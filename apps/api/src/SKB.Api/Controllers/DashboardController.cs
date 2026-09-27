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

        var revenue = await Scoped(_db.SalesDocuments)
            .Where(d => d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED)
            .SumAsync(d => (long?)d.GrandTotal) ?? 0;
        var purchases = await Scoped(_db.SalesDocuments)
            .Where(d => d.Type == DocumentType.PURCHASE_INVOICE && d.Status != DocumentStatus.CANCELLED)
            .SumAsync(d => (long?)d.GrandTotal) ?? 0;

        var balances = await _db.Parties.Select(p => p.Balance).ToListAsync();
        var receivables = balances.Where(b => b > 0).Sum();
        var payables = balances.Where(b => b < 0).Sum(b => -b);

        var lowStock = await _db.Products.Where(p => p.IsActive && p.StockOnHand <= p.ReorderLevel)
            .OrderBy(p => p.StockOnHand).ToListAsync();

        var recent = await Scoped(_db.SalesDocuments)
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .OrderByDescending(d => d.IssueDate).Take(6).ToListAsync();

        var kpis = new[]
        {
            new KpiDto("kpi.revenue", revenue, true, Currency, "positive", null),
            new KpiDto("kpi.purchases", purchases, true, Currency, "info", null),
            new KpiDto("kpi.receivables", receivables, true, Currency, "positive", null),
            new KpiDto("kpi.payables", payables, true, Currency, "warning", null),
            new KpiDto("kpi.lowStock", lowStock.Count, false, null, lowStock.Count > 0 ? "destructive" : "neutral", null),
            new KpiDto("kpi.cashPosition", revenue - purchases, true, Currency, "neutral", null),
        };

        return Ok(new DashboardDto(
            kpis,
            await BuildTrendAsync(all, branchId),
            lowStock.Select(Mapper.ToProduct).ToArray(),
            recent.Select(Mapper.ToSummary).ToArray(),
            Currency));
    }

    private async Task<TrendPointDto[]> BuildTrendAsync(bool all, Guid branchId)
    {
        var since = DateTime.UtcNow.Date.AddDays(-(TrendDays - 1));
        var q = _db.SalesDocuments.Where(d =>
            d.IssueDate >= since && d.Status != DocumentStatus.CANCELLED &&
            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.PURCHASE_INVOICE));
        if (!all) q = q.Where(d => d.BranchId == branchId);

        var rows = await q.Select(d => new { d.IssueDate, d.Type, d.GrandTotal }).ToListAsync();

        var buckets = new Dictionary<string, (long Sales, long Purchases)>();
        for (var i = 0; i < TrendDays; i++)
            buckets[since.AddDays(i).ToString("yyyy-MM-dd")] = (0, 0);

        foreach (var r in rows)
        {
            var key = r.IssueDate.ToString("yyyy-MM-dd");
            if (!buckets.TryGetValue(key, out var b)) continue;
            buckets[key] = r.Type == DocumentType.SALES_INVOICE
                ? (b.Sales + r.GrandTotal, b.Purchases)
                : (b.Sales, b.Purchases + r.GrandTotal);
        }

        return buckets.OrderBy(kv => kv.Key)
            .Select(kv => new TrendPointDto(kv.Key, kv.Value.Sales, kv.Value.Purchases)).ToArray();
    }
}
