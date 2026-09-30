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
    private readonly AppDbContext _db;

    public DashboardController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Get()
    {
        var all = CurrentUser.CanSeeAllBranches(User);
        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);

        IQueryable<SalesDocument> Scoped(IQueryable<SalesDocument> q) =>
            all ? q : q.Where(d => d.BranchId == branchId);

        // Net of returns: sales returns reduce revenue, purchase returns reduce purchases.
        var totals = await Scoped(_db.SalesDocuments)
            .Where(d => d.Status != DocumentStatus.CANCELLED)
            .GroupBy(d => d.Type)
            .Select(g => new { Type = g.Key, Total = g.Sum(d => d.GrandTotal) })
            .ToListAsync();
        long Total(DocumentType t) => totals.FirstOrDefault(x => x.Type == t)?.Total ?? 0;
        var revenue = Total(DocumentType.SALES_INVOICE) - Total(DocumentType.SALES_RETURN);
        var purchases = Total(DocumentType.PURCHASE_INVOICE) - Total(DocumentType.PURCHASE_RETURN);

        // Cash position: what the money accounts hold (cash boxes, custody, banks, wallets).
        var cash = await _db.MoneyAccounts.Where(a => a.IsActive && (all || a.BranchId == branchId))
            .SumAsync(a => (long?)a.Balance) ?? 0;

        var balances = await _db.Parties.Select(p => p.Balance).ToListAsync();
        var receivables = balances.Where(b => b > 0).Sum();
        var payables = balances.Where(b => b < 0).Sum(b => -b);

        var lowStock = await _db.Products.AsNoTracking().Where(p => p.IsActive && p.StockOnHand <= p.ReorderLevel)
            .Include(p => p.Size).Include(p => p.Color)
            .OrderBy(p => p.StockOnHand).ToListAsync();
        var book = await PriceBook.LoadAsync(_db, lowStock.Select(p => p.Id));

        var recent = await Scoped(_db.SalesDocuments).Where(d => d.Type != DocumentType.QUOTATION)
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.SourceDocument)
            .OrderByDescending(d => d.IssueDate).Take(6).ToListAsync();

        var kpis = new[]
        {
            new KpiDto("kpi.revenue", revenue, true, Currency, "positive", null),
            new KpiDto("kpi.purchases", purchases, true, Currency, "info", null),
            new KpiDto("kpi.receivables", receivables, true, Currency, "positive", null),
            new KpiDto("kpi.payables", payables, true, Currency, "warning", null),
            new KpiDto("kpi.lowStock", lowStock.Count, false, null, lowStock.Count > 0 ? "destructive" : "neutral", null),
            new KpiDto("kpi.cashPosition", cash, true, Currency, "neutral", null),
        };

        return Ok(new DashboardDto(
            kpis,
            await BuildTrendAsync(all, branchId),
            lowStock.Select(p => Mapper.ToProduct(p, book)).ToArray(),
            recent.Select(Mapper.ToSummary).ToArray(),
            Currency));
    }

    private async Task<TrendPointDto[]> BuildTrendAsync(bool all, Guid branchId)
    {
        var first = CompanyClock.Today.AddDays(-(TrendDays - 1));
        var since = CompanyClock.StartOf(first);
        var q = _db.SalesDocuments.Where(d =>
            d.IssueDate >= since && d.Status != DocumentStatus.CANCELLED &&
            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN ||
             d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN));
        if (!all) q = q.Where(d => d.BranchId == branchId);

        var rows = await q.Select(d => new { d.IssueDate, d.Type, d.GrandTotal }).ToListAsync();

        var buckets = new Dictionary<string, (long Sales, long Purchases)>();
        for (var i = 0; i < TrendDays; i++)
            buckets[first.AddDays(i).ToString("yyyy-MM-dd")] = (0, 0);

        foreach (var r in rows)
        {
            var key = CompanyClock.DayOf(r.IssueDate).ToString("yyyy-MM-dd");
            if (!buckets.TryGetValue(key, out var b)) continue;
            buckets[key] = r.Type switch
            {
                DocumentType.SALES_INVOICE => (b.Sales + r.GrandTotal, b.Purchases),
                DocumentType.SALES_RETURN => (b.Sales - r.GrandTotal, b.Purchases),
                DocumentType.PURCHASE_INVOICE => (b.Sales, b.Purchases + r.GrandTotal),
                _ => (b.Sales, b.Purchases - r.GrandTotal),
            };
        }

        return buckets.OrderBy(kv => kv.Key)
            .Select(kv => new TrendPointDto(kv.Key, kv.Value.Sales, kv.Value.Purchases)).ToArray();
    }
}
