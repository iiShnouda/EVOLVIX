using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize(Policy = Permissions.DashboardView)]
public sealed class DashboardController : ControllerBase
{
    private const string Currency = "EGP";
    private const int TrendDays = 7;
    private const int LowStockShown = 12;
    private readonly AppDbContext _db;

    public DashboardController(AppDbContext db) => _db = db;

    /// <param name="days">How many days the sales / purchases trend covers (7 by default, up to 31).</param>
    /// <param name="from">With <paramref name="to"/>: a period of company days (owner, 2026-10-02: "by
    /// day, week, month, year or the dates I want"). Revenue, purchases, the trend and the latest
    /// documents are for that period; balances, cash and low stock are as they are now.</param>
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Get([FromQuery] int days = TrendDays,
        [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        IQueryable<SalesDocument> Scoped(IQueryable<SalesDocument> q) => q.InBranches(User, d => d.BranchId);
        var period = Period(from, to);
        if (period is { Error: true }) return BadRequest(new { message = "Choose up to ten years, the start before the end.", code = "bad_range" });
        var (pStart, pEnd) = period is { } pr ? CompanyClock.Days(pr.From, pr.To) : (DateTime.MinValue, DateTime.MaxValue);

        // Net of returns: sales returns reduce revenue, purchase returns reduce purchases.
        var totals = await Scoped(_db.SalesDocuments)
            .Where(d => d.Status != DocumentStatus.CANCELLED && d.IssueDate >= pStart && d.IssueDate < pEnd)
            .GroupBy(d => d.Type)
            .Select(g => new { Type = g.Key, Total = g.Sum(d => d.GrandTotal) })
            .ToListAsync();
        long Total(DocumentType t) => totals.FirstOrDefault(x => x.Type == t)?.Total ?? 0;
        var revenue = Total(DocumentType.SALES_INVOICE) - Total(DocumentType.SALES_RETURN);
        var purchases = Total(DocumentType.PURCHASE_INVOICE) - Total(DocumentType.PURCHASE_RETURN);

        // Cash position: what the money accounts hold (cash boxes, custody, banks, wallets).
        var only = Access.MoneyAccounts(User);
        var cash = await _db.MoneyAccounts.InBranches(User, a => a.BranchId)
            .Where(a => a.IsActive && (only == null || only.Contains(a.Id)))
            .SumAsync(a => (long?)a.Balance) ?? 0;

        // Summed by the database (not every balance brought over).
        var receivables = await _db.Parties.Where(p => p.Balance > 0).SumAsync(p => (long?)p.Balance) ?? 0;
        var payables = await _db.Parties.Where(p => p.Balance < 0).SumAsync(p => (long?)-p.Balance) ?? 0;

        // How many items are low, and only the few the dashboard shows (a big catalogue may have
        // thousands out of stock).
        var low = _db.Products.AsNoTracking().Where(p => p.IsActive && p.StockOnHand <= p.ReorderLevel);
        var lowCount = await low.CountAsync();
        var lowStock = await low.Include(p => p.Size).Include(p => p.Color)
            .OrderBy(p => p.StockOnHand).ThenBy(p => p.Id).Take(LowStockShown).ToListAsync();
        var book = await PriceBook.LoadAsync(_db, lowStock.Select(p => p.Id));

        // Posted documents only: quotations and pending invoices move nothing.
        var recent = await Scoped(_db.SalesDocuments)
            .Where(d => d.Type != DocumentType.QUOTATION && d.Type != DocumentType.SALES_ORDER
                        && d.IssueDate >= pStart && d.IssueDate < pEnd)
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.SourceDocument)
            .OrderByDescending(d => d.IssueDate).Take(6).ToListAsync();

        var kpis = new[]
        {
            new KpiDto("kpi.revenue", revenue, true, Currency, "positive", null),
            new KpiDto("kpi.purchases", purchases, true, Currency, "info", null),
            new KpiDto("kpi.receivables", receivables, true, Currency, "positive", null),
            new KpiDto("kpi.payables", payables, true, Currency, "warning", null),
            new KpiDto("kpi.lowStock", lowCount, false, null, lowCount > 0 ? "destructive" : "neutral", null),
            new KpiDto("kpi.cashPosition", cash, true, Currency, "neutral", null),
        };

        return Ok(new DashboardDto(
            kpis,
            period is { } tp
                ? await BuildTrendAsync(tp.From, tp.To)
                : await BuildTrendAsync(CompanyClock.Today.AddDays(-(Math.Clamp(days, 1, 31) - 1)), CompanyClock.Today),
            lowStock.Select(p => Costs.Guard(User, Mapper.ToProduct(p, book),
                ProductsController.PurchaseLevelIds(book))).ToArray(),
            recent.Select(Mapper.ToSummary).ToArray(),
            Currency));
    }

    /// <summary>
    /// More of the business at a glance: today, this month against last, the best customers and
    /// items, sales per branch, money, cheques due this week, invoices waiting for approval and
    /// customers over their limit. Each part only for those who may see it, in their branches.
    /// </summary>
    /// <param name="from">With <paramref name="to"/>: a period of company days. "Today" and "this
    /// month" become that period (against the same number of days before it), the rankings are for
    /// it and the cheques are those due by its end. Money, approvals and limits are as they are now.</param>
    [HttpGet("more")]
    public async Task<ActionResult<DashboardMoreDto>> More([FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        bool Can(string p) => User.HasClaim("permission", p);
        var period = Period(from, to);
        if (period is { Error: true }) return BadRequest(new { message = "Choose up to ten years, the start before the end.", code = "bad_range" });
        var today = CompanyClock.Today;
        var dayStart = CompanyClock.StartOf(today);
        var dayEnd = DateTime.MaxValue;
        var monthStart = CompanyClock.StartOf(new DateOnly(today.Year, today.Month, 1));
        var monthEnd = DateTime.MaxValue;
        var lastMonthStart = CompanyClock.StartOf(new DateOnly(today.Year, today.Month, 1).AddMonths(-1));
        var notesUntil = today.AddDays(7);
        if (period is { } pr)
        {
            // The period, and as many days just before it to compare with.
            (monthStart, monthEnd) = CompanyClock.Days(pr.From, pr.To);
            lastMonthStart = CompanyClock.StartOf(pr.From.AddDays(-(pr.To.DayNumber - pr.From.DayNumber + 1)));
            (dayStart, dayEnd) = (monthStart, monthEnd);
            notesUntil = pr.To;
        }
        var sales = _db.SalesDocuments.InBranches(User, d => d.BranchId).Where(d =>
            d.Status != DocumentStatus.CANCELLED
            && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN));

        DashTodayDto? todayDto = null;
        DashMonthDto? month = null;
        DashRankDto[]? topCustomers = null, topItems = null, byBranch = null;
        if (Can(Permissions.SalesView))
        {
            var t = await sales.Where(d => d.IssueDate >= dayStart && d.IssueDate < dayEnd).GroupBy(d => d.Type)
                .Select(g => new { g.Key, Total = g.Sum(d => d.GrandTotal), Count = g.Count() }).ToListAsync();
            var inv = t.FirstOrDefault(x => x.Key == DocumentType.SALES_INVOICE);
            var ret = t.FirstOrDefault(x => x.Key == DocumentType.SALES_RETURN);
            todayDto = new DashTodayDto((inv?.Total ?? 0) - (ret?.Total ?? 0), inv?.Count ?? 0, ret?.Total ?? 0);

            var m = await sales.Where(d => d.IssueDate >= lastMonthStart && d.IssueDate < monthEnd)
                .GroupBy(d => new { This = d.IssueDate >= monthStart, d.Type })
                .Select(g => new { g.Key.This, g.Key.Type, Total = g.Sum(d => d.GrandTotal), Profit = g.Sum(d => d.ProfitTotal) })
                .ToListAsync();
            long Net(bool thisMonth, bool profit = false) =>
                m.Where(x => x.This == thisMonth).Sum(x =>
                    (x.Type == DocumentType.SALES_INVOICE ? 1 : -1) * (profit ? x.Profit : x.Total));
            long? expenses = null;
            if (Can(Permissions.ReceiptsView))
                expenses = await _db.Vouchers.InBranches(User, v => v.BranchId)
                    .Where(v => v.Type == VoucherType.EXPENSE && v.Status == VoucherStatus.POSTED
                                && v.CreatedAt >= monthStart && v.CreatedAt < monthEnd)
                    .SumAsync(v => (long?)v.Amount) ?? 0;
            month = new DashMonthDto(Net(true), Net(false),
                Can(Permissions.CostsView) ? Net(true, profit: true) : null, expenses);

            var monthSales = sales.Where(d => d.IssueDate >= monthStart && d.IssueDate < monthEnd);
            var customers = await monthSales.GroupBy(d => d.PartyId)
                .Select(g => new
                {
                    g.Key,
                    Net = g.Sum(d => d.Type == DocumentType.SALES_INVOICE ? d.GrandTotal : -d.GrandTotal),
                    Count = g.Count(d => d.Type == DocumentType.SALES_INVOICE),
                })
                .OrderByDescending(x => x.Net).Take(5).ToListAsync();
            var names = await _db.Parties.Where(p => customers.Select(c => c.Key).Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Name);
            topCustomers = customers.Select(c => new DashRankDto(c.Key.ToString(),
                names.GetValueOrDefault(c.Key, ""), c.Net, c.Count)).ToArray();

            var items = await _db.DocumentLines.Where(l => monthSales.Any(d => d.Id == l.DocumentId))
                .GroupBy(l => new { l.ProductId, l.ProductName })
                .Select(g => new
                {
                    g.Key.ProductId,
                    g.Key.ProductName,
                    Qty = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.Quantity : -l.Quantity),
                    Value = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.LineTotal : -l.LineTotal),
                })
                .OrderByDescending(x => x.Qty).Take(5).ToListAsync();
            topItems = items.Select(i => new DashRankDto(i.ProductId.ToString(), i.ProductName, i.Value, i.Qty)).ToArray();

            var branches = await monthSales.GroupBy(d => d.BranchId)
                .Select(g => new { g.Key, Net = g.Sum(d => d.Type == DocumentType.SALES_INVOICE ? d.GrandTotal : -d.GrandTotal) })
                .ToListAsync();
            var branchNames = await _db.Branches.ToDictionaryAsync(b => b.Id, b => Loc.Name(b));
            byBranch = branches.OrderByDescending(b => b.Net).Take(8)
                .Select(b => new DashRankDto(b.Key.ToString(), branchNames.GetValueOrDefault(b.Key, ""), b.Net)).ToArray();
        }

        DashAccountDto[]? accounts = null;
        if (Can(Permissions.ReceiptsView))
        {
            var only = Access.MoneyAccounts(User);
            var rows = await _db.MoneyAccounts.InBranches(User, a => a.BranchId)
                .Where(a => a.IsActive && (only == null || only.Contains(a.Id)))
                .OrderByDescending(a => a.Balance).Take(8).ToListAsync();
            accounts = rows.Select(a => new DashAccountDto(a.Id.ToString(), Loc.Name(a), a.Kind.ToString(), a.Balance)).ToArray();
        }

        DashNotesDueDto? notes = null;
        if (Can(Permissions.NotesView))
        {
            var weekEnd = CompanyClock.StartOf(notesUntil.AddDays(1));
            var due = await _db.Notes.InBranches(User, n => n.BranchId)
                .Where(n => n.DueDate < weekEnd
                    && (n.Status == NoteStatus.IN_HAND || n.Status == NoteStatus.UNDER_COLLECTION || n.Status == NoteStatus.ISSUED))
                .GroupBy(n => n.Direction)
                .Select(g => new { g.Key, Count = g.Count(), Amount = g.Sum(n => n.Amount) }).ToListAsync();
            var r = due.FirstOrDefault(x => x.Key == NoteDirection.RECEIVABLE);
            var p = due.FirstOrDefault(x => x.Key == NoteDirection.PAYABLE);
            notes = new DashNotesDueDto(r?.Count ?? 0, r?.Amount ?? 0, p?.Count ?? 0, p?.Amount ?? 0);
        }

        int? awaiting = Can(Permissions.SalesApprove)
            ? await _db.SalesDocuments.InBranches(User, d => d.BranchId)
                .CountAsync(d => d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING)
            : null;

        DashRankDto[]? overLimit = null;
        var overCount = 0;
        if (Can(Permissions.PartiesView))
        {
            var over = _db.Parties.Where(p => p.IsActive && p.CreditLimit != null && p.Balance >= p.CreditLimit);
            overCount = await over.CountAsync();
            overLimit = (await over.OrderByDescending(p => p.Balance - p.CreditLimit).Take(5).ToListAsync())
                .Select(p => new DashRankDto(p.Id.ToString(), p.Name, p.Balance, null, p.CreditLimit)).ToArray();
        }

        long? stockValue = Can(Permissions.CostsView)
            ? await _db.Products.Where(p => p.IsActive && p.StockOnHand > 0).SumAsync(p => (long?)p.StockOnHand * p.CostPrice) ?? 0
            : null;

        return Ok(new DashboardMoreDto(todayDto, month, topCustomers, topItems, byBranch, accounts, notes, awaiting,
            overLimit, overCount, stockValue));
    }

    /// <summary>
    /// A period asked for (yyyy-MM-dd company days, both or neither): null when not asked, Error
    /// when it is wrong (the end before the start, or more than ten years).
    /// </summary>
    private static (DateOnly From, DateOnly To, bool Error)? Period(string? from, string? to)
    {
        if (string.IsNullOrWhiteSpace(from) && string.IsNullOrWhiteSpace(to)) return null;
        var f = CompanyClock.ParseDay(from);
        var t = CompanyClock.ParseDay(to) ?? f;
        if (f is null || t is null || t < f || t.Value.DayNumber - f.Value.DayNumber > 3660)
            return (default, default, true);
        return (f.Value, t.Value, false);
    }

    /// <summary>
    /// Net sales and purchases between two company days: one point a day for up to 62 days, else
    /// one a month (dated its first day). Summed by the database by company day.
    /// </summary>
    private async Task<TrendPointDto[]> BuildTrendAsync(DateOnly first, DateOnly last)
    {
        var monthly = last.DayNumber - first.DayNumber + 1 > 62;
        // Days still to come have nothing yet: the line stops at today.
        if (first <= CompanyClock.Today && last > CompanyClock.Today) last = CompanyClock.Today;
        var (since, until) = CompanyClock.Days(first, last);
        var zone = CompanyClock.ZoneId;
        var rows = await _db.SalesDocuments.InBranches(User, d => d.BranchId)
            .Where(d => d.IssueDate >= since && d.IssueDate < until && d.Status != DocumentStatus.CANCELLED &&
                        (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN ||
                         d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN))
            .Select(d => new { At = AppDbContext.LocalTime(zone, d.IssueDate), d.Type, d.GrandTotal })
            .GroupBy(d => new { d.At.Year, d.At.Month, Day = monthly ? 1 : d.At.Day, d.Type })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Type, Total = g.Sum(d => d.GrandTotal) })
            .ToListAsync();

        var buckets = new SortedDictionary<string, (long Sales, long Purchases)>(StringComparer.Ordinal);
        if (monthly)
            for (var m = new DateOnly(first.Year, first.Month, 1); m <= last; m = m.AddMonths(1))
                buckets[m.ToString("yyyy-MM-dd")] = (0, 0);
        else
            for (var d = first; d <= last; d = d.AddDays(1))
                buckets[d.ToString("yyyy-MM-dd")] = (0, 0);

        foreach (var r in rows)
        {
            var key = new DateOnly(r.Year, r.Month, r.Day).ToString("yyyy-MM-dd");
            if (!buckets.TryGetValue(key, out var b)) continue;
            buckets[key] = r.Type switch
            {
                DocumentType.SALES_INVOICE => (b.Sales + r.Total, b.Purchases),
                DocumentType.SALES_RETURN => (b.Sales - r.Total, b.Purchases),
                DocumentType.PURCHASE_INVOICE => (b.Sales, b.Purchases + r.Total),
                _ => (b.Sales, b.Purchases - r.Total),
            };
        }
        return buckets.Select(kv => new TrendPointDto(kv.Key, kv.Value.Sales, kv.Value.Purchases)).ToArray();
    }
}
