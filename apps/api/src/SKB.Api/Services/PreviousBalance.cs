using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// What a customer owed just before a sales invoice (owner, 2026-11-10: "the previous balance" on the
/// printed invoice). It is the customer's statement up to the invoice's own date and time, as the
/// account stands now, without the invoice itself:
/// <list type="bullet">
/// <item>every line on the customer's accounts dated before the invoice's date (a back-dated invoice:
/// the day it is dated on) — opening balance, invoices, returns, money, cheques, discounts;</item>
/// <item>nothing the invoice itself posted (its amount, money paid on it at once, its own discounts,
/// and every earlier posting of it when it was changed), so changing it never moves the figure;</item>
/// <item>a cancelled invoice or return counts for nothing (as on the statement), and a changed invoice
/// counts as it stands now, at its own date — not at the moment it was changed.</item>
/// </list>
/// Money received, goods returned or a discount given after the invoice are not in it.
/// </summary>
public static class PreviousBalance
{
    /// <summary>The figure for each of <paramref name="docs"/> (all of one customer): invoices that stand and pending ones.</summary>
    public static async Task<Dictionary<Guid, long>> ForAsync(AppDbContext db, Guid partyId, IReadOnlyCollection<SalesDocument> docs)
    {
        var wanted = docs.Where(Applies).ToList();
        var result = new Dictionary<Guid, long>();
        if (wanted.Count == 0) return result;
        var rows = await RowsAsync(db, partyId, wanted.Max(d => d.IssueDate));
        foreach (var d in wanted)
            result[d.Id] = rows.Where(r => r.At < d.IssueDate && r.SourceId != d.Id).Sum(r => r.Net);
        return result;
    }

    /// <summary>
    /// What the customer owed before <paramref name="start"/> (the customer's invoices together: before
    /// the period's first day), by the same rules.
    /// </summary>
    public static async Task<long> BeforeAsync(AppDbContext db, Guid partyId, DateTime start) =>
        (await RowsAsync(db, partyId, start)).Sum(r => r.Net);

    private sealed record Row(Guid? SourceId, DateTime At, long Net);

    /// <summary>The customer's lines that stand, each at its date (an invoice at its own), before <paramref name="last"/>.</summary>
    private static async Task<List<Row>> RowsAsync(AppDbContext db, Guid partyId, DateTime last)
    {
        // What no longer stands (the same rule as the customer's statement).
        var superseded = db.JournalEntries.Where(e =>
            e.SourceType == "SALES_INVOICE_CANCEL" || e.SourceType == "SALES_RETURN_CANCEL"
            || e.SourceType == "PURCHASE_RETURN_CANCEL"
            || ((e.SourceType == "SALES_RETURN" || e.SourceType == "PURCHASE_RETURN")
                && db.SalesDocuments.Any(d => d.Id == e.SourceId && d.Status == DocumentStatus.CANCELLED))
            || ((e.SourceType == "SALES_INVOICE" || e.SourceType == "SALES_DISCOUNT")
                && (db.SalesDocuments.Any(d => d.Id == e.SourceId && d.Status == DocumentStatus.CANCELLED)
                    || db.JournalEntries.Any(o => o.SourceType == "SALES_INVOICE" && o.SourceId == e.SourceId
                                                   && o.Serial > e.Serial))))
            .Select(e => e.Id);
        var lines = await db.JournalLines.AsNoTracking()
            .Where(l => l.Account!.PartyId == partyId && !superseded.Contains(l.EntryId))
            .Select(l => new
            {
                l.Entry!.SourceId,
                // An invoice stands at its own date, however often it was changed since.
                At = l.Entry.SourceType == "SALES_INVOICE"
                    ? db.SalesDocuments.Where(d => d.Id == l.Entry.SourceId).Select(d => (DateTime?)d.IssueDate).FirstOrDefault()
                      ?? l.Entry.Date
                    : l.Entry.Date,
                Net = l.Debit - l.Credit,
            })
            .Where(x => x.At < last)
            .ToListAsync();
        return lines.Select(r => new Row(r.SourceId, r.At, r.Net)).ToList();
    }

    /// <summary>A sales invoice that stands, or one waiting for approval.</summary>
    public static bool Applies(SalesDocument d) =>
        (d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED)
        || (d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING);
}
