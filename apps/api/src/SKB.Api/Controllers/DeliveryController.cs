using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Delivery (التوصيل — DOMAIN.md §2.5). A sale is picked up, delivered by our driver, or handed to a
/// shipping company:
/// <list type="bullet">
/// <item><b>Own delivery:</b> the sale moves PENDING → OUT_FOR_DELIVERY → DELIVERED, or RETURNED.</item>
/// <item><b>Shipping company:</b> its invoices go in a <see cref="Shipment"/> (waybill, بوليصة):
/// CREATED → PICKED_UP → DELIVERED → SETTLED, or RETURNED (refused) / CANCELLED. With cash on
/// delivery, delivering moves the customer's debt to the carrier (the invoices count as paid), and
/// a <see cref="CarrierSettlement"/> clears it when the carrier pays, net of its fees; anything short
/// stays on the carrier's balance.</item>
/// <item>A refused parcel can post full sales returns of its goods (needs <c>sales:return</c>).</item>
/// </list>
/// Seeing needs <c>delivery:view</c>, moving things along <c>delivery:manage</c>, settling
/// <c>delivery:settle</c>. Branch-scoped users see their branch's. Cash received lands in a cash
/// box once cash boxes exist (step 5); fees post to the ledger with step 6.
/// </summary>
[ApiController]
[Route("api")]
[Authorize(Policy = Permissions.DeliveryView)]
public sealed class DeliveryController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ReturnsService _returns;
    private readonly AuditService _audit;
    private readonly MoneyService _money;
    private readonly LedgerService _ledger;

    public DeliveryController(AppDbContext db, ReturnsService returns, AuditService audit, MoneyService money,
        LedgerService ledger)
    {
        _db = db;
        _returns = returns;
        _audit = audit;
        _money = money;
        _ledger = ledger;
    }

    private static readonly ShipmentStatus[] Live =
        { ShipmentStatus.CREATED, ShipmentStatus.PICKED_UP, ShipmentStatus.DELIVERED, ShipmentStatus.SETTLED };

    // ------------------------------------------------------------------ deliveries

    /// <summary>Sales that are delivered (not picked up), newest first; filter by status and method.</summary>
    [HttpGet("deliveries")]
    public async Task<ActionResult<PaginatedDto<DeliveryDto>>> Deliveries(
        [FromQuery] string? status = null, [FromQuery] string? method = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 30)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = ScopedDocs().Where(d => d.Type == DocumentType.SALES_INVOICE && d.DeliveryMethod != DeliveryMethod.PICKUP);
        if (Enum.TryParse<DeliveryStatus>(status, true, out var st)) q = q.Where(d => d.DeliveryStatus == st);
        if (Enum.TryParse<DeliveryMethod>(method, true, out var m)) q = q.Where(d => d.DeliveryMethod == m);

        var total = await q.CountAsync();
        var docs = await q.Include(d => d.Party).Include(d => d.Branch).Include(d => d.Driver).Include(d => d.Carrier)
            .OrderByDescending(d => d.IssueDate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var shipments = await ShipmentOfAsync(docs.Select(d => d.Id).ToList());
        var owed = await OwedAsync(docs);
        return Ok(new PaginatedDto<DeliveryDto>(
            docs.Select(d => ToDelivery(d, shipments.GetValueOrDefault(d.Id), owed[d.Id])).ToArray(),
            total, page, pageSize));
    }

    /// <summary>
    /// Move an own-delivery sale along: OUT_FOR_DELIVERY (optionally naming the driver), DELIVERED,
    /// or RETURNED — with <c>CreateReturn</c>, the goods come back through a full sales return.
    /// Sales sent with a shipping company move with their shipment instead.
    /// </summary>
    [HttpPut("sales/invoices/{id:guid}/delivery")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public async Task<ActionResult<DeliveryActionDto>> SetDelivery(Guid id, [FromBody] SetDeliveryStatusRequest req)
    {
        if (!Enum.TryParse<DeliveryStatus>(req.Status, true, out var next) || next == DeliveryStatus.PENDING)
            return Bad("bad_status", "Choose out for delivery, delivered or returned.");
        if (next == DeliveryStatus.RETURNED && req.CreateReturn && !Can(Permissions.SalesReturn))
            return Refused("return_not_allowed", "Posting a sales return needs permission.");

        await using (var tx = await _db.Database.BeginTransactionAsync())
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
            var doc = await ScopedDocs().FirstOrDefaultAsync(d => d.Id == id && d.Type == DocumentType.SALES_INVOICE);
            if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
            if (doc.DeliveryMethod == DeliveryMethod.SHIPPING_COMPANY)
                return Bad("use_shipment", "This sale goes with a shipping company: move its shipment instead.");
            if (doc.DeliveryMethod != DeliveryMethod.OWN_DELIVERY)
                return Bad("not_delivered", "This sale is picked up by the customer.");
            if (doc.Status == DocumentStatus.CANCELLED
                || (doc.Status == DocumentStatus.RETURNED && next != DeliveryStatus.RETURNED))
                return Bad("invoice_closed", "This invoice is cancelled or already returned.");
            var now = doc.DeliveryStatus ?? DeliveryStatus.PENDING;
            var allowed = now switch
            {
                DeliveryStatus.PENDING => next is DeliveryStatus.OUT_FOR_DELIVERY or DeliveryStatus.DELIVERED or DeliveryStatus.RETURNED,
                DeliveryStatus.OUT_FOR_DELIVERY => next is DeliveryStatus.DELIVERED or DeliveryStatus.RETURNED,
                _ => false,
            };
            if (!allowed) return Bad("bad_transition", $"This delivery is already {now}.");
            if (!string.IsNullOrWhiteSpace(req.DriverId))
            {
                if (!Guid.TryParse(req.DriverId, out var driver) || !await _db.Staff.AnyAsync(s => s.Id == driver && s.IsActive))
                    return Bad("driver_not_found", "Driver not found.");
                doc.DriverId = driver;
            }
            doc.DeliveryStatus = next;
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            await AuditAsync("delivery_" + next.ToString().ToLowerInvariant(), "sales_invoice", doc.Id, doc.BranchId);
        }

        var (returned, problems) = next == DeliveryStatus.RETURNED && req.CreateReturn
            ? await ReturnAllAsync(new[] { id })
            : (new List<string>(), new List<string>());
        var fresh = await ScopedDocs().AsNoTracking().Include(d => d.Party).Include(d => d.Branch).Include(d => d.Driver)
            .Include(d => d.Carrier).FirstAsync(d => d.Id == id);
        var owed = await OwedAsync(new List<SalesDocument> { fresh });
        return Ok(new DeliveryActionDto(ToDelivery(fresh, null, owed[id]), returned.ToArray(), problems.ToArray()));
    }

    // ------------------------------------------------------------------ shipments

    [HttpGet("shipments")]
    public async Task<ActionResult<PaginatedDto<ShipmentDto>>> Shipments(
        [FromQuery] string? status = null, [FromQuery] string? carrierId = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 30)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = ScopedShipments();
        if (Enum.TryParse<ShipmentStatus>(status, true, out var st)) q = q.Where(s => s.Status == st);
        if (Guid.TryParse(carrierId, out var carrier)) q = q.Where(s => s.CarrierId == carrier);
        var total = await q.CountAsync();
        var rows = await WithDetails(q).OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(new PaginatedDto<ShipmentDto>(rows.Select(s => ToDto(s, currency)).ToArray(), total, page, pageSize));
    }

    [HttpGet("shipments/{id:guid}")]
    public async Task<ActionResult<ShipmentDto>> Shipment(Guid id)
    {
        var s = await WithDetails(ScopedShipments()).FirstOrDefaultAsync(x => x.Id == id);
        return s is null ? NotFound(new { message = "Shipment not found.", code = "not_found" }) : Ok(ToDto(s, await CurrencyAsync()));
    }

    /// <summary>Sales waiting for a shipment with a carrier: sent by it and not on a live shipment.</summary>
    [HttpGet("shipments/eligible")]
    public async Task<ActionResult<DeliveryDto[]>> Eligible([FromQuery] string? carrierId = null)
    {
        if (!Guid.TryParse(carrierId, out var carrier)) return Ok(Array.Empty<DeliveryDto>());
        var shipped = _db.ShipmentInvoices.Where(x => Live.Contains(x.Shipment!.Status)).Select(x => x.DocumentId);
        var docs = await ScopedDocs()
            .Where(d => d.Type == DocumentType.SALES_INVOICE && d.DeliveryMethod == DeliveryMethod.SHIPPING_COMPANY
                        && d.CarrierId == carrier && d.Status != DocumentStatus.CANCELLED
                        && d.Status != DocumentStatus.RETURNED && !shipped.Contains(d.Id))
            .Include(d => d.Party).Include(d => d.Branch).Include(d => d.Carrier)
            .OrderBy(d => d.IssueDate).ToListAsync();
        var owed = await OwedAsync(docs);
        return Ok(docs.Select(d => ToDelivery(d, null, owed[d.Id])).ToArray());
    }

    /// <summary>
    /// Hand one customer's invoices to a carrier. Cash on delivery defaults to what is still owed on
    /// them (0 = prepaid) and is shared over the invoices in date order.
    /// </summary>
    [HttpPost("shipments")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public async Task<ActionResult<ShipmentDto>> Create([FromBody] CreateShipmentRequest req)
    {
        if (!Guid.TryParse(req.CarrierId, out var carrierId)) return Bad("carrier_not_found", "Choose the shipping company.");
        var ids = new List<Guid>();
        foreach (var raw in req.InvoiceIds ?? Array.Empty<string>())
        {
            if (!Guid.TryParse(raw, out var id) || ids.Contains(id)) return Bad("invoice_not_found", "An invoice was not found.");
            ids.Add(id);
        }
        if (ids.Count == 0) return Bad("no_invoices", "Choose the invoices in the parcel.");
        if (ids.Count > 50) return Bad("no_invoices", "At most 50 invoices per shipment.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var carrier = await _db.Parties.FirstOrDefaultAsync(p => p.Id == carrierId && p.IsActive
            && p.Types.Contains(nameof(PartyType.CARRIER)));
        if (carrier is null) return Bad("carrier_not_found", "Choose the shipping company.");

        // Lock the invoices so two people can't put one invoice in two parcels at the same moment.
        var ordered = ids.OrderBy(i => i).ToArray();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        var docs = await ScopedDocs().Where(d => ids.Contains(d.Id) && d.Type == DocumentType.SALES_INVOICE).ToListAsync();
        if (docs.Count != ids.Count) return Bad("invoice_not_found", "An invoice was not found.");
        if (docs.Any(d => d.Status is DocumentStatus.CANCELLED or DocumentStatus.RETURNED))
            return Bad("invoice_closed", "A cancelled or returned invoice can't be shipped.");
        if (docs.Any(d => d.DeliveryMethod != DeliveryMethod.SHIPPING_COMPANY || d.CarrierId != carrierId))
            return Bad("wrong_carrier", "Every invoice must be sent with this shipping company.");
        if (docs.Select(d => d.PartyId).Distinct().Count() != 1)
            return Bad("mixed_customers", "A parcel goes to one customer.");
        if (docs.Select(d => d.BranchId).Distinct().Count() != 1)
            return Bad("mixed_branches", "A parcel comes from one branch.");
        if (await _db.ShipmentInvoices.AnyAsync(x => ids.Contains(x.DocumentId) && Live.Contains(x.Shipment!.Status)))
            return Bad("already_shipped", "An invoice is already in another parcel.");

        var dues = await OwedAsync(docs);
        var owed = docs.OrderBy(d => d.IssueDate).ThenBy(d => d.Number)
            .Select(d => (Doc: d, Owed: dues[d.Id])).ToList();
        var cod = req.CodAmount ?? owed.Sum(o => o.Owed);
        if (cod < 0 || cod > owed.Sum(o => o.Owed))
            return Bad("bad_cod", "Cash on delivery can't be more than what is still owed on the invoices.");

        var waybill = req.WaybillNo?.Trim();
        var shipment = new Shipment
        {
            Number = await DocumentNumbers.NextShipmentAsync(_db), CarrierId = carrierId, PartyId = docs[0].PartyId,
            BranchId = docs[0].BranchId, CodAmount = cod,
            WaybillNo = string.IsNullOrEmpty(waybill) ? null : waybill[..Math.Min(60, waybill.Length)],
            Notes = Text(req.Notes, 500), CreatedById = Me(),
        };
        var left = cod;
        foreach (var (doc, due) in owed)
        {
            var share = Math.Min(left, due);
            left -= share;
            shipment.Invoices.Add(new ShipmentInvoice { DocumentId = doc.Id, CodShare = share });
            doc.DeliveryStatus = DeliveryStatus.PENDING;
        }
        _db.Shipments.Add(shipment);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "shipment", shipment.Id, shipment.BranchId);
        return Created($"/api/shipments/{shipment.Id}", ToDto(await ReloadAsync(shipment.Id), await CurrencyAsync()));
    }

    [HttpPost("shipments/{id:guid}/picked-up")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public Task<ActionResult<ShipmentDto>> PickedUp(Guid id) =>
        MoveAsync(id, "picked_up", ShipmentStatus.PICKED_UP, s =>
        {
            if (s.Status != ShipmentStatus.CREATED) return "Only a new parcel can be picked up.";
            s.PickedUpAt = DateTime.UtcNow;
            return null;
        }, DeliveryStatus.OUT_FOR_DELIVERY);

    /// <summary>
    /// The carrier delivered the parcel. With cash on delivery the customer has paid the carrier: the
    /// customer's debt moves to the carrier, and each invoice counts its share as paid.
    /// </summary>
    [HttpPost("shipments/{id:guid}/delivered")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public Task<ActionResult<ShipmentDto>> Delivered(Guid id) =>
        MoveAsync(id, "delivered", ShipmentStatus.DELIVERED, s =>
        {
            if (s.Status is not (ShipmentStatus.CREATED or ShipmentStatus.PICKED_UP))
                return "Only a parcel on its way can be delivered.";
            s.DeliveredAt = DateTime.UtcNow;
            s.PickedUpAt ??= s.DeliveredAt;
            if (s.CodAmount > 0)
            {
                s.Party!.Balance -= s.CodAmount;
                s.Carrier!.Balance += s.CodAmount;
                foreach (var si in s.Invoices)
                {
                    var doc = si.Document!;
                    doc.PaidAmount = Math.Min(doc.GrandTotal, doc.PaidAmount + si.CodShare);
                    if (doc.Status != DocumentStatus.RETURNED)
                        doc.Status = doc.PaidAmount >= doc.GrandTotal ? DocumentStatus.PAID
                            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID : doc.Status;
                }
            }
            return null;
        }, DeliveryStatus.DELIVERED);

    /// <summary>
    /// The customer refused the parcel and it came back: nothing is collected. With
    /// <c>CreateReturns</c> the goods come back into stock through full sales returns.
    /// </summary>
    [HttpPost("shipments/{id:guid}/returned")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public async Task<ActionResult<ShipmentActionDto>> Returned(Guid id, [FromBody] ShipmentReturnRequest? req)
    {
        var createReturns = req?.CreateReturns ?? true;
        if (createReturns && !Can(Permissions.SalesReturn))
            return Refused("return_not_allowed", "Posting a sales return needs permission.");
        var moved = await MoveAsync(id, "returned", ShipmentStatus.RETURNED, s =>
        {
            if (s.Status is not (ShipmentStatus.CREATED or ShipmentStatus.PICKED_UP))
                return "Only a parcel on its way can come back.";
            s.ReturnedAt = DateTime.UtcNow;
            return null;
        }, DeliveryStatus.RETURNED);
        if (moved.Result is not OkObjectResult { Value: ShipmentDto dto }) return moved.Result!;

        var (returned, problems) = createReturns
            ? await ReturnAllAsync(dto.Invoices.Select(i => Guid.Parse(i.DocumentId)).ToList())
            : (new List<string>(), new List<string>());
        return Ok(new ShipmentActionDto(dto, returned.ToArray(), problems.ToArray()));
    }

    [HttpPost("shipments/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.DeliveryManage)]
    public Task<ActionResult<ShipmentDto>> Cancel(Guid id) =>
        MoveAsync(id, "cancel", ShipmentStatus.CANCELLED, s =>
        {
            if (s.Status != ShipmentStatus.CREATED) return "Only a parcel the carrier hasn't taken can be cancelled.";
            s.CancelledAt = DateTime.UtcNow;
            return null;
        }, DeliveryStatus.PENDING);

    // ------------------------------------------------------------------ settlements

    [HttpGet("carrier-settlements")]
    public async Task<ActionResult<CarrierSettlementDto[]>> Settlements([FromQuery] string? carrierId = null)
    {
        var q = _db.CarrierSettlements.AsNoTracking().Include(x => x.Carrier).Include(x => x.CreatedBy)
            .Include(x => x.Account).Include(x => x.Shipments).AsQueryable();
        if (Guid.TryParse(carrierId, out var carrier)) q = q.Where(x => x.CarrierId == carrier);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            var branch = MyBranch();
            q = q.Where(x => x.Shipments.Any(s => s.BranchId == branch));
        }
        var rows = await q.OrderByDescending(x => x.CreatedAt).Take(200).AsSplitQuery().ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(rows.Select(x => ToDto(x, currency)).ToArray());
    }

    /// <summary>
    /// A carrier pays for delivered cash-on-delivery parcels, keeping its fees. The carrier's balance
    /// drops by what it paid plus the fees; anything short stays owed. The parcels become SETTLED.
    /// </summary>
    [HttpPost("carrier-settlements")]
    [Authorize(Policy = Permissions.DeliverySettle)]
    public async Task<ActionResult<CarrierSettlementDto>> Settle([FromBody] CreateSettlementRequest req)
    {
        if (!Guid.TryParse(req.CarrierId, out var carrierId)) return Bad("carrier_not_found", "Choose the shipping company.");
        if (req.Fees < 0 || req.Received < 0 || req.Fees > InvoiceLines.MaxPrice || req.Received > InvoiceLines.MaxPrice)
            return Bad("bad_amount", "Amounts can't be negative.");
        var ids = new List<Guid>();
        foreach (var raw in req.ShipmentIds ?? Array.Empty<string>())
        {
            if (!Guid.TryParse(raw, out var id) || ids.Contains(id)) return Bad("shipment_not_found", "A shipment was not found.");
            ids.Add(id);
        }
        if (ids.Count == 0) return Bad("no_shipments", "Choose the parcels the carrier is paying for.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var ordered = ids.OrderBy(i => i).ToArray();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"Shipments\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        var carrier = await _db.Parties.FirstOrDefaultAsync(p => p.Id == carrierId && p.Types.Contains(nameof(PartyType.CARRIER)));
        if (carrier is null) return Bad("carrier_not_found", "Choose the shipping company.");
        var shipments = await ScopedShipments().Where(s => ids.Contains(s.Id)).ToListAsync();
        if (shipments.Count != ids.Count) return Bad("shipment_not_found", "A shipment was not found.");
        if (shipments.Any(s => s.CarrierId != carrierId)) return Bad("wrong_carrier", "Every parcel must be this carrier's.");
        if (shipments.Any(s => s.Status != ShipmentStatus.DELIVERED || s.CodAmount == 0))
            return Bad("not_settleable", "Only delivered cash-on-delivery parcels, not yet settled, can be settled.");

        var codTotal = shipments.Sum(s => s.CodAmount);
        var settlement = new CarrierSettlement
        {
            Number = await DocumentNumbers.NextSettlementAsync(_db), CarrierId = carrierId, CodTotal = codTotal,
            Fees = req.Fees, Received = req.Received, Difference = codTotal - req.Fees - req.Received,
            Notes = Text(req.Notes, 500), CreatedById = Me(),
        };
        foreach (var s in shipments)
        {
            s.Status = ShipmentStatus.SETTLED;
            s.Settlement = settlement;
        }
        // The carrier owed the parcels' COD; it has paid what it paid, and kept its fees. What it paid
        // lands in a money account (the one picked, else the branch's cash box).
        await MoneyService.LockPartiesAsync(_db, carrierId);
        carrier.Balance -= req.Received + req.Fees;
        MoneyAccount? into = null;
        if (req.Received > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(req.AccountId, shipments[0].BranchId, MoneyService.ScopeOf(User));
            if (moneyError is not null) return Bad(moneyError.Code, moneyError.Message);
            into = account!;
            settlement.AccountId = account!.Id;
            _money.Move(account, req.Received, MoneyMovementKind.CARRIER_SETTLEMENT, Me(), settlement.Number,
                partyId: carrierId, settlementId: settlement.Id);
        }
        await _ledger.PostSettlementAsync(settlement, carrier, into, shipments[0].BranchId, Me());
        _db.CarrierSettlements.Add(settlement);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "carrier_settlement", settlement.Id, shipments[0].BranchId);

        var saved = await _db.CarrierSettlements.AsNoTracking().Include(x => x.Carrier).Include(x => x.CreatedBy)
            .Include(x => x.Account).Include(x => x.Shipments).FirstAsync(x => x.Id == settlement.Id);
        return Created($"/api/carrier-settlements/{settlement.Id}", ToDto(saved, await CurrencyAsync()));
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>Lock a shipment, check and apply a step, keep its invoices' delivery status in step.</summary>
    private async Task<ActionResult<ShipmentDto>> MoveAsync(Guid id, string action, ShipmentStatus next,
        Func<Shipment, string?> apply, DeliveryStatus invoiceStatus)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Shipments\" WHERE \"Id\" = {id} FOR UPDATE");
        var s = await ScopedShipments().Include(x => x.Carrier).Include(x => x.Party)
            .Include(x => x.Invoices).ThenInclude(i => i.Document)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (s is null) return NotFound(new { message = "Shipment not found.", code = "not_found" });
        await MoneyService.LockPartiesAsync(_db, s.PartyId, s.CarrierId);
        var problem = apply(s);
        if (problem is not null) return Bad("bad_transition", problem);
        if (next == ShipmentStatus.DELIVERED && s.CodAmount > 0) await _ledger.PostCodDeliveredAsync(s, Me());
        s.Status = next;
        foreach (var si in s.Invoices) si.Document!.DeliveryStatus = invoiceStatus;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync(action, "shipment", s.Id, s.BranchId);
        return Ok(ToDto(await ReloadAsync(id), await CurrencyAsync()));
    }

    /// <summary>Post full sales returns (everything still on them) for refused invoices. Never throws.</summary>
    private async Task<(List<string> Returns, List<string> Problems)> ReturnAllAsync(IList<Guid> invoiceIds)
    {
        var returns = new List<string>();
        var problems = new List<string>();
        Guid? scope = CurrentUser.CanSeeAllBranches(User) ? null : MyBranch();
        foreach (var invoiceId in invoiceIds)
        {
            var lines = await _db.DocumentLines.AsNoTracking().Where(l => l.DocumentId == invoiceId).ToListAsync();
            var done = await _returns.ReturnedByLineAsync(invoiceId);
            var left = lines.Select(l => new CreateReturnLineRequest(l.Id.ToString(),
                    l.Quantity - (done.TryGetValue(l.Id, out var r) ? r.Quantity : 0)))
                .Where(l => l.Quantity > 0).ToArray();
            var number = await _db.SalesDocuments.Where(d => d.Id == invoiceId).Select(d => d.Number).FirstAsync();
            if (left.Length == 0) continue;
            _db.ChangeTracker.Clear();
            var (doc, error) = await _returns.CreateAsync(invoiceId, DocumentType.SALES_INVOICE,
                new CreateReturnRequest(left, 0, "Refused delivery"), scope, Me());
            if (error is not null) problems.Add($"{number}: {error.Message}");
            else
            {
                returns.Add(doc!.Number);
                await AuditAsync("create", "sales_return", doc.Id, doc.BranchId);
            }
        }
        return (returns, problems);
    }

    private IQueryable<SalesDocument> ScopedDocs()
    {
        var q = _db.SalesDocuments.AsQueryable();
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            var branch = MyBranch();
            q = q.Where(d => d.BranchId == branch);
        }
        return q;
    }

    private IQueryable<Shipment> ScopedShipments()
    {
        var q = _db.Shipments.AsQueryable();
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            var branch = MyBranch();
            q = q.Where(s => s.BranchId == branch);
        }
        return q;
    }

    private static IQueryable<Shipment> WithDetails(IQueryable<Shipment> q) => q.AsNoTracking()
        .Include(s => s.Carrier).Include(s => s.Party).Include(s => s.Branch).Include(s => s.CreatedBy)
        .Include(s => s.Settlement).Include(s => s.Invoices).ThenInclude(i => i.Document)
        .AsSplitQuery();

    private Task<Shipment> ReloadAsync(Guid id) => WithDetails(_db.Shipments).FirstAsync(s => s.Id == id);

    /// <summary>The live shipment (if any) each document is on.</summary>
    private async Task<Dictionary<Guid, Shipment>> ShipmentOfAsync(List<Guid> docIds) =>
        (await _db.ShipmentInvoices.AsNoTracking().Include(x => x.Shipment)
            .Where(x => docIds.Contains(x.DocumentId) && Live.Contains(x.Shipment!.Status))
            .ToListAsync())
        .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.First().Shipment!);

    /// <summary>
    /// What the customer still owes on each invoice: grand total − paid, less what its sales returns
    /// put back on the customer's account (a return credits the account, not the invoice).
    /// </summary>
    private Task<Dictionary<Guid, long>> OwedAsync(IReadOnlyCollection<SalesDocument> docs) =>
        MoneyService.OutstandingAsync(_db, docs);

    private static DeliveryDto ToDelivery(SalesDocument d, Shipment? s, long owed) => new(
        d.Id.ToString(), d.Number, d.IssueDate.ToString("o"), d.PartyId.ToString(), d.Party?.Name ?? "",
        Loc.Name(d.Branch), d.DeliveryMethod.ToString(), d.DeliveryStatus?.ToString(), d.DeliveryAddress,
        d.Driver?.FullName, d.CarrierId?.ToString(), d.Carrier?.Name,
        d.GrandTotal, owed, d.Currency,
        s?.Id.ToString(), s?.Number, s?.Status.ToString());

    private static ShipmentDto ToDto(Shipment s, string currency) => new(
        s.Id.ToString(), s.Number, s.WaybillNo, s.Status.ToString(), s.CarrierId.ToString(), s.Carrier?.Name ?? "",
        s.PartyId.ToString(), s.Party?.Name ?? "", Loc.Name(s.Branch), s.CodAmount, s.Notes,
        s.CreatedAt.ToString("o"), s.CreatedBy?.FullName ?? "", s.PickedUpAt?.ToString("o"),
        s.DeliveredAt?.ToString("o"), s.ReturnedAt?.ToString("o"), s.CancelledAt?.ToString("o"),
        s.SettlementId?.ToString(), s.Settlement?.Number,
        s.Invoices.OrderBy(i => i.Document?.Number).Select(i => new ShipmentInvoiceDto(
            i.DocumentId.ToString(), i.Document?.Number ?? "", i.Document?.GrandTotal ?? 0, i.CodShare)).ToArray(),
        currency);

    private static CarrierSettlementDto ToDto(CarrierSettlement x, string currency) => new(
        x.Id.ToString(), x.Number, x.CarrierId.ToString(), x.Carrier?.Name ?? "", x.CodTotal, x.Fees, x.Received,
        x.Difference, x.Notes, x.CreatedAt.ToString("o"), x.CreatedBy?.FullName ?? "",
        x.Shipments.OrderBy(s => s.Number).Select(s => s.Number).ToArray(), currency,
        x.Account is null ? null : Loc.Name(x.Account));

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private bool Can(string permission) => User.HasClaim("permission", permission);
    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;
    private Guid MyBranch() => Guid.TryParse(CurrentUser.BranchId(User), out var id) ? id : Guid.Empty;

    private static string? Text(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });
    private ObjectResult Refused(string code, string message) => StatusCode(403, new { message, code });

    private Task AuditAsync(string action, string resource, Guid id, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource, branchId.ToString(),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(),
            id.ToString());
}
