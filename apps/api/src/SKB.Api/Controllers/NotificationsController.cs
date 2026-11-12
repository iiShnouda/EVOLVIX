using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The signed-in person's own notifications (the bell): newest first, with how many are unread;
/// read, delete and their own choices of what to be told. Nobody sees anyone else's.
/// </summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public sealed class NotificationsController : ControllerBase
{
    private const int Page = 30;
    private readonly AppDbContext _db;
    private readonly IWebHostEnvironment _env;

    public NotificationsController(AppDbContext db, IWebHostEnvironment env)
    {
        _db = db;
        _env = env;
    }

    /// <param name="before">The id of the last one shown: the next page after it.</param>
    /// <param name="unread">Only the unread ones.</param>
    [HttpGet]
    public async Task<ActionResult<NotificationsDto>> List([FromQuery] Guid? before = null, [FromQuery] bool unread = false)
    {
        var me = Me();
        var mine = _db.Notifications.AsNoTracking().Where(n => n.StaffId == me);
        var count = await mine.CountAsync(n => n.ReadAt == null);
        var q = unread ? mine.Where(n => n.ReadAt == null) : mine;
        if (before is Guid b && await mine.Where(n => n.Id == b).Select(n => (DateTime?)n.CreatedAt).FirstOrDefaultAsync() is DateTime at)
            q = q.Where(n => n.CreatedAt < at || (n.CreatedAt == at && n.Id.CompareTo(b) < 0));
        var rows = await q.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(Page + 1).ToListAsync();
        return Ok(new NotificationsDto(count, rows.Take(Page).Select(ToDto).ToArray(), rows.Count > Page));
    }

    private static NotificationDto ToDto(Notification n) => new(
        n.Id.ToString(), n.Kind, n.DocumentId?.ToString(), n.DocumentNumber, n.PartyName, n.Amount, n.ActorName,
        n.Message, DateTime.SpecifyKind(n.CreatedAt, DateTimeKind.Utc).ToString("o"), n.ReadAt is not null,
        n.DepartmentName, ParseData(n.Data));

    private static JsonElement? ParseData(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id)
    {
        var me = Me();
        await _db.Notifications.Where(n => n.Id == id && n.StaffId == me && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow));
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll()
    {
        var me = Me();
        await _db.Notifications.Where(n => n.StaffId == me && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow));
        return NoContent();
    }

    /// <summary>Remove one of mine.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var me = Me();
        await _db.Notifications.Where(n => n.Id == id && n.StaffId == me).ExecuteDeleteAsync();
        return NoContent();
    }

    /// <summary>Clear the ones I have read.</summary>
    [HttpDelete("read")]
    public async Task<IActionResult> DeleteRead()
    {
        var me = Me();
        await _db.Notifications.Where(n => n.StaffId == me && n.ReadAt != null).ExecuteDeleteAsync();
        return NoContent();
    }

    /// <summary>My choices: what I may be sent, and what I switched off.</summary>
    [HttpGet("preferences")]
    public async Task<ActionResult<NotificationPrefsDto>> Preferences()
    {
        var me = Me();
        var row = await _db.StaffPreferences.AsNoTracking()
            .Where(p => p.StaffId == me && p.Key == NotificationService.PreferenceKey).Select(p => p.Value).FirstOrDefaultAsync();
        var c = NotificationService.Choices.Parse(row);
        var offered = NotificationService.Offered(User.FindAll("permission").Select(x => x.Value));
        return Ok(new NotificationPrefsDto(offered, c.Off.Where(offered.Contains).ToArray(),
            NotificationService.AlwaysOn.ToArray(), c.Sound, c.Device));
    }

    [HttpPut("preferences")]
    public async Task<ActionResult<NotificationPrefsDto>> SavePreferences([FromBody] SaveNotificationPrefsRequest req)
    {
        var me = Me();
        var row = await _db.StaffPreferences.FirstOrDefaultAsync(p => p.StaffId == me && p.Key == NotificationService.PreferenceKey);
        var c = NotificationService.Choices.Parse(row?.Value);
        var off = req.Off is null
            ? c.Off
            : req.Off.Where(k => NotificationService.Kinds.ContainsKey(k) && !NotificationService.AlwaysOn.Contains(k))
                .Distinct().ToArray();
        c = new NotificationService.Choices(off, req.Sound ?? c.Sound, req.Device ?? c.Device);
        var json = JsonSerializer.Serialize(c, NotificationService.Json);
        if (row is null)
            _db.StaffPreferences.Add(new StaffPreference { StaffId = me, Key = NotificationService.PreferenceKey, Value = json });
        else
        {
            row.Value = json;
            row.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        return await Preferences();
    }

    /// <summary>
    /// Development and test servers only: run the daily jobs now (cheques falling due, and the day's
    /// summary for <c>day</c> or the usual day), for whoever may update the server.
    /// </summary>
    [HttpPost("run-daily")]
    [Authorize(Policy = Permissions.SystemUpdate)]
    public async Task<ActionResult<RunDailyDto>> RunDaily([FromBody] RunDailyRequest? req,
        [FromServices] NotificationService notify, [FromServices] AccessService access,
        [FromServices] MoneyService money, [FromServices] WarehouseService warehouses)
    {
        if (!_env.IsDevelopment()) return NotFound();
        var day = CompanyClock.ParseDay(req?.Day) ?? NotificationJobs.SummaryDay();
        var notes = await notify.NoteAlertsAsync();
        var told = await notify.DailySummaryAsync(day, access, money, warehouses);
        return Ok(new RunDailyDto(notes, told, day.ToString("yyyy-MM-dd")));
    }

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;
}
