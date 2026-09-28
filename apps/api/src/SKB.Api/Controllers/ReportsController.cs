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
    /// non-cancelled sales invoices in a date range, broken down by customer, product, or day.
    /// "Net" means after returns: a sales return in the period counts negative (its revenue, cost
    /// and profit are all reversed), dated on the day the goods came back.
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

        const DocumentType Invoice = DocumentType.SALES_INVOICE;
        const DocumentType Return = DocumentType.SALES_RETURN;

        var docs = _db.SalesDocuments.Where(d =>
            (d.Type == Invoice || d.Type == Return) && d.Status != DocumentStatus.CANCELLED &&
            d.IssueDate >= fromDate && d.IssueDate < toExclusive);
        if (scoped) docs = docs.Where(d => d.BranchId == branchId);

        var currency = await docs.Select(d => d.Currency).FirstOrDefaultAsync() ?? "EGP";
        var revenue = await docs.SumAsync(d =>
            (long?)(d.Type == Return ? -(d.Subtotal - d.DiscountTotal) : d.Subtotal - d.DiscountTotal)) ?? 0;
        var cost = await docs.SumAsync(d => (long?)(d.Type == Return ? -d.CostTotal : d.CostTotal)) ?? 0;
        var profit = await docs.SumAsync(d => (long?)(d.Type == Return ? -d.ProfitTotal : d.ProfitTotal)) ?? 0;
        var invoices = await docs.CountAsync(d => d.Type == Invoice);
        var returns = await docs.Where(d => d.Type == Return)
            .SumAsync(d => (long?)(d.Subtotal - d.DiscountTotal)) ?? 0;

        ProfitRowDto[] rows;
        if (by == "product")
        {
            var lines = _db.DocumentLines.Where(l =>
                (l.Document!.Type == Invoice || l.Document.Type == Return) &&
                l.Document.Status != DocumentStatus.CANCELLED &&
                l.Document.IssueDate >= fromDate && l.Document.IssueDate < toExclusive);
            if (scoped) lines = lines.Where(l => l.Document!.BranchId == branchId);

            // Flatten the sign first so the grouped aggregates don't reach through a navigation.
            var grouped = await lines
                .Select(l => new
                {
                    l.ProductId, l.ProductName, l.LineTotal, l.LineCost, l.LineProfit, l.Quantity,
                    Sign = l.Document!.Type == Return ? -1 : 1,
                })
                .GroupBy(x => new { x.ProductId, x.ProductName })
                .Select(g => new
                {
                    g.Key.ProductId,
                    g.Key.ProductName,
                    Revenue = g.Sum(x => x.Sign * x.LineTotal),
                    Cost = g.Sum(x => x.Sign * x.LineCost),
                    Profit = g.Sum(x => x.Sign * x.LineProfit),
                    Quantity = g.Sum(x => x.Sign * x.Quantity),
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
                    Revenue = g.Sum(d => d.Type == Return ? -(d.Subtotal - d.DiscountTotal) : d.Subtotal - d.DiscountTotal),
                    Cost = g.Sum(d => d.Type == Return ? -d.CostTotal : d.CostTotal),
                    Profit = g.Sum(d => d.Type == Return ? -d.ProfitTotal : d.ProfitTotal),
                    Invoices = g.Sum(d => d.Type == Invoice ? 1 : 0),
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
                    Revenue = g.Sum(d => d.Type == Return ? -(d.Subtotal - d.DiscountTotal) : d.Subtotal - d.DiscountTotal),
                    Cost = g.Sum(d => d.Type == Return ? -d.CostTotal : d.CostTotal),
                    Profit = g.Sum(d => d.Type == Return ? -d.ProfitTotal : d.ProfitTotal),
                    Invoices = g.Sum(d => d.Type == Invoice ? 1 : 0),
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
            by, currency, revenue, cost, profit, invoices, returns, rows));
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
