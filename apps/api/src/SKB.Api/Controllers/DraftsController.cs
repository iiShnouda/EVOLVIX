using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The signed-in person's own work in progress, kept while the app updates itself (owner decision
/// 2026-09-30): just before the new version loads, each open screen saves what was typed; the new
/// version, at the same address, takes it back (once) and carries on. Only the person who saved a
/// draft can read it, it lives a short while, and it never touches the books — so it needs no
/// permission beyond being signed in, and isn't audited (nothing in the company changes).
/// </summary>
[ApiController]
[Route("api/drafts")]
[Authorize]
public sealed class DraftsController : ControllerBase
{
    /// <summary>A draft older than this is not given back (work left that long is not picked up again).</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromDays(7);
    private const int MaxKey = 200, MaxData = 256 * 1024, MaxPerPerson = 20;

    private readonly AppDbContext _db;
    public DraftsController(AppDbContext db) => _db = db;

    /// <summary>Save (or replace) the draft of one screen.</summary>
    [HttpPut]
    public async Task<IActionResult> Save([FromBody] SaveWorkDraftRequest req)
    {
        var me = Me();
        if (me == Guid.Empty) return Unauthorized();
        var key = req.Key?.Trim() ?? "";
        if (key.Length is 0 or > MaxKey || req.Data is null || req.Data.Length > MaxData)
            return BadRequest(new { message = "The draft is too big.", code = "bad_draft" });

        // Old ones go, and a person keeps only a few.
        var stale = DateTime.UtcNow - KeepFor;
        await _db.WorkDrafts.Where(d => d.StaffId == me && (d.UpdatedAt < stale || d.Key == key)).ExecuteDeleteAsync();
        var extra = await _db.WorkDrafts.Where(d => d.StaffId == me).OrderByDescending(d => d.UpdatedAt)
            .Skip(MaxPerPerson - 1).Select(d => d.Id).ToListAsync();
        if (extra.Count > 0) await _db.WorkDrafts.Where(d => extra.Contains(d.Id)).ExecuteDeleteAsync();

        _db.WorkDrafts.Add(new WorkDraft { StaffId = me, Key = key, Data = req.Data });
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Give back one screen's draft and forget it; 204 when there is none (or it's too old).</summary>
    [HttpPost("take")]
    public async Task<ActionResult<WorkDraftDto>> Take([FromBody] TakeWorkDraftRequest req)
    {
        var me = Me();
        var key = req.Key?.Trim() ?? "";
        var draft = await _db.WorkDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.StaffId == me && d.Key == key);
        if (draft is null) return NoContent();
        await _db.WorkDrafts.Where(d => d.Id == draft.Id).ExecuteDeleteAsync();
        if (draft.UpdatedAt < DateTime.UtcNow - KeepFor) return NoContent();
        return Ok(new WorkDraftDto(draft.Key, draft.Data, draft.UpdatedAt.ToString("o")));
    }

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;
}
