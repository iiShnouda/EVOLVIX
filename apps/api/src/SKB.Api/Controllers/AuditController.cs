using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The activity log (سجل النشاط): who did what, when, from where — every change the app audits.
/// Read-only; seeing it needs <c>audit:view</c> (the owner's by default).
/// </summary>
[ApiController]
[Route("api/audit")]
[Authorize(Policy = Permissions.AuditView)]
public sealed class AuditController : ControllerBase
{
    private readonly AppDbContext _db;

    public AuditController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<PaginatedDto<AuditEntryDto>>> List(
        [FromQuery] string? actorId = null, [FromQuery] string? resource = null, [FromQuery] string? action = null,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50, [FromQuery] string? resourceId = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var q = _db.AuditEntries.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(actorId)) q = q.Where(a => a.ActorId == actorId);
        if (!string.IsNullOrWhiteSpace(resource)) q = q.Where(a => a.Resource == resource);
        if (!string.IsNullOrWhiteSpace(action)) q = q.Where(a => a.Action == action);
        // One record's own history (owner, 2026-10-19: an invoice shows its activity log).
        if (!string.IsNullOrWhiteSpace(resourceId)) q = q.Where(a => a.ResourceId == resourceId);
        if (CompanyClock.ParseDay(from) is DateOnly f)
        {
            var start = CompanyClock.StartOf(f);
            q = q.Where(a => a.CreatedAt >= start);
        }
        if (CompanyClock.ParseDay(to) is DateOnly t)
        {
            var end = CompanyClock.StartOf(t.AddDays(1));
            q = q.Where(a => a.CreatedAt < end);
        }
        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(a => a.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var branchIds = rows.Select(r => Guid.TryParse(r.BranchId, out var b) ? b : Guid.Empty).Distinct().ToList();
        var branches = await _db.Branches.AsNoTracking().Where(b => branchIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id);
        return Ok(new PaginatedDto<AuditEntryDto>(rows.Select(r => new AuditEntryDto(
            r.Id.ToString(), r.ActorId, r.ActorName, r.Action, r.Resource, r.ResourceId, r.Details,
            AuditService.DeviceKind(r.UserAgent),
            Guid.TryParse(r.BranchId, out var b) && branches.TryGetValue(b, out var branch) ? Loc.Name(branch) : null,
            r.Ip, r.CreatedAt.ToString("o"))).ToArray(), total, page, pageSize));
    }

    /// <summary>The kinds of record and action that appear in the log, for the filters.</summary>
    [HttpGet("facets")]
    public async Task<ActionResult<object>> Facets() => Ok(new
    {
        resources = await _db.AuditEntries.Select(a => a.Resource).Distinct().OrderBy(x => x).ToListAsync(),
        actions = await _db.AuditEntries.Select(a => a.Action).Distinct().OrderBy(x => x).ToListAsync(),
        actors = (await _db.AuditEntries.GroupBy(a => a.ActorId)
            .Select(g => new { id = g.Key, name = g.Max(a => a.ActorName) }).ToListAsync()).OrderBy(x => x.name).ToList(),
    });
}
