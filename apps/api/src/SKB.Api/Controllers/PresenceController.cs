using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>Who's online now (المتصلون الآن): each person, their branch, device and screen.</summary>
[ApiController]
[Route("api/presence")]
[Authorize(Policy = Permissions.PresenceView)]
public sealed class PresenceController : ControllerBase
{
    private readonly PresenceTracker _tracker;
    private readonly AppDbContext _db;

    public PresenceController(PresenceTracker tracker, AppDbContext db)
    {
        _tracker = tracker;
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PresenceEntryDto>>> List()
    {
        var windows = _tracker.Snapshot();
        var branches = await _db.Branches.AsNoTracking().ToDictionaryAsync(b => b.Id.ToString(), b => Loc.Name(b));
        return Ok(windows.GroupBy(w => w.UserId).Select(g =>
        {
            var latest = g.MaxBy(w => w.LastActiveAt)!;
            return new PresenceEntryDto(g.Key, latest.FullName, latest.Role, latest.BranchId,
                branches.GetValueOrDefault(latest.BranchId), latest.CurrentView,
                g.Min(w => w.ConnectedAt).ToString("o"), latest.LastActiveAt.ToString("o"),
                g.OrderByDescending(w => w.LastActiveAt).Select(w => new PresenceWindowDto(
                    w.Device, w.Ip, w.CurrentView, w.ConnectedAt.ToString("o"), w.LastActiveAt.ToString("o"))).ToArray());
        }).OrderByDescending(e => e.LastActiveAt).ToList());
    }
}
