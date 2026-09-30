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
    private readonly MoneyService _money;
    private readonly LedgerService _ledger;

    public SalesController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
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
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null) =>
        ListAsync(DocumentType.SALES_INVOICE, page, pageSize, search, status, departmentId);

    /// <summary>Price quotations (عروض الأسعار), newest first.</summary>
    [HttpGet("quotations")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> Quotations(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null) =>
        ListAsync(DocumentType.QUOTATION, page, pageSize, search, status, departmentId);

    /// <summary>Sales returns (مرتجعات المبيعات), newest first.</summary>
    [HttpGet("returns")]
    public Task<ActionResult<PaginatedDto<SalesSummaryDto>>> Returns(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null) =>
        ListAsync(DocumentType.SALES_RETURN, page, pageSize, search, status, departmentId);

    private async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> ListAsync(
        DocumentType type, int page, int pageSize, string? search, string? status, string? departmentId)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == type);
        q = q.InBranches(User, d => d.BranchId).InDepartments(User);
        // "none" = documents of no department.
        if (departmentId == "none") q = q.Where(d => d.DepartmentId == null);
        else if (Guid.TryParse(departmentId, out var dept)) q = q.Where(d => d.DepartmentId == dept);
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
            .Include(d => d.Department)
            .OrderByDescending(d => d.IssueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Ok(new PaginatedDto<SalesSummaryDto>(
            rows.Select(Mapper.ToSummary).ToArray(), total, page, pageSize));
    }

    /// <summary>
    /// One sales invoice, return or quotation. Limited to sales documents — purchase documents are
    /// behind purchases:view and must not be readable through this endpoint. For an invoice,
    /// each line carries the quantity already returned so the client can offer only what's left;
    /// a quotation names the invoice it became.
    /// </summary>
    [HttpGet("invoices/{id:guid}")]
    [HttpGet("returns/{id:guid}")]
    [HttpGet("quotations/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id &&
            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN
                                                  || d.Type == DocumentType.QUOTATION));
        q = q.InBranches(User, d => d.BranchId).InDepartments(User);
        var doc = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .Include(d => d.Lines).ThenInclude(l => l.Unit)
            .Include(d => d.SourceDocument).Include(d => d.PriceLevel)
            .Include(d => d.Charges).Include(d => d.Rep).Include(d => d.Driver).Include(d => d.Carrier)
            .Include(d => d.PaidAccount).Include(d => d.Department)
            .AsSplitQuery()
            .FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found" });

        var returned = doc.Type == DocumentType.SALES_INVOICE ? await _returns.ReturnedByLineAsync(doc.Id) : null;
        var dto = Mapper.ToDetail(doc, returned, await InvoiceLines.BaseUnitNamesAsync(_db, doc));
        if (doc.Type == DocumentType.QUOTATION
            && await _db.SalesDocuments.AsNoTracking()
                .Where(i => i.SourceDocumentId == doc.Id && i.Type == DocumentType.SALES_INVOICE)
                .Select(i => new { i.Id, i.Number }).FirstOrDefaultAsync() is { } invoice)
            dto = dto with { InvoiceId = invoice.Id.ToString(), InvoiceNumber = invoice.Number };
        return Ok(Costs.Guard(User, dto));
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
    public Task<ActionResult<SalesDetailDto>> Create([FromBody] CreateSalesInvoiceRequest req) =>
        CreateCore(req, quote: false, fromQuoteId: null);

    /// <summary>
    /// A price quotation (عرض سعر): priced exactly like an invoice — same levels, charges, permissions
    /// and profit floor — but it moves no stock, money or balance and posts nothing. It holds its
    /// prices until <c>DueDate</c> (two weeks unless given).
    /// </summary>
    [HttpPost("quotations")]
    [Authorize(Policy = Permissions.SalesQuote)]
    public Task<ActionResult<SalesDetailDto>> CreateQuotation([FromBody] CreateSalesInvoiceRequest req) =>
        CreateCore(req, quote: true, fromQuoteId: null);

    /// <summary>
    /// Turn an open quotation into a sales invoice with its lines, prices, level, charges and rep.
    /// While it's valid its prices hold — they were approved when it was made; after its date they
    /// are checked like any new invoice. Stock, the profit floor and payment are checked now.
    /// </summary>
    [HttpPost("quotations/{id:guid}/convert")]
    [Authorize(Policy = Permissions.SalesCreate)]
    public async Task<ActionResult<SalesDetailDto>> ConvertQuotation(Guid id, [FromBody] ConvertQuotationRequest req)
    {
        var quote = await ScopedQuotes().AsNoTracking().Include(d => d.Lines).Include(d => d.Charges)
            .AsSplitQuery().FirstOrDefaultAsync(d => d.Id == id);
        if (quote is null) return NotFound(new { message = "Quotation not found.", code = "not_found" });
        var invoice = new CreateSalesInvoiceRequest(
            quote.PartyId.ToString(),
            quote.Lines.OrderBy(l => l.LineNo).Select(l => new CreateInvoiceLineRequest(
                l.ProductId.ToString(), l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.UnitPrice, l.Discount,
                req.WarehouseId ?? l.WarehouseId?.ToString(), l.UnitId?.ToString(), l.IsBonus)).ToArray(),
            Notes: req.Notes ?? quote.Notes, DueDate: req.DueDate, PaidAmount: req.PaidAmount,
            OverrideFloor: req.OverrideFloor, PriceLevelId: quote.PriceLevelId?.ToString(),
            Charges: quote.Charges.OrderBy(c => c.Seq).Select(c => new ChargeRequest(c.Kind.ToString(),
                c.RateBp is int bp ? bp / 100m : null, c.RateBp is null ? c.FixedAmount : null, c.Label)).ToArray(),
            RepId: quote.RepId?.ToString(), DeliveryMethod: req.DeliveryMethod, DeliveryAddress: req.DeliveryAddress,
            DriverId: req.DriverId, CarrierId: req.CarrierId, PaidAccountId: req.PaidAccountId,
            DepartmentId: quote.DepartmentId?.ToString());
        return await CreateCore(invoice, quote: false, fromQuoteId: id, branch: quote.BranchId);
    }

    /// <summary>Close an open quotation without an invoice.</summary>
    [HttpPost("quotations/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.SalesQuote)]
    public async Task<ActionResult<SalesDetailDto>> CancelQuotation(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var quote = await ScopedQuotes().FirstOrDefaultAsync(d => d.Id == id);
        if (quote is null) return NotFound(new { message = "Quotation not found.", code = "not_found" });
        if (quote.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This quotation is already closed.", code = "quote_closed" });
        quote.Status = DocumentStatus.CANCELLED;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", "quotation", quote);
        return await GetOne(id);
    }

    private IQueryable<SalesDocument> ScopedQuotes()
    {
        var q = _db.SalesDocuments.Where(d => d.Type == DocumentType.QUOTATION);
        return q.InBranches(User, d => d.BranchId).InDepartments(User);
    }

    private Task AuditAsync(string action, string resource, SalesDocument doc) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            doc.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

    /// <summary>
    /// Make a sales invoice or (<paramref name="quote"/>) a quotation. With
    /// <paramref name="fromQuoteId"/> the invoice comes from that quotation, which is closed with it.
    /// </summary>
    /// <param name="branch">The branch it belongs to (a quotation's invoice stays in its branch); else the working branch.</param>
    private async Task<ActionResult<SalesDetailDto>> CreateCore(
        CreateSalesInvoiceRequest req, bool quote, Guid? fromQuoteId, Guid? branch = null)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines per invoice.", code = "too_many_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A customer is required.", code = "no_party" });

        var branchId = branch ?? Access.Work(User);
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Customer not found.", code = "party_not_found" });

        var dueDate = ParseDate(req.DueDate);
        if (quote && dueDate is DateTime until && until.Date < CompanyClock.TodayDate)
            return BadRequest(new { message = "A quotation is valid until today or later.", code = "bad_valid_until" });

        var settings = await GetSettingsAsync();
        // A quotation still valid keeps what was approved on it: its prices, level, discounts, free
        // goods and taxes. (Whether it's still open is checked under its lock below.)
        var trusted = false;
        if (fromQuoteId is Guid quoteId)
        {
            var validUntil = await _db.SalesDocuments.Where(d => d.Id == quoteId).Select(d => d.DueDate).FirstOrDefaultAsync();
            trusted = validUntil is null || validUntil.Value.Date >= CompanyClock.TodayDate;
        }
        bool Can(string permission) => User.HasClaim("permission", permission);
        bool Approved(string permission) => trusted || Can(permission);
        var canOverride = Can(Permissions.SalesOverrideFloor);
        var canChangePrice = Approved(Permissions.SalesChangePrice);

        // ---- Invoice charges: discounts, taxes, additions — each needs its own permission ----
        var (specs, chargeError) = Charges.Parse(req.Charges, req.TaxPercent, settings.DefaultTaxPercent);
        if (chargeError is not null) return BadRequest(new { message = chargeError.Message, code = chargeError.Code });
        if (specs!.Any(c => c.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT) && !Approved(Permissions.SalesDiscount))
            return InvoiceLines.Refuse(this, new("discount_not_allowed", "Giving an invoice discount needs permission."));
        if (specs!.Any(c => c.Kind == ChargeKind.ADDITION) && !Approved(Permissions.SalesAdditions))
            return InvoiceLines.Refuse(this, new("additions_not_allowed", "Adding charges needs permission."));
        if (!Approved(Permissions.SalesChangeTax) && !Charges.IsDefaultTax(specs!, settings.DefaultTaxPercent))
            return InvoiceLines.Refuse(this, new("tax_not_allowed",
                $"The tax is {settings.DefaultTaxPercent}%. Changing it needs permission."));

        // ---- The sales department (قسم) it belongs to: sold only from that department's items ----
        var (department, departmentError) = await ResolveDepartmentAsync(req.DepartmentId);
        if (departmentError is not null) return departmentError;

        Guid? repId = null;
        if (!string.IsNullOrWhiteSpace(req.RepId))
        {
            if (!Guid.TryParse(req.RepId, out var rep) || !await _db.Staff.AnyAsync(s => s.Id == rep && s.IsActive))
                return BadRequest(new { message = "Sales rep not found.", code = "rep_not_found" });
            repId = rep;
        }

        // ---- Delivery: pickup, our driver, or a shipping company (DOMAIN.md §2.5) ----
        // A quotation has no delivery: that's decided when it becomes an invoice.
        var method = DeliveryMethod.PICKUP;
        if (!quote && !string.IsNullOrWhiteSpace(req.DeliveryMethod) && !Enum.TryParse(req.DeliveryMethod, true, out method))
            return BadRequest(new { message = "Unknown delivery method.", code = "bad_delivery" });
        Guid? driverId = null, carrierId = null;
        if (method == DeliveryMethod.OWN_DELIVERY && !string.IsNullOrWhiteSpace(req.DriverId))
        {
            if (!Guid.TryParse(req.DriverId, out var driver) || !await _db.Staff.AnyAsync(s => s.Id == driver && s.IsActive))
                return BadRequest(new { message = "Driver not found.", code = "driver_not_found" });
            driverId = driver;
        }
        if (method == DeliveryMethod.SHIPPING_COMPANY)
        {
            if (!Guid.TryParse(req.CarrierId, out var carrier)
                || !await _db.Parties.AnyAsync(p => p.Id == carrier && p.IsActive && p.Types.Contains(nameof(PartyType.CARRIER))))
                return BadRequest(new { message = "Choose the shipping company.", code = "carrier_not_found" });
            carrierId = carrier;
        }
        var deliveryAddress = method == DeliveryMethod.PICKUP ? null
            : Clean(req.DeliveryAddress, 300) ?? party.ShippingAddress ?? party.Address;

        // ---- Shape checks and warehouse per line (no stock read yet) ----
        var cache = new Dictionary<string, Warehouse>();
        var lines = new List<(CreateInvoiceLineRequest Req, Guid ProductId, Guid? UnitId, Warehouse Warehouse)>();
        foreach (var line in req.Lines)
        {
            var shape = InvoiceLines.CheckShape(line.ProductId, line.UnitId, line.Quantity, line.UnitPrice, line.Discount);
            if (shape.Error is not null) return BadRequest(new { message = shape.Error.Message, code = shape.Error.Code });
            if (line.IsBonus)
            {
                if (!Approved(Permissions.SalesBonus))
                    return InvoiceLines.Refuse(this, new("bonus_not_allowed", "Giving free goods needs permission."));
                if (line.UnitPrice != 0 || line.Discount != 0)
                    return BadRequest(new { message = "Free goods have no price.", code = "bad_bonus" });
            }
            var (warehouse, whError) = await _warehouses.ResolveAsync(User, line.WarehouseId ?? req.WarehouseId, cache);
            if (whError is not null) return BadRequest(new { message = whError.Message, code = whError.Code });
            lines.Add((line, shape.ProductId, shape.UnitId, warehouse!));
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        // The quotation first (documents before items): only one invoice can come from it.
        SalesDocument? fromQuote = null;
        if (fromQuoteId is Guid qid)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {qid} FOR UPDATE");
            fromQuote = await _db.SalesDocuments.FirstAsync(d => d.Id == qid);
            if (fromQuote.Status != DocumentStatus.PENDING)
                return BadRequest(new { message = "This quotation is already closed.", code = "quote_closed" });
        }
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
        var book = await PriceBook.LoadAsync(_db, products.Keys);
        var categoryIds = products.Values.Select(p => p.CategoryId).Distinct().ToList();
        var departmentOf = await _db.Categories.AsNoTracking().Where(c => categoryIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.DepartmentId);

        var (level, levelError) = InvoiceLines.ResolveLevel(book, req.PriceLevelId, party.SalesPriceLevelId,
            PriceSide.SALE, Approved(Permissions.SalesChoosePriceLevel));
        if (levelError is not null) return InvoiceLines.Refuse(this, levelError);

        // ---- Resolve units and check prices against the level ----
        var resolved = new List<(CreateInvoiceLineRequest Req, Product Product, ItemUnit Unit, int BaseQty,
            Warehouse Warehouse, long BaseCost)>();
        foreach (var (line, pid, unitId, warehouse) in lines)
        {
            if (!products.TryGetValue(pid, out var product) || !product.IsActive)
                return BadRequest(new { message = "A product on the invoice was not found.", code = "product_not_found" });
            if (department is not null && departmentOf.GetValueOrDefault(product.CategoryId) is Guid itemDept
                && itemDept != department.Id)
                return BadRequest(new
                {
                    message = $"{Loc.Name(product)} is not sold by the {Loc.Name(department)} department.",
                    code = "not_in_department",
                });
            var (unit, baseQty, unitError) = InvoiceLines.ResolveUnit(book, product, unitId, line.Quantity);
            if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });

            // Cost is per branch: price and floor are judged against the cost where the goods leave from.
            var baseCost = _inventory.CostAt(product, warehouse);
            if (!canChangePrice && !line.IsBonus)
            {
                var expected = level is null
                    ? InvoiceLines.MarkupPrice(baseCost, unit!.Factor, settings.DefaultMarkupPercent)
                    : book.SuggestedSale(pid, unit!, level.Id, baseCost, settings.DefaultMarkupPercent);
                if (line.UnitPrice != expected)
                    return InvoiceLines.Refuse(this, new("price_not_allowed",
                        $"{Loc.Name(product)}: the price is {InvoiceLines.Major(expected)} per {Loc.Name(unit!.Unit)}. " +
                        "Changing a price needs permission."));
            }
            // A discount on one line (a %, or so much per piece) is a discount, not a price change.
            // (More than the line is worth is already refused by the shape check.)
            if (line.Discount != 0 && !Approved(Permissions.SalesDiscount))
                return InvoiceLines.Refuse(this, new("discount_not_allowed",
                    $"{Loc.Name(product)}: giving a discount needs permission."));
            resolved.Add((line, product, unit!, baseQty, warehouse, baseCost));
        }

        // ---- Work out the charges and each line's share of the invoice discount ----
        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitPrice - r.Req.Discount).ToList();
        var (charges, applyError) = Charges.Apply(nets, resolved.Select(r => !r.Req.IsBonus).ToList(), specs!);
        if (applyError is not null) return BadRequest(new { message = applyError.Message, code = applyError.Code });

        // The person's discount limit: a line's own discount plus its share of the invoice discount.
        if (!trusted && Access.MaxDiscount(User) is int maxDiscount)
            for (var i = 0; i < resolved.Count; i++)
            {
                var (line, product, _, _, _, _) = resolved[i];
                if (line.IsBonus) continue;
                var gross = (long)line.Quantity * line.UnitPrice;
                if ((line.Discount + charges!.Allocation[i]) * 100 > gross * maxDiscount)
                    return InvoiceLines.Refuse(this, new("discount_over_limit",
                        $"{Loc.Name(product)}: the discount is more than your limit of {maxDiscount}%."));
            }

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
        // asked of each warehouse, in base units. A quotation may promise more than is in stock.
        foreach (var need in quote ? [] : resolved.GroupBy(l => (l.Product.Id, l.Warehouse.Id)))
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
        var type = quote ? DocumentType.QUOTATION : DocumentType.SALES_INVOICE;
        var number = await DocumentNumbers.NextAsync(_db, type);
        var doc = new SalesDocument
        {
            Number = number, Type = type, BranchId = branchId,
            PartyId = partyId, StaffId = staffId, IssueDate = DateTime.UtcNow,
            DueDate = dueDate ?? (quote ? CompanyClock.TodayDate.AddDays(14) : null),
            Currency = settings.Currency, Notes = Clean(req.Notes, 500), SourceDocumentId = fromQuoteId,
            PriceLevelId = level?.Id, RepId = repId, DepartmentId = department?.Id,
            DeliveryMethod = method, DeliveryStatus = method == DeliveryMethod.PICKUP ? null : DeliveryStatus.PENDING,
            DeliveryAddress = deliveryAddress, DriverId = driverId, CarrierId = carrierId,
        };

        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, baseQty, warehouse, baseCost) = resolved[i];
            // A quotation only estimates the profit, at today's cost.
            var unitCost = quote ? baseCost : _inventory.Issue(product, warehouse, baseQty,
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
        if (quote)
        {
            doc.Status = DocumentStatus.PENDING;
            _db.SalesDocuments.Add(doc);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            await AuditAsync("create", "quotation", doc);
            await InvoiceLines.LoadForDetailAsync(_db, doc);
            return Created($"/api/sales/quotations/{doc.Id}",
                Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
        }
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // The customer owes us the unpaid balance (receivable → positive).
        await MoneyService.LockPartiesAsync(_db, party.Id);
        party.Balance += grand - doc.PaidAmount;

        // Money paid now lands in a money account: the one picked, else the branch's cash box.
        MoneyAccount? paidInto = null;
        if (doc.PaidAmount > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(req.PaidAccountId, branchId, User);
            if (moneyError is not null) return BadRequest(new { message = moneyError.Message, code = moneyError.Code });
            paidInto = account!;
            doc.PaidAccountId = account!.Id;
            _money.Move(account, doc.PaidAmount, MoneyMovementKind.SALE_PAID, staffId, doc.Number,
                documentId: doc.Id, partyId: party.Id);
        }
        await _ledger.PostSalesInvoiceAsync(doc, party, paidInto, staffId);
        if (fromQuote is not null) fromQuote.Status = DocumentStatus.CONFIRMED;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("create", "sales_invoice", doc);
        if (fromQuote is not null) await AuditAsync("convert", "quotation", fromQuote);

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/invoices/{doc.Id}",
            Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
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
        var (doc, error) = await _returns.CreateAsync(id, DocumentType.SALES_INVOICE, req, User, staffId);
        if (error is not null)
        {
            var body = new { message = error.Message, code = error.Code };
            return error.Code == "not_found" ? NotFound(body) : BadRequest(body);
        }

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "sales_return",
            doc!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/returns/{doc.Id}",
            Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
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

    /// <summary>
    /// The department a new sale belongs to: the one asked for, which must be open and one the
    /// person works in. Someone limited to one department sells in it without asking; someone
    /// limited to several must choose. Others may leave it out (a sale of no department).
    /// </summary>
    private async Task<(Department? Department, ActionResult? Error)> ResolveDepartmentAsync(string? raw)
    {
        var mine = Access.Departments(User);
        Guid id;
        if (string.IsNullOrWhiteSpace(raw))
        {
            if (mine is null) return (null, null);
            if (mine.Length != 1)
                return (null, BadRequest(new { message = "Choose the department.", code = "department_required" }));
            id = mine[0];
        }
        else if (!Guid.TryParse(raw, out id))
            return (null, BadRequest(new { message = "Department not found.", code = "department_not_found" }));

        var department = await _db.Departments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id);
        if (department is null || !department.IsActive)
            return (null, BadRequest(new { message = "Department not found.", code = "department_not_found" }));
        if (!Access.CanUseDepartment(User, id))
            return (null, StatusCode(403, new { message = "You don't sell for this department.", code = "not_your_department" }));
        return (department, null);
    }

    private async Task<CompanySettings> GetSettingsAsync() =>
        await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();

    private static string? Clean(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var d)
            ? d : null;
}
