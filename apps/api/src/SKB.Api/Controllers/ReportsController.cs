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
[Authorize]
public sealed class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ReportsController(AppDbContext db) => _db = db;

    /// <summary>
    /// Cancelled and changed sales invoices (owner, 2026-10-01): each change with who made it, when,
    /// why (if given) and the invoice total before and after. <paramref name="kind"/> EDIT or CANCEL.
    /// </summary>
    [HttpGet("invoice-changes")]
    [Authorize(Policy = Permissions.ReportsChanges)]
    public async Task<ActionResult<InvoiceRevisionDto[]>> InvoiceChanges(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? kind = null)
    {
        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, today.Month, 1);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        var (fromDate, toExclusive) = CompanyClock.Days(fromDay, toDay);
        var q = _db.InvoiceRevisions.AsNoTracking().Where(r => r.At >= fromDate && r.At < toExclusive);
        if (kind is "EDIT" or "CANCEL" or "DISCOUNT") q = q.Where(r => r.Kind == kind);
        var allowed = _db.SalesDocuments.InBranches(User, d => d.BranchId).Select(d => d.Id);
        q = q.Where(r => allowed.Contains(r.DocumentId));
        var rows = await q.OrderByDescending(r => r.At).Take(1000)
            .Select(r => new
            {
                r.Id, r.DocumentId, r.Document!.Number, PartyName = r.Document.Party!.Name, PartyCode = (int?)r.Document.Party.Code,
                r.Kind, r.At, r.StaffName, r.Reason, r.TotalBefore, r.TotalAfter, BranchName = r.Document.Branch!.Name,
            }).ToListAsync();
        return Ok(rows.Select(r => new InvoiceRevisionDto(r.Id.ToString(), r.DocumentId.ToString(), r.Number,
            r.PartyName, r.PartyCode, r.Kind, r.At.ToString("o"), r.StaffName, r.Reason, r.TotalBefore, r.TotalAfter,
            r.BranchName)).ToArray());
    }

    /// <summary>
    /// Profitability report (تقارير الربحية). Sums net sales, cost of goods and profit for
    /// non-cancelled sales invoices in a date range, broken down by customer, product, or day.
    /// "Net" means after returns: a sales return in the period counts negative (its revenue, cost
    /// and profit are all reversed), dated on the day the goods came back.
    /// Revenue = subtotal − discount (tax excluded); profit is the stored per-document/-line profit.
    /// </summary>
    [HttpGet("profitability")]
    [Authorize(Policy = Permissions.ReportsProfit)]
    public async Task<ActionResult<ProfitReportDto>> Profitability(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string by = "customer")
    {
        // A report of cost and profit: its own permission is enough (owner, 2026-10-23).
        // Whole company days (Settings → time zone); by default this month so far.
        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, today.Month, 1);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        var (fromDate, toExclusive) = CompanyClock.Days(fromDay, toDay);
        by = by.ToLowerInvariant() is "product" or "day" or "model" or "rep" ? by.ToLowerInvariant() : "customer";

        const DocumentType Invoice = DocumentType.SALES_INVOICE;
        const DocumentType Return = DocumentType.SALES_RETURN;

        var docs = _db.SalesDocuments.Where(d =>
            (d.Type == Invoice || d.Type == Return) && d.Status != DocumentStatus.CANCELLED &&
            d.IssueDate >= fromDate && d.IssueDate < toExclusive);
        docs = docs.InBranches(User, d => d.BranchId);

        var currency = await docs.Select(d => d.Currency).FirstOrDefaultAsync() ?? "EGP";
        var revenue = await docs.SumAsync(d =>
            (long?)(d.Type == Return ? -(d.Subtotal - d.DiscountTotal) : d.Subtotal - d.DiscountTotal)) ?? 0;
        var cost = await docs.SumAsync(d => (long?)(d.Type == Return ? -d.CostTotal : d.CostTotal)) ?? 0;
        var profit = await docs.SumAsync(d => (long?)(d.Type == Return ? -d.ProfitTotal : d.ProfitTotal)) ?? 0;
        var invoices = await docs.CountAsync(d => d.Type == Invoice);
        var returns = await docs.Where(d => d.Type == Return)
            .SumAsync(d => (long?)(d.Subtotal - d.DiscountTotal)) ?? 0;

        ProfitRowDto[] rows;
        if (by is "product" or "model")
        {
            var lines = _db.DocumentLines.Where(l =>
                (l.Document!.Type == Invoice || l.Document.Type == Return) &&
                l.Document.Status != DocumentStatus.CANCELLED &&
                l.Document.IssueDate >= fromDate && l.Document.IssueDate < toExclusive);
            lines = lines.InBranches(User, l => l.Document!.BranchId);

            // Flatten the sign first so the grouped aggregates don't reach through a navigation.
            var grouped = await lines
                .Select(l => new
                {
                    l.ProductId, l.ProductName, LineTotal = l.LineTotal - l.DocDiscount, l.LineCost, l.LineProfit, l.Quantity,
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

            if (by == "model")
            {
                // Size/color variants roll up to their model; other items stay as they are.
                var ids = rows.Select(r => Guid.Parse(r.Key)).ToList();
                var models = await _db.Products.AsNoTracking().Where(p => ids.Contains(p.Id) && p.ModelId != null)
                    .Include(p => p.Model).ToDictionaryAsync(p => p.Id.ToString(), p => p.Model!);
                rows = rows
                    .GroupBy(r => models.TryGetValue(r.Key, out var m) ? (m.Id.ToString(), Loc.Name(m)) : (r.Key, r.Label))
                    .Select(g => new ProfitRowDto(g.Key.Item1, g.Key.Item2, g.Sum(r => r.Revenue), g.Sum(r => r.Cost),
                        g.Sum(r => r.Profit), 0, g.Sum(r => r.Quantity)))
                    .OrderByDescending(r => r.Profit)
                    .ToArray();
            }
        }
        else if (by == "rep")
        {
            // Sales reps (مندوب): whose sales they were. No commission (owner, 2026-09-29).
            var grouped = await docs
                .GroupBy(d => new { d.RepId, Name = d.Rep!.FullName })
                .Select(g => new
                {
                    g.Key.RepId,
                    g.Key.Name,
                    Revenue = g.Sum(d => d.Type == Return ? -(d.Subtotal - d.DiscountTotal) : d.Subtotal - d.DiscountTotal),
                    Cost = g.Sum(d => d.Type == Return ? -d.CostTotal : d.CostTotal),
                    Profit = g.Sum(d => d.Type == Return ? -d.ProfitTotal : d.ProfitTotal),
                    Invoices = g.Sum(d => d.Type == Invoice ? 1 : 0),
                })
                .ToListAsync();
            rows = grouped
                .OrderByDescending(g => g.Profit)
                .Select(g => new ProfitRowDto(g.RepId?.ToString() ?? "", g.Name ?? "",
                    g.Revenue, g.Cost, g.Profit, g.Invoices, 0))
                .ToArray();
        }
        else if (by == "day")
        {
            var zone = CompanyClock.ZoneId;
            var grouped = await docs
                .Select(d => new { At = AppDbContext.LocalTime(zone, d.IssueDate), d.Type, d.Subtotal, d.DiscountTotal, d.CostTotal, d.ProfitTotal })
                .GroupBy(d => d.At.Date)
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
            fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"),
            by, currency, revenue, cost, profit, invoices, returns, rows));
    }
}
