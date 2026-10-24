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
[Authorize]
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

    /// <summary>Purchase invoices, newest first: filtered by period, status and payment, with their totals.</summary>
    [HttpGet("invoices")]
    [AnyPermission(Permissions.PurchasesView, Permissions.PurchasesReturn, Permissions.PurchasesPhotos,
        Permissions.PurchasesPriceSheet)]
    public Task<ActionResult<DocumentListDto>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null,
        [FromQuery] string? status = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.PURCHASE_INVOICE, page, pageSize, search, status, from, to, payment);

    /// <summary>Purchase returns (مرتجعات المشتريات), newest first.</summary>
    [HttpGet("returns")]
    [AnyPermission(Permissions.PurchasesReturnsView, Permissions.PurchasesReturnCancel)]
    public Task<ActionResult<DocumentListDto>> Returns(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null,
        [FromQuery] string? status = null, [FromQuery] string? from = null, [FromQuery] string? to = null) =>
        ListAsync(DocumentType.PURCHASE_RETURN, page, pageSize, search, status, from, to, null);

    private async Task<ActionResult<DocumentListDto>> ListAsync(DocumentType type, int page, int pageSize,
        string? search, string? status, string? from, string? to, string? payment)
    {
        var q = _db.SalesDocuments.Where(d => d.Type == type).InBranches(User, d => d.BranchId);
        q = DocumentLists.Filter(q, search, status, from, to);
        q = DocumentLists.Find(q, Request.Query["number"], Request.Query["party"], Request.Query["partyCode"]);
        q = DocumentLists.Narrow(q, Request.Query["branchId"], Request.Query["warehouseId"]);
        // Invoices with items of this department (owner, 2026-10-19: a purchase isn't of one department).
        if (Guid.TryParse(Request.Query["departmentId"], out var dep))
            q = q.Where(d => d.Lines.Any(l => l.Product != null && l.Product.Category != null && l.Product.Category.DepartmentId == dep));
        return Ok(await DocumentLists.PageAsync(_db, q, page, pageSize, payment, Request.Query["state"]));
    }

    /// <summary>One purchase invoice or purchase return (invoice lines carry the returned quantity).</summary>
    [HttpGet("invoices/{id:guid}")]
    [HttpGet("returns/{id:guid}")]
    [AnyPermission(Permissions.PurchasesView, Permissions.PurchasesReturn, Permissions.PurchasesPhotos,
        Permissions.PurchasesPriceSheet, Permissions.PurchasesReturnsView, Permissions.PurchasesCreate,
        Permissions.PurchasesReturnFree, Permissions.PurchasesReturnCancel, Permissions.StatementSuppliers)]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id &&
            (d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN));
        q = q.InBranches(User, d => d.BranchId);
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
        // Invoices and returns are seen with permissions of their own, by whoever acts on them, and
        // by whoever made them (owner, 2026-10-23).
        var mine = doc.StaffId.ToString() == CurrentUser.Id(User);
        if (doc.Type == DocumentType.PURCHASE_RETURN
                ? !(User.HasAny(Permissions.PurchasesReturnsView, Permissions.PurchasesReturnCancel,
                        Permissions.StatementSuppliers)
                    || (mine && User.HasAny(Permissions.PurchasesReturn, Permissions.PurchasesReturnFree)))
                : !(User.HasAny(Permissions.PurchasesView, Permissions.PurchasesReturn, Permissions.PurchasesPhotos,
                        Permissions.PurchasesPriceSheet, Permissions.StatementSuppliers)
                    || (mine && User.Has(Permissions.PurchasesCreate))))
            return NotFound(new { message = "Document not found" });

        var returned = doc.Type == DocumentType.PURCHASE_INVOICE ? await _returns.ReturnedByLineAsync(doc.Id) : null;
        var dto = Mapper.ToDetail(doc, returned, await InvoiceLines.BaseUnitNamesAsync(_db, doc));
        if (doc.Type == DocumentType.PURCHASE_INVOICE
            && (await DocumentLists.StatesAsync(_db, new[] { doc.Id })).TryGetValue(doc.Id, out var st))
            dto = dto with { State = st.State, Owed = st.Owed };
        var pages = await _db.DocumentImages.CountAsync(x => x.DocumentId == doc.Id);
        if (pages > 0) dto = dto with { HasImage = true, ImagePages = pages };
        return Ok(dto);
    }

    /// <summary>
    /// A purchase document is about to be printed (owner, 2026-10-24): printing is its own permission,
    /// checked here before the web app prints, and written in the activity log.
    /// </summary>
    [HttpPost("invoices/{id:guid}/print")]
    [HttpPost("returns/{id:guid}/print")]
    [Authorize(Policy = Permissions.PurchasesPrint)]
    public async Task<ActionResult> Printed(Guid id)
    {
        var doc = await _db.SalesDocuments.AsNoTracking()
            .Where(d => d.Id == id && (d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN))
            .InBranches(User, d => d.BranchId).FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found", code = "not_found" });
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "print",
            doc.Type == DocumentType.PURCHASE_RETURN ? "purchase_return" : "purchase_invoice",
            doc.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString(), $"{doc.Number} · {doc.GrandTotal / 100m:N2}");
        return NoContent();
    }

    private const long MaxImageBytes = 5 * 1024 * 1024;

    /// <summary>
    /// A purchase invoice's price sheet (owner, 2026-10-19): each item with its code, how many pieces
    /// came and what it sells for now, to print for the salespeople. Sale prices only, never costs.
    /// </summary>
    [HttpGet("invoices/{id:guid}/price-sheet")]
    [Authorize(Policy = Permissions.PurchasesPriceSheet)]
    public async Task<ActionResult<PriceSheetDto>> PriceSheet(Guid id)
    {
        var doc = await _db.SalesDocuments.AsNoTracking().InBranches(User, d => d.BranchId)
            .Include(d => d.Party).Include(d => d.Lines).ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(d => d.Id == id && d.Type == DocumentType.PURCHASE_INVOICE);
        if (doc is null) return NotFound(new { message = "Document not found", code = "not_found" });
        var rows = doc.Lines.Where(l => l.Product is not null)
            .GroupBy(l => l.ProductId)
            .Select(g => new PriceSheetLineDto(g.First().Product!.Sku, Loc.Name(g.First().Product!),
                g.Sum(l => l.Quantity), g.First().Product!.SalePrice))
            .OrderBy(r => r.Name).ToArray();
        return Ok(new PriceSheetDto(doc.Number, CompanyClock.DayOf(doc.IssueDate).ToString("yyyy-MM-dd"),
            doc.Party?.Name, rows));
    }

    private const int MaxImagePages = 10;

    /// <summary>
    /// Keep a photo of the supplier's own invoice with the purchase invoice (owner, 2026-10-17),
    /// one per page (`page` from 0, up to 10 pages), replacing that page's photo. Only a real JPEG, PNG or WebP up to 5 MB (its first bytes are
    /// checked); stored in the database, never on the server's disk.
    /// </summary>
    [HttpPut("invoices/{id:guid}/image")]
    [Authorize(Policy = Permissions.PurchasesPhotos)]
    [RequestSizeLimit(MaxImageBytes + 64 * 1024)]
    public async Task<ActionResult> PutImage(Guid id, IFormFile? file, [FromQuery] int page = 0)
    {
        if (page is < 0 or >= MaxImagePages)
            return BadRequest(new { message = $"Up to {MaxImagePages} pages.", code = "bad_photo" });
        var doc = await _db.SalesDocuments.InBranches(User, d => d.BranchId)
            .FirstOrDefaultAsync(d => d.Id == id && d.Type == DocumentType.PURCHASE_INVOICE);
        if (doc is null) return NotFound(new { message = "Document not found", code = "not_found" });
        if (file is null || file.Length == 0 || file.Length > MaxImageBytes)
            return BadRequest(new { message = "Choose a photo of up to 5 MB.", code = "bad_photo" });
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var data = buffer.ToArray();
        var type = Pictures.TypeOf(data);
        if (type is null) return BadRequest(new { message = "Only JPEG, PNG or WebP photos.", code = "bad_photo" });
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var image = await _db.DocumentImages.FirstOrDefaultAsync(x => x.DocumentId == id && x.Page == page);
        if (image is null) _db.DocumentImages.Add(image = new DocumentImage { DocumentId = id, Page = page });
        image.ContentType = type;
        image.Data = data;
        image.UploadedAt = DateTime.UtcNow;
        image.UploadedBy = staffId == Guid.Empty ? null : staffId;
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "image", "purchase",
            CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
        return Ok(new { hasImage = true });
    }

    /// <summary>A page of the supplier invoice's photos, never cached.</summary>
    [HttpGet("invoices/{id:guid}/image")]
    [AnyPermission(Permissions.PurchasesView, Permissions.PurchasesPhotos)]
    public async Task<IActionResult> GetImage(Guid id, [FromQuery] int page = 0)
    {
        var mine = await _db.SalesDocuments.InBranches(User, d => d.BranchId).AnyAsync(d => d.Id == id);
        if (!mine) return NotFound(new { message = "Not found.", code = "not_found" });
        var image = await _db.DocumentImages.AsNoTracking().FirstOrDefaultAsync(x => x.DocumentId == id && x.Page == page);
        if (image is null) return NotFound(new { message = "Not found.", code = "not_found" });
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(image.Data, image.ContentType);
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
        // A supplier's invoice entered late carries its own day (owner, 2026-10-02).
        var (when, dateCode, dateMessage) = await Backdate.CheckAsync(_db, User, req.DocumentDate);
        if (dateCode is not null) return BadRequest(new { message = dateMessage, code = dateCode });
        using var dated = Backdate.To(when);
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines per invoice.", code = "too_many_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A supplier is required.", code = "no_party" });

        var branchId = Access.Work(User);
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
            var shape = InvoiceLines.CheckShape(line.ProductId, line.UnitId, line.Quantity, line.UnitCost, line.Discount);
            if (shape.Error is not null)
                return BadRequest(new { message = shape.Error.Message, code = shape.Error.Code == "bad_price" ? "bad_cost" : shape.Error.Code });
            // The supplier's discount on a line (owner, 2026-10-01: per piece, as % or an amount).
            if (line.Discount != 0 && !Can(Permissions.PurchasesDiscount))
                return InvoiceLines.Refuse(this, new("discount_not_allowed", "Entering a supplier discount needs permission."));
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
            resolved.Add((line, product, unit!, baseQty, warehouse));
        }
        // The cost is the supplier's price list, else the level, else the average cost; another needs permission.
        if (!canChangePrice)
        {
            var special = await SpecialPrices.LoadAsync(_db, PriceSide.PURCHASE, party.PurchasePriceListId,
                resolved.Select(r => r.Product).ToList());
            var priced = special.Price(book, level, PriceSide.PURCHASE, resolved.Select(r =>
                new SpecialPrices.LineAsk(r.Product, r.Unit, r.Req.Quantity, r.BaseQty, r.Req.IsBonus,
                    _inventory.CostAt(r.Product, r.Warehouse))).ToList(), 0);
            for (var i = 0; i < resolved.Count; i++)
            {
                var (line, product, unit, _, _) = resolved[i];
                if (line.IsBonus || line.UnitCost == priced[i].UnitPrice) continue;
                return InvoiceLines.Refuse(this, new("price_not_allowed",
                    $"{Loc.Name(product)}: the cost is {InvoiceLines.Major(priced[i].UnitPrice)} per {Loc.Name(unit.Unit)}. " +
                    "Changing a cost needs permission."));
            }
        }

        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitCost - r.Req.Discount).ToList();
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
            var lineTotal = (long)line.Quantity * line.UnitCost - line.Discount;
            var docDiscount = charges!.Allocation[i];
            // The goods cost what was paid for them after the supplier's discount; free goods cost
            // nothing and so lower the average.
            var lineCost = lineTotal - docDiscount;
            _inventory.ReceiveValue(product, warehouse, baseQty, lineCost,
                StockMovementType.PURCHASE_IN, doc.Id, number);
            // The first supplier an item is bought from becomes its main supplier, so the invoice's
            // supplier filter works without setting every item up by hand. A variant follows its
            // model, so it is left for the model editor.
            if (product.SupplierId is null && product.ModelId is null
                && party.Types.Contains(nameof(PartyType.SUPPLIER)))
                product.SupplierId = party.Id;

            doc.Lines.Add(new DocumentLine
            {
                LineNo = doc.Lines.Count + 1,
                ProductId = product.Id, ProductName = product.Name, Quantity = baseQty,
                UnitId = unit.UnitId, UnitFactor = unit.Factor, UnitQuantity = line.Quantity,
                UnitPrice = line.UnitCost, Discount = line.Discount, LineTotal = lineTotal,
                IsBonus = line.IsBonus, DocDiscount = docDiscount,
                // Cost of one base unit, for display; LineCost is the exact amount paid.
                UnitCost = (long)decimal.Round((decimal)lineCost / baseQty, MidpointRounding.AwayFromZero),
                LineCost = lineCost, LineProfit = 0,
                WarehouseId = warehouse.Id, Warehouse = warehouse,
            });
        }
        foreach (var c in charges!.Rows) doc.Charges.Add(c);

        var subtotal = doc.Lines.Sum(l => l.LineTotal + l.Discount);
        var lineDiscounts = doc.Lines.Sum(l => l.Discount);
        var net = subtotal - lineDiscounts - charges.Discount;
        var grand = net + charges.Tax + charges.Addition;

        doc.Subtotal = subtotal;
        doc.DiscountTotal = lineDiscounts + charges.Discount;
        doc.TaxTotal = charges.Tax;
        doc.AdditionTotal = charges.Addition;
        doc.GrandTotal = grand;
        doc.CostTotal = net;
        doc.ProfitTotal = 0;
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.PaidDirect = doc.PaidAmount;
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
            var (account, moneyError) = await _money.ForDocumentAsync(req.PaidAccountId, branchId, User);
            moneyError ??= _money.Move(account!, -doc.PaidAmount, MoneyMovementKind.PURCHASE_PAID, staffId, doc.Number,
                documentId: doc.Id, partyId: party.Id);
            if (moneyError is not null) return BadRequest(new { message = moneyError.Message, code = moneyError.Code });
            paidFrom = account!;
            doc.PaidAccountId = account!.Id;
        }
        await _ledger.PostPurchaseInvoiceAsync(doc, party, paidFrom, staffId);

        // Shipping we paid to bring the goods: our expense (not added to the items' cost).
        if (req.ShippingCost < 0) return BadRequest(new { message = "Enter a shipping cost of zero or more.", code = "bad_amount" });
        var (_, shipError) = await _money.ShippingExpenseAsync(req.ShippingCost, req.ShippingAccountId, branchId,
            doc.Number, User, staffId, _ledger);
        if (shipError is not null) return BadRequest(new { message = shipError.Message, code = shipError.Code });

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
    /// What <paramref name="partyId"/> last paid for each of <paramref name="productIds"/>, per unit: a
    /// return typed without an invoice is priced at it (another price needs the change-price permission).
    /// </summary>
    [HttpGet("returns/last-prices")]
    [AnyPermission(Permissions.PurchasesReturn, Permissions.PurchasesReturnFree)]
    public async Task<ActionResult<IEnumerable<LastPriceDto>>> LastPrices([FromQuery] Guid partyId, [FromQuery] Guid[] productIds)
    {
        if (productIds.Length == 0 || productIds.Length > InvoiceLines.MaxLines) return Ok(Array.Empty<LastPriceDto>());
        var last = await PriceBasis.LastPricesAsync(_db, partyId, productIds, DocumentType.PURCHASE_INVOICE);
        return Ok(last.Select(x => new LastPriceDto(x.Key.Product.ToString(), x.Key.Unit?.ToString(), x.Value)));
    }

    /// <summary>Cancel a purchase return entered by mistake: everything it moved goes back (owner, 2026-10-24).</summary>
    [HttpPost("returns/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.PurchasesReturnCancel)]
    public async Task<ActionResult<SalesDetailDto>> CancelReturn(Guid id)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var (doc, error) = await _returns.CancelAsync(id, false, User, staffId);
        if (error is not null)
        {
            var body = new { message = error.Message, code = error.Code };
            return error.Code == "not_found" ? NotFound(body) : BadRequest(body);
        }
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "cancel", "purchase_return",
            doc!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString(), $"{doc.Number} · {doc.GrandTotal / 100m:N2}");
        _db.ChangeTracker.Clear();
        return await GetOne(id);
    }

    /// <summary>
    /// A return typed line by line, without picking an invoice (owner decision 2026-10-01). It goes
    /// on the party's account; a cash customer is paid back from the branch cash box.
    /// </summary>
    [HttpPost("returns")]
    [Authorize(Policy = Permissions.PurchasesReturnFree)]
    public async Task<ActionResult<SalesDetailDto>> CreateFreeReturn([FromBody] CreateFreeReturnRequest req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var (doc, error) = await _returns.CreateFreeAsync(false, req, User, staffId);
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
        var (doc, error) = await _returns.CreateAsync(id, DocumentType.PURCHASE_INVOICE, req, User, staffId);
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
