using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The returns report (owner, 2026-11-18): sales returns of a period by reason, item, customer or
/// sales rep, with the return rate — pieces returned ÷ pieces sold in the same period (by item,
/// customer or rep; by reason, each reason's share of what came back). Only the person's branches
/// and departments; cancelled documents don't count.
/// </summary>
[ApiController]
[Route("api/reports/returns")]
[Authorize]
public sealed class ReturnsReportController : ControllerBase
{
    private readonly AppDbContext _db;
    public ReturnsReportController(AppDbContext db) => _db = db;

    [HttpGet]
    [Authorize(Policy = Permissions.ReportsReturns)]
    public async Task<ActionResult<ReturnsReportDto>> Get([FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string by = "reason", [FromQuery] string? branchId = null, [FromQuery] string? departmentId = null)
    {
        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, today.Month, 1);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        var (fromDate, toExclusive) = CompanyClock.Days(fromDay, toDay);
        by = by is "item" or "customer" or "rep" ? by : "reason";

        var docs = _db.SalesDocuments.Where(d => d.Status != DocumentStatus.CANCELLED
                                                 && d.IssueDate >= fromDate && d.IssueDate < toExclusive)
            .InBranches(User, d => d.BranchId).InDepartments(User);
        if (Guid.TryParse(branchId, out var bid)) docs = docs.Where(d => d.BranchId == bid);
        if (Guid.TryParse(departmentId, out var dept)) docs = docs.Where(d => d.DepartmentId == dept);
        var returns = docs.Where(d => d.Type == DocumentType.SALES_RETURN);

        var back = await _db.DocumentLines.AsNoTracking().Where(l => returns.Any(d => d.Id == l.DocumentId))
            .Select(l => new
            {
                l.DocumentId, l.ProductId, l.Quantity, Value = l.LineTotal - l.DocDiscount + l.Tax,
                Reason = l.ReturnReason ?? "", l.Document!.PartyId, l.Document.RepId,
            }).ToListAsync();
        string KeyOf(Guid productId, Guid partyId, Guid? repId, string reason) => by switch
        {
            "item" => productId.ToString(),
            "customer" => partyId.ToString(),
            "rep" => repId?.ToString() ?? "",
            _ => reason,
        };

        // What was sold in the period, by the same key (not by reason).
        var sold = new Dictionary<string, int>();
        if (by != "reason")
        {
            var soldLines = _db.DocumentLines.AsNoTracking().Where(l => docs.Any(d => d.Id == l.DocumentId
                                                                                     && d.Type == DocumentType.SALES_INVOICE));
            var rows = by switch
            {
                "item" => await soldLines.GroupBy(l => l.ProductId)
                    .Select(g => new { Key = g.Key.ToString(), Qty = g.Sum(l => l.Quantity) }).ToListAsync(),
                "customer" => await soldLines.GroupBy(l => l.Document!.PartyId)
                    .Select(g => new { Key = g.Key.ToString(), Qty = g.Sum(l => l.Quantity) }).ToListAsync(),
                _ => await soldLines.GroupBy(l => l.Document!.RepId)
                    .Select(g => new { Key = g.Key == null ? "" : g.Key.ToString()!, Qty = g.Sum(l => l.Quantity) })
                    .ToListAsync(),
            };
            foreach (var r in rows) sold[r.Key] = sold.GetValueOrDefault(r.Key) + r.Qty;
        }

        var groups = back.GroupBy(l => KeyOf(l.ProductId, l.PartyId, l.RepId, l.Reason))
            .Select(g => new
            {
                g.Key, Qty = g.Sum(l => l.Quantity), Value = g.Sum(l => l.Value),
                Count = g.Select(l => l.DocumentId).Distinct().Count(),
            }).ToList();
        var ids = groups.Select(g => Guid.TryParse(g.Key, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).ToList();
        var names = by switch
        {
            "item" => await _db.Products.AsNoTracking().Where(p => ids.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id.ToString(), p => (Name: p.Name, Code: p.Sku)),
            "customer" => await _db.Parties.AsNoTracking().Where(p => ids.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id.ToString(), p => (Name: p.Name, Code: p.Code.ToString())),
            "rep" => await _db.Staff.AsNoTracking().Where(s => ids.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id.ToString(), s => (Name: s.FullName, Code: s.Code.ToString())),
            _ => new Dictionary<string, (string Name, string Code)>(),
        };
        var totalQty = groups.Sum(g => g.Qty);
        var result = groups.Select(g =>
            {
                int? soldQty = by == "reason" ? null : sold.GetValueOrDefault(g.Key);
                // Basis points: returned ÷ sold, or (by reason) ÷ everything returned.
                var of = by == "reason" ? totalQty : soldQty ?? 0;
                int? rate = of > 0 ? (int)Math.Round(g.Qty * 10000m / of, MidpointRounding.AwayFromZero) : null;
                var (name, code) = names.TryGetValue(g.Key, out var n) ? n : (g.Key, (string?)null);
                return new ReturnsReportRowDto(g.Key, name, code, g.Count, g.Qty, g.Value, soldQty, rate);
            })
            .OrderByDescending(r => r.Quantity).ThenBy(r => r.Label).ToArray();
        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        var soldTotal = by == "reason" ? (int?)null : sold.Values.Sum();
        return Ok(new ReturnsReportDto(by, fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), currency, result,
            back.Select(l => l.DocumentId).Distinct().Count(), totalQty, back.Sum(l => l.Value), soldTotal,
            soldTotal is > 0 ? (int)Math.Round(totalQty * 10000m / soldTotal.Value, MidpointRounding.AwayFromZero) : null));
    }
}
