using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Sales reps' commission (owner, 2026-11-18). Each rep has rules: a percent of their net sales or of
/// the money collected on their invoices, for every department or one, from a day on.
/// <list type="bullet">
/// <item>Sales: a posted sales invoice credited to the rep, at what it comes to after every
/// discount and without tax or additions (<c>Subtotal − DiscountTotal</c>), on its day.</item>
/// <item>Returns: each returned line at what it took off its invoice (<c>LineTotal − DocDiscount</c>),
/// for the rep of the invoice it came from, on the return's day — it lowers the net.</item>
/// <item>Collected: money taken on the rep's invoices — paid at the counter, receipts settling them,
/// and cheques settling them once collected — on the day it came in.</item>
/// </list>
/// Each amount takes the rule of its rep for its department (else the rep's rule for every
/// department) that started latest on or before its day; a net-sales rule pays on sales and returns,
/// a collections rule on what was collected. Each amount's commission is rounded to the piastre.
/// </summary>
public sealed class CommissionService
{
    public const string Sale = "SALE", Return = "RETURN", Collection = "COLLECTION";

    private readonly AppDbContext _db;

    public CommissionService(AppDbContext db) => _db = db;

    /// <summary>One amount counted for a rep (an invoice, a return, or money collected).</summary>
    public sealed record Item(
        Guid RepId, string Kind, Guid DocumentId, string Number, string Reference, DateTime Date, Guid? DepartmentId,
        string PartyName, long Amount, int PercentBp, long Commission);

    /// <summary>
    /// Every amount of the period (company days, both included) for the documents given — already
    /// scoped by the caller to what the person may see — and one rep or all.
    /// </summary>
    public async Task<List<Item>> ItemsAsync(IQueryable<SalesDocument> docs, DateOnly from, DateOnly to, Guid? repId = null)
    {
        var (start, end) = CompanyClock.Days(from, to);
        var items = new List<(Guid Rep, string Kind, Guid Doc, string Number, string Reference, DateTime Date, Guid? Dept,
            string Party, long Amount)>();

        var invoices = docs.Where(d => d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED
                                       && d.RepId != null && (repId == null || d.RepId == repId));

        // Sales.
        var sales = await invoices.AsNoTracking().Where(d => d.IssueDate >= start && d.IssueDate < end)
            .Select(d => new { d.Id, d.Number, d.IssueDate, d.DepartmentId, Rep = d.RepId!.Value, Party = d.Party!.Name,
                Amount = d.Subtotal - d.DiscountTotal })
            .ToListAsync();
        items.AddRange(sales.Select(s => (s.Rep, Sale, s.Id, s.Number, s.Number, s.IssueDate, s.DepartmentId, s.Party, s.Amount)));

        // Returns: each line for the rep of the invoice it came from.
        var returnLines = await (from l in _db.DocumentLines.AsNoTracking()
                                 join r in docs on l.DocumentId equals r.Id
                                 join s in _db.DocumentLines on l.SourceLineId equals (Guid?)s.Id
                                 join inv in _db.SalesDocuments on s.DocumentId equals inv.Id
                                 where r.Type == DocumentType.SALES_RETURN && r.Status != DocumentStatus.CANCELLED
                                       && r.IssueDate >= start && r.IssueDate < end && inv.RepId != null
                                       && (repId == null || inv.RepId == repId)
                                 select new
                                 {
                                     r.Id, r.Number, r.IssueDate, Invoice = inv.Number, inv.DepartmentId,
                                     Rep = inv.RepId!.Value, Party = r.Party!.Name, Amount = l.LineTotal - l.DocDiscount,
                                 }).ToListAsync();
        foreach (var g in returnLines.GroupBy(x => (x.Id, x.Rep, x.DepartmentId, x.Invoice)))
        {
            var f = g.First();
            items.Add((f.Rep, Return, f.Id, f.Number, f.Invoice, f.IssueDate, f.DepartmentId, f.Party, -g.Sum(x => x.Amount)));
        }

        // Collected: paid at the counter.
        var counter = await (from m in _db.MoneyMovements.AsNoTracking()
                             join d in invoices on m.DocumentId equals (Guid?)d.Id
                             where m.Kind == MoneyMovementKind.SALE_PAID && m.CreatedAt >= start && m.CreatedAt < end
                             select new { d.Id, d.Number, m.CreatedAt, d.DepartmentId, Rep = d.RepId!.Value,
                                 Party = d.Party!.Name, m.Amount }).ToListAsync();
        foreach (var g in counter.GroupBy(x => (x.Id, x.CreatedAt)))
        {
            var f = g.First();
            items.Add((f.Rep, Collection, f.Id, f.Number, f.Number, f.CreatedAt, f.DepartmentId, f.Party, g.Sum(x => x.Amount)));
        }
        // … receipts settling the invoices…
        var receipts = await (from a in _db.VoucherAllocations.AsNoTracking()
                              join d in invoices on a.DocumentId equals d.Id
                              where a.Voucher!.Type == VoucherType.RECEIPT && a.Voucher.Status == VoucherStatus.POSTED
                                    && a.Voucher.CreatedAt >= start && a.Voucher.CreatedAt < end
                              select new { d.Id, d.Number, Voucher = a.Voucher.Number, a.Voucher.CreatedAt, d.DepartmentId,
                                  Rep = d.RepId!.Value, Party = d.Party!.Name, a.Amount }).ToListAsync();
        items.AddRange(receipts.Select(x =>
            (x.Rep, Collection, x.Id, x.Number, x.Voucher, x.CreatedAt, x.DepartmentId, x.Party, x.Amount)));
        // … and cheques settling them, on the day they were collected.
        var cheques = await (from a in _db.NoteAllocations.AsNoTracking()
                             join d in invoices on a.DocumentId equals d.Id
                             where a.Note!.Status == NoteStatus.COLLECTED
                             let collected = _db.NoteEvents.Where(e => e.NoteId == a.NoteId && e.ToStatus == NoteStatus.COLLECTED)
                                 .Max(e => (DateTime?)e.CreatedAt)
                             where collected >= start && collected < end
                             select new { d.Id, d.Number, Note = a.Note.Ref, Collected = collected!.Value, d.DepartmentId,
                                 Rep = d.RepId!.Value, Party = d.Party!.Name, a.Amount }).ToListAsync();
        items.AddRange(cheques.Select(x =>
            (x.Rep, Collection, x.Id, x.Number, x.Note, x.Collected, x.DepartmentId, x.Party, x.Amount)));

        if (items.Count == 0) return new();
        var reps = items.Select(i => i.Rep).Distinct().ToList();
        var rules = (await _db.CommissionRules.AsNoTracking().Where(r => reps.Contains(r.StaffId)).ToListAsync())
            .GroupBy(r => r.StaffId).ToDictionary(g => g.Key, g => g.ToList());
        return items.Select(i =>
            {
                var rule = RuleFor(rules.GetValueOrDefault(i.Rep), i.Dept, CompanyClock.DayOf(i.Date));
                var counts = rule is not null && (rule.Basis == CommissionBasis.COLLECTIONS) == (i.Kind == Collection);
                var bp = counts ? rule!.PercentBp : 0;
                return new Item(i.Rep, i.Kind, i.Doc, i.Number, i.Reference, i.Date, i.Dept, i.Party, i.Amount, bp,
                    Commission(i.Amount, bp));
            })
            .OrderBy(i => i.Date).ThenBy(i => i.Number).ToList();
    }

    /// <summary>The rule for a department on a day: the department's own, else the every-department one; the latest started.</summary>
    public static CommissionRule? RuleFor(List<CommissionRule>? rules, Guid? departmentId, DateOnly day)
    {
        if (rules is null) return null;
        var started = rules.Where(r => DateOnly.FromDateTime(r.StartDate) <= day).ToList();
        return started.Where(r => departmentId != null && r.DepartmentId == departmentId)
                   .OrderByDescending(r => r.StartDate).ThenByDescending(r => r.CreatedAt).FirstOrDefault()
               ?? started.Where(r => r.DepartmentId == null)
                   .OrderByDescending(r => r.StartDate).ThenByDescending(r => r.CreatedAt).FirstOrDefault();
    }

    /// <summary><paramref name="bp"/> hundredths of a percent of an amount, to the piastre (a return's is negative).</summary>
    public static long Commission(long amount, int bp) =>
        bp <= 0 ? 0 : (long)decimal.Round((decimal)amount * bp / 10000m, MidpointRounding.AwayFromZero);
}
