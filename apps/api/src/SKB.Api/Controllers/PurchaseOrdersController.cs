using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Purchase orders to a factory (أوامر الشراء, owner 2026-11-18): «a page where I order a purchase
/// invoice from a factory, with suggestions from the items I have and items I'll bring new». An order
/// lists items in the catalog (offered from the "what to buy" suggestions for that supplier) and new
/// items only named; it goes DRAFT → SENT → PARTLY_RECEIVED / RECEIVED, or CANCELLED. It is no
/// accounting document: nothing here touches stock, money or the ledger. Its goods come in on an
/// ordinary purchase invoice that names it (<see cref="PurchaseOrders.ReceiveAsync"/>). Every change
/// is in the activity log; only the person's branches, warehouses and departments.
/// </summary>
[ApiController]
[Route("api/purchase-orders")]
[Authorize]
public sealed class PurchaseOrdersController : ControllerBase
{
    private const int MaxLines = 500;
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly StockValuation _valuation;
    private readonly AuditService _audit;

    public PurchaseOrdersController(AppDbContext db, WarehouseService warehouses, StockValuation valuation, AuditService audit)
    {
        _db = db;
        _warehouses = warehouses;
        _valuation = valuation;
        _audit = audit;
    }

    /// <summary>Orders, newest first: by supplier, status, period, number or notes, and the item ordered.</summary>
    [HttpGet]
    [AnyPermission(Permissions.PurchaseOrdersView, Permissions.PurchaseOrdersCreate, Permissions.PurchaseOrdersEdit,
        Permissions.PurchaseOrdersCancel, Permissions.PurchaseOrdersReceive)]
    public async Task<ActionResult<PurchaseOrderListDto>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null, [FromQuery] string? partyId = null,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? warehouseId = null,
        [FromQuery] string? item = null, [FromQuery] bool open = false)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var q = _db.PurchaseOrders.AsNoTracking().Visible(User);
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<PurchaseOrderStatus>(status, out var st))
                return BadRequest(new { message = "Unknown status.", code = "bad_status" });
            q = q.Where(o => o.Status == st);
        }
        if (open)
            q = q.Where(o => o.Status == PurchaseOrderStatus.DRAFT || o.Status == PurchaseOrderStatus.SENT
                             || o.Status == PurchaseOrderStatus.PARTLY_RECEIVED);
        if (Guid.TryParse(partyId, out var party)) q = q.Where(o => o.PartyId == party);
        if (Guid.TryParse(warehouseId, out var wh)) q = q.Where(o => o.WarehouseId == wh);
        if (CompanyClock.ParseDay(from) is DateOnly f) q = q.Where(o => o.OrderDate >= f);
        if (CompanyClock.ParseDay(to) is DateOnly t) q = q.Where(o => o.OrderDate <= t);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            q = q.Where(o => o.Number.ToLower().Contains(s) || (o.Notes != null && o.Notes.ToLower().Contains(s))
                             || o.Party!.Name.ToLower().Contains(s));
        }
        if (!string.IsNullOrWhiteSpace(item))
        {
            var it = item.Trim().ToLower();
            q = q.Where(o => o.Lines.Any(l => l.Name.ToLower().Contains(it)
                                              || (l.SupplierCode != null && l.SupplierCode.ToLower().Contains(it))
                                              || (l.Product != null && (l.Product.Sku.ToLower().Contains(it)
                                                                        || l.Product.Name.ToLower().Contains(it)))));
        }
        var total = await q.CountAsync();
        var sums = await q.SelectMany(o => o.Lines).GroupBy(_ => 1).Select(g => new
        {
            Amount = g.Sum(l => (long)l.Quantity * l.UnitPrice),
            Pieces = g.Sum(l => l.Quantity * l.UnitFactor),
        }).FirstOrDefaultAsync();
        var rows = await q.OrderByDescending(o => o.OrderDate).ThenByDescending(o => o.Number)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(o => new
            {
                o.Id, o.Number, o.Status, o.PartyId, PartyName = o.Party!.Name, PartyCode = o.Party.Code,
                Branch = o.Branch!.Name, Warehouse = o.Warehouse!, Department = o.Department!.Name, o.OrderDate,
                o.ExpectedDate, Lines = o.Lines.Count, NewItems = o.Lines.Count(l => l.IsNew),
                Pieces = o.Lines.Sum(l => l.Quantity * l.UnitFactor), Received = o.Lines.Sum(l => l.ReceivedPieces),
                Total = o.Lines.Sum(l => (long)l.Quantity * l.UnitPrice), By = o.CreatedBy!.FullName, o.Notes,
            }).ToListAsync();
        var currency = await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new PurchaseOrderListDto(rows.Select(r => new PurchaseOrderSummaryDto(r.Id.ToString(), r.Number,
                r.Status.ToString(), r.PartyId.ToString(), r.PartyName, r.PartyCode, r.Branch, Loc.Name(r.Warehouse),
                r.Department, r.OrderDate.ToString("yyyy-MM-dd"), r.ExpectedDate?.ToString("yyyy-MM-dd"), r.Lines,
                r.NewItems, r.Pieces, r.Received, r.Total, r.By, r.Notes)).ToArray(),
            total, page, pageSize, sums?.Amount ?? 0, sums?.Pieces ?? 0, currency));
    }

    [HttpGet("{id:guid}")]
    [AnyPermission(Permissions.PurchaseOrdersView, Permissions.PurchaseOrdersCreate, Permissions.PurchaseOrdersEdit,
        Permissions.PurchaseOrdersCancel, Permissions.PurchaseOrdersReceive)]
    public async Task<ActionResult<PurchaseOrderDto>> Get(Guid id)
    {
        if (!await _db.PurchaseOrders.Visible(User).AnyAsync(o => o.Id == id))
            return NotFound(new { message = "Purchase order not found.", code = "not_found" });
        return Ok(await PurchaseOrders.DetailAsync(_db, User, id));
    }

    /// <summary>
    /// The supplier's items to buy again (the "what to buy" suggestions, owner 2026-11-18): sold lately
    /// and running low, with the quantity suggested, for prefilling an order. Costs only for whoever may
    /// see them.
    /// </summary>
    [HttpGet("suggestions")]
    [AnyPermission(Permissions.PurchaseOrdersCreate, Permissions.PurchaseOrdersEdit)]
    public async Task<ActionResult<PurchaseOrderSuggestionDto[]>> Suggestions([FromQuery] string supplierId,
        [FromQuery] int days = 30, [FromQuery] int target = 30, [FromQuery] string? departmentId = null)
    {
        if (!Guid.TryParse(supplierId, out _))
            return BadRequest(new { message = "Choose a supplier.", code = "no_party" });
        // The same reckoning as the analytics tab, for this supplier only.
        var analytics = new SeasonAnalyticsController(_db, _warehouses, _valuation) { ControllerContext = ControllerContext };
        var result = await analytics.PurchaseSuggestions(days, target, supplierId, departmentId);
        if (result.Result is ObjectResult { Value: not PurchaseSuggestionsDto } refused) return refused;
        var data = result.Value ?? (result.Result as ObjectResult)?.Value as PurchaseSuggestionsDto;
        var rows = data?.Groups.SelectMany(g => g.Rows) ?? Enumerable.Empty<PurchaseSuggestionRowDto>();
        return Ok(rows.Select(r => new PurchaseOrderSuggestionDto(r.Id, r.Sku, r.Name, r.Department, r.Stock, r.SoldQty,
            r.DaysLeft, r.ReorderLevel, r.Suggested, r.Cost)).ToArray());
    }

    [HttpPost]
    [Authorize(Policy = Permissions.PurchaseOrdersCreate)]
    public async Task<ActionResult<PurchaseOrderDto>> Create([FromBody] SavePurchaseOrderRequest req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var order = new PurchaseOrder { CreatedById = staffId };
        var error = await FillAsync(order, req);
        if (error is not null) return Problem(error);
        await using var tx = await _db.Database.BeginTransactionAsync();
        order.Number = await DocumentNumbers.NextPurchaseOrderAsync(_db);
        _db.PurchaseOrders.Add(order);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await Audit("create", order);
        return Created($"/api/purchase-orders/{order.Id}", await PurchaseOrders.DetailAsync(_db, User, order.Id));
    }

    /// <summary>Change an order: only before anything of it was received.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.PurchaseOrdersEdit)]
    public async Task<ActionResult<PurchaseOrderDto>> Update(Guid id, [FromBody] SavePurchaseOrderRequest req)
    {
        var order = await _db.PurchaseOrders.Visible(User).Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { message = "Purchase order not found.", code = "not_found" });
        if (!PurchaseOrders.Editable(order))
            return Conflict(new { message = "Only an order with nothing received can be changed.", code = "po_locked" });
        var old = order.Lines.ToList();
        order.Lines = new List<PurchaseOrderLine>();
        var error = await FillAsync(order, req);
        if (error is not null) return Problem(error);
        _db.PurchaseOrderLines.RemoveRange(old);
        _db.PurchaseOrderLines.AddRange(order.Lines);
        order.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await Audit("update", order);
        return Ok(await PurchaseOrders.DetailAsync(_db, User, order.Id));
    }

    /// <summary>The order went to the factory.</summary>
    [HttpPost("{id:guid}/send")]
    [Authorize(Policy = Permissions.PurchaseOrdersEdit)]
    public async Task<ActionResult<PurchaseOrderDto>> Send(Guid id)
    {
        var order = await _db.PurchaseOrders.Visible(User).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { message = "Purchase order not found.", code = "not_found" });
        if (order.Status != PurchaseOrderStatus.DRAFT)
            return Conflict(new { message = "Only a draft can be marked sent.", code = "po_not_draft" });
        order.Status = PurchaseOrderStatus.SENT;
        order.SentAt = order.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await Audit("send", order);
        return Ok(await PurchaseOrders.DetailAsync(_db, User, order.Id));
    }

    /// <summary>Call the order off: what was received stays received, the rest is not expected any more.</summary>
    [HttpPost("{id:guid}/cancel")]
    [Authorize(Policy = Permissions.PurchaseOrdersCancel)]
    public async Task<ActionResult<PurchaseOrderDto>> Cancel(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"PurchaseOrders\" WHERE \"Id\" = {id} FOR UPDATE");
        var order = await _db.PurchaseOrders.Visible(User).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { message = "Purchase order not found.", code = "not_found" });
        if (!PurchaseOrders.Open(order))
            return Conflict(new { message = "The order is already received or cancelled.", code = "po_closed" });
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        order.Status = PurchaseOrderStatus.CANCELLED;
        order.CancelledById = staffId;
        order.CancelledAt = order.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await Audit("cancel", order);
        return Ok(await PurchaseOrders.DetailAsync(_db, User, order.Id));
    }

    private ObjectResult Problem(PurchaseOrders.OrderError e) =>
        StatusCode(e.Status, new { message = e.Message, code = e.Code });

    private Task Audit(string action, PurchaseOrder order) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "purchase_order",
            order.BranchId.ToString(), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), order.Id.ToString(), order.Number);

    /// <summary>Checks the request and puts it on the order (its supplier, place, dates and lines).</summary>
    private async Task<PurchaseOrders.OrderError?> FillAsync(PurchaseOrder order, SavePurchaseOrderRequest req)
    {
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return new("no_party", "Choose a supplier.");
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null || !party.Types.Contains(nameof(PartyType.SUPPLIER)))
            return new("party_not_found", "Supplier not found.");
        if (req.Lines is null || req.Lines.Length == 0) return new("no_lines", "Add at least one item.");
        if (req.Lines.Length > MaxLines) return new("too_many_lines", $"At most {MaxLines} lines per order.");

        var (warehouse, whError) = await _warehouses.ResolveAsync(User, req.WarehouseId);
        if (whError is not null) return new(whError.Code, whError.Message);
        if (!Access.CanUseBranch(User, warehouse!.BranchId)) return new("warehouse_not_found", "Warehouse not found.");

        Guid? departmentId = null;
        if (!string.IsNullOrWhiteSpace(req.DepartmentId))
        {
            if (!Guid.TryParse(req.DepartmentId, out var d) || !Access.CanUseDepartment(User, d)
                || !await _db.Departments.AnyAsync(x => x.Id == d))
                return new("department_not_found", "Department not found.");
            departmentId = d;
        }
        else if (Access.Departments(User) is not null)
            return new("department_required", "Choose the order's department.");

        var orderDate = CompanyClock.Today;
        if (!string.IsNullOrWhiteSpace(req.OrderDate))
        {
            if (CompanyClock.ParseDay(req.OrderDate) is not DateOnly od) return new("po_bad_date", "Enter a valid date.");
            orderDate = od;
        }
        DateOnly? expected = null;
        if (!string.IsNullOrWhiteSpace(req.ExpectedDate))
        {
            if (CompanyClock.ParseDay(req.ExpectedDate) is not DateOnly ed) return new("po_bad_date", "Enter a valid date.");
            if (ed < orderDate) return new("bad_expected_date", "The expected date is before the order's date.");
            expected = ed;
        }
        var notes = req.Notes?.Trim();
        if (notes?.Length > 1000) return new("bad_notes", "The notes are too long.");

        // What the lines name, read once.
        var productIds = req.Lines.Select(l => Guid.TryParse(l.ProductId, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty).Distinct().ToList();
        var products = await _db.Products.AsNoTracking().Include(p => p.Category).Include(p => p.Units)
            .Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var units = await _db.Units.AsNoTracking().ToDictionaryAsync(u => u.Id);
        var options = await _db.VariantOptions.AsNoTracking().ToDictionaryAsync(v => v.Id);
        var groups = await _db.Categories.AsNoTracking().Select(c => new { c.Id, c.DepartmentId }).ToDictionaryAsync(c => c.Id);
        var departments = await _db.Departments.AsNoTracking().Select(d => d.Id).ToListAsync();

        var lines = new List<PurchaseOrderLine>();
        foreach (var l in req.Lines)
        {
            if (l.Quantity is < 1 or > 1_000_000) return new("bad_quantity", "Enter a quantity of 1 or more.");
            if (l.UnitPrice is < 0 or > 1_000_000_000_000) return new("bad_price", "Enter a price of zero or more.");
            var line = new PurchaseOrderLine { LineNo = lines.Count + 1, Quantity = l.Quantity, UnitPrice = l.UnitPrice };
            Guid? unitId = Guid.TryParse(l.UnitId, out var u) ? u : null;
            if (!string.IsNullOrWhiteSpace(l.UnitId) && unitId is null) return new("unit_not_found", "Unit not found.");
            if (!string.IsNullOrWhiteSpace(l.ProductId))
            {
                if (!Guid.TryParse(l.ProductId, out var pid) || !products.TryGetValue(pid, out var product) || !product.IsActive)
                    return new("product_not_found", "An item on the order was not found.");
                if (product.Category?.DepartmentId is Guid pd && !Access.CanUseDepartment(User, pd))
                    return new("product_not_found", "An item on the order was not found.");
                var itemUnit = unitId is Guid uid
                    ? product.Units.FirstOrDefault(x => x.UnitId == uid)
                    : product.Units.OrderBy(x => x.Factor).FirstOrDefault();
                if (unitId is not null && itemUnit is null)
                    return new("unit_not_found", $"{Loc.Name(product)} is not sold in that unit.");
                line.ProductId = product.Id;
                line.Name = product.Name;
                line.SupplierCode = product.SupplierCode;
                line.DepartmentId = product.Category?.DepartmentId;
                line.UnitId = itemUnit?.UnitId;
                line.UnitFactor = itemUnit?.Factor ?? 1;
            }
            else
            {
                // A new item: only named; it is made when its goods arrive.
                var name = Loc.Clean(l.Name);
                if (name is null) return new("po_no_name", "Name the new item.");
                line.IsNew = true;
                line.Name = name;
                line.SupplierCode = l.SupplierCode?.Trim() is { Length: > 0 } code ? code[..Math.Min(code.Length, 100)] : null;
                if (!string.IsNullOrWhiteSpace(l.DepartmentId))
                {
                    if (!Guid.TryParse(l.DepartmentId, out var d) || !departments.Contains(d) || !Access.CanUseDepartment(User, d))
                        return new("department_not_found", "Department not found.");
                    line.DepartmentId = d;
                }
                if (!string.IsNullOrWhiteSpace(l.GroupId))
                {
                    if (!Guid.TryParse(l.GroupId, out var g) || !groups.TryGetValue(g, out var grp)
                        || line.DepartmentId is null || grp.DepartmentId != line.DepartmentId)
                        return new("group_not_found", "The group is not of the department.");
                    line.GroupId = g;
                }
                if (!string.IsNullOrWhiteSpace(l.SizeId))
                {
                    if (!Guid.TryParse(l.SizeId, out var s) || !options.TryGetValue(s, out var size) || size.Kind != VariantKind.SIZE)
                        return new("size_not_found", "Size not found.");
                    line.SizeId = s;
                }
                if (!string.IsNullOrWhiteSpace(l.ColorId))
                {
                    if (!Guid.TryParse(l.ColorId, out var c) || !options.TryGetValue(c, out var color) || color.Kind != VariantKind.COLOR)
                        return new("color_not_found", "Colour not found.");
                    line.ColorId = c;
                }
                if (unitId is Guid uid)
                {
                    if (!units.TryGetValue(uid, out var unit) || !unit.IsActive) return new("unit_not_found", "Unit not found.");
                    line.UnitId = uid;
                    line.UnitFactor = Math.Max(1, unit.Pieces);
                }
            }
            lines.Add(line);
        }

        order.PartyId = party.Id;
        order.WarehouseId = warehouse.Id;
        order.BranchId = warehouse.BranchId;
        order.DepartmentId = departmentId;
        order.OrderDate = orderDate;
        order.ExpectedDate = expected;
        order.Notes = string.IsNullOrEmpty(notes) ? null : notes;
        foreach (var line in lines)
        {
            line.OrderId = order.Id;
            order.Lines.Add(line);
        }
        return null;
    }
}
