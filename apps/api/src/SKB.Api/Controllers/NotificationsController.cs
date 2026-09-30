using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>The signed-in person's own notifications (the bell): newest first, with how many are unread.</summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public sealed class NotificationsController : ControllerBase
{
    private readonly AppDbContext _db;
    public NotificationsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<NotificationsDto>> List()
    {
        var me = Me();
        var mine = _db.Notifications.AsNoTracking().Where(n => n.StaffId == me);
        var unread = await mine.CountAsync(n => n.ReadAt == null);
        var rows = await mine.OrderByDescending(n => n.CreatedAt).Take(30).ToListAsync();
        return Ok(new NotificationsDto(unread, rows.Select(n => new NotificationDto(
            n.Id.ToString(), n.Kind, n.DocumentId?.ToString(), n.DocumentNumber, n.PartyName, n.Amount, n.ActorName,
            n.Message, n.CreatedAt.ToString("o"), n.ReadAt is not null, n.DepartmentName)).ToArray()));
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

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;
}
