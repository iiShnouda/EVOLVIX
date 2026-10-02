using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// The invoice lists (sales and purchases, returns, quotations, pending invoices), laid out like the
/// old program's screen (owner, 2026-10-01): each document with its code, name, rep, total, net,
/// paid, what is left and the note; filtered by period, status, department and payment (credit =
/// something still owed, paid = nothing owed), with the totals of everything the filter finds.
/// </summary>
public static class DocumentLists
{
    /// <summary>One document's amounts, as the database works them out.</summary>
    private sealed class Raw
    {
        public Guid Id { get; set; }
        public DateTime IssueDate { get; set; }
        public DocumentStatus Status { get; set; }
        public long GrandTotal { get; set; }
        public long PaidAmount { get; set; }
        public bool IsInvoice { get; set; }
        public bool IsPending { get; set; }
        public bool Edited { get; set; }
        public bool OverLimit { get; set; }
        public bool Collecting { get; set; }
        /// <summary>What of the invoice went on the party's account (not paid at the counter or on delivery).</summary>
        public long Unit { get; set; }
        /// <summary>What the party's newer invoices of the same kind put on the account.</summary>
        public long Newer { get; set; }
        /// <summary>What the party owes now on this side (customer: they owe us; supplier: we owe them).</summary>
        public long Owing { get; set; }
        /// <summary>Cheques and notes taken against it and not collected yet (paid, but not in cash yet).</summary>
        public long Deferred { get; set; }
        /// <summary>Written less than a day ago.</summary>
        public bool Fresh { get; set; }
    }

    private sealed class Row
    {
        public Guid Id { get; set; }
        public DateTime IssueDate { get; set; }
        public DocumentStatus Status { get; set; }
        public long GrandTotal { get; set; }
        public long PaidAmount { get; set; }
        /// <summary>Still owed on the invoice, the account settled oldest-first (0 = nothing).</summary>
        public long Owed { get; set; }
        /// <summary>Cheques and notes taken against it and not collected yet.</summary>
        public long Deferred { get; set; }
        public bool IsInvoice { get; set; }
        /// <summary>A pending invoice: waiting for the accountant (or turned down).</summary>
        public bool IsPending { get; set; }
        /// <summary>Changed after it was saved (a revision of kind EDIT).</summary>
        public bool Edited { get; set; }
        /// <summary>A posted invoice waiting for the accountant over the purchase limit.</summary>
        public bool OverLimit { get; set; }
        /// <summary>A shipping company still has to pay us cash on delivery for it.</summary>
        public bool Collecting { get; set; }
        public bool Fresh { get; set; }
    }

    /// <summary>
    /// The payment state of an invoice (owner, 2026-10-02). The party's account is settled oldest
    /// first: what they still owe sits on their newest invoices, so money received, returns and
    /// discounts settle the old ones before the new ("he paid 100 of 1,000, bought 1,000 more,
    /// returned 100 and paid 1,000: the old invoices are paid, the new one is part paid").
    /// <list type="bullet">
    /// <item>DUE (في انتظار الدفع): nothing paid on it yet, written less than a day ago.</item>
    /// <item>UNPAID (لم يتم الدفع): nothing paid a day later; it stays on the account.</item>
    /// <item>PARTIAL (مدفوعة جزئيًا): part of it paid.</item>
    /// <item>CREDIT (آجل): nothing owed, but a cheque or promissory note taken against it is not collected yet.</item>
    /// <item>PAID (مدفوعة), COLLECTING (with the shipping company, cash on delivery), CANCELLED.</item>
    /// </list>
    /// Other documents keep their status.
    /// </summary>
    public static readonly string[] States =
        { "DUE", "UNPAID", "CREDIT", "COLLECTING", "PARTIAL", "PAID", "CANCELLED", "AWAITING", "EDITED" };

    private static string StateOf(Row r) =>
        r.Status == DocumentStatus.CANCELLED ? "CANCELLED"
        : r.IsPending ? (r.Status == DocumentStatus.REJECTED ? "REJECTED" : "AWAITING")
        : !r.IsInvoice ? r.Status.ToString()
        // Cash on delivery not yet handed to us by the shipping company.
        : r.Collecting ? "COLLECTING"
        : r.Owed <= 0 ? (r.Deferred > 0 ? "CREDIT" : "PAID")
        : r.Owed < r.GrandTotal ? "PARTIAL"
        : r.Fresh ? "DUE"
        : "UNPAID";

    /// <summary>Each document with what is owed on it and how it stands, worked out by the database.</summary>
    private static IQueryable<Row> Rows(AppDbContext db, IQueryable<SalesDocument> q)
    {
        var cutoff = DateTime.UtcNow.AddHours(-24);
        var raw = q.Select(d => new Raw
        {
            Id = d.Id, IssueDate = d.IssueDate, Status = d.Status, GrandTotal = d.GrandTotal, PaidAmount = d.PaidAmount,
            IsInvoice = (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.PURCHASE_INVOICE)
                        && d.Status != DocumentStatus.CANCELLED,
            IsPending = d.Type == DocumentType.SALES_ORDER,
            Edited = db.InvoiceRevisions.Any(x => x.DocumentId == d.Id && x.Kind == "EDIT"),
            OverLimit = d.OverLimit,
            Collecting = db.ShipmentInvoices.Any(x => x.DocumentId == d.Id && x.CodShare > 0
                && (x.Shipment!.Status == ShipmentStatus.CREATED || x.Shipment.Status == ShipmentStatus.PICKED_UP
                    || x.Shipment.Status == ShipmentStatus.DELIVERED)),
            Unit = d.GrandTotal - d.PaidDirect,
            Newer = db.SalesDocuments
                .Where(o => o.PartyId == d.PartyId && o.Type == d.Type && o.Status != DocumentStatus.CANCELLED
                            && (o.IssueDate > d.IssueDate
                                || (o.IssueDate == d.IssueDate && string.Compare(o.Number, d.Number) > 0)))
                .Sum(o => (long?)(o.GrandTotal - o.PaidDirect)) ?? 0,
            Owing = d.Type == DocumentType.PURCHASE_INVOICE ? -d.Party!.Balance : d.Party!.Balance,
            Deferred = db.NoteAllocations.Where(a => a.DocumentId == d.Id
                    && (a.Note!.Status == NoteStatus.IN_HAND || a.Note.Status == NoteStatus.UNDER_COLLECTION
                        || a.Note.Status == NoteStatus.ISSUED))
                .Sum(a => (long?)a.Amount) ?? 0,
            Fresh = d.IssueDate > cutoff,
        });
        return raw.Select(r => new Row
        {
            Id = r.Id, IssueDate = r.IssueDate, Status = r.Status, GrandTotal = r.GrandTotal, PaidAmount = r.PaidAmount,
            IsInvoice = r.IsInvoice, IsPending = r.IsPending, Edited = r.Edited, OverLimit = r.OverLimit,
            Collecting = r.Collecting, Fresh = r.Fresh,
            Owed = r.IsInvoice ? Math.Max(0, Math.Min(r.Unit, r.Owing - r.Newer)) : 0,
            Deferred = r.IsInvoice ? r.Deferred : 0,
        });
    }

    /// <summary>
    /// Several invoices taken together, as on the combined invoice of a customer's day (owner,
    /// 2026-10-02): paid, by cheque, part paid, or nothing paid yet (new, or a day old).
    /// </summary>
    public static string? Together(IEnumerable<(long Owed, string State)> invoices, long total)
    {
        var all = invoices.Where(x => x.State is not ("CANCELLED" or "AWAITING" or "REJECTED")).ToList();
        if (all.Count == 0) return null;
        var owed = all.Sum(x => x.Owed);
        if (all.Any(x => x.State == "COLLECTING")) return "COLLECTING";
        if (owed <= 0) return all.Any(x => x.State == "CREDIT") ? "CREDIT" : "PAID";
        if (owed < total) return "PARTIAL";
        return all.Any(x => x.State == "DUE") ? "DUE" : "UNPAID";
    }

    /// <summary>How each of these documents stands and what is owed on it (for screens that list a few).</summary>
    public static async Task<Dictionary<Guid, (long Owed, string State)>> StatesAsync(AppDbContext db,
        IReadOnlyCollection<Guid> ids)
    {
        if (ids.Count == 0) return new();
        var rows = await Rows(db, db.SalesDocuments.Where(d => ids.Contains(d.Id))).ToListAsync();
        return rows.ToDictionary(r => r.Id, r => (r.Owed, StateOf(r)));
    }

    /// <summary>Only one branch (of those the person may see) and documents with goods in one warehouse.</summary>
    public static IQueryable<SalesDocument> Narrow(IQueryable<SalesDocument> q, string? branchId, string? warehouseId)
    {
        if (Guid.TryParse(branchId, out var b)) q = q.Where(d => d.BranchId == b);
        if (Guid.TryParse(warehouseId, out var w)) q = q.Where(d => d.Lines.Any(l => l.WarehouseId == w));
        return q;
    }

    /// <summary>Search (number, name, or the customer's code), status and company days.</summary>
    public static IQueryable<SalesDocument> Filter(IQueryable<SalesDocument> q, string? search, string? status,
        string? from, string? to)
    {
        if (DateOnly.TryParse(from, out var fromDay)) { var start = CompanyClock.StartOf(fromDay); q = q.Where(d => d.IssueDate >= start); }
        if (DateOnly.TryParse(to, out var toDay)) { var end = CompanyClock.StartOf(toDay.AddDays(1)); q = q.Where(d => d.IssueDate < end); }
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<DocumentStatus>(status, out var st))
            q = q.Where(d => d.Status == st);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            var code = int.TryParse(s, out var n) ? n : -1;
            q = q.Where(d => d.Number.ToLower().Contains(s) || d.Party!.Name.ToLower().Contains(s) || d.Party!.Code == code);
        }
        return q;
    }

    /// <summary>One page, newest first, with what is owed on each and the totals of the whole filter.</summary>
    /// <param name="payment">"credit" (آجل: still owed) or "paid" (nothing owed); anything else = all.</param>
    /// <param name="state">One of <see cref="States"/>; anything else = all.</param>
    public static async Task<DocumentListDto> PageAsync(AppDbContext db, IQueryable<SalesDocument> q,
        int page, int pageSize, string? payment, string? state = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var rows = Rows(db, q);
        switch (state?.ToUpperInvariant())
        {
            case "CANCELLED": rows = rows.Where(r => r.Status == DocumentStatus.CANCELLED); break;
            case "AWAITING":
                rows = rows.Where(r => (r.IsPending && r.Status == DocumentStatus.PENDING)
                                       || (r.IsInvoice && r.OverLimit && r.Status != DocumentStatus.CANCELLED)); break;
            case "EDITED": rows = rows.Where(r => r.Edited && r.Status != DocumentStatus.CANCELLED); break;
            case "PAID":
                rows = rows.Where(r => r.IsInvoice && !r.Collecting && r.Owed <= 0 && r.Deferred <= 0); break;
            case "CREDIT":
                rows = rows.Where(r => r.IsInvoice && !r.Collecting && r.Owed <= 0 && r.Deferred > 0); break;
            case "COLLECTING":
                rows = rows.Where(r => r.IsInvoice && r.Collecting); break;
            case "PARTIAL":
                rows = rows.Where(r => r.IsInvoice && !r.Collecting && r.Owed > 0 && r.Owed < r.GrandTotal); break;
            case "DUE":
                rows = rows.Where(r => r.IsInvoice && !r.Collecting && r.Owed > 0 && r.Owed >= r.GrandTotal && r.Fresh); break;
            case "UNPAID":
                rows = rows.Where(r => r.IsInvoice && !r.Collecting && r.Owed > 0 && r.Owed >= r.GrandTotal && !r.Fresh); break;
        }
        if (payment == "credit") rows = rows.Where(r => r.Owed > 0);
        else if (payment == "paid") rows = rows.Where(r => r.Owed <= 0 && r.Status != DocumentStatus.CANCELLED);

        var total = await rows.CountAsync();
        var sums = await rows.Where(r => r.Status != DocumentStatus.CANCELLED && !r.IsPending).GroupBy(r => 1)
            .Select(g => new DocumentListTotalsDto(
                g.Count(), g.Sum(r => r.GrandTotal), g.Sum(r => r.PaidAmount), g.Sum(r => r.Owed > 0 ? r.Owed : 0)))
            .FirstOrDefaultAsync() ?? new DocumentListTotalsDto(0, 0, 0, 0);
        var pageRows = await rows.OrderByDescending(r => r.IssueDate).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();
        var ids = pageRows.Select(r => r.Id).ToList();
        var docs = await db.SalesDocuments.AsNoTracking().Where(d => ids.Contains(d.Id))
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.SourceDocument)
            .Include(d => d.Department).Include(d => d.Rep)
            .ToDictionaryAsync(d => d.Id);
        var items = pageRows.Where(r => docs.ContainsKey(r.Id))
            .Select(r => Mapper.ToSummary(docs[r.Id]) with { Owed = Math.Max(0, r.Owed), State = StateOf(r), Edited = r.Edited }).ToArray();
        return new DocumentListDto(items, total, page, pageSize, sums);
    }
}
