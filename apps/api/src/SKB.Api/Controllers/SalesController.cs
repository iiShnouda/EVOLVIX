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
    private readonly NotificationService _notifications;

    public SalesController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        ReturnsService returns, AuditService audit, MoneyService money, LedgerService ledger,
        NotificationService notifications)
    {
        _notifications = notifications;
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _returns = returns;
        _audit = audit;
        _money = money;
        _ledger = ledger;
    }

    [HttpGet("invoices")]
    public Task<ActionResult<DocumentListDto>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.SALES_INVOICE, page, pageSize, search, status, departmentId, from, to, payment,
            withAwaiting: true);

    /// <summary>Price quotations (عروض الأسعار), newest first.</summary>
    [HttpGet("quotations")]
    public Task<ActionResult<DocumentListDto>> Quotations(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.QUOTATION, page, pageSize, search, status, departmentId, from, to, payment);

    /// <summary>Pending invoices (فواتير معلّقة) waiting for the accountant, newest first.</summary>
    [HttpGet("orders")]
    public Task<ActionResult<DocumentListDto>> Orders(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.SALES_ORDER, page, pageSize, search, status, departmentId, from, to, payment);

    /// <summary>Sales returns (مرتجعات المبيعات), newest first.</summary>
    [HttpGet("returns")]
    public Task<ActionResult<DocumentListDto>> Returns(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.SALES_RETURN, page, pageSize, search, status, departmentId, from, to, payment);

    private async Task<ActionResult<DocumentListDto>> ListAsync(
        DocumentType type, int page, int pageSize, string? search, string? status, string? departmentId,
        string? from = null, string? to = null, string? payment = null, bool withAwaiting = false)
    {
        // The sales list also shows invoices waiting for the accountant (owner decision 2026-10-01:
        // no separate list of pending invoices) and the ones turned down.
        var q = withAwaiting
            ? _db.SalesDocuments.Where(d => d.Type == type || (d.Type == DocumentType.SALES_ORDER
                && (d.Status == DocumentStatus.PENDING || d.Status == DocumentStatus.REJECTED)))
            : _db.SalesDocuments.Where(d => d.Type == type);
        q = q.InBranches(User, d => d.BranchId).InDepartments(User);
        // "none" = documents of no department.
        if (departmentId == "none") q = q.Where(d => d.DepartmentId == null);
        else if (Guid.TryParse(departmentId, out var dept)) q = q.Where(d => d.DepartmentId == dept);
        q = DocumentLists.Filter(q, search, status, from, to);
        q = DocumentLists.Narrow(q, Request.Query["branchId"], Request.Query["warehouseId"]);
        return Ok(await DocumentLists.PageAsync(_db, q, page, pageSize, payment, Request.Query["state"]));
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
    [HttpGet("orders/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id &&
            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN
                                                  || d.Type == DocumentType.QUOTATION
                                                  || d.Type == DocumentType.SALES_ORDER));
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
        if (doc.Type is DocumentType.QUOTATION or DocumentType.SALES_ORDER
            && await _db.SalesDocuments.AsNoTracking()
                .Where(i => i.SourceDocumentId == doc.Id && i.Type == DocumentType.SALES_INVOICE)
                .Select(i => new { i.Id, i.Number }).FirstOrDefaultAsync() is { } invoice)
            dto = dto with { InvoiceId = invoice.Id.ToString(), InvoiceNumber = invoice.Number };
        return Ok(Costs.Guard(User, dto));
    }

    /// <summary>
    /// A customer's account for the accountant (owner decision 2026-09-30): what they owe now, their
    /// invoices and returns with dates, discounts, what was paid and what is left, and notes — in
    /// total and per sales department — plus the pending invoices waiting for approval. No cost or
    /// profit. Limited to the person's branches and departments.
    /// </summary>
    [HttpGet("customers/{partyId:guid}/account")]
    public async Task<ActionResult<CustomerAccountDto>> CustomerAccount(Guid partyId, [FromQuery] string? departmentId = null)
    {
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId);
        if (party is null) return NotFound(new { message = "Customer not found.", code = "party_not_found" });

        var q = _db.SalesDocuments.Where(d => d.PartyId == partyId && d.Status != DocumentStatus.CANCELLED
                && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN
                                                         || (d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING)))
            .InBranches(User, d => d.BranchId).InDepartments(User);
        if (departmentId == "none") q = q.Where(d => d.DepartmentId == null);
        else if (Guid.TryParse(departmentId, out var dept)) q = q.Where(d => d.DepartmentId == dept);
        var docs = await q.AsNoTracking()
            .Include(d => d.Branch).Include(d => d.Staff).Include(d => d.Department).Include(d => d.SourceDocument)
            .OrderByDescending(d => d.IssueDate).Take(1000).ToListAsync();

        var invoices = docs.Where(d => d.Type == DocumentType.SALES_INVOICE).ToList();
        var returns = docs.Where(d => d.Type == DocumentType.SALES_RETURN).ToList();
        var owed = await MoneyService.OutstandingAsync(_db, invoices);
        long Owed(SalesDocument d) => d.Type == DocumentType.SALES_INVOICE ? owed.GetValueOrDefault(d.Id) : 0;
        string DeptName(SalesDocument d) => d.Department is null ? "" : Loc.Name(d.Department);

        var departments = docs.Where(d => d.Type != DocumentType.SALES_ORDER)
            .GroupBy(d => d.DepartmentId)
            .Select(g => new AccountDepartmentDto(
                g.Key?.ToString(), DeptName(g.First()),
                g.Count(d => d.Type == DocumentType.SALES_INVOICE),
                g.Where(d => d.Type == DocumentType.SALES_INVOICE).Sum(d => d.GrandTotal),
                g.Where(d => d.Type == DocumentType.SALES_INVOICE).Sum(d => d.DiscountTotal),
                g.Where(d => d.Type == DocumentType.SALES_RETURN).Sum(d => d.GrandTotal),
                g.Sum(Owed)))
            .OrderByDescending(r => r.Total).ToArray();
        var rows = docs.Select(d => new AccountDocumentDto(
            d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(), d.IssueDate.ToString("o"),
            d.DepartmentId?.ToString(), d.Department is null ? null : DeptName(d), Loc.Name(d.Branch), d.Staff?.FullName ?? "",
            d.Subtotal, d.DiscountTotal, d.GrandTotal, d.PaidAmount, Owed(d), d.Notes, d.SourceDocument?.Number)).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(x => x.Currency).FirstOrDefaultAsync() ?? party.Currency;
        return Ok(new CustomerAccountDto(
            party.Id.ToString(), party.Name, party.Phone, party.Address, party.ShippingAddress, party.Notes,
            party.Balance, currency,
            invoices.Sum(d => d.GrandTotal), invoices.Sum(d => d.DiscountTotal), returns.Sum(d => d.GrandTotal),
            invoices.Sum(Owed), docs.Where(d => d.Type == DocumentType.SALES_ORDER).Sum(d => d.GrandTotal),
            departments, rows, party.CreditLimit));
    }

    /// <summary>Who a sale can be credited to (active staff), for the invoice's sales-rep picker.</summary>
    [HttpGet("reps")]
    public async Task<ActionResult<RepOptionDto[]>> Reps()
    {
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).OrderBy(s => s.FullName).ToListAsync();
        return Ok(staff.Select(s => new RepOptionDto(s.Id.ToString(), s.FullName, s.BranchId.ToString(), s.Code)).ToArray());
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
        var result = await CreateCore(req, DocumentType.SALES_INVOICE, fromId: null);
        // Over the customer's purchase limit (owner decision 2026-10-01): it is not refused; it waits
        // in the sales list for the accountant to accept or turn it down. Nothing was posted.
        if (ErrorCode(result.Result) != "over_credit_limit") return result;
        _db.ChangeTracker.Clear();
        return await CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER, fromId: null);
    }

    /// <summary>The <c>code</c> of an error answer, if it is one.</summary>
    private static string? ErrorCode(IActionResult? result) =>
        (result as ObjectResult) is { StatusCode: >= 400, Value: { } v }
            ? v.GetType().GetProperty("code")?.GetValue(v) as string
            : null;

    /// <summary>
    /// Change a posted sales invoice (owner decision 2026-10-01): what it moved — stock, the
    /// customer's balance, money paid now and its ledger entry — is reversed, and it is posted again
    /// from the request under its own number and date, checked like a new invoice. Not once goods
    /// were returned on it, payments or notes were taken against it, it went out for delivery, or
    /// it is in a locked period.
    /// </summary>
    [HttpPut("invoices/{id:guid}")]
    [Authorize(Policy = Permissions.SalesEdit)]
    public async Task<ActionResult<SalesDetailDto>> UpdateInvoice(Guid id, [FromBody] CreateSalesInvoiceRequest req)
    {
        var branch = await ScopedInvoices().Where(d => d.Id == id).Select(d => (Guid?)d.BranchId).FirstOrDefaultAsync();
        if (branch is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        return await CreateCore(req, DocumentType.SALES_INVOICE, fromId: null, branch: branch, editId: id);
    }

    /// <summary>
    /// Cancel (delete) a posted sales invoice: its goods go back into their warehouses at the cost
    /// they left at, the customer no longer owes it, money paid now goes back out, and its ledger
    /// entry is reversed. It stays on the list as cancelled, under its number.
    /// </summary>
    [HttpPost("invoices/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.SalesCancel)]
    public async Task<ActionResult<SalesDetailDto>> CancelInvoice(Guid id,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] CancelInvoiceRequest? req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var doc = await ScopedInvoices().Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        var totalBefore = doc.GrandTotal;
        var error = await ReverseInvoiceAsync(doc, staffId);
        if (error is not null) return InvoiceLines.Refuse(this, error);
        doc.Status = DocumentStatus.CANCELLED;
        doc.CancelReason = Clean(req?.Reason, 300);
        _db.InvoiceRevisions.Add(new InvoiceRevision
        {
            DocumentId = doc.Id, Kind = "CANCEL", StaffId = staffId, StaffName = CurrentUser.Name(User) ?? "",
            Reason = doc.CancelReason, TotalBefore = totalBefore, TotalAfter = 0,
        });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", "sales_invoice", doc);
        return await GetOne(id);
    }

    private IQueryable<SalesDocument> ScopedInvoices() =>
        _db.SalesDocuments.Where(d => d.Type == DocumentType.SALES_INVOICE)
            .InBranches(User, d => d.BranchId).InDepartments(User);

    /// <summary>
    /// Undo everything posted sales invoice <paramref name="doc"/> moved, as it stands now (so it can
    /// be changed again and again): goods back at the cost they left at, the customer's balance,
    /// money paid now, and the ledger. The caller holds the transaction and the invoice's row lock;
    /// the changes are saved (not committed) so what follows reads them.
    /// </summary>
    private async Task<InvoiceLines.LineError?> ReverseInvoiceAsync(SalesDocument doc, Guid staffId)
    {
        if (doc.Status == DocumentStatus.CANCELLED)
            return new("invoice_cancelled", "This invoice is already cancelled.");
        if (await _db.SalesDocuments.AnyAsync(d => d.SourceDocumentId == doc.Id && d.Type == DocumentType.SALES_RETURN
                                                   && d.Status != DocumentStatus.CANCELLED))
            return new("invoice_has_returns", "Goods were returned on this invoice, so it can no longer be changed.");
        if (await _db.VoucherAllocations.AnyAsync(a => a.DocumentId == doc.Id && a.Voucher!.Status == VoucherStatus.POSTED))
            return new("invoice_has_payments", "Payments were received against this invoice. Cancel those vouchers first.");
        if (await _db.NoteAllocations.AnyAsync(a => a.DocumentId == doc.Id && a.Note!.Status != NoteStatus.CANCELLED))
            return new("invoice_has_notes", "Cheques or notes were taken against this invoice. Cancel them first.");
        if (doc.DeliveryStatus is DeliveryStatus.OUT_FOR_DELIVERY or DeliveryStatus.DELIVERED or DeliveryStatus.RETURNED
            || await _db.ShipmentInvoices.AnyAsync(x => x.DocumentId == doc.Id && x.Shipment!.Status != ShipmentStatus.CANCELLED))
            return new("invoice_shipped", "This invoice went out for delivery, so it can no longer be changed.");
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(doc.IssueDate) <= DateOnly.FromDateTime(locked))
            return new("period_locked", "This invoice is in a locked period.");

        // Goods back where they left from, at what they cost when they left.
        var products = await _inventory.LockProductsAsync(doc.Lines.Select(l => l.ProductId));
        foreach (var line in doc.Lines.Where(l => l.Quantity > 0 && l.Warehouse is not null))
            if (products.TryGetValue(line.ProductId, out var product))
                _inventory.ReceiveValue(product, line.Warehouse!, line.Quantity, line.LineCost,
                    StockMovementType.SALE_CANCELLED, doc.Id, doc.Number);

        // The customer no longer owes it; money paid on it now goes back out.
        await MoneyService.LockPartiesAsync(_db, doc.PartyId);
        var party = await _db.Parties.FirstAsync(p => p.Id == doc.PartyId);
        await _db.Entry(party).ReloadAsync();
        party.Balance -= doc.GrandTotal - doc.PaidAmount;
        MoneyAccount? paidInto = null;
        if (doc.PaidAmount > 0 && doc.PaidAccountId is Guid accountId)
        {
            paidInto = (await _money.LockAsync(new[] { accountId }))[accountId];
            var moneyError = _money.Move(paidInto, -doc.PaidAmount, MoneyMovementKind.CANCELLATION, staffId, doc.Number,
                documentId: doc.Id, partyId: doc.PartyId);
            if (moneyError is not null) return new(moneyError.Code, moneyError.Message);
        }
        await _ledger.PostSalesInvoiceReversalAsync(doc, party, paidInto, staffId, doc.Number);
        await _db.SaveChangesAsync();
        return null;
    }

    /// <summary>
    /// A price quotation (عرض سعر): priced exactly like an invoice — same levels, charges, permissions
    /// and profit floor — but it moves no stock, money or balance and posts nothing. It holds its
    /// prices until <c>DueDate</c> (two weeks unless given).
    /// </summary>
    [HttpPost("quotations")]
    [Authorize(Policy = Permissions.SalesQuote)]
    public Task<ActionResult<SalesDetailDto>> CreateQuotation([FromBody] CreateSalesInvoiceRequest req) =>
        CreateCore(req, DocumentType.QUOTATION, fromId: null);

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
        return await CreateCore(invoice, DocumentType.SALES_INVOICE, fromId: id, branch: quote.BranchId);
    }

    /// <summary>
    /// Save a pending invoice (فاتورة معلّقة) for the accountant: priced and checked exactly like an
    /// invoice — prices, level, discounts and the person's discount limit, the department, the
    /// profit floor, stock — and its goods are held for it, but nothing is posted: no stock leaves,
    /// no money, balance or ledger moves until the accountant approves it.
    /// </summary>
    [HttpPost("orders")]
    [Authorize(Policy = Permissions.SalesOrder)]
    public Task<ActionResult<SalesDetailDto>> CreateOrder([FromBody] CreateSalesInvoiceRequest req) =>
        CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER, fromId: null);

    /// <summary>
    /// The accountant approves a pending invoice: it becomes a sales invoice with its items,
    /// prices, level, department, rep and delivery (approved when it was made). The accountant may
    /// change its discounts — within their own permission and limit — takes what the customer pays
    /// now and posts it; stock, the profit floor and cost are checked now. The rest stays on the
    /// customer's account (cheques and notes are taken against the invoice afterwards).
    /// </summary>
    [HttpPost("orders/{id:guid}/approve")]
    [Authorize(Policy = Permissions.SalesApprove)]
    public async Task<ActionResult<SalesDetailDto>> ApproveOrder(Guid id, [FromBody] ApproveOrderRequest req)
    {
        var order = await ScopedOrders().AsNoTracking().Include(d => d.Lines).Include(d => d.Charges)
            .AsSplitQuery().FirstOrDefaultAsync(d => d.Id == id);
        if (order is null) return NotFound(new { message = "Pending invoice not found.", code = "not_found" });

        // New discounts, if the accountant changed them: per line, and the invoice's own.
        var lineDiscounts = new Dictionary<Guid, long>();
        foreach (var d in req.LineDiscounts ?? Array.Empty<LineDiscountRequest>())
        {
            if (!Guid.TryParse(d.LineId, out var lineId) || order.Lines.All(l => l.Id != lineId))
                return BadRequest(new { message = "A line was not found on the invoice.", code = "line_not_found" });
            lineDiscounts[lineId] = d.Discount;
        }
        var lines = order.Lines.OrderBy(l => l.LineNo).Select(l => new CreateInvoiceLineRequest(
            l.ProductId.ToString(), l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.UnitPrice,
            lineDiscounts.GetValueOrDefault(l.Id, l.Discount),
            req.WarehouseId ?? l.WarehouseId?.ToString(), l.UnitId?.ToString(), l.IsBonus)).ToArray();
        var kept = order.Charges.OrderBy(c => c.Seq).Select(c => new ChargeRequest(c.Kind.ToString(),
            c.RateBp is int bp ? bp / 100m : null, c.RateBp is null ? c.FixedAmount : null, c.Label)).ToArray();
        var charges = req.Charges is null ? kept
            : kept.Where(c => c.Kind is not (nameof(ChargeKind.DISCOUNT) or nameof(ChargeKind.EXTRA_DISCOUNT)))
                .Concat(req.Charges.Where(c => string.Equals(c.Kind, nameof(ChargeKind.DISCOUNT), StringComparison.OrdinalIgnoreCase)
                                               || string.Equals(c.Kind, nameof(ChargeKind.EXTRA_DISCOUNT), StringComparison.OrdinalIgnoreCase)))
                .ToArray();
        var discountsKept = lines.Zip(order.Lines.OrderBy(l => l.LineNo)).All(x => x.First.Discount == x.Second.Discount)
                            && SameDiscounts(kept, charges);

        // The sale is credited to its rep, else to whoever made it (if they still work here).
        var repId = order.RepId
                    ?? (await _db.Staff.AnyAsync(x => x.Id == order.StaffId && x.IsActive) ? order.StaffId : null);
        var invoice = new CreateSalesInvoiceRequest(
            order.PartyId.ToString(), lines,
            Notes: req.Notes ?? order.Notes, DueDate: req.DueDate, PaidAmount: req.PaidAmount,
            OverrideFloor: req.OverrideFloor, PriceLevelId: order.PriceLevelId?.ToString(), Charges: charges,
            RepId: repId?.ToString(),
            DeliveryMethod: order.DeliveryMethod.ToString(), DeliveryAddress: order.DeliveryAddress,
            DriverId: order.DriverId?.ToString(), CarrierId: order.CarrierId?.ToString(),
            PaidAccountId: req.PaidAccountId, DepartmentId: order.DepartmentId?.ToString());
        return await CreateCore(invoice, DocumentType.SALES_INVOICE, fromId: id, branch: order.BranchId, approved: true,
            discountsKept: discountsKept);
    }

    /// <summary>
    /// Change a pending invoice before it is approved — its items, prices, discounts, notes — checked
    /// exactly like a new one. It keeps its number, date and maker. Its maker or an approver may.
    /// </summary>
    [HttpPut("orders/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> UpdateOrder(Guid id, [FromBody] CreateSalesInvoiceRequest req)
    {
        var order = await ScopedOrders().AsNoTracking().FirstOrDefaultAsync(d => d.Id == id);
        if (order is null) return NotFound(new { message = "Pending invoice not found.", code = "not_found" });
        var mine = order.StaffId.ToString() == CurrentUser.Id(User) && User.HasClaim("permission", Permissions.SalesOrder);
        if (!mine && !User.HasClaim("permission", Permissions.SalesApprove))
            return StatusCode(403, new { message = "Only its maker or an approver can change it.", code = "edit_not_allowed" });
        if (order.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
        return await CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER,
            fromId: null, branch: order.BranchId, replaceId: id);
    }

    /// <summary>
    /// The accountant turns a pending invoice down, saying why: its goods are free again and its
    /// maker is told.
    /// </summary>
    [HttpPost("orders/{id:guid}/reject")]
    [Authorize(Policy = Permissions.SalesApprove)]
    public async Task<ActionResult<SalesDetailDto>> RejectOrder(Guid id, [FromBody] RejectOrderRequest req)
    {
        var reason = Clean(req.Reason, 300);
        if (reason is null) return BadRequest(new { message = "Say why it is turned down.", code = "reason_required" });
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var order = await ScopedOrders().FirstOrDefaultAsync(d => d.Id == id);
        if (order is null) return NotFound(new { message = "Pending invoice not found.", code = "not_found" });
        if (order.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
        order.Status = DocumentStatus.REJECTED;
        order.RejectReason = reason;
        await _notifications.OrderDecidedAsync(order, approved: false, User);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("reject", "sales_order", order);
        return await GetOne(id);
    }

    /// <summary>Cancel a pending invoice: its goods are free again. Its maker or an approver may.</summary>
    [HttpPost("orders/{id:guid}/cancel")]
    public async Task<ActionResult<SalesDetailDto>> CancelOrder(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var order = await ScopedOrders().FirstOrDefaultAsync(d => d.Id == id);
        if (order is null) return NotFound(new { message = "Pending invoice not found.", code = "not_found" });
        var mine = order.StaffId.ToString() == CurrentUser.Id(User) && User.HasClaim("permission", Permissions.SalesOrder);
        if (!mine && !User.HasClaim("permission", Permissions.SalesApprove))
            return StatusCode(403, new { message = "Only its maker or an approver can cancel it.", code = "cancel_not_allowed" });
        if (order.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
        order.Status = DocumentStatus.CANCELLED;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", "sales_order", order);
        return await GetOne(id);
    }

    private IQueryable<SalesDocument> ScopedOrders() =>
        _db.SalesDocuments.Where(d => d.Type == DocumentType.SALES_ORDER)
            .InBranches(User, d => d.BranchId).InDepartments(User);

    /// <summary>The same invoice discounts (kind, rate or amount), in order.</summary>
    private static bool SameDiscounts(ChargeRequest[] a, ChargeRequest[] b)
    {
        static string Key(ChargeRequest c) => $"{c.Kind?.ToUpperInvariant()}|{c.Percent}|{c.Amount}";
        static bool IsDiscount(ChargeRequest c) => c.Kind?.ToUpperInvariant() is nameof(ChargeKind.DISCOUNT) or nameof(ChargeKind.EXTRA_DISCOUNT);
        return a.Where(IsDiscount).Select(Key).SequenceEqual(b.Where(IsDiscount).Select(Key));
    }

    /// <summary>
    /// Base units of each item held by open pending invoices, per warehouse (except
    /// <paramref name="except"/>, the one being approved or changed). One past its hold date
    /// (Settings: PendingHoldDays) holds nothing. Items must be locked first.
    /// </summary>
    private async Task<Dictionary<(Guid Product, Guid Warehouse), long>> HeldAsync(IEnumerable<Guid> productIds, Guid? except)
    {
        var ids = productIds.ToList();
        var rows = await _db.DocumentLines.AsNoTracking()
            .Where(l => ids.Contains(l.ProductId) && l.WarehouseId != null && l.DocumentId != except
                        && l.Document!.Type == DocumentType.SALES_ORDER && l.Document.Status == DocumentStatus.PENDING
                        && (l.Document.DueDate == null || l.Document.DueDate >= CompanyClock.TodayDate))
            .GroupBy(l => new { l.ProductId, WarehouseId = l.WarehouseId!.Value })
            .Select(g => new { g.Key.ProductId, g.Key.WarehouseId, Quantity = g.Sum(l => (long)l.Quantity) })
            .ToListAsync();
        return rows.ToDictionary(r => (r.ProductId, r.WarehouseId), r => r.Quantity);
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
    /// Make a sales invoice, a quotation or a pending invoice (<paramref name="type"/>). With
    /// <paramref name="fromId"/> the invoice comes from that quotation or pending invoice, which is
    /// closed with it: what was approved on it (prices, level, free goods, taxes) holds, and so do
    /// its discounts unless they were changed (<paramref name="discountsKept"/>).
    /// </summary>
    /// <param name="branch">The branch it belongs to (a quotation's invoice stays in its branch); else the working branch.</param>
    private async Task<ActionResult<SalesDetailDto>> CreateCore(
        CreateSalesInvoiceRequest req, DocumentType type, Guid? fromId, Guid? branch = null, bool discountsKept = true,
        Guid? replaceId = null, Guid? editId = null, bool approved = false)
    {
        var quote = type == DocumentType.QUOTATION;
        // Quotations and pending invoices post nothing.
        var posts = type == DocumentType.SALES_INVOICE;
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines per invoice.", code = "too_many_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A customer is required.", code = "no_party" });

        var branchId = branch ?? Access.Work(User);
        // The branch picked on the invoice (owner, 2026-10-01), if the person may work in it.
        if (branch is null && editId is null && Guid.TryParse(req.BranchId, out var pickedBranch))
        {
            if (!Access.CanUseBranch(User, pickedBranch)
                || !await _db.Branches.AnyAsync(b => b.Id == pickedBranch && b.IsActive))
                return BadRequest(new { message = "Branch not found.", code = "branch_not_found" });
            branchId = pickedBranch;
        }
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Customer not found.", code = "party_not_found" });

        var dueDate = ParseDate(req.DueDate);
        if (quote && dueDate is DateTime until && until.Date < CompanyClock.TodayDate)
            return BadRequest(new { message = "A quotation is valid until today or later.", code = "bad_valid_until" });
        // A new invoice's due date (تاريخ الاستحقاق) is today or later.
        if (type == DocumentType.SALES_INVOICE && fromId is null && editId is null
            && dueDate is DateTime due && due.Date < CompanyClock.TodayDate)
            return BadRequest(new { message = "The due date is today or later.", code = "bad_due_date" });

        var basis = PriceBasis.Parse(req.PriceBasis);
        if (basis is null) return BadRequest(new { message = "Unknown price basis.", code = "bad_price_basis" });
        // Each line may have its own basis (else the invoice's).
        if (req.Lines.Any(l => !string.IsNullOrWhiteSpace(l.PriceBasis) && PriceBasis.Parse(l.PriceBasis) is null))
            return BadRequest(new { message = "Unknown price basis.", code = "bad_price_basis" });

        var settings = await GetSettingsAsync();
        // A quotation still valid keeps what was approved on it: its prices, level, discounts, free
        // goods and taxes. (Whether it's still open is checked under its lock below.)
        // A pending invoice was approved when it was made, whatever its date.
        var trusted = false;
        if (fromId is Guid sourceId)
        {
            var source = await _db.SalesDocuments.Where(d => d.Id == sourceId)
                .Select(d => new { d.Type, d.DueDate }).FirstOrDefaultAsync();
            trusted = source?.Type == DocumentType.SALES_ORDER
                      || source?.DueDate is null || source.DueDate.Value.Date >= CompanyClock.TodayDate;
        }
        bool Can(string permission) => User.HasClaim("permission", permission);
        bool Approved(string permission) => trusted || Can(permission);
        // Discounts someone changes now are theirs: their permission and their limit.
        var discountTrusted = trusted && discountsKept;
        bool DiscountApproved() => discountTrusted || Can(Permissions.SalesDiscount);
        var canOverride = Can(Permissions.SalesOverrideFloor);
        var canChangePrice = Approved(Permissions.SalesChangePrice);
        var canRaisePrice = Approved(Permissions.SalesRaisePrice);

        // ---- Invoice charges: discounts, taxes, additions — each needs its own permission ----
        var (specs, chargeError) = Charges.Parse(req.Charges, req.TaxPercent, settings.DefaultTaxPercent);
        if (chargeError is not null) return BadRequest(new { message = chargeError.Message, code = chargeError.Code });
        if (specs!.Any(c => c.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT) && !DiscountApproved())
            return InvoiceLines.Refuse(this, new("discount_not_allowed", "Giving an invoice discount needs permission."));
        if (specs!.Any(c => c.Kind == ChargeKind.ADDITION) && !Approved(Permissions.SalesAdditions))
            return InvoiceLines.Refuse(this, new("additions_not_allowed", "Adding charges needs permission."));
        if (!Approved(Permissions.SalesChangeTax) && !Charges.IsDefaultTax(specs!, settings.DefaultTaxPercent))
            return InvoiceLines.Refuse(this, new("tax_not_allowed",
                $"The tax is {settings.DefaultTaxPercent}%. Changing it needs permission."));

        // ---- The sales department (قسم) it belongs to: sold only from that department's items ----
        var (department, departmentError) = await ResolveDepartmentAsync(req.DepartmentId);
        if (departmentError is not null) return departmentError;
        // …one the warehouse has, when the warehouse picks its departments (owner decision 2026-10-01).
        if (department is not null && Guid.TryParse(req.WarehouseId, out var invoiceWarehouse))
        {
            var has = _db.WarehouseDepartments.Where(l => l.WarehouseId == invoiceWarehouse);
            if (await has.AnyAsync() && !await has.AnyAsync(l => l.DepartmentId == department.Id))
                return BadRequest(new { message = "That department isn't in this warehouse.", code = "department_not_in_warehouse" });
        }

        // Every sale has a rep (المندوب): the one chosen, else whoever makes it. A quotation gets one
        // only if chosen, so turning it into an invoice credits whoever does that.
        Guid? repId = quote || staffId == Guid.Empty ? null : staffId;
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
        // The shipping company and address come from the customer's file (owner, 2026-10-01);
        // another one on this sale needs its own permission.
        var canChangeShipping = Approved(Permissions.SalesChangeShipping);
        if (method == DeliveryMethod.SHIPPING_COMPANY)
        {
            var asked = string.IsNullOrWhiteSpace(req.CarrierId) ? party.DefaultCarrierId?.ToString() : req.CarrierId;
            if (!Guid.TryParse(asked, out var carrier)
                || !await _db.Parties.AnyAsync(p => p.Id == carrier && p.IsActive && p.Types.Contains(nameof(PartyType.CARRIER))))
                return BadRequest(new { message = "Choose the shipping company.", code = "carrier_not_found" });
            if (party.DefaultCarrierId is Guid usual && carrier != usual && !canChangeShipping)
                return InvoiceLines.Refuse(this, new("shipping_not_allowed",
                    "This customer ships with another company. Changing it needs permission."));
            carrierId = carrier;
        }
        var fileAddress = party.ShippingAddress ?? party.Address;
        var askedAddress = Clean(req.DeliveryAddress, 300);
        if (method != DeliveryMethod.PICKUP && askedAddress is not null && fileAddress is not null
            && askedAddress != fileAddress && !canChangeShipping)
            return InvoiceLines.Refuse(this, new("shipping_not_allowed",
                "The shipping address comes from the customer's file. Changing it needs permission."));
        var deliveryAddress = method == DeliveryMethod.PICKUP ? null : askedAddress ?? fileAddress;

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
        if (fromId is Guid qid)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {qid} FOR UPDATE");
            fromQuote = await _db.SalesDocuments.FirstAsync(d => d.Id == qid);
            if (fromQuote.Status != DocumentStatus.PENDING)
                return BadRequest(fromQuote.Type == DocumentType.SALES_ORDER
                    ? new { message = "This invoice is no longer pending.", code = "order_closed" }
                    : new { message = "This quotation is already closed.", code = "quote_closed" });
        }
        // A posted invoice being changed: undo it first, so its goods and the customer's balance
        // are back before the new version is checked and posted.
        SalesDocument? edited = null;
        long editedTotal = 0;
        if (editId is Guid eid)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {eid} FOR UPDATE");
            edited = await ScopedInvoices().Include(d => d.Lines).ThenInclude(l => l.Warehouse).Include(d => d.Charges)
                .AsSplitQuery().FirstOrDefaultAsync(d => d.Id == eid);
            if (edited is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
            editedTotal = edited.GrandTotal;
            var reverseError = await ReverseInvoiceAsync(edited, staffId);
            if (reverseError is not null) return InvoiceLines.Refuse(this, reverseError);
        }
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
        var book = await PriceBook.LoadAsync(_db, products.Keys);
        var categoryIds = products.Values.Select(p => p.CategoryId).Distinct().ToList();
        var departmentOf = await _db.Categories.AsNoTracking().Where(c => categoryIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.DepartmentId);

        var (level, levelError) = InvoiceLines.ResolveLevel(book, req.PriceLevelId, party.SalesPriceLevelId,
            PriceSide.SALE, Approved(Permissions.SalesChoosePriceLevel));
        if (levelError is not null) return InvoiceLines.Refuse(this, levelError);

        // ---- Resolve units; prices are checked against the level, price lists and quantity discounts ----
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
            resolved.Add((line, product, unit!, baseQty, warehouse, baseCost));
        }
        // What each line costs by the rules: price list, level (or cost), and its quantity discount.
        var special = await SpecialPrices.LoadAsync(_db, PriceSide.SALE, party.SalesPriceListId,
            resolved.Select(r => r.Product).ToList());
        var asks = resolved.Select(r =>
            new SpecialPrices.LineAsk(r.Product, r.Unit, r.Req.Quantity, r.BaseQty, r.Req.IsBonus, r.BaseCost)).ToList();
        var priced = special.Price(book, level, PriceSide.SALE, asks, settings.DefaultMarkupPercent);
        // Sold at the customer's last price or at cost instead of the selling price: its own permission.
        var bases = resolved.Select(r =>
            string.IsNullOrWhiteSpace(r.Req.PriceBasis) ? basis : PriceBasis.Parse(r.Req.PriceBasis)!).ToList();
        if (bases.Any(b => b != PriceBasis.List))
        {
            if (!Approved(Permissions.SalesPriceBasis))
                return InvoiceLines.Refuse(this, new("price_basis_not_allowed", "Pricing at the last price or at cost needs permission."));
            var last = bases.Contains(PriceBasis.Last)
                ? await PriceBasis.LastPricesAsync(_db, partyId, products.Keys)
                : new Dictionary<(Guid Product, Guid? Unit), long>();
            priced = PriceBasis.Apply(bases, priced, asks, last);
        }
        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, _, _, _) = resolved[i];
            if (line.IsBonus) continue;
            // Adding to the price on this invoice only is its own permission; going under it is not.
            var raised = line.UnitPrice > priced[i].UnitPrice && canRaisePrice;
            if (!canChangePrice && line.UnitPrice != priced[i].UnitPrice && !raised)
                return InvoiceLines.Refuse(this, new("price_not_allowed",
                    $"{Loc.Name(product)}: the price is {InvoiceLines.Major(priced[i].UnitPrice)} per {Loc.Name(unit.Unit)}" +
                    (priced[i].Discount > 0 ? $", less {InvoiceLines.Major(priced[i].Discount)}" : "") +
                    ". Changing a price needs permission."));
            // A line's quantity discount comes by itself; any other discount on one line is a discount,
            // not a price change. (More than the line is worth is already refused by the shape check.)
            if (line.Discount != 0 && line.Discount != priced[i].Discount && !DiscountApproved())
                return InvoiceLines.Refuse(this, new("discount_not_allowed",
                    $"{Loc.Name(product)}: giving a discount needs permission."));
        }

        // ---- Work out the charges and each line's share of the invoice discount ----
        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitPrice - r.Req.Discount).ToList();
        var (charges, applyError) = Charges.Apply(nets, resolved.Select(r => !r.Req.IsBonus).ToList(), specs!);
        if (applyError is not null) return BadRequest(new { message = applyError.Message, code = applyError.Code });

        // The person's discount limit: a line's own discount plus its share of the invoice discount.
        if (!discountTrusted && Access.MaxDiscount(User) is int maxDiscount)
            for (var i = 0; i < resolved.Count; i++)
            {
                var (line, product, _, _, _, _) = resolved[i];
                if (line.IsBonus) continue;
                var gross = (long)line.Quantity * line.UnitPrice;
                // The quantity discount is the company's own rule: it doesn't count against the limit.
                var automatic = line.Discount == priced[i].Discount ? priced[i].Discount : 0;
                if ((line.Discount - automatic + charges!.Allocation[i]) * 100 > gross * maxDiscount)
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
        // Goods held by pending invoices are not available (except the one being approved).
        var held = quote ? new() : await HeldAsync(products.Keys, fromId ?? replaceId);
        foreach (var need in quote ? [] : resolved.GroupBy(l => (l.Product.Id, l.Warehouse.Id)))
        {
            var product = need.First().Product;
            var warehouse = need.First().Warehouse;
            var wanted = need.Sum(l => (long)l.BaseQty);
            var available = _inventory.Available(product.Id, warehouse.Id) - held.GetValueOrDefault((product.Id, warehouse.Id));
            if (wanted > available)
                return BadRequest(new
                {
                    message = $"Not enough {Loc.Name(product)} in {Loc.Name(warehouse)}: {available} left, {wanted} requested.",
                    code = "insufficient_stock",
                });
        }

        // ---- Post the document ----
        // A pending invoice being changed is written again under its own id, number, date and maker.
        SalesDocument? replaced = null;
        if (replaceId is Guid rid)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {rid} FOR UPDATE");
            replaced = await _db.SalesDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == rid);
            if (replaced is null || replaced.Type != DocumentType.SALES_ORDER || replaced.Status != DocumentStatus.PENDING)
                return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
            await _db.DocumentLines.Where(l => l.DocumentId == rid).ExecuteDeleteAsync();
            await _db.DocumentCharges.Where(c => c.DocumentId == rid).ExecuteDeleteAsync();
            await _db.SalesDocuments.Where(d => d.Id == rid).ExecuteDeleteAsync();
        }
        var number = edited?.Number ?? replaced?.Number ?? await DocumentNumbers.NextAsync(_db, type);
        if (edited is not null)
        {
            _db.DocumentLines.RemoveRange(edited.Lines);
            _db.DocumentCharges.RemoveRange(edited.Charges);
            edited.Lines.Clear();
            edited.Charges.Clear();
        }
        var doc = edited ?? new SalesDocument
        {
            Id = replaced?.Id ?? Guid.NewGuid(), CreatedAt = replaced?.CreatedAt ?? DateTime.UtcNow,
            Number = number, Type = type, BranchId = branchId,
            PartyId = partyId, StaffId = replaced?.StaffId ?? staffId, IssueDate = replaced?.IssueDate ?? DateTime.UtcNow,
            // A quotation holds its prices two weeks; a pending invoice holds its goods as Settings say.
            DueDate = dueDate ?? (quote ? CompanyClock.TodayDate.AddDays(14)
                : type == DocumentType.SALES_ORDER && settings.PendingHoldDays > 0
                    ? CompanyClock.TodayDate.AddDays(settings.PendingHoldDays) : null),
            Currency = settings.Currency, Notes = Clean(req.Notes, 500), SourceDocumentId = fromId,
            PriceLevelId = level?.Id, RepId = repId, DepartmentId = department?.Id,
            DeliveryMethod = method, DeliveryStatus = method == DeliveryMethod.PICKUP ? null : DeliveryStatus.PENDING,
            DeliveryAddress = deliveryAddress, DriverId = driverId, CarrierId = carrierId,
        };
        if (edited is not null)
        {
            // Same document, number, date and maker; everything else as asked now.
            doc.PartyId = partyId;
            doc.DueDate = dueDate;
            doc.Currency = settings.Currency;
            doc.Notes = Clean(req.Notes, 500);
            doc.PriceLevelId = level?.Id;
            doc.RepId = repId;
            doc.DepartmentId = department?.Id;
            doc.DeliveryMethod = method;
            doc.DeliveryStatus = method == DeliveryMethod.PICKUP ? null : DeliveryStatus.PENDING;
            doc.DeliveryAddress = deliveryAddress;
            doc.DriverId = driverId;
            doc.CarrierId = carrierId;
            doc.PaidAccountId = null;
        }

        for (var i = 0; i < resolved.Count; i++)
        {
            var (line, product, unit, baseQty, warehouse, baseCost) = resolved[i];
            // A quotation only estimates the profit, at today's cost.
            var unitCost = !posts ? baseCost : _inventory.Issue(product, warehouse, baseQty,
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
        if (!posts)
        {
            doc.Status = DocumentStatus.PENDING;
            _db.SalesDocuments.Add(doc);
            // A new pending invoice goes to whoever may approve it.
            if (type == DocumentType.SALES_ORDER && replaced is null)
                await _notifications.OrderPendingAsync(doc, party.Name, department is null ? null : Loc.Name(department), User);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            await AuditAsync(replaced is null ? "create" : "update", quote ? "quotation" : "sales_order", doc);
            await InvoiceLines.LoadForDetailAsync(_db, doc);
            return Created($"/api/sales/{(quote ? "quotations" : "orders")}/{doc.Id}",
                Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
        }
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        // A cash customer (عميل نقدي) pays the whole invoice now.
        if (party.IsCashCustomer && doc.PaidAmount < grand)
            return BadRequest(new
            {
                message = $"{party.Name} is a cash customer: the whole {InvoiceLines.Major(grand)} is paid now.",
                code = "cash_customer_must_pay",
            });
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // The customer owes us the unpaid balance (receivable → positive).
        await MoneyService.LockPartiesAsync(_db, party.Id);
        await _db.Entry(party).ReloadAsync();
        party.Balance += grand - doc.PaidAmount;
        // Not over their credit limit (حد الائتمان), unless the person may allow it.
        // An invoice the accountant approves is their decision on the limit (owner decision 2026-10-01).
        if (party.CreditLimit is long limit && grand > doc.PaidAmount && party.Balance > limit
            && !approved && !Can(Permissions.SalesOverCredit))
            return BadRequest(new
            {
                message = $"{party.Name} would owe {InvoiceLines.Major(party.Balance)}, over their credit limit of " +
                          $"{InvoiceLines.Major(limit)}. Take more now, or ask a manager.",
                code = "over_credit_limit",
            });

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
        if (fromQuote?.Type == DocumentType.SALES_ORDER) await _notifications.OrderDecidedAsync(fromQuote, approved: true, User);
        // Whoever takes the payment hears of it: the customer and the department.
        else if (edited is null)
            await _notifications.InvoiceNewAsync(doc, party.Name, department is null ? null : Loc.Name(department), User);

        if (edited is null) _db.SalesDocuments.Add(doc);
        else
        {
            _db.InvoiceRevisions.Add(new InvoiceRevision
            {
                DocumentId = doc.Id, Kind = "EDIT", StaffId = staffId, StaffName = CurrentUser.Name(User) ?? "",
                TotalBefore = editedTotal, TotalAfter = doc.GrandTotal,
            });
            // New rows under a document already tracked: insert them (their ids are set already).
            foreach (var l in doc.Lines) _db.Entry(l).State = EntityState.Added;
            foreach (var c in doc.Charges) _db.Entry(c).State = EntityState.Added;
        }
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync(edited is null ? "create" : "update", "sales_invoice", doc);
        if (fromQuote is not null)
            await AuditAsync(fromQuote.Type == DocumentType.SALES_ORDER ? "approve" : "convert",
                fromQuote.Type == DocumentType.SALES_ORDER ? "sales_order" : "quotation", fromQuote);

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/invoices/{doc.Id}",
            Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
    }

    /// <summary>
    /// What <paramref name="partyId"/> last paid for each of <paramref name="productIds"/>, per unit: a
    /// return typed without an invoice is priced at it (another price needs the change-price permission).
    /// </summary>
    [HttpGet("returns/last-prices")]
    [Authorize(Policy = Permissions.SalesReturn)]
    public async Task<ActionResult<IEnumerable<LastPriceDto>>> LastPrices([FromQuery] Guid partyId, [FromQuery] Guid[] productIds)
    {
        if (productIds.Length == 0 || productIds.Length > InvoiceLines.MaxLines) return Ok(Array.Empty<LastPriceDto>());
        var last = await PriceBasis.LastPricesAsync(_db, partyId, productIds, DocumentType.SALES_INVOICE);
        return Ok(last.Select(x => new LastPriceDto(x.Key.Product.ToString(), x.Key.Unit?.ToString(), x.Value)));
    }

    /// <summary>
    /// A return typed line by line, without picking an invoice (owner decision 2026-10-01). It goes
    /// on the party's account; a cash customer is paid back from the branch cash box.
    /// </summary>
    [HttpPost("returns")]
    [Authorize(Policy = Permissions.SalesReturnFree)]
    public async Task<ActionResult<SalesDetailDto>> CreateFreeReturn([FromBody] CreateFreeReturnRequest req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var (doc, error) = await _returns.CreateFreeAsync(true, req, User, staffId);
        if (error is not null)
        {
            var body = new { message = error.Message, code = error.Code };
            return error.Code == "not_found" ? NotFound(body) : BadRequest(body);
        }

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "sales_return",
            doc!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await InvoiceLines.LoadForDetailAsync(_db, doc);
        return Created($"/api/sales/returns/{doc.Id}", Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
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
            // Every sale names its department while the company has any (Settings).
            if (mine is null)
                return await _db.CompanySettings.Select(s => s.RequireDepartment).FirstOrDefaultAsync()
                       && await _db.Departments.AnyAsync(d => d.IsActive)
                    ? (null, BadRequest(new { message = "Choose the department.", code = "department_required" }))
                    : (null, null);
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
