using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Backups (النسخ الاحتياطي): download one now (encrypted with a passphrase the owner chooses),
/// see the automatic ones on the server and download them. A backup holds everything, so it's
/// the owner's alone (<c>backup:create</c>) and every download is audited. Restoring is a server
/// command, not an endpoint.
/// </summary>
[ApiController]
[Route("api/backups")]
[Authorize(Policy = Permissions.BackupCreate)]
public sealed class BackupsController : ControllerBase
{
    private readonly BackupService _backup;
    private readonly BackupScheduler _scheduler;
    private readonly AuditService _audit;

    public BackupsController(BackupService backup, BackupScheduler scheduler, AuditService audit)
    {
        _backup = backup;
        _scheduler = scheduler;
        _audit = audit;
    }

    [HttpGet]
    public ActionResult<BackupStatusDto> Status() => Ok(new BackupStatusDto(
        _scheduler.Folder is not null, _scheduler.Folder, _scheduler.Hour, _scheduler.Keep,
        _scheduler.Passphrase is not null, _scheduler.LastRunAt?.ToString("o"), _scheduler.LastFile,
        _scheduler.LastError, _scheduler.NextRunAt()?.ToUniversalTime().ToString("o"),
        _scheduler.Files().Select(f => new BackupFileDto(f.Name, f.Length, f.LastWriteTimeUtc.ToString("o"))).ToArray()));

    /// <summary>A backup of everything now, encrypted with the passphrase given.</summary>
    [HttpPost("download")]
    public async Task<IActionResult> Download([FromBody] DownloadBackupRequest req, CancellationToken ct)
    {
        var passphrase = req.Passphrase ?? "";
        if (passphrase.Length is < BackupService.MinPassphrase or > BackupService.MaxPassphrase)
            return BadRequest(new { message = "Choose a passphrase of at least 8 characters.", code = "bad_passphrase" });
        var path = Path.Combine(Path.GetTempPath(), $"skb-download-{Guid.NewGuid():N}.skbak");
        try
        {
            await _backup.WriteFileAsync(path, passphrase, ct);
        }
        catch
        {
            System.IO.File.Delete(path);
            throw;
        }
        await AuditAsync("download", null);
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920,
            FileOptions.DeleteOnClose | FileOptions.Asynchronous);
        return File(stream, "application/octet-stream", $"skb-{DateTime.Now:yyyyMMdd-HHmmss}.skbak");
    }

    /// <summary>Make an automatic-style backup in the server folder now.</summary>
    [HttpPost("run")]
    public async Task<ActionResult<BackupFileDto>> Run(CancellationToken ct)
    {
        if (_scheduler.Folder is null)
            return BadRequest(new { message = "No backup folder is set on the server.", code = "no_backup_folder" });
        try
        {
            var file = await _scheduler.RunAsync(ct);
            await AuditAsync("run", file.Name);
            return Ok(new BackupFileDto(file.Name, file.Length, file.LastWriteTimeUtc.ToString("o")));
        }
        catch (Exception e) when (e is BackupException or IOException or UnauthorizedAccessException)
        {
            return BadRequest(new { message = e.Message, code = "backup_failed" });
        }
    }

    /// <summary>Download one of the backups in the server folder.</summary>
    [HttpGet("files/{name}")]
    public async Task<IActionResult> File(string name)
    {
        var file = BackupScheduler.FileName().IsMatch(name)
            ? _scheduler.Files().FirstOrDefault(f => f.Name == name)
            : null;
        if (file is null) return NotFound(new { message = "No such backup.", code = "not_found" });
        await AuditAsync("download", file.Name);
        return PhysicalFile(file.FullName, "application/octet-stream", file.Name);
    }

    private Task AuditAsync(string action, string? file) => _audit.RecordAsync(
        CurrentUser.Id(User), CurrentUser.Name(User), action, "backup", CurrentUser.BranchId(User),
        HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), file);
}
