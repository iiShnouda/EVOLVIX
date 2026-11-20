using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The increases report (owner, 2026-11-20): the sales invoices of a period that had something added
/// to them — on an item or on the whole invoice — by whoever typed each increase, with how many
/// invoices and how much each added, and the invoices themselves (<c>by</c> narrows them to one giver).
/// Only for whoever may see increases; the person's branches and departments; cancelled ones don't count.
/// </summary>
[ApiController]
[Route("api/reports/increases")]
[Authorize]
public sealed class IncreasesReportController : ControllerBase
{
    private readonly AppDbContext _db;
    public IncreasesReportController(AppDbContext db) => _db = db;

    [HttpGet]
    [Authorize(Policy = Permissions.SalesSeeIncreases)]
    public async Task<ActionResult<IncreasesReportDto>> Get([FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? branchId = null, [FromQuery] string? departmentId = null, [FromQuery] string? by = null)
    {
        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, today.Month, 1);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        var (fromDate, toExclusive) = CompanyClock.Days(fromDay, toDay);

        var docs = _db.SalesDocuments.Where(d => d.Type == DocumentType.SALES_INVOICE && d.Status != DocumentStatus.CANCELLED
                                                 && d.IssueDate >= fromDate && d.IssueDate < toExclusive)
            .InBranches(User, d => d.BranchId).InDepartments(User);
        if (Guid.TryParse(branchId, out var bid)) docs = docs.Where(d => d.BranchId == bid);
        if (Guid.TryParse(departmentId, out var dept)) docs = docs.Where(d => d.DepartmentId == dept);

        var onLines = await _db.DocumentLines.AsNoTracking()
            .Where(l => l.Increase > 0 && docs.Any(d => d.Id == l.DocumentId))
            .Select(l => new { l.DocumentId, By = l.IncreaseById, Name = l.IncreaseByName, Amount = l.Increase })
            .ToListAsync();
        var onInvoices = await _db.DocumentCharges.AsNoTracking()
            .Where(c => c.Kind == ChargeKind.INCREASE && c.Amount > 0 && docs.Any(d => d.Id == c.DocumentId))
            .Select(c => new { c.DocumentId, By = c.ById, Name = c.ByName, c.Amount })
            .ToListAsync();
        var all = onLines.Concat(onInvoices).ToList();
        if (by is not null)
            all = all.Where(x => (x.By?.ToString() ?? "") == by).ToList();

        var staffIds = all.Where(x => x.By != null).Select(x => x.By!.Value).Distinct().ToList();
        var staff = await _db.Staff.AsNoTracking().Where(s => staffIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, s => (s.FullName, s.Code));
        string NameOf(Guid? id, string? name) =>
            id is Guid g && staff.TryGetValue(g, out var s) ? s.FullName : name ?? "";

        var rows = all.GroupBy(x => x.By)
            .Select(g => new IncreaseGiverDto(g.Key?.ToString() ?? "", NameOf(g.Key, g.First().Name),
                g.Key is Guid k && staff.TryGetValue(k, out var s) ? s.Code : null,
                g.Select(x => x.DocumentId).Distinct().Count(), g.Sum(x => x.Amount)))
            .OrderByDescending(r => r.Amount).ThenBy(r => r.Name).ToArray();

        var ids = all.Select(x => x.DocumentId).Distinct().ToList();
        var heads = await _db.SalesDocuments.AsNoTracking().Where(d => ids.Contains(d.Id))
            .Select(d => new
            {
                d.Id, d.Number, d.IssueDate, Party = d.Party!.Name, Rep = d.Rep != null ? d.Rep.FullName : null,
                Department = d.Department, d.GrandTotal,
            }).ToListAsync();
        var invoices = heads.Select(h =>
            {
                var mine = all.Where(x => x.DocumentId == h.Id).ToList();
                return new IncreaseInvoiceDto(h.Id.ToString(), h.Number,
                    DateTime.SpecifyKind(h.IssueDate, DateTimeKind.Utc).ToString("o"), h.Party, h.Rep,
                    h.Department is null ? null : Loc.Name(h.Department), h.GrandTotal, mine.Sum(x => x.Amount),
                    mine.Select(x => NameOf(x.By, x.Name)).Where(n => n != "").Distinct().ToArray());
            })
            .OrderByDescending(i => i.IssueDate).ToArray();
        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new IncreasesReportDto(fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), currency, rows,
            invoices, invoices.Length, all.Sum(x => x.Amount)));
    }
}
