using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The signed-in person's own screen preferences, such as which columns each table hides (owner,
/// 2026-10-01): kept per person on the server so they follow them to any device. They are UI
/// choices, not company data: only the person reads and writes their own, no permission beyond
/// being signed in, and nothing is audited.
/// <para>
/// The print options are the exception (owner, 2026-11-12): changing them is a permission of its
/// own (<see cref="Permissions.PrintSettings"/>). Whoever has it keeps their own; everyone else gets
/// the company's layout, which a holder of <see cref="Permissions.PrintDefault"/> sets from theirs.
/// </para>
/// </summary>
[ApiController]
[Route("api/preferences")]
[Authorize]
public sealed class PreferencesController : ControllerBase
{
    private const int MaxKey = 120, MaxValue = 8 * 1024, MaxPerPerson = 200;
    /// <summary>Where the print options are kept: paper, type size, what a document carries.</summary>
    private const string PrintPrefix = "columns:print.";
    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    public PreferencesController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    /// <summary>
    /// All of mine, as key → value. The print options are the company's unless I may change them;
    /// then they are mine, and the company's where I chose nothing.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<Dictionary<string, string>>> List()
    {
        var me = Me();
        var mine = await _db.StaffPreferences.AsNoTracking().Where(p => p.StaffId == me)
            .ToDictionaryAsync(p => p.Key, p => p.Value);
        if (!MayPrintSettings())
            foreach (var key in mine.Keys.Where(IsPrint).ToList()) mine.Remove(key);
        foreach (var (key, value) in await CompanyLayoutAsync()) mine.TryAdd(key, value);
        return Ok(mine);
    }

    /// <summary>
    /// My print options become the company's (owner, 2026-11-12): what everyone without the
    /// print-settings permission prints with, and where a new holder starts.
    /// </summary>
    [HttpPut("print-default")]
    [Authorize(Policy = Permissions.PrintDefault)]
    public async Task<IActionResult> SavePrintDefault()
    {
        var me = Me();
        var settings = await _db.CompanySettings.FirstOrDefaultAsync();
        if (me == Guid.Empty || settings is null) return Unauthorized();
        var layout = await CompanyLayoutAsync();
        // What I print with now: my own choices over the company's.
        if (MayPrintSettings())
            foreach (var p in await _db.StaffPreferences.AsNoTracking()
                         .Where(p => p.StaffId == me && p.Key.StartsWith(PrintPrefix)).ToListAsync())
                layout[p.Key] = p.Value;
        settings.PrintLayout = System.Text.Json.JsonSerializer.Serialize(layout);
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "update", "print_layout",
            null, Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString());
        return NoContent();
    }

    /// <summary>Back to the app's own layout for everyone without the print-settings permission.</summary>
    [HttpDelete("print-default")]
    [Authorize(Policy = Permissions.PrintDefault)]
    public async Task<IActionResult> ClearPrintDefault()
    {
        var settings = await _db.CompanySettings.FirstOrDefaultAsync();
        if (settings is null) return NotFound();
        settings.PrintLayout = null;
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "reset", "print_layout",
            null, Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString());
        return NoContent();
    }

    private static bool IsPrint(string key) => key.StartsWith(PrintPrefix, StringComparison.Ordinal);
    private bool MayPrintSettings() => User.HasClaim("permission", Permissions.PrintSettings);

    private async Task<Dictionary<string, string>> CompanyLayoutAsync()
    {
        var json = await _db.CompanySettings.AsNoTracking().Select(s => s.PrintLayout).FirstOrDefaultAsync();
        if (string.IsNullOrEmpty(json)) return new();
        try
        {
            return (System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? new())
                .Where(p => IsPrint(p.Key)).ToDictionary(p => p.Key, p => p.Value);
        }
        catch (System.Text.Json.JsonException)
        {
            return new();
        }
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
        if (IsPrint(key) && !MayPrintSettings())
            return StatusCode(403, new { message = "Changing the print options needs permission.", code = "forbidden" });

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
