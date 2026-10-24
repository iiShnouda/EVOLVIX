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
[Authorize]
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
    [AnyPermission(Permissions.SalesView, Permissions.SalesEdit, Permissions.SalesCancel, Permissions.SalesLock,
        Permissions.SalesReturn, Permissions.SalesApprove, Permissions.SalesReject, Permissions.SalesDiscount,
        Permissions.SalesDiscountLine, Permissions.SalesDiscountCombined)]
    public Task<ActionResult<DocumentListDto>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.SALES_INVOICE, page, pageSize, search, status, departmentId, from, to, payment,
            withAwaiting: true);

    /// <summary>Price quotations (عروض الأسعار), newest first.</summary>
    [HttpGet("quotations")]
    [AnyPermission(Permissions.SalesView, Permissions.SalesQuote)]
    public Task<ActionResult<DocumentListDto>> Quotations(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.QUOTATION, page, pageSize, search, status, departmentId, from, to, payment);

    /// <summary>Pending invoices (فواتير معلّقة) waiting for the accountant, newest first.</summary>
    [HttpGet("orders")]
    [AnyPermission(Permissions.SalesView, Permissions.SalesApprove, Permissions.SalesReject)]
    public Task<ActionResult<DocumentListDto>> Orders(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? payment = null) =>
        ListAsync(DocumentType.SALES_ORDER, page, pageSize, search, status, departmentId, from, to, payment);

    /// <summary>Sales returns (مرتجعات المبيعات), newest first.</summary>
    [HttpGet("returns")]
    [Authorize(Policy = Permissions.SalesReturnsView)]
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
        q = DocumentLists.Find(q, Request.Query["number"], Request.Query["party"], Request.Query["partyCode"]);
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
        if (doc is null || !MaySee(doc)) return NotFound(new { message = "Document not found" });

        var returned = doc.Type == DocumentType.SALES_INVOICE ? await _returns.ReturnedByLineAsync(doc.Id) : null;
        var dto = Mapper.ToDetail(doc, returned, await InvoiceLines.BaseUnitNamesAsync(_db, doc));
        if (doc.Type is DocumentType.QUOTATION or DocumentType.SALES_ORDER
            && await _db.SalesDocuments.AsNoTracking()
                .Where(i => i.SourceDocumentId == doc.Id && i.Type == DocumentType.SALES_INVOICE)
                .Select(i => new { i.Id, i.Number }).FirstOrDefaultAsync() is { } invoice)
            dto = dto with { InvoiceId = invoice.Id.ToString(), InvoiceNumber = invoice.Number };
        if (doc.Type == DocumentType.SALES_INVOICE
            && await _db.InvoiceRevisions.AnyAsync(x => x.DocumentId == doc.Id && x.Kind == "EDIT"))
            dto = dto with { Edited = true };
        if (doc.Type == DocumentType.SALES_INVOICE
            && (await DocumentLists.StatesAsync(_db, new[] { doc.Id })).TryGetValue(doc.Id, out var st))
            dto = dto with { State = st.State, Owed = st.Owed };
        return Ok(Costs.Guard(User, dto));
    }

    /// <summary>
    /// Whether this person may open this document (owner, 2026-10-23): each list has its own
    /// permission and is opened too by whoever acts on its documents; whoever made one may open it.
    /// </summary>
    private bool MaySee(SalesDocument d)
    {
        var mine = d.StaffId.ToString() == CurrentUser.Id(User);
        return d.Type switch
        {
            DocumentType.SALES_INVOICE => User.HasAny(Permissions.SalesView, Permissions.SalesEdit, Permissions.SalesCancel,
                    Permissions.SalesLock, Permissions.SalesReturn, Permissions.SalesApprove, Permissions.SalesReject,
                    Permissions.SalesDiscount, Permissions.SalesDiscountLine, Permissions.SalesDiscountCombined,
                    Permissions.SalesTogether, Permissions.StatementCustomers)
                || (mine && User.HasAny(Permissions.SalesCreate, Permissions.SalesOrder, Permissions.SalesQuote)),
            DocumentType.SALES_RETURN => User.HasAny(Permissions.SalesReturnsView, Permissions.StatementCustomers)
                || (mine && User.HasAny(Permissions.SalesReturn, Permissions.SalesReturnFree)),
            DocumentType.QUOTATION => User.HasAny(Permissions.SalesView, Permissions.SalesQuote),
            DocumentType.SALES_ORDER => User.HasAny(Permissions.SalesView, Permissions.SalesApprove, Permissions.SalesReject,
                    Permissions.SalesDiscount, Permissions.SalesDiscountLine, Permissions.SalesDiscountCombined,
                    Permissions.SalesTogether)
                || (mine && User.Has(Permissions.SalesOrder)),
            _ => false,
        };
    }

    /// <summary>
    /// A customer's account for the accountant (owner decision 2026-09-30): what they owe now, their
    /// invoices and returns with dates, discounts, what was paid and what is left, and notes — in
    /// total and per sales department — plus the pending invoices waiting for approval. No cost or
    /// profit. Limited to the person's branches and departments.
    /// </summary>
    [HttpGet("customers/{partyId:guid}/account")]
    [AnyPermission(Permissions.SalesTogether, Permissions.StatementCustomers)]
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

    /// <summary>
    /// A customer's invoices together, for the accountant (owner, 2026-10-02): what they took from
    /// every department in the period (today unless given) — posted invoices and those waiting for
    /// approval — one after another with their lines, so a discount can be given on each or on all,
    /// and each printed alone or together. Also what they owed before these invoices. It opens for
    /// whoever prints them and whoever gives any kind of discount, which is given only here.
    /// </summary>
    [HttpGet("customers/{partyId:guid}/invoices")]
    [AnyPermission(Permissions.SalesTogether, Permissions.SalesDiscount, Permissions.SalesDiscountLine,
        Permissions.SalesDiscountCombined)]
    public async Task<ActionResult<CustomerInvoicesDto>> CustomerInvoices(Guid partyId, [FromQuery] string? from = null,
        [FromQuery] string? to = null)
    {
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId);
        if (party is null) return NotFound(new { message = "Customer not found.", code = "party_not_found" });
        var today = CompanyClock.Today;
        var fromDay = DateOnly.TryParse(from, out var f) ? f : today;
        var toDay = DateOnly.TryParse(to, out var t) ? t : fromDay;
        if (toDay < fromDay || toDay.DayNumber - fromDay.DayNumber > 92)
            return BadRequest(new { message = "Choose up to three months.", code = "bad_period" });
        var start = CompanyClock.StartOf(fromDay);
        var end = CompanyClock.StartOf(toDay.AddDays(1));
        // …and their returns in the period (owner, 2026-10-02): printed with them and taken off the total.
        var docs = await _db.SalesDocuments.AsNoTracking()
            .Where(d => d.PartyId == partyId && d.IssueDate >= start && d.IssueDate < end
                        && ((d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED)
                            || (d.Type == DocumentType.SALES_RETURN && d.Status != DocumentStatus.CANCELLED)
                            || (d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING)))
            .InBranches(User, d => d.BranchId).InDepartments(User)
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .Include(d => d.Lines).ThenInclude(l => l.Unit)
            .Include(d => d.SourceDocument).Include(d => d.PriceLevel)
            .Include(d => d.Charges).Include(d => d.Rep).Include(d => d.Driver).Include(d => d.Carrier)
            .Include(d => d.PaidAccount).Include(d => d.Department)
            .AsSplitQuery().OrderBy(d => d.IssueDate).Take(200).ToListAsync();
        var ids = docs.Select(d => d.Id).ToList();
        var edited = await _db.InvoiceRevisions.Where(x => ids.Contains(x.DocumentId) && x.Kind == "EDIT")
            .Select(x => x.DocumentId).Distinct().ToListAsync();
        var states = await DocumentLists.StatesAsync(_db,
            docs.Where(d => d.Type == DocumentType.SALES_INVOICE).Select(d => d.Id).ToList());
        var invoices = new List<SalesDetailDto>();
        var returns = new List<SalesDetailDto>();
        foreach (var d in docs)
        {
            var dto = Mapper.ToDetail(d, null, await InvoiceLines.BaseUnitNamesAsync(_db, d)) with { Edited = edited.Contains(d.Id) };
            if (states.TryGetValue(d.Id, out var st)) dto = dto with { State = st.State, Owed = st.Owed };
            (d.Type == DocumentType.SALES_RETURN ? returns : invoices).Add(Costs.Guard(User, dto));
        }
        // What they owed before these: the balance less what the posted ones still put on it, plus
        // what their returns took off it (less what was paid back in cash).
        var posted = docs.Where(d => d.Type == DocumentType.SALES_INVOICE).ToList();
        var owed = await MoneyService.OutstandingAsync(_db, posted);
        var onThese = posted.Sum(d => owed.GetValueOrDefault(d.Id));
        var back = docs.Where(d => d.Type == DocumentType.SALES_RETURN).ToList();
        var returnsTotal = back.Sum(d => d.GrandTotal);
        // A return against one of these invoices is already off what that invoice still owes.
        var postedIds = posted.Select(d => d.Id).ToHashSet();
        var offBalance = back.Where(d => d.SourceDocumentId is not Guid src || !postedIds.Contains(src))
            .Sum(d => d.GrandTotal - d.PaidAmount);
        var currency = await _db.CompanySettings.AsNoTracking().Select(x => x.Currency).FirstOrDefaultAsync() ?? party.Currency;
        return Ok(new CustomerInvoicesDto(Mapper.ToParty(party, User), party.Balance, party.Balance - onThese + offBalance, onThese,
            currency, fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), invoices.ToArray(),
            returns.ToArray(), returnsTotal, DocumentLists.Together(states.Values, posted.Sum(d => d.GrandTotal))));
    }

    /// <summary>
    /// The accountant's discount on one invoice (owner, 2026-10-02), posted or waiting for approval:
    /// its invoice discount (or, with <c>Kind = EXTRA_DISCOUNT</c>, its second one) becomes this
    /// percent or amount (neither = none). Everything else stays as it was approved; the discount is
    /// checked against the person's own permission and limit, and the invoice is posted again under
    /// its number (listed as a discount among its changes).
    /// </summary>
    [HttpPost("invoices/{id:guid}/discount")]
    [HttpPost("orders/{id:guid}/discount")]
    [Authorize(Policy = Permissions.SalesDiscount)]
    public async Task<ActionResult<SalesDetailDto>> SetDiscount(Guid id, [FromBody] SetInvoiceDiscountRequest req)
    {
        var kind = string.Equals(req.Kind, nameof(ChargeKind.EXTRA_DISCOUNT), StringComparison.OrdinalIgnoreCase)
            ? ChargeKind.EXTRA_DISCOUNT : ChargeKind.DISCOUNT;
        var doc = await _db.SalesDocuments.AsNoTracking()
            .Where(d => d.Id == id && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_ORDER))
            .InBranches(User, d => d.BranchId).InDepartments(User)
            .Include(d => d.Lines).Include(d => d.Charges).AsSplitQuery().FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        var error = CheckDiscountTarget(doc);
        if (error is not null) return error;
        var result = await ApplyDiscountAsync(doc, kind, req.Percent, req.Amount);
        _db.ChangeTracker.Clear();
        return result;
    }

    /// <summary>
    /// The accountant's discount on an invoice's items (owner, 2026-10-24), posted or waiting for
    /// approval: each line named gets this discount for the whole line (0 = none). Everything else
    /// stays as it was; the discount keeps to the person's limit and the invoice is posted again under
    /// its number (listed as a discount among its changes).
    /// </summary>
    [HttpPost("invoices/{id:guid}/line-discounts")]
    [HttpPost("orders/{id:guid}/line-discounts")]
    [Authorize(Policy = Permissions.SalesDiscountLine)]
    public async Task<ActionResult<SalesDetailDto>> SetLineDiscounts(Guid id, [FromBody] SetLineDiscountsRequest req)
    {
        var doc = await _db.SalesDocuments.AsNoTracking()
            .Where(d => d.Id == id && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_ORDER))
            .InBranches(User, d => d.BranchId).InDepartments(User)
            .Include(d => d.Lines).Include(d => d.Charges).AsSplitQuery().FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        var discounts = new Dictionary<Guid, long>();
        foreach (var d in req.Lines ?? [])
        {
            if (!Guid.TryParse(d.LineId, out var lineId) || doc.Lines.All(l => l.Id != lineId))
                return BadRequest(new { message = "A line was not found on the invoice.", code = "line_not_found" });
            discounts[lineId] = d.Discount;
        }
        if (discounts.Count == 0) return BadRequest(new { message = "Choose the items.", code = "line_not_found" });
        var error = CheckDiscountTarget(doc);
        if (error is not null) return error;
        var result = await ApplyDiscountAsync(doc, null, null, null, discounts);
        _db.ChangeTracker.Clear();
        return result;
    }

    /// <summary>
    /// One discount over several invoices of one customer (owner, 2026-10-02): a percent comes off
    /// each; an amount is shared out in proportion to what each comes to (the last takes what is left,
    /// so it adds up exactly). It is each invoice's second discount. All or nothing.
    /// </summary>
    [HttpPost("invoices/discount-all")]
    [Authorize(Policy = Permissions.SalesDiscountCombined)]
    public async Task<ActionResult<SalesDetailDto[]>> SetDiscountAll([FromBody] SetDiscountAllRequest req)
    {
        var ids = (req.InvoiceIds ?? Array.Empty<string>()).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty)
            .Distinct().ToList();
        if (ids.Count == 0 || ids.Contains(Guid.Empty) || ids.Count > 50)
            return BadRequest(new { message = "Choose the invoices.", code = "invoice_not_found" });
        if (req.Percent is decimal p && (p < 0 || p > 100))
            return BadRequest(new { message = "A percent is between 0 and 100.", code = "bad_charge" });
        if (req.Amount is long a && a < 0)
            return BadRequest(new { message = "Enter an amount above zero.", code = "bad_amount" });
        var docs = await _db.SalesDocuments.AsNoTracking()
            .Where(d => ids.Contains(d.Id) && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_ORDER))
            .InBranches(User, d => d.BranchId).InDepartments(User)
            .Include(d => d.Lines).Include(d => d.Charges).AsSplitQuery()
            .OrderBy(d => d.IssueDate).ThenBy(d => d.Number).ToListAsync();
        if (docs.Count != ids.Count) return NotFound(new { message = "An invoice was not found.", code = "invoice_not_found" });
        if (docs.Select(d => d.PartyId).Distinct().Count() != 1)
            return BadRequest(new { message = "The invoices must be one customer's.", code = "not_one_customer" });
        foreach (var d in docs)
            if (CheckDiscountTarget(d) is { } bad) return bad;

        // An amount is shared by what each invoice comes to before its second discount.
        var shares = new long[docs.Count];
        if (req.Amount is long amount && amount > 0)
        {
            var bases = docs.Select(d => d.GrandTotal + d.Charges.Where(c => c.Kind == ChargeKind.EXTRA_DISCOUNT)
                .Sum(c => c.Amount)).ToArray();
            var all = bases.Sum();
            if (all <= 0 || amount > all)
                return BadRequest(new { message = "The discount is more than the invoices.", code = "charge_too_big" });
            long given = 0;
            for (var i = 0; i < docs.Count; i++)
            {
                shares[i] = i == docs.Count - 1 ? amount - given
                    : (long)decimal.Round((decimal)amount * bases[i] / all, MidpointRounding.AwayFromZero);
                given += shares[i];
            }
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        var done = new List<string>();
        for (var i = 0; i < docs.Count; i++)
        {
            var result = await ApplyDiscountAsync(docs[i], ChargeKind.EXTRA_DISCOUNT, req.Percent,
                req.Amount is null ? null : shares[i]);
            if (result.Result is ObjectResult { StatusCode: >= 400 } failed) return failed;
            done.Add(docs[i].Id.ToString());
        }
        await tx.CommitAsync();
        _db.ChangeTracker.Clear();
        var back = new List<SalesDetailDto>();
        foreach (var docId in docs.Select(d => d.Type == DocumentType.SALES_ORDER ? d.Id : d.Id))
            if ((await GetOne(docId)).Result is OkObjectResult { Value: SalesDetailDto dto }) back.Add(dto);
        return Ok(back.ToArray());
    }

    /// <summary>A discount can be given on an open invoice: not cancelled or turned down.</summary>
    private ActionResult? CheckDiscountTarget(SalesDocument doc)
    {
        if (doc.Type == DocumentType.SALES_ORDER && doc.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
        if (doc.Type == DocumentType.SALES_INVOICE && doc.Status == DocumentStatus.CANCELLED)
            return BadRequest(new { message = "This invoice is already cancelled.", code = "invoice_cancelled" });
        // The discount is its own permission now (owner, 2026-10-13: a per-kind discount right), so
        // giving one no longer needs the edit right — only that the invoice isn't frozen.
        if (doc.Type == DocumentType.SALES_INVOICE && doc.EditLocked && !Access.OverridePasses(User))
            return StatusCode(403, new { message = "This invoice is locked. Reopen it to change a discount.", code = "invoice_locked" });
        return null;
    }

    private bool Can(string permission) => User.HasClaim("permission", permission);

    private static readonly TimeSpan EditGrace = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Whether a posted invoice may still be changed or deleted now (owner, 2026-10-13). Whoever holds
    /// the given right (the accountant) may, unless the invoice is locked; the person who made it may
    /// for half an hour after creating it. A locked invoice is frozen for everyone until it is reopened.
    /// </summary>
    private ActionResult? CheckEditable(Guid makerId, DateTime createdAt, bool editLocked, string permission)
    {
        if (editLocked && !Access.OverridePasses(User))
            return StatusCode(403, new { message = "This invoice is locked. Ask the accountant to reopen it.", code = "invoice_locked" });
        if (Can(permission)) return null;
        Guid.TryParse(CurrentUser.Id(User), out var uid);
        if (makerId == uid && DateTime.UtcNow - createdAt <= EditGrace) return null;
        var mine = makerId == uid;
        return StatusCode(403, new
        {
            message = mine ? "The half-hour to change this invoice has passed." : "Changing this invoice needs permission.",
            code = mine ? "edit_window_closed" : "edit_not_allowed",
        });
    }

    /// <summary>
    /// Freeze or reopen invoices for editing and deleting (owner, 2026-10-13): the accountant's button
    /// on one invoice, and the automatic lock the web app asks for when the combined invoices are printed.
    /// </summary>
    [HttpPost("invoices/lock")]
    [Authorize(Policy = Permissions.SalesLock)]
    public async Task<ActionResult> LockInvoices([FromBody] LockInvoicesRequest req)
    {
        var ids = (req.Ids ?? Array.Empty<Guid>()).Distinct().ToArray();
        if (ids.Length == 0) return BadRequest(new { message = "No invoices.", code = "no_invoices" });
        var docs = await ScopedInvoices().Where(d => ids.Contains(d.Id) && d.Status != DocumentStatus.CANCELLED).ToListAsync();
        foreach (var d in docs) d.EditLocked = req.Locked;
        await _db.SaveChangesAsync();
        foreach (var d in docs) await AuditAsync(req.Locked ? "lock" : "unlock", "sales_invoice", d);
        return Ok(new { locked = req.Locked, count = docs.Count });
    }

    /// <summary>
    /// Post <paramref name="doc"/> again with its discounts set: one of the invoice's own
    /// (<paramref name="kind"/>: this percent or amount, neither = none), or its lines' own
    /// (<paramref name="lineDiscounts"/>, by line). Nothing else changes.
    /// </summary>
    private async Task<ActionResult<SalesDetailDto>> ApplyDiscountAsync(SalesDocument doc, ChargeKind? kind,
        decimal? percent, long? amount, IReadOnlyDictionary<Guid, long>? lineDiscounts = null)
    {
        var charges = doc.Charges.OrderBy(c => c.Seq).Where(c => c.Kind != kind)
            .Select(c => new ChargeRequest(c.Kind.ToString(),
                c.RateBp is int bp ? bp / 100m : null, c.RateBp is null ? c.FixedAmount : null, c.Label))
            .ToList();
        if (kind is ChargeKind given)
        {
            if (percent is decimal pc && pc > 0) charges.Add(new ChargeRequest(given.ToString(), pc, null));
            else if (amount is long am && am > 0) charges.Add(new ChargeRequest(given.ToString(), null, am));
        }
        // The invoice's own discount before the second one, as the charges apply in order.
        charges = charges.OrderBy(c => c.Kind == nameof(ChargeKind.DISCOUNT) ? 0
            : c.Kind == nameof(ChargeKind.EXTRA_DISCOUNT) ? 1 : 2).ToList();
        var req = new CreateSalesInvoiceRequest(
            doc.PartyId.ToString(),
            doc.Lines.OrderBy(l => l.LineNo).Select(l => new CreateInvoiceLineRequest(
                l.ProductId.ToString(), l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.UnitPrice,
                lineDiscounts?.GetValueOrDefault(l.Id, l.Discount) ?? l.Discount,
                l.WarehouseId?.ToString(), l.UnitId?.ToString(), l.IsBonus)).ToArray(),
            Notes: doc.Notes, DueDate: doc.DueDate?.ToString("yyyy-MM-dd"), PaidAmount: doc.PaidAmount,
            PriceLevelId: doc.PriceLevelId?.ToString(), Charges: charges.ToArray(), RepId: doc.RepId?.ToString(),
            DeliveryMethod: doc.DeliveryMethod.ToString(), DeliveryAddress: doc.DeliveryAddress,
            DriverId: doc.DriverId?.ToString(), CarrierId: doc.CarrierId?.ToString(),
            PaidAccountId: doc.PaidAccountId?.ToString(), DepartmentId: doc.DepartmentId?.ToString());
        return doc.Type == DocumentType.SALES_ORDER
            ? await CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER, fromId: null,
                branch: doc.BranchId, discounts: DiscountMode.Give, baseline: doc, replaceId: doc.Id, trustPrices: true)
            : await CreateCore(req, DocumentType.SALES_INVOICE, fromId: null, branch: doc.BranchId,
                discounts: DiscountMode.Give, baseline: doc, editId: doc.Id, trustPrices: true);
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
        // Dated on an earlier day (owner, 2026-10-02): everything it posts lands on that day.
        var (when, dateCode, dateMessage) = await Backdate.CheckAsync(_db, User, req.DocumentDate);
        if (dateCode is not null) return BadRequest(new { message = dateMessage, code = dateCode });
        using var dated = Backdate.To(when);
        var result = await CreateCore(req, DocumentType.SALES_INVOICE, fromId: null);
        // Over the customer's purchase limit (owner decision 2026-10-01): it is not refused; it waits
        // in the sales list for the accountant to accept or turn it down. Nothing was posted.
        // The owner is asked first instead (owner, 2026-10-22), and once they confirm it is posted.
        if (ErrorCode(result.Result) != "over_credit_limit" || Access.OverrideMayConfirm()) return result;
        _db.ChangeTracker.Clear();
        return await CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER, fromId: null,
            overLimit: true);
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
    [AnyPermission(Permissions.SalesEdit, Permissions.SalesCreate)]
    public async Task<ActionResult<SalesDetailDto>> UpdateInvoice(Guid id, [FromBody] CreateSalesInvoiceRequest req)
    {
        var doc = await ScopedInvoices().Where(d => d.Id == id)
            .Select(d => new { d.BranchId, d.StaffId, d.CreatedAt, d.EditLocked }).FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        var gate = CheckEditable(doc.StaffId, doc.CreatedAt, doc.EditLocked, Permissions.SalesEdit);
        if (gate is not null) return gate;
        // Its discounts stay as they are: the accountant changes them from the customer's invoices.
        return await CreateCore(req, DocumentType.SALES_INVOICE, fromId: null, branch: doc.BranchId,
            discounts: DiscountMode.Keep, editId: id);
    }

    /// <summary>
    /// Cancel (delete) a posted sales invoice: its goods go back into their warehouses at the cost
    /// they left at, the customer no longer owes it, money paid now goes back out, and its ledger
    /// entry is reversed. It stays on the list as cancelled, under its number.
    /// </summary>
    [HttpPost("invoices/{id:guid}/cancel")]
    [AnyPermission(Permissions.SalesCancel, Permissions.SalesCreate)]
    public async Task<ActionResult<SalesDetailDto>> CancelInvoice(Guid id,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] CancelInvoiceRequest? req)
    {
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var doc = await ScopedInvoices().Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        var gate = CheckEditable(doc.StaffId, doc.CreatedAt, doc.EditLocked, Permissions.SalesCancel);
        if (gate is not null) return gate;
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
        if (lockDate is DateTime locked && CompanyClock.DayOf(doc.IssueDate) <= DateOnly.FromDateTime(locked)
            && !Access.OverridePasses(User))
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
        // Its discounts were approved with it while it is valid; after its date they are new ones.
        var valid = quote.DueDate is null || quote.DueDate.Value.Date >= CompanyClock.TodayDate;
        return await CreateCore(invoice, DocumentType.SALES_INVOICE, fromId: id, branch: quote.BranchId,
            discounts: valid ? DiscountMode.Trusted : DiscountMode.Give);
    }

    /// <summary>
    /// Save a pending invoice (فاتورة معلّقة) for the accountant: priced and checked exactly like an
    /// invoice — prices, level (no discounts: the accountant gives those), the department, the
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
        return await CreateCore(invoice, DocumentType.SALES_INVOICE, fromId: id, branch: order.BranchId,
            discounts: DiscountMode.Give, baseline: order, approved: true,
            approvalNote: order.OverLimit ? $"BY:{CurrentUser.Name(User)}" : null);
    }

    /// <summary>
    /// The accountant accepts a posted invoice that waits over the customer's purchase limit (it was
    /// changed after it was saved and the change took the customer over it).
    /// </summary>
    [HttpPost("invoices/{id:guid}/approve-limit")]
    [Authorize(Policy = Permissions.SalesApprove)]
    public async Task<ActionResult<SalesDetailDto>> ApproveLimit(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var doc = await ScopedInvoices().FirstOrDefaultAsync(d => d.Id == id);
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        if (!doc.OverLimit || doc.Status == DocumentStatus.CANCELLED)
            return BadRequest(new { message = "This invoice isn't waiting for approval.", code = "not_awaiting" });
        doc.OverLimit = false;
        doc.ApprovalNote = $"BY:{CurrentUser.Name(User)}";
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("approve", "sales_invoice", doc);
        return await GetOne(id);
    }

    /// <summary>
    /// The accountant turns down a posted invoice that waits over the purchase limit: it is cancelled
    /// (everything it moved goes back), with the reason.
    /// </summary>
    [HttpPost("invoices/{id:guid}/reject-limit")]
    [Authorize(Policy = Permissions.SalesReject)]
    public async Task<ActionResult<SalesDetailDto>> RejectLimit(Guid id, [FromBody] RejectOrderRequest req)
    {
        var reason = Clean(req.Reason, 300);
        if (reason is null) return BadRequest(new { message = "Say why it is turned down.", code = "reason_required" });
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {id} FOR UPDATE");
        var doc = await ScopedInvoices().Include(d => d.Lines).ThenInclude(l => l.Warehouse)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
        if (!doc.OverLimit || doc.Status == DocumentStatus.CANCELLED)
            return BadRequest(new { message = "This invoice isn't waiting for approval.", code = "not_awaiting" });
        var totalBefore = doc.GrandTotal;
        var error = await ReverseInvoiceAsync(doc, staffId);
        if (error is not null) return InvoiceLines.Refuse(this, error);
        doc.Status = DocumentStatus.CANCELLED;
        doc.OverLimit = false;
        doc.RejectReason = reason;
        doc.CancelReason = reason;
        _db.InvoiceRevisions.Add(new InvoiceRevision
        {
            DocumentId = doc.Id, Kind = "CANCEL", StaffId = staffId, StaffName = CurrentUser.Name(User) ?? "",
            Reason = reason, TotalBefore = totalBefore, TotalAfter = 0,
        });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("reject", "sales_invoice", doc);
        return await GetOne(id);
    }

    /// <summary>
    /// After money comes in from <paramref name="partyId"/> (a receipt), whatever waits over their
    /// purchase limit and now fits in it is accepted by the system, oldest first (owner, 2026-10-02):
    /// changed invoices are simply released; pending invoices are posted as if the accountant had
    /// approved them, with their discounts and prices as they are and nothing paid now. One that
    /// can't be posted now (stock gone, cost risen above the price) stays waiting. Each one says
    /// it was accepted by the system because of <paramref name="voucherNumber"/>.
    /// </summary>
    [NonAction]
    public async Task<int> AutoApproveAsync(Guid partyId, string voucherNumber)
    {
        var accepted = 0;
        var note = $"AUTO:{voucherNumber}";
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId);
        if (party?.CreditLimit is not long limit) return 0;

        // Changed invoices are already in the balance: they fit once it is within the limit.
        if (party.Balance <= limit)
        {
            var flagged = await _db.SalesDocuments.Where(d => d.PartyId == partyId && d.Type == DocumentType.SALES_INVOICE
                                                              && d.OverLimit && d.Status != DocumentStatus.CANCELLED)
                .ToListAsync();
            foreach (var d in flagged)
            {
                d.OverLimit = false;
                d.ApprovalNote = note;
            }
            if (flagged.Count > 0)
            {
                await _db.SaveChangesAsync();
                foreach (var d in flagged) await AuditAsync("auto_approve", "sales_invoice", d);
                accepted += flagged.Count;
            }
        }

        var waiting = await _db.SalesDocuments.AsNoTracking()
            .Where(d => d.PartyId == partyId && d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING
                        && d.OverLimit)
            .OrderBy(d => d.IssueDate).Select(d => d.Id).ToListAsync();
        foreach (var orderId in waiting)
        {
            _db.ChangeTracker.Clear();
            var balance = await _db.Parties.AsNoTracking().Where(p => p.Id == partyId).Select(p => p.Balance).FirstAsync();
            var order = await _db.SalesDocuments.AsNoTracking().Include(d => d.Lines).Include(d => d.Charges)
                .AsSplitQuery().FirstAsync(d => d.Id == orderId);
            if (balance + order.GrandTotal > limit) break;
            var repId = order.RepId
                        ?? (await _db.Staff.AnyAsync(x => x.Id == order.StaffId && x.IsActive) ? order.StaffId : null);
            var invoice = new CreateSalesInvoiceRequest(
                order.PartyId.ToString(),
                order.Lines.OrderBy(l => l.LineNo).Select(l => new CreateInvoiceLineRequest(
                    l.ProductId.ToString(), l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.UnitPrice, l.Discount,
                    l.WarehouseId?.ToString(), l.UnitId?.ToString(), l.IsBonus)).ToArray(),
                Notes: order.Notes, PaidAmount: 0, PriceLevelId: order.PriceLevelId?.ToString(),
                Charges: order.Charges.OrderBy(c => c.Seq).Select(c => new ChargeRequest(c.Kind.ToString(),
                    c.RateBp is int bp ? bp / 100m : null, c.RateBp is null ? c.FixedAmount : null, c.Label)).ToArray(),
                RepId: repId?.ToString(),
                DeliveryMethod: order.DeliveryMethod.ToString(), DeliveryAddress: order.DeliveryAddress,
                DriverId: order.DriverId?.ToString(), CarrierId: order.CarrierId?.ToString(),
                DepartmentId: order.DepartmentId?.ToString());
            var result = await CreateCore(invoice, DocumentType.SALES_INVOICE, fromId: orderId, branch: order.BranchId,
                discounts: DiscountMode.Trusted, approved: true, approvalNote: note, systemApproval: true);
            if (result.Result is ObjectResult { StatusCode: >= 400 }) continue;
            accepted++;
            await AuditAsync("auto_approve", "sales_order", order);
        }
        _db.ChangeTracker.Clear();
        return accepted;
    }

    /// <summary>
    /// Change a pending invoice before it is approved — its items, prices, notes — checked exactly like
    /// a new one; its discounts stay. It keeps its number, date and maker. Its maker or an approver may.
    /// </summary>
    [HttpPut("orders/{id:guid}")]
    [AnyPermission(Permissions.SalesOrder, Permissions.SalesApprove)]
    public async Task<ActionResult<SalesDetailDto>> UpdateOrder(Guid id, [FromBody] CreateSalesInvoiceRequest req)
    {
        var order = await ScopedOrders().AsNoTracking().Include(d => d.Lines).Include(d => d.Charges)
            .AsSplitQuery().FirstOrDefaultAsync(d => d.Id == id);
        if (order is null) return NotFound(new { message = "Pending invoice not found.", code = "not_found" });
        var mine = order.StaffId.ToString() == CurrentUser.Id(User) && User.HasClaim("permission", Permissions.SalesOrder);
        if (!mine && !User.HasClaim("permission", Permissions.SalesApprove))
            return StatusCode(403, new { message = "Only its maker or an approver can change it.", code = "edit_not_allowed" });
        if (order.Status != DocumentStatus.PENDING)
            return BadRequest(new { message = "This invoice is no longer pending.", code = "order_closed" });
        // Its discounts stay as they are: the accountant changes them from the customer's invoices.
        return await CreateCore(req with { PaidAmount = 0, PaidAccountId = null }, DocumentType.SALES_ORDER,
            fromId: null, branch: order.BranchId, discounts: DiscountMode.Keep, baseline: order, replaceId: id);
    }

    /// <summary>
    /// The accountant turns a pending invoice down, saying why: its goods are free again and its
    /// maker is told.
    /// </summary>
    [HttpPost("orders/{id:guid}/reject")]
    [Authorize(Policy = Permissions.SalesReject)]
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
    [AnyPermission(Permissions.SalesOrder, Permissions.SalesApprove)]
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
            Request.Headers.UserAgent.ToString(), doc.Id.ToString(),
            $"{doc.Number} · {doc.GrandTotal / 100m:N2}");

    /// <summary>
    /// Where an invoice's discounts come from (owner, 2026-10-24): none are given while an invoice is
    /// made or its items changed; the accountant gives every kind from the customer's invoices, each
    /// with its own permission.
    /// </summary>
    private enum DiscountMode
    {
        /// <summary>A new invoice, pending invoice or quotation: only the company's quantity discounts.</summary>
        None,
        /// <summary>Its items are changed: the discounts it has stay exactly as they are.</summary>
        Keep,
        /// <summary>The accountant's discount: a kind that changes needs its permission and keeps to their limit.</summary>
        Give,
        /// <summary>Approved already (a valid quotation, the system accepting a pending invoice).</summary>
        Trusted,
    }

    /// <summary>
    /// Make a sales invoice, a quotation or a pending invoice (<paramref name="type"/>). With
    /// <paramref name="fromId"/> the invoice comes from that quotation or pending invoice, which is
    /// closed with it: what was approved on it (prices, level, free goods, taxes) holds.
    /// </summary>
    /// <param name="branch">The branch it belongs to (a quotation's invoice stays in its branch); else the working branch.</param>
    /// <param name="discounts">How its discounts are checked, against <paramref name="baseline"/> (what it had before).</param>
    private async Task<ActionResult<SalesDetailDto>> CreateCore(
        CreateSalesInvoiceRequest req, DocumentType type, Guid? fromId, Guid? branch = null,
        DiscountMode discounts = DiscountMode.None, SalesDocument? baseline = null, Guid? replaceId = null,
        Guid? editId = null, bool approved = false, bool overLimit = false, bool trustPrices = false,
        string? approvalNote = null, bool systemApproval = false)
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
        // Only the discounts of a saved invoice change (the accountant's discount): its prices,
        // free goods, taxes and delivery stay as they were approved when it was made.
        if (trustPrices) trusted = true;
        bool Can(string permission) => User.HasClaim("permission", permission);
        bool Approved(string permission) => trusted || Can(permission);
        var canOverride = Can(Permissions.SalesOverrideFloor);
        var canChangePrice = Approved(Permissions.SalesChangePrice);
        var canRaisePrice = Approved(Permissions.SalesRaisePrice);

        // ---- Invoice charges: discounts, taxes, additions — each needs its own permission ----
        // (Discounts are checked with the lines' own, below.)
        var (specs, chargeError) = Charges.Parse(req.Charges, req.TaxPercent, settings.DefaultTaxPercent);
        if (chargeError is not null) return BadRequest(new { message = chargeError.Message, code = chargeError.Code });
        if (specs!.Any(c => c.Kind == ChargeKind.ADDITION) && !Approved(Permissions.SalesAdditions))
            return InvoiceLines.Refuse(this, new("additions_not_allowed", "Adding charges needs permission."));
        if (!Approved(Permissions.SalesChangeTax) && !Charges.IsDefaultTax(specs!, settings.DefaultTaxPercent))
            return InvoiceLines.Refuse(this, new("tax_not_allowed",
                $"The tax is {settings.DefaultTaxPercent}%. Changing it needs permission."));

        // ---- The sales department (قسم) it belongs to: sold only from that department's items ----
        var (department, departmentError) = await ResolveDepartmentAsync(req.DepartmentId, systemApproval);
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
            // The system accepting a pending invoice takes the warehouses it was made with.
            var (warehouse, whError) = systemApproval && Guid.TryParse(line.WarehouseId, out var lineWarehouse)
                ? (await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == lineWarehouse && w.IsActive
                                                                && w.Kind == WarehouseKind.STORE) is { } found
                    ? (found, (WarehouseService.WarehouseError?)null)
                    : (null, new WarehouseService.WarehouseError("warehouse_not_found", "Warehouse not found.")))
                : await _warehouses.ResolveAsync(User, line.WarehouseId ?? req.WarehouseId, cache);
            if (whError is not null) return BadRequest(new { message = whError.Message, code = whError.Code });
            lines.Add((line, shape.ProductId, shape.UnitId, warehouse!));
        }

        // Inside a caller's transaction (a discount over several invoices), that one commits.
        await using var tx = _db.Database.CurrentTransaction is null ? await _db.Database.BeginTransactionAsync() : null;
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
            // Selling at the supply price shows it: only for whoever may see costs (owner, 2026-10-02).
            if (bases.Contains(PriceBasis.Cost) && !trusted && !Costs.CanSee(User))
                return InvoiceLines.Refuse(this, new("cost_basis_not_allowed", "Selling at the supply price needs permission to see costs."));
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
        }

        // ---- Discounts: what changed from before, kind by kind ----
        // A line's quantity discount comes by itself and none is no discount; any other stays as it was
        // when it is no more a piece than the same item had before (it follows the quantity, rounding
        // aside), else it is a new one. (More than the line is worth is refused by the shape check.)
        var discountChanged = false;
        if (discounts != DiscountMode.Trusted)
        {
            var before = edited ?? baseline;
            var had = (before?.Lines ?? []).Where(l => !l.IsBonus && l.Discount > 0 && l.Quantity > 0).ToList();
            string? lineGiven = null;
            for (var i = 0; i < resolved.Count; i++)
            {
                var (line, product, _, baseQty, _, _) = resolved[i];
                if (line.Discount == 0 || line.Discount == priced[i].Discount) continue;
                if (had.Any(b => b.ProductId == product.Id
                                 && (decimal)line.Discount * b.Quantity <= (decimal)b.Discount * baseQty + b.Quantity))
                    continue;
                lineGiven ??= Loc.Name(product);
            }
            // The invoice's own discounts, as a list per kind (a zero one is none).
            bool Changed(ChargeKind kind) =>
                !specs!.Where(s => s.Kind == kind && ((long?)s.RateBp ?? s.Fixed ?? 0) != 0)
                    .Select(s => (s.RateBp, s.RateBp is null ? s.Fixed : null))
                    .SequenceEqual((before?.Charges ?? []).Where(c => c.Kind == kind
                                                                     && ((long?)c.RateBp ?? c.FixedAmount ?? 0) != 0)
                        .OrderBy(c => c.Seq).Select(c => (c.RateBp, c.RateBp is null ? c.FixedAmount : null)));
            var invoiceGiven = Changed(ChargeKind.DISCOUNT);
            var extraGiven = Changed(ChargeKind.EXTRA_DISCOUNT);
            discountChanged = lineGiven is not null || invoiceGiven || extraGiven;
            // Not while an invoice is made or its items changed (owner, 2026-10-24).
            if (discountChanged && discounts != DiscountMode.Give)
                return InvoiceLines.Refuse(this, new("discount_on_customer_invoices",
                    "Discounts are given from the customer's invoices."));
            if (lineGiven is not null && !Can(Permissions.SalesDiscountLine))
                return InvoiceLines.Refuse(this, new("discount_not_allowed",
                    $"{lineGiven}: a discount on an item needs permission."));
            if (invoiceGiven && !Can(Permissions.SalesDiscount))
                return InvoiceLines.Refuse(this, new("discount_not_allowed", "Giving an invoice discount needs permission."));
            // The second discount is also where one discount over several invoices goes.
            if (extraGiven && !Can(Permissions.SalesDiscount) && !Can(Permissions.SalesDiscountCombined))
                return InvoiceLines.Refuse(this, new("discount_not_allowed", "Giving an invoice discount needs permission."));
        }

        // ---- Work out the charges and each line's share of the invoice discount ----
        var nets = resolved.Select(r => (long)r.Req.Quantity * r.Req.UnitPrice - r.Req.Discount).ToList();
        var (charges, applyError) = Charges.Apply(nets, resolved.Select(r => !r.Req.IsBonus).ToList(), specs!);
        if (applyError is not null) return BadRequest(new { message = applyError.Message, code = applyError.Code });

        // The person's discount limit, when they change one: a line's own discount plus its share of the
        // invoice discount.
        if (discountChanged && Access.MaxDiscount(User) is int maxDiscount)
            for (var i = 0; i < resolved.Count; i++)
            {
                var (line, product, _, _, _, _) = resolved[i];
                if (line.IsBonus) continue;
                var gross = (long)line.Quantity * line.UnitPrice;
                // The quantity discount is the company's own rule: it doesn't count against the limit.
                var automatic = line.Discount == priced[i].Discount ? priced[i].Discount : 0;
                if ((line.Discount - automatic + charges!.Allocation[i]) * 100 > gross * maxDiscount
                    && !Access.OverridePasses(User))
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
            if (floorError is not null && !Access.OverridePasses(User))
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
            // Saved because of the purchase limit: a pending invoice being changed keeps that.
            doc.OverLimit = type == DocumentType.SALES_ORDER && (overLimit || replaced?.OverLimit == true);
            _db.SalesDocuments.Add(doc);
            // A new pending invoice goes to whoever may approve it.
            if (type == DocumentType.SALES_ORDER && replaced is null)
                await _notifications.OrderPendingAsync(doc, party.Name, department is null ? null : Loc.Name(department), User);
            await _db.SaveChangesAsync();
            if (tx is not null) await tx.CommitAsync();
            await AuditAsync(replaced is null ? "create" : discounts == DiscountMode.Give ? "discount" : "update",
                quote ? "quotation" : "sales_order", doc);
            await InvoiceLines.LoadForDetailAsync(_db, doc);
            return Created($"/api/sales/{(quote ? "quotations" : "orders")}/{doc.Id}",
                Costs.Guard(User, Mapper.ToDetail(doc, null, await InvoiceLines.BaseUnitNamesAsync(_db, doc))));
        }
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.PaidDirect = doc.PaidAmount;
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
        // Not over their purchase limit (حد الائتمان): whoever makes it, a new sale over it waits for
        // the accountant instead (Create), whose approval is the decision on the limit (owner,
        // 2026-10-02). A change to a posted invoice that takes the customer over it is saved, and
        // the invoice waits for the accountant all the same.
        // The owner's own sale goes through over the limit (owner, 2026-10-22).
        var over = party.CreditLimit is long limit && grand > doc.PaidAmount && party.Balance > limit
                   && !Access.OverridePasses(User);
        if (over && !approved && edited is null)
            return BadRequest(new
            {
                message = $"{party.Name} would owe {InvoiceLines.Major(party.Balance)}, over their credit limit of " +
                          $"{InvoiceLines.Major(party.CreditLimit!.Value)}. It waits for the accountant.",
                code = "over_credit_limit",
            });
        if (approved) { doc.OverLimit = false; doc.ApprovalNote = approvalNote ?? doc.ApprovalNote; }
        else if (edited is not null)
        {
            if (over) { doc.OverLimit = true; doc.ApprovalNote = null; }
            else if (doc.OverLimit) { doc.OverLimit = false; doc.ApprovalNote = "WITHIN_LIMIT"; }
        }

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
        var departmentLabel = department is null ? null : Loc.Name(department);
        if (fromQuote?.Type == DocumentType.SALES_ORDER) await _notifications.OrderDecidedAsync(fromQuote, approved: true, User);
        // Whoever takes the payment hears of it: the customer and the department.
        else if (edited is null)
            await _notifications.InvoiceNewAsync(doc, party.Name, departmentLabel, User);
        else await _notifications.InvoiceEditedAsync(doc, party.Name, departmentLabel, User);
        // Over the customer's purchase limit (new or changed): whoever accepts it is told it waits.
        if (doc.OverLimit) await _notifications.LimitWaitAsync(doc, party.Name, departmentLabel, User);

        if (edited is null) _db.SalesDocuments.Add(doc);
        else
        {
            // The accountant's discount is a change of its own, not an edit of the invoice (owner, 2026-10-24).
            _db.InvoiceRevisions.Add(new InvoiceRevision
            {
                DocumentId = doc.Id, Kind = discounts == DiscountMode.Give ? "DISCOUNT" : "EDIT", StaffId = staffId,
                StaffName = CurrentUser.Name(User) ?? "", TotalBefore = editedTotal, TotalAfter = doc.GrandTotal,
            });
            // New rows under a document already tracked: insert them (their ids are set already).
            foreach (var l in doc.Lines) _db.Entry(l).State = EntityState.Added;
            foreach (var c in doc.Charges) _db.Entry(c).State = EntityState.Added;
        }
        await _db.SaveChangesAsync();
        if (tx is not null) await tx.CommitAsync();

        await AuditAsync(edited is null ? "create" : discounts == DiscountMode.Give ? "discount" : "update",
            "sales_invoice", doc);
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
    [AnyPermission(Permissions.SalesReturn, Permissions.SalesReturnFree)]
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
        // Goods come back on an invoice only some hours after it was made (Settings, 12 by default;
        // owner 2026-10-02): until then the invoice itself is changed.
        var hours = await _db.CompanySettings.Select(x => x.ReturnAfterHours).FirstOrDefaultAsync();
        var made = await _db.SalesDocuments.Where(d => d.Id == id && d.Type == DocumentType.SALES_INVOICE)
            .Select(d => (DateTime?)d.CreatedAt).FirstOrDefaultAsync();
        if (hours > 0 && made is DateTime createdAt && DateTime.UtcNow < createdAt.AddHours(hours)
            && !Access.OverridePasses(User))
            return BadRequest(new
            {
                message = $"Goods can be returned on this invoice {hours} hours after it was made " +
                          $"(from {createdAt.AddHours(hours):o}). Until then, change the invoice.",
                code = "return_too_soon",
                from = createdAt.AddHours(hours).ToString("o"),
            });
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
    private async Task<(Department? Department, ActionResult? Error)> ResolveDepartmentAsync(string? raw,
        bool system = false)
    {
        var mine = system ? null : Access.Departments(User);
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
        if (!system && !Access.CanUseDepartment(User, id))
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
