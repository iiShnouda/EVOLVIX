using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/purchases")]
[Authorize(Policy = Permissions.PurchasesView)]
public sealed class PurchasesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly ReturnsService _returns;
    private readonly AuditService _audit;
    private readonly MoneyService _money;
    private readonly LedgerService _ledger;

    public PurchasesController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        ReturnsService returns, AuditService audit, MoneyService money, LedgerService ledger)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _returns = returns;
        _audit = audit;
        _money = money;
        _ledger = ledger;
    }

    [HttpGet("invoices")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null) =>
        ListAsync(DocumentType.PURCHASE_INVOICE, page, pageSize, search);

    /// <summary>Purchase returns (مرتجعات المشتريات), newest first.</summary>
    [HttpGet("returns")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> Returns(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null) =>
        ListAsync(DocumentType.PURCHASE_RETURN, page, pageSize, search);

    private async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> ListAsync(
        DocumentType type, int page, int pageSize, string? search)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == type);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(d => d.Number.ToLower().Contains(s) || d.Party!.Name.ToLower().Contains(s));
        }

        var total = await q.CountAsync();
        var rows = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.SourceDocument)
            .OrderByDescending(d => d.IssueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Ok(new PaginatedDto<SalesSummaryDto>(
            rows.Select(Mapper.ToSummary).ToArray(), total, page, pageSize));
    }

    /// <summary>One purchase invoice or purchase return (invoice lines carry the returned quantity).</summary>
    [HttpGet("invoices/{id:guid}")]
    [HttpGet("returns/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id &&
            (d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN));
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        var doc = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .Include(d => d.Lines).ThenInclude(l => l.Unit)
            .Include(d => d.SourceDocument).Include(d => d.PriceLevel)
            .Include(d => d.Charges).Include(d => d.Rep).Include(d => d.Driver).Include(d => d.Carrier)
            .Include(d => d.PaidAccount)
            .AsSplitQuery()
            .FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found" });

        var returned = doc.Type == DocumentType.PURCHASE_INVOICE ? await _returns.ReturnedByLineAsync(doc.Id) : null;
        return Ok(Mapper.ToDetail(doc, returned, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    /// <summary>
    /// Create a purchase invoice: receive stock and recompute each product's weighted-average cost.
    /// This is what makes future sales' COGS and profit correct. Commits atomically. Lines may be in
    /// any of the item's units; a carton bought at 100.00 brings exactly 100.00 into the average.
    /// The cost comes from the supplier's price level (or the current average cost for an item
    /// without one); another cost needs <c>purchases:change_price</c>.
    /// </summary>
    [HttpPost("invoices")]
    [Authorize(Policy = Permissions.PurchasesCreate)]
    public async Task<ActionResult<SalesDetailDto>> Create([FromBody] CreatePurchaseInvoiceRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines per invoice.", code = "too_many_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A supplier is required.", code = "no_party" });

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Supplier not found.", code = "party_not_found" });

        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        bool Can(string permission) => User.HasClaim("permission", permission);
        var canChangePrice = Can(Permissions.PurchasesChangePrice);

        // Invoice charges: a supplier's discount (خصم مكتسب) comes off the goods' cost; taxes and
        // additions (e.g. freight) are owed to the supplier but are not part of the goods' cost.
        var (specs, chargeError) = Charges.Parse(req.Charges, req.TaxPercent, settings.DefaultTaxPercent);
        if (chargeError is not null) return BadRequest(new { message = chargeError.Message, code = chargeError.Code });
        if (specs!.Any(c => c.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT) && !Can(Permissions.PurchasesDiscount))
            return InvoiceLines.Refuse(this, new("discount_not_allowed", "Entering a supplier discount needs permission."));
        if (specs!.Any(c => c.Kind == ChargeKind.ADDITION) && !Can(Permissions.PurchasesAdditions))
            return InvoiceLines.Refuse(this, new("additions_not_allowed", "Adding charges needs permission."));
        if (!Can(Permissions.PurchasesChangeTax) && !Charges.IsDefaultTax(specs!, settings.DefaultTaxPercent))
            return InvoiceLines.Refuse(this, new("tax_not_allowed",
                $"The tax is {settings.DefaultTaxPercent}%. Changing it needs permission."));

        // Shape checks and the warehouse each line is received into.
        var cache = new Dictionary<string, Warehouse>();
        var lines = new List<(CreatePurchaseLineRequest Req, Guid ProductId, Guid? UnitId, Warehouse Warehouse)>();
        foreach (var line in req.Lines)
        {
            var shape = InvoiceLines.CheckShape(line.ProductId, line.UnitId, line.Quantity, line.UnitCost, 0);
            if (shape.Error is not null)
                return BadRequest(new { message = shape.Error.Message, code = shape.Error.Code == "bad_price" ? "bad_cost" : shape.Error.Code });
            if (line.IsBonus)
            {
                if (!Can(Permissions.PurchasesBonus))
                    return InvoiceLines.Refuse(this, new("bonus_not_allowed", "Entering free goods needs permission."));
                if (line.UnitCost != 0)
                    return BadRequest(new { message = "Free goods have no cost.", code = "bad_bonus" });
            }
            var (warehouse, whError) = await _warehouses.ResolveAsync(User, line.WarehouseId ?? req.WarehouseId, cache);
            if (whError is not null) return BadRequest(new { message = whError.Message, code = whError.Code });
            lines.Add((line, shape.ProductId, shape.UnitId, warehouse!));
        }

        // Receipts move the weighted average, so the items are locked like any other stock change.
        await using var tx = await _db.Database.BeginTransactionAsync();
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
        if (lines.Any(l => !products.TryGetValue(l.ProductId, out var pr) || !pr.IsActive))
            return BadRequest(new { message = "A product on the invoice was not found.", code = "product_not_found" });
        var book = await PriceBook.LoadAsync(_db, products.Keys);

        var (level, levelError) = InvoiceLines.ResolveLevel(book, req.PriceLevelId, party.PurchasePriceLevelId,
            PriceSide.PURCHASE, Can(Permissions.PurchasesChoosePriceLevel));
        if (levelError is not null) return InvoiceLines.Refuse(this, levelError);

        var resolved = new List<(CreatePurchaseLineRequest Req, Product Product, ItemUnit Unit, int BaseQty, Warehouse Warehouse)>();
        foreach (var (line, pid, unitId, warehouse) in lines)
        {
            var product = products[pid];
            var (unit, baseQty, unitError) = InvoiceLines.ResolveUnit(book, product, unitId, line.Quantity);
            if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });
            if (!canChangePrice && !line.IsBonus)
            {
                var baseCost = _inventory.CostAt(product, warehouse);
                var expected = level is null
                    ? baseCost * unit!.Factor
                    : book.SuggestedPurchase(pid, unit!, level.Id, baseCost);
                if (line.UnitCost != expected)
                    return InvoiceLines.Refuse(this, new("price_not_allowed",
                        $"{Loc.Name(product)}: the cost is {InvoiceLines.Major(expected)} per {Loc.Name(unit!.Unit)}. " +
                        "Changing a cost needs permission."));
            }
            resolved.Add((line, product, unit!, baseQty, warehouse));
        }

        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitCost).ToList();
        var (charges, applyError) = Charges.Apply(nets, resolved.Select(r => !r.Req.IsBonus).ToList(), specs!);
        if (applyError is not null) return BadRequest(new { message = applyError.Message, code = applyError.Code });

        var number = await DocumentNumbers.NextAsync(_db, DocumentType.PURCHASE_INVOICE);
        var doc = new SalesDocument
        {
            Number = number, Type = DocumentType.PURCHASE_INVOICE, BranchId = branchId,
            PartyId = partyId, StaffId = staffId, IssueDate = DateTime.UtcNow,
            DueDate = ParseDate(req.DueDate), Currency = settings.Currency, Notes = req.Notes,
            PriceLevelId = level?.Id,
        };

        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, baseQty, warehouse) = resolved[i];
            var lineTotal = (long)line.Quantity * line.UnitCost;
            var docDiscount = charges!.Allocation[i];
            // The goods cost what was paid for them after the supplier's discount; free goods cost
            // nothing and so lower the average.
            var lineCost = lineTotal - docDiscount;
            _inventory.ReceiveValue(product, warehouse, baseQty, lineCost,
                StockMovementType.PURCHASE_IN, doc.Id, number);

            doc.Lines.Add(new DocumentLine
            {
                LineNo = doc.Lines.Count + 1,
                ProductId = product.Id, ProductName = product.Name, Quantity = baseQty,
                UnitId = unit.UnitId, UnitFactor = unit.Factor, UnitQuantity = line.Quantity,
                UnitPrice = line.UnitCost, Discount = 0, LineTotal = lineTotal,
                IsBonus = line.IsBonus, DocDiscount = docDiscount,
                // Cost of one base unit, for display; LineCost is the exact amount paid.
                UnitCost = (long)decimal.Round((decimal)lineCost / baseQty, MidpointRounding.AwayFromZero),
                LineCost = lineCost, LineProfit = 0,
                WarehouseId = warehouse.Id, Warehouse = warehouse,
            });
        }
        foreach (var c in charges!.Rows) doc.Charges.Add(c);

        var subtotal = doc.Lines.Sum(l => l.LineTotal);
        var net = subtotal - charges.Discount;
        var grand = net + charges.Tax + charges.Addition;

        doc.Subtotal = subtotal;
        doc.DiscountTotal = charges.Discount;
        doc.TaxTotal = charges.Tax;
        doc.AdditionTotal = charges.Addition;
        doc.GrandTotal = grand;
        doc.CostTotal = net;
        doc.ProfitTotal = 0;
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // We owe the supplier the unpaid balance (payable → negative).
        await MoneyService.LockPartiesAsync(_db, party.Id);
        party.Balance -= grand - doc.PaidAmount;

        // Money paid now leaves a money account (the one picked, else the branch's cash box), which
        // must hold it.
        MoneyAccount? paidFrom = null;
        if (doc.PaidAmount > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(req.PaidAccountId, branchId, MoneyService.ScopeOf(User));
            moneyError ??= _money.Move(account!, -doc.PaidAmount, MoneyMovementKind.PURCHASE_PAID, staffId, doc.Number,
                documentId: doc.Id, partyId: party.Id);
            if (moneyError is not null) return BadRequest(new { message = moneyError.Message, code = moneyError.Code });
            paidFrom = account!;
            doc.PaidAccountId = account!.Id;
        }
        await _ledger.PostPurchaseInvoiceAsync(doc, party, paidFrom, staffId);

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "purchase_invoice",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/purchases/invoices/{doc.Id}", Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    /// <summary>
    /// Purchase return (مرتجع مشتريات) against invoice <paramref name="id"/>: goods leave stock at
    /// the price we paid, the weighted average is backed out, and the payable drops (minus any cash
    /// the supplier refunds now). Refused for goods no longer in stock.
    /// </summary>
    [HttpPost("invoices/{id:guid}/returns")]
    [Authorize(Policy = Permissions.PurchasesReturn)]
    public async Task<ActionResult<SalesDetailDto>> CreateReturn(Guid id, [FromBody] CreateReturnRequest req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        Guid? scope = null;
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            scope = branchId;
        }

        var (doc, error) = await _returns.CreateAsync(id, DocumentType.PURCHASE_INVOICE, req, scope, staffId);
        if (error is not null)
        {
            var body = new { message = error.Message, code = error.Code };
            return error.Code == "not_found" ? NotFound(body) : BadRequest(body);
        }

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "purchase_return",
            doc!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/purchases/returns/{doc.Id}", Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var d)
            ? d : null;
}
