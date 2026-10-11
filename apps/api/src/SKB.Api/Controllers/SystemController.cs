using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The owner's server pages, the owner's alone:
/// <list type="bullet">
/// <item>the monitor (<c>system:monitor</c>): how loaded the server and each of its parts are, read-only;</item>
/// <item>updates (<c>system:update</c>, owner, 2026-10-11): whether a new version is out, what it brings,
/// and updating to it (see <see cref="UpdateService"/>).</item>
/// </list>
/// There is deliberately no way to run a command or see a file from the app.
/// </summary>
[ApiController]
[Route("api/system")]
[Authorize]
public sealed class SystemController : ControllerBase
{
    private readonly UpdateService _updates;
    private readonly AuditService _audit;

    public SystemController(UpdateService updates, AuditService audit)
    {
        _updates = updates;
        _audit = audit;
    }

    [HttpGet("monitor")]
    [Authorize(Policy = Permissions.SystemMonitor)]
    public async Task<ActionResult<SystemMonitorDto>> Monitor([FromServices] SystemMonitor monitor, CancellationToken ct) =>
        Ok(await monitor.ReadAsync(ct));

    [HttpGet("updates")]
    [Authorize(Policy = Permissions.SystemUpdate)]
    public ActionResult<SystemUpdatesDto> Updates()
    {
        var v = _updates.Read();
        var coming = v.Newest is null ? Array.Empty<Releases.Release>() : Releases.NewerThanCurrent(v.Newest);
        return Ok(new SystemUpdatesDto(v.Enabled, Releases.Current.Version, Releases.All, v.Behind > 0 || coming.Count > 0,
            v.Behind, coming, v.State, v.Step, v.Error, v.CheckedAt, v.StartedAt, v.FinishedAt));
    }

    /// <summary>Ask the server to look for a new version now.</summary>
    [HttpPost("updates/check")]
    [Authorize(Policy = Permissions.SystemUpdate)]
    public async Task<IActionResult> Check()
    {
        var v = _updates.Read();
        if (!v.Enabled) return NotSetUp();
        if (v.State is "waiting" or "checking" or "updating") return Busy();
        _updates.Request("check");
        await AuditAsync("check");
        return Accepted(new { code = "checking" });
    }

    /// <summary>
    /// Update the server to the newest version: a backup first (when backups are set up), then the
    /// server's updater fetches, builds and restarts; the app is away for a minute or so meanwhile.
    /// </summary>
    [HttpPost("updates/apply")]
    [Authorize(Policy = Permissions.SystemUpdate)]
    public async Task<IActionResult> Apply([FromServices] BackupScheduler backups, CancellationToken ct)
    {
        var v = _updates.Read();
        if (!v.Enabled) return NotSetUp();
        if (v.State is "waiting" or "checking" or "updating") return Busy();
        var coming = v.Newest is null ? 0 : Releases.NewerThanCurrent(v.Newest).Count;
        if (v.Behind == 0 && coming == 0 && v.State != "failed")
            return Conflict(new { message = "The server is up to date.", code = "up_to_date" });
        // A backup first, unless one was just made (trying again right after a failed update).
        var latest = backups.Folder is null ? null : backups.Files().FirstOrDefault();
        var recent = latest is not null && DateTime.UtcNow - latest.LastWriteTimeUtc < TimeSpan.FromMinutes(15);
        if (backups.Folder is not null && !recent)
        {
            try
            {
                await backups.RunAsync(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                return StatusCode(500, new { message = "The backup before the update failed.", code = "backup_failed" });
            }
        }
        _updates.Request("update");
        await AuditAsync("upgrade");
        return Accepted(new { code = "updating" });
    }

    private ObjectResult NotSetUp() => Conflict(new { message = "Updates aren't set up on this server.", code = "updates_off" });
    private ObjectResult Busy() => Conflict(new { message = "The server is already busy with it.", code = "update_running" });

    private Task AuditAsync(string action) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "system_update",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), Releases.Current.Version);
}
