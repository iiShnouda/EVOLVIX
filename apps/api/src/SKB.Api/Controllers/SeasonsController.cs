using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>Seasons (مواسم): read by anyone who sees the stock; added by hand under seasons:manage.</summary>
[ApiController]
[Route("api/seasons")]
[Authorize]
public sealed class SeasonsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public SeasonsController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    /// <summary>Every season, newest first, "no season" last; the current one is marked.</summary>
    [HttpGet]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<SeasonDto[]>> List()
    {
        await Seasons.EnsureAsync(_db);
        var now = (await Seasons.CurrentAsync(_db))?.Id;
        var rows = await _db.Seasons.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        return Ok(rows
            .OrderBy(s => s.Kind == Seasons.None ? 1 : 0)
            .ThenByDescending(s => s.Year ?? 0)
            .ThenBy(s => s.Kind == Seasons.Winter ? 0 : 1)
            .ThenBy(s => s.Name)
            .Select(s => Seasons.ToDto(s, now)).ToArray());
    }

    [HttpPost]
    [Authorize(Policy = Permissions.SeasonsManage)]
    public async Task<ActionResult<SeasonDto>> Create([FromBody] CreateSeasonRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null || name.Length > 60)
            return BadRequest(new { message = "The season needs a name of up to 60 characters.", code = "bad_name" });
        if (await _db.Seasons.AnyAsync(s => s.Name.ToLower() == name.ToLower()))
            return BadRequest(new { message = $"There is already a season called {name}.", code = "duplicate_name" });
        var season = new Season { Name = name, Kind = Seasons.Custom };
        _db.Seasons.Add(season);
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "season",
            CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), season.Id.ToString());
        return Created($"/api/seasons/{season.Id}", Seasons.ToDto(season, (await Seasons.CurrentAsync(_db))?.Id));
    }

    /// <summary>Rename a season added by hand (summer and winter keep the system's names).</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.SeasonsManage)]
    public async Task<ActionResult<SeasonDto>> Update(Guid id, [FromBody] CreateSeasonRequest req)
    {
        var season = await _db.Seasons.FirstOrDefaultAsync(s => s.Id == id && s.IsActive);
        if (season is null) return NotFound(new { message = "Season not found.", code = "not_found" });
        if (season.Kind != Seasons.Custom)
            return BadRequest(new { message = "Summer and winter keep their names.", code = "system_season" });
        var name = Loc.Clean(req.Name);
        if (name is null || name.Length > 60)
            return BadRequest(new { message = "The season needs a name of up to 60 characters.", code = "bad_name" });
        if (await _db.Seasons.AnyAsync(s => s.Id != id && s.Name.ToLower() == name.ToLower()))
            return BadRequest(new { message = $"There is already a season called {name}.", code = "duplicate_name" });
        season.Name = name;
        await _db.SaveChangesAsync();
        await AuditAsync("update", season.Id);
        return Ok(Seasons.ToDto(season, (await Seasons.CurrentAsync(_db))?.Id));
    }

    /// <summary>
    /// Delete a season no item carries (owner, 2026-10-21). One the system adds (summer, winter) is
    /// hidden instead, so it isn't added again; "no season" stays.
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Permissions.SetupDelete)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var season = await _db.Seasons.FirstOrDefaultAsync(s => s.Id == id && s.IsActive);
        if (season is null) return NotFound(new { message = "Season not found.", code = "not_found" });
        if (season.Kind == Seasons.None || await _db.Products.AnyAsync(p => p.SeasonId == id))
            return Conflict(new { message = "Items carry this season.", code = "in_use" });
        await _db.CompanySettings.Where(c => c.CurrentSeasonId == id)
            .ExecuteUpdateAsync(x => x.SetProperty(c => c.CurrentSeasonId, (Guid?)null));
        if (season.Kind == Seasons.Custom) _db.Seasons.Remove(season);
        else season.IsActive = false;
        await _db.SaveChangesAsync();
        await AuditAsync("delete", id);
        return NoContent();
    }

    private Task AuditAsync(string action, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "season",
            CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
