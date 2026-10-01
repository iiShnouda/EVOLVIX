using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The signed-in person's own screen preferences, such as which columns each table hides (owner,
/// 2026-10-01): kept per person on the server so they follow them to any device. They are UI
/// choices, not company data: only the person reads and writes their own, no permission beyond
/// being signed in, and nothing is audited.
/// </summary>
[ApiController]
[Route("api/preferences")]
[Authorize]
public sealed class PreferencesController : ControllerBase
{
    private const int MaxKey = 120, MaxValue = 8 * 1024, MaxPerPerson = 200;
    private readonly AppDbContext _db;
    public PreferencesController(AppDbContext db) => _db = db;

    /// <summary>All of mine, as key → value.</summary>
    [HttpGet]
    public async Task<ActionResult<Dictionary<string, string>>> List()
    {
        var me = Me();
        return Ok(await _db.StaffPreferences.AsNoTracking().Where(p => p.StaffId == me)
            .ToDictionaryAsync(p => p.Key, p => p.Value));
    }

    /// <summary>Set one (an empty value forgets it).</summary>
    [HttpPut]
    public async Task<IActionResult> Save([FromBody] SavePreferenceRequest req)
    {
        var me = Me();
        if (me == Guid.Empty) return Unauthorized();
        var key = req.Key?.Trim() ?? "";
        if (key.Length is 0 or > MaxKey || (req.Value?.Length ?? 0) > MaxValue)
            return BadRequest(new { message = "The preference is too big.", code = "bad_preference" });

        var row = await _db.StaffPreferences.FirstOrDefaultAsync(p => p.StaffId == me && p.Key == key);
        if (string.IsNullOrEmpty(req.Value))
        {
            if (row is not null) _db.StaffPreferences.Remove(row);
        }
        else if (row is null)
        {
            if (await _db.StaffPreferences.CountAsync(p => p.StaffId == me) >= MaxPerPerson)
                return BadRequest(new { message = "Too many preferences.", code = "bad_preference" });
            _db.StaffPreferences.Add(new StaffPreference { StaffId = me, Key = key, Value = req.Value });
        }
        else
        {
            row.Value = req.Value;
            row.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;
}
