using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(Policy = Permissions.AnalyticsView)]
public sealed class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ReportsController(AppDbContext db) => _db = db;

    /// <summary>
    /// Profitability report (تقارير الربحية). Sums net sales, cost of goods and profit for
    /// confirmed sales invoices in a date range, broken down by customer, product, or day.
    /// Revenue = subtotal − discount (tax excluded); profit is the stored per-document/-line profit.
    /// </summary>
    [HttpGet("profitability")]
    public async Task<ActionResult<ProfitReportDto>> Profitability(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string by = "customer")
    {
        var now = DateTime.UtcNow;
        var fromRaw = ParseDate(from) ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var toRaw = ParseDate(to) ?? now;
        // Normalize to UTC midnight boundaries; Npgsql requires Kind=Utc for timestamptz.
        var fromDate = DateTime.SpecifyKind(fromRaw.Date, DateTimeKind.Utc);
        var toExclusive = DateTime.SpecifyKind(toRaw.Date.AddDays(1), DateTimeKind.Utc);
        by = by.ToLowerInvariant() is "product" or "day" ? by.ToLowerInvariant() : "customer";

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        var scoped = !CurrentUser.CanSeeAllBranches(User);

        var docs = _db.SalesDocuments.Where(d =>
            d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED &&
            d.IssueDate >= fromDate && d.IssueDate < toExclusive);
        if (scoped) docs = docs.Where(d => d.BranchId == branchId);

        var currency = await docs.Select(d => d.Currency).FirstOrDefaultAsync() ?? "EGP";
        var revenue = await docs.SumAsync(d => (long?)(d.Subtotal - d.DiscountTotal)) ?? 0;
        var cost = await docs.SumAsync(d => (long?)d.CostTotal) ?? 0;
        var profit = await docs.SumAsync(d => (long?)d.ProfitTotal) ?? 0;
        var invoices = await docs.CountAsync();

        ProfitRowDto[] rows;
        if (by == "product")
        {
            var lines = _db.DocumentLines.Where(l =>
                l.Document!.Type == DocumentType.SALES_INVOICE && l.Document.Status != DocumentStatus.CANCELLED &&
                l.Document.IssueDate >= fromDate && l.Document.IssueDate < toExclusive);
            if (scoped) lines = lines.Where(l => l.Document!.BranchId == branchId);

            var grouped = await lines
                .GroupBy(l => new { l.ProductId, l.ProductName })
                .Select(g => new
                {
                    g.Key.ProductId,
                    g.Key.ProductName,
                    Revenue = g.Sum(l => l.LineTotal),
                    Cost = g.Sum(l => l.LineCost),
                    Profit = g.Sum(l => l.LineProfit),
                    Quantity = g.Sum(l => l.Quantity),
                })
                .ToListAsync();
            rows = grouped
                .OrderByDescending(g => g.Profit)
                .Select(g => new ProfitRowDto(
                    g.ProductId.ToString(), g.ProductName, g.Revenue, g.Cost, g.Profit, 0, g.Quantity))
                .ToArray();
        }
        else if (by == "day")
        {
            var grouped = await docs
                .GroupBy(d => d.IssueDate.Date)
                .Select(g => new
                {
                    Day = g.Key,
                    Revenue = g.Sum(d => d.Subtotal - d.DiscountTotal),
                    Cost = g.Sum(d => d.CostTotal),
                    Profit = g.Sum(d => d.ProfitTotal),
                    Invoices = g.Count(),
                })
                .ToListAsync();
            rows = grouped
                .OrderBy(g => g.Day)
                .Select(g => new ProfitRowDto(
                    g.Day.ToString("yyyy-MM-dd"), g.Day.ToString("yyyy-MM-dd"),
                    g.Revenue, g.Cost, g.Profit, g.Invoices, 0))
                .ToArray();
        }
        else
        {
            var grouped = await docs
                .GroupBy(d => new { d.PartyId, Name = d.Party!.Name })
                .Select(g => new
                {
                    g.Key.PartyId,
                    g.Key.Name,
                    Revenue = g.Sum(d => d.Subtotal - d.DiscountTotal),
                    Cost = g.Sum(d => d.CostTotal),
                    Profit = g.Sum(d => d.ProfitTotal),
                    Invoices = g.Count(),
                })
                .ToListAsync();
            rows = grouped
                .OrderByDescending(g => g.Profit)
                .Select(g => new ProfitRowDto(
                    g.PartyId.ToString(), g.Name, g.Revenue, g.Cost, g.Profit, g.Invoices, 0))
                .ToArray();
        }

        return Ok(new ProfitReportDto(
            fromDate.ToString("yyyy-MM-dd"), toExclusive.AddDays(-1).ToString("yyyy-MM-dd"),
            by, currency, revenue, cost, profit, invoices, rows));
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
