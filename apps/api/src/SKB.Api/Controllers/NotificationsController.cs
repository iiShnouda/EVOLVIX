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
    /// <param name="from">From this company day (yyyy-MM-dd).</param>
    /// <param name="to">Up to and including this company day.</param>
    /// <param name="kinds">Only these kinds (comma-separated).</param>
    /// <param name="branchId">Only those that happened in this branch (and so on).</param>
    [HttpGet]
    public async Task<ActionResult<NotificationsDto>> List([FromQuery] Guid? before = null, [FromQuery] bool unread = false,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? kinds = null,
        [FromQuery] Guid? branchId = null, [FromQuery] Guid? departmentId = null, [FromQuery] Guid? warehouseId = null,
        [FromQuery] int take = Page)
    {
        var me = Me();
        var mine = _db.Notifications.AsNoTracking().Where(n => n.StaffId == me);
        var count = await mine.CountAsync(n => n.ReadAt == null);
        var q = unread ? mine.Where(n => n.ReadAt == null) : mine;
        if (CompanyClock.ParseDay(from) is DateOnly f)
        {
            var start = CompanyClock.StartOf(f);
            q = q.Where(n => n.CreatedAt >= start);
        }
        if (CompanyClock.ParseDay(to) is DateOnly t)
        {
            var end = CompanyClock.StartOf(t.AddDays(1));
            q = q.Where(n => n.CreatedAt < end);
        }
        var wanted = (kinds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(NotificationService.Kinds.ContainsKey).ToArray();
        if (wanted.Length > 0) q = q.Where(n => wanted.Contains(n.Kind));
        if (branchId is Guid bid) q = q.Where(n => n.BranchId == bid);
        if (departmentId is Guid did) q = q.Where(n => n.DepartmentId == did);
        if (warehouseId is Guid wid) q = q.Where(n => n.WarehouseId == wid);
        var total = await q.CountAsync();
        if (before is Guid b && await mine.Where(n => n.Id == b).Select(n => (DateTime?)n.CreatedAt).FirstOrDefaultAsync() is DateTime at)
            q = q.Where(n => n.CreatedAt < at || (n.CreatedAt == at && n.Id.CompareTo(b) < 0));
        var size = Math.Clamp(take, 1, 100);
        var rows = await q.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(size + 1).ToListAsync();
        return Ok(new NotificationsDto(count, rows.Take(size).Select(ToDto).ToArray(), rows.Count > size, total));
    }

    /// <summary>
    /// The places my notifications happened in that I may still see (the page's place filter): only
    /// my branches, departments and stores.
    /// </summary>
    [HttpGet("places")]
    public async Task<ActionResult<NotificationPlacesDto>> Places([FromServices] WarehouseService warehouses)
    {
        var me = Me();
        var mine = _db.Notifications.AsNoTracking().Where(n => n.StaffId == me);
        var branchIds = mine.Where(n => n.BranchId != null).Select(n => n.BranchId!.Value).Distinct();
        var branches = await _db.Branches.AsNoTracking().InBranches(User, x => x.Id).Where(x => branchIds.Contains(x.Id))
            .ToListAsync();
        var departmentIds = mine.Where(n => n.DepartmentId != null).Select(n => n.DepartmentId!.Value).Distinct();
        var dq = _db.Departments.AsNoTracking().Where(x => departmentIds.Contains(x.Id));
        if (Access.Departments(User) is Guid[] allowed) dq = dq.Where(x => allowed.Contains(x.Id));
        var departments = await dq.ToListAsync();
        var warehouseIds = mine.Where(n => n.WarehouseId != null).Select(n => n.WarehouseId!.Value).Distinct();
        var stores = await warehouses.Visible(User).AsNoTracking().Where(x => warehouseIds.Contains(x.Id)).ToListAsync();
        static PlaceDto[] Of<T>(IEnumerable<T> xs, Func<T, Guid> id, Func<T, string> name) =>
            xs.Select(x => new PlaceDto(id(x).ToString(), name(x))).OrderBy(x => x.Name).ToArray();
        return Ok(new NotificationPlacesDto(Of(branches, x => x.Id, x => Loc.Name(x)),
            Of(departments, x => x.Id, x => x.Name), Of(stores, x => x.Id, x => Loc.Name(x))));
    }

    private static NotificationDto ToDto(Notification n) => new(
        n.Id.ToString(), n.Kind, n.DocumentId?.ToString(), n.DocumentNumber, n.PartyName, n.Amount, n.ActorName,
        n.Message, DateTime.SpecifyKind(n.CreatedAt, DateTimeKind.Utc).ToString("o"), n.ReadAt is not null,
        n.DepartmentName, ParseData(n.Data), CompanyClock.DayOf(n.CreatedAt).ToString("yyyy-MM-dd"),
        n.BranchId?.ToString(), n.DepartmentId?.ToString(), n.WarehouseId?.ToString());

    private static JsonElement? ParseData(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    /// <summary>Mark some of mine read or unread.</summary>
    [HttpPost("mark")]
    public async Task<IActionResult> Mark([FromBody] MarkNotificationsRequest req)
    {
        var me = Me();
        var ids = Ids(req.Ids);
        if (ids.Length == 0) return NoContent();
        var mine = _db.Notifications.Where(n => n.StaffId == me && ids.Contains(n.Id));
        if (req.Read)
            await mine.Where(n => n.ReadAt == null).ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow));
        else
            await mine.Where(n => n.ReadAt != null).ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, (DateTime?)null));
        return NoContent();
    }

    /// <summary>
    /// Remove several of mine at once: the ones given, or every one before a company day (read or
    /// not), or every read one. Never anyone else's. Returns how many went.
    /// </summary>
    [HttpPost("delete")]
    public async Task<ActionResult<DeletedDto>> DeleteMany([FromBody] DeleteNotificationsRequest req)
    {
        var me = Me();
        var mine = _db.Notifications.Where(n => n.StaffId == me);
        IQueryable<Notification>? q = null;
        if (req.Ids is { Length: > 0 })
        {
            var ids = Ids(req.Ids);
            q = mine.Where(n => ids.Contains(n.Id));
        }
        else if (CompanyClock.ParseDay(req.Before) is DateOnly day)
        {
            var start = CompanyClock.StartOf(day);
            q = mine.Where(n => n.CreatedAt < start);
            if (req.ReadOnly) q = q.Where(n => n.ReadAt != null);
        }
        else if (req.ReadOnly) q = mine.Where(n => n.ReadAt != null);
        else if (req.All) q = mine;
        if (q is null) return BadRequest(new { error = "NOTHING_CHOSEN" });
        return Ok(new DeletedDto(await q.ExecuteDeleteAsync()));
    }

    private static Guid[] Ids(string[]? ids) =>
        (ids ?? Array.Empty<string>()).Take(500).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty).Distinct().ToArray();

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
