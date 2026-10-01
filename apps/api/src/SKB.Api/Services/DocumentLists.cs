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
    private sealed class Row
    {
        public Guid Id { get; set; }
        public DateTime IssueDate { get; set; }
        public DocumentStatus Status { get; set; }
        public long GrandTotal { get; set; }
        public long PaidAmount { get; set; }
        /// <summary>Still owed on an invoice: total − paid − what its returns put on the account (≤ 0 = nothing).</summary>
        public long Owed { get; set; }
        public bool IsInvoice { get; set; }
        /// <summary>A pending invoice: waiting for the accountant (or turned down).</summary>
        public bool IsPending { get; set; }
        /// <summary>Changed after it was saved (a revision of kind EDIT).</summary>
        public bool Edited { get; set; }
        /// <summary>A shipping company still has to pay us cash on delivery for it.</summary>
        public bool Collecting { get; set; }
        /// <summary>
        /// What counts as unpaid for the state: what is owed plus cheques or notes not collected yet
        /// (a cheque is credit until it is collected, owner 2026-10-01).
        /// </summary>
        public long Unpaid { get; set; }
    }

    /// <summary>
    /// The payment state of an invoice (owner, 2026-10-01), one list instead of status + payment, as
    /// the accountant settles it: CREDIT (آجل: nothing paid; a cheque or note not yet collected counts
    /// as not paid), COLLECTING (جاري الدفع: cash on delivery not yet handed to us by the shipping
    /// company), PARTIAL (مدفوعة جزئيًا), PAID (مدفوعة) or CANCELLED (ملغاة). Other documents keep their status.
    /// </summary>
    public static readonly string[] States = { "CREDIT", "COLLECTING", "PARTIAL", "PAID", "CANCELLED", "AWAITING", "EDITED" };

    private static string StateOf(Row r) =>
        r.Status == DocumentStatus.CANCELLED ? "CANCELLED"
        : r.IsPending ? (r.Status == DocumentStatus.REJECTED ? "REJECTED" : "AWAITING")
        : !r.IsInvoice ? r.Status.ToString()
        // Cash on delivery not yet handed to us by the shipping company.
        : r.Collecting ? "COLLECTING"
        : r.Unpaid <= 0 ? "PAID"
        : r.Unpaid < r.GrandTotal ? "PARTIAL"
        : "CREDIT";

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

        var rows = q.Select(d => new Row
        {
            Id = d.Id, IssueDate = d.IssueDate, Status = d.Status, GrandTotal = d.GrandTotal, PaidAmount = d.PaidAmount,
            Owed = d.Status == DocumentStatus.CANCELLED
                   || !(d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.PURCHASE_INVOICE)
                ? 0
                : d.GrandTotal - d.PaidAmount - (db.SalesDocuments
                    .Where(r => r.SourceDocumentId == d.Id
                                && (r.Type == DocumentType.SALES_RETURN || r.Type == DocumentType.PURCHASE_RETURN)
                                && r.Status != DocumentStatus.CANCELLED)
                    .Sum(r => (long?)(r.GrandTotal - r.PaidAmount)) ?? 0),
            IsInvoice = d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.PURCHASE_INVOICE,
            IsPending = d.Type == DocumentType.SALES_ORDER,
            Edited = db.InvoiceRevisions.Any(x => x.DocumentId == d.Id && x.Kind == "EDIT"),
            Collecting = db.ShipmentInvoices.Any(x => x.DocumentId == d.Id && x.CodShare > 0
                && (x.Shipment!.Status == ShipmentStatus.CREATED || x.Shipment.Status == ShipmentStatus.PICKED_UP
                    || x.Shipment.Status == ShipmentStatus.DELIVERED)),
            Unpaid = (d.Status == DocumentStatus.CANCELLED
                      || !(d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.PURCHASE_INVOICE)
                    ? 0
                    : d.GrandTotal - d.PaidAmount - (db.SalesDocuments
                        .Where(r => r.SourceDocumentId == d.Id
                                    && (r.Type == DocumentType.SALES_RETURN || r.Type == DocumentType.PURCHASE_RETURN)
                                    && r.Status != DocumentStatus.CANCELLED)
                        .Sum(r => (long?)(r.GrandTotal - r.PaidAmount)) ?? 0))
                + (db.NoteAllocations.Where(a => a.DocumentId == d.Id
                        && (a.Note!.Status == NoteStatus.IN_HAND || a.Note.Status == NoteStatus.UNDER_COLLECTION))
                    .Sum(a => (long?)a.Amount) ?? 0),
        });
        switch (state?.ToUpperInvariant())
        {
            case "CANCELLED": rows = rows.Where(r => r.Status == DocumentStatus.CANCELLED); break;
            case "AWAITING": rows = rows.Where(r => r.IsPending && r.Status == DocumentStatus.PENDING); break;
            case "EDITED": rows = rows.Where(r => r.Edited && r.Status != DocumentStatus.CANCELLED); break;
            case "PAID":
                rows = rows.Where(r => r.Status != DocumentStatus.CANCELLED && r.IsInvoice && r.Unpaid <= 0
                                       && !r.Collecting); break;
            case "COLLECTING":
                rows = rows.Where(r => r.Status != DocumentStatus.CANCELLED && r.IsInvoice && r.Collecting); break;
            case "PARTIAL":
                rows = rows.Where(r => r.Status != DocumentStatus.CANCELLED && r.IsInvoice && r.Unpaid > 0
                                       && !r.Collecting && r.Unpaid < r.GrandTotal); break;
            case "CREDIT":
                rows = rows.Where(r => r.Status != DocumentStatus.CANCELLED && r.IsInvoice && !r.Collecting
                                       && r.Unpaid >= r.GrandTotal); break;
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
