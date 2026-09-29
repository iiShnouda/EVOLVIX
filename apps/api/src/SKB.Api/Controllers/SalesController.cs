using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/sales")]
[Authorize(Policy = Permissions.SalesView)]
public sealed class SalesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly ReturnsService _returns;
    private readonly AuditService _audit;

    public SalesController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        ReturnsService returns, AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _returns = returns;
        _audit = audit;
    }

    [HttpGet("invoices")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null) =>
        ListAsync(DocumentType.SALES_INVOICE, page, pageSize, search, status);

    /// <summary>Sales returns (مرتجعات المبيعات), newest first.</summary>
    [HttpGet("returns")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> Returns(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null) =>
        ListAsync(DocumentType.SALES_RETURN, page, pageSize, search, status);

    private async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> ListAsync(
        DocumentType type, int page, int pageSize, string? search, string? status)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == type);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<DocumentStatus>(status, out var st))
            q = q.Where(d => d.Status == st);
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

    /// <summary>
    /// One sales invoice or sales return. Limited to sales documents — purchase documents are
    /// behind purchases:view and must not be readable through this endpoint. For an invoice,
    /// each line carries the quantity already returned so the client can offer only what's left.
    /// </summary>
    [HttpGet("invoices/{id:guid}")]
    [HttpGet("returns/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id &&
            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN));
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
            .Include(d => d.Charges).Include(d => d.Rep)
            .AsSplitQuery()
            .FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found" });

        var returned = doc.Type == DocumentType.SALES_INVOICE ? await _returns.ReturnedByLineAsync(doc.Id) : null;
        return Ok(Mapper.ToDetail(doc, returned, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    /// <summary>Who a sale can be credited to (active staff), for the invoice's sales-rep picker.</summary>
    [HttpGet("reps")]
    public async Task<ActionResult<RepOptionDto[]>> Reps()
    {
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).OrderBy(s => s.FullName).ToListAsync();
        return Ok(staff.Select(s => new RepOptionDto(s.Id.ToString(), s.FullName, s.BranchId.ToString())).ToArray());
    }

    /// <summary>
    /// Create a sales invoice: consume stock at weighted-average cost from each line's warehouse,
    /// compute profit, and enforce the profit floor (never below cost; and never below the
    /// configured minimum markup unless the user may override). All-or-nothing: the items are
    /// row-locked, checked and posted in one transaction, so two invoices can't sell the same stock.
    /// Lines may be in any of the item's units (carton = 24 pieces moves 24 pieces of stock). Prices
    /// come from the invoice's price level; a different price needs <c>sales:change_price</c>, and a
    /// level other than the customer's needs <c>sales:choose_price_level</c>.
    /// </summary>
    [HttpPost("invoices")]
    [Authorize(Policy = Permissions.SalesCreate)]
    public async Task<ActionResult<SalesDetailDto>> Create([FromBody] CreateSalesInvoiceRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines per invoice.", code = "too_many_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A customer is required.", code = "no_party" });

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Customer not found.", code = "party_not_found" });

        var settings = await GetSettingsAsync();
        bool Can(string permission) => User.HasClaim("permission", permission);
        var canOverride = Can(Permissions.SalesOverrideFloor);
        var canChangePrice = Can(Permissions.SalesChangePrice);

        // ---- Invoice charges: discounts, taxes, additions — each needs its own permission ----
        var (specs, chargeError) = Charges.Parse(req.Charges, req.TaxPercent, settings.DefaultTaxPercent);
        if (chargeError is not null) return BadRequest(new { message = chargeError.Message, code = chargeError.Code });
        if (specs!.Any(c => c.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT) && !Can(Permissions.SalesDiscount))
            return InvoiceLines.Refuse(this, new("discount_not_allowed", "Giving an invoice discount needs permission."));
        if (specs!.Any(c => c.Kind == ChargeKind.ADDITION) && !Can(Permissions.SalesAdditions))
            return InvoiceLines.Refuse(this, new("additions_not_allowed", "Adding charges needs permission."));
        if (!Can(Permissions.SalesChangeTax) && !Charges.IsDefaultTax(specs!, settings.DefaultTaxPercent))
            return InvoiceLines.Refuse(this, new("tax_not_allowed",
                $"The tax is {settings.DefaultTaxPercent}%. Changing it needs permission."));

        Guid? repId = null;
        if (!string.IsNullOrWhiteSpace(req.RepId))
        {
            if (!Guid.TryParse(req.RepId, out var rep) || !await _db.Staff.AnyAsync(s => s.Id == rep && s.IsActive))
                return BadRequest(new { message = "Sales rep not found.", code = "rep_not_found" });
            repId = rep;
        }

        // ---- Shape checks and warehouse per line (no stock read yet) ----
        var cache = new Dictionary<string, Warehouse>();
        var lines = new List<(CreateInvoiceLineRequest Req, Guid ProductId, Guid? UnitId, Warehouse Warehouse)>();
        foreach (var line in req.Lines)
        {
            var shape = InvoiceLines.CheckShape(line.ProductId, line.UnitId, line.Quantity, line.UnitPrice, line.Discount);
            if (shape.Error is not null) return BadRequest(new { message = shape.Error.Message, code = shape.Error.Code });
            if (line.IsBonus)
            {
                if (!Can(Permissions.SalesBonus))
                    return InvoiceLines.Refuse(this, new("bonus_not_allowed", "Giving free goods needs permission."));
                if (line.UnitPrice != 0 || line.Discount != 0)
                    return BadRequest(new { message = "Free goods have no price.", code = "bad_bonus" });
            }
            var (warehouse, whError) = await _warehouses.ResolveAsync(User, line.WarehouseId ?? req.WarehouseId, cache);
            if (whError is not null) return BadRequest(new { message = whError.Message, code = whError.Code });
            lines.Add((line, shape.ProductId, shape.UnitId, warehouse!));
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
        var book = await PriceBook.LoadAsync(_db, products.Keys);

        var (level, levelError) = InvoiceLines.ResolveLevel(book, req.PriceLevelId, party.SalesPriceLevelId,
            PriceSide.SALE, Can(Permissions.SalesChoosePriceLevel));
        if (levelError is not null) return InvoiceLines.Refuse(this, levelError);

        // ---- Resolve units and check prices against the level ----
        var resolved = new List<(CreateInvoiceLineRequest Req, Product Product, ItemUnit Unit, int BaseQty,
            Warehouse Warehouse, long BaseCost)>();
        foreach (var (line, pid, unitId, warehouse) in lines)
        {
            if (!products.TryGetValue(pid, out var product) || !product.IsActive)
                return BadRequest(new { message = "A product on the invoice was not found.", code = "product_not_found" });
            var (unit, baseQty, unitError) = InvoiceLines.ResolveUnit(book, product, unitId, line.Quantity);
            if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });

            // Cost is per branch: price and floor are judged against the cost where the goods leave from.
            var baseCost = _inventory.CostAt(product, warehouse);
            if (!canChangePrice && !line.IsBonus)
            {
                var expected = level is null
                    ? InvoiceLines.MarkupPrice(baseCost, unit!.Factor, settings.DefaultMarkupPercent)
                    : book.SuggestedSale(pid, unit!, level.Id, baseCost, settings.DefaultMarkupPercent);
                if (line.UnitPrice != expected || line.Discount != 0)
                    return InvoiceLines.Refuse(this, new("price_not_allowed",
                        $"{Loc.Name(product)}: the price is {InvoiceLines.Major(expected)} per {Loc.Name(unit!.Unit)}. " +
                        "Changing a price needs permission."));
            }
            resolved.Add((line, product, unit!, baseQty, warehouse, baseCost));
        }

        // ---- Work out the charges and each line's share of the invoice discount ----
        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitPrice - r.Req.Discount).ToList();
        var (charges, applyError) = Charges.Apply(nets, resolved.Select(r => !r.Req.IsBonus).ToList(), specs!);
        if (applyError is not null) return BadRequest(new { message = applyError.Message, code = applyError.Code });

        // Profit floor on what each line really brings in, after its share of the invoice discount.
        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, _, _, baseCost) = resolved[i];
            if (line.IsBonus) continue;
            var floorError = CheckFloor(line.Quantity, line.UnitPrice, line.Discount + charges!.Allocation[i],
                baseCost * unit.Factor, settings.MinMarkupPercent, canOverride, req.OverrideFloor);
            if (floorError is not null)
                return BadRequest(new
                {
                    message = floorError == "below_cost"
                        ? $"{Loc.Name(product)}: price is below cost — selling at a loss is never allowed."
                        : $"{Loc.Name(product)}: price is below the minimum profit floor. Ask a manager to override.",
                    code = floorError,
                });
        }
        // The same item may appear on several lines (even in different units): check the total
        // asked of each warehouse, in base units.
        foreach (var need in resolved.GroupBy(l => (l.Product.Id, l.Warehouse.Id)))
        {
            var product = need.First().Product;
            var warehouse = need.First().Warehouse;
            var wanted = need.Sum(l => (long)l.BaseQty);
            var available = _inventory.Available(product.Id, warehouse.Id);
            if (wanted > available)
                return BadRequest(new
                {
                    message = $"Not enough {Loc.Name(product)} in {Loc.Name(warehouse)}: {available} left, {wanted} requested.",
                    code = "insufficient_stock",
                });
        }

        // ---- Post the document ----
        var number = await DocumentNumbers.NextAsync(_db, DocumentType.SALES_INVOICE);
        var doc = new SalesDocument
        {
            Number = number, Type = DocumentType.SALES_INVOICE, BranchId = branchId,
            PartyId = partyId, StaffId = staffId, IssueDate = DateTime.UtcNow,
            DueDate = ParseDate(req.DueDate), Currency = settings.Currency, Notes = req.Notes,
            PriceLevelId = level?.Id, RepId = repId,
        };

        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, baseQty, warehouse, _) = resolved[i];
            var unitCost = _inventory.Issue(product, warehouse, baseQty,
                StockMovementType.SALE_OUT, doc.Id, number);

            var lineTotal = (long)line.Quantity * line.UnitPrice - line.Discount;
            var lineCost = (long)baseQty * unitCost;
            var docDiscount = charges!.Allocation[i];
            doc.Lines.Add(new DocumentLine
            {
                LineNo = doc.Lines.Count + 1,
                ProductId = product.Id, ProductName = product.Name, Quantity = baseQty,
                UnitId = unit.UnitId, UnitFactor = unit.Factor, UnitQuantity = line.Quantity,
                UnitPrice = line.UnitPrice, Discount = line.Discount, LineTotal = lineTotal,
                IsBonus = line.IsBonus, DocDiscount = docDiscount,
                UnitCost = unitCost, LineCost = lineCost, LineProfit = lineTotal - docDiscount - lineCost,
                WarehouseId = warehouse.Id, Warehouse = warehouse,
            });
        }
        foreach (var c in charges!.Rows) doc.Charges.Add(c);

        var subtotal = doc.Lines.Sum(l => l.LineTotal + l.Discount);
        var discountTotal = doc.Lines.Sum(l => l.Discount) + charges.Discount;
        var net = subtotal - discountTotal;
        var grand = net + charges.Tax + charges.Addition;
        var costTotal = doc.Lines.Sum(l => l.LineCost);

        doc.Subtotal = subtotal;
        doc.DiscountTotal = discountTotal;
        doc.TaxTotal = charges.Tax;
        doc.AdditionTotal = charges.Addition;
        doc.GrandTotal = grand;
        doc.CostTotal = costTotal;
        // Profit is what the goods brought in after every discount, minus their cost. Taxes and
        // additions (e.g. the delivery fee) are neither revenue nor cost.
        doc.ProfitTotal = net - costTotal;
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // The customer owes us the unpaid balance (receivable → positive).
        party.Balance += grand - doc.PaidAmount;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "sales_invoice",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/invoices/{doc.Id}", Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    /// <summary>
    /// Sales return (مرتجع مبيعات) against invoice <paramref name="id"/>: restock at the original
    /// cost, reverse revenue + profit, credit the customer (minus any cash refunded now).
    /// </summary>
    [HttpPost("invoices/{id:guid}/returns")]
    [Authorize(Policy = Permissions.SalesReturn)]
    public async Task<ActionResult<SalesDetailDto>> CreateReturn(Guid id, [FromBody] CreateReturnRequest req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        Guid? scope = null;
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            scope = branchId;
        }

        var (doc, error) = await _returns.CreateAsync(id, DocumentType.SALES_INVOICE, req, scope, staffId);
        if (error is not null)
        {
            var body = new { message = error.Message, code = error.Code };
            return error.Code == "not_found" ? NotFound(body) : BadRequest(body);
        }

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "sales_return",
            doc!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/returns/{doc.Id}", Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc)));
    }

    /// <summary>
    /// Never below cost; and never below cost×(1+min/100) unless the user may override. Judged on
    /// the line's net amount (after its discount) against <paramref name="quantity"/> × the cost of
    /// one line unit, so a discount can't slip a line under the floor.
    /// </summary>
    private static string? CheckFloor(int quantity, long unitPrice, long discount, long unitCost, int minMarkup,
        bool canOverride, bool overrideRequested)
    {
        var net = (decimal)quantity * unitPrice - discount;
        if (net < (decimal)quantity * unitCost) return "below_cost";
        var floor = decimal.Round(unitCost * (100m + Math.Max(0, minMarkup)) / 100m, MidpointRounding.AwayFromZero);
        if (net < quantity * floor && !(canOverride && overrideRequested)) return "below_floor";
        return null;
    }

    private async Task<CompanySettings> GetSettingsAsync() =>
        await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
