using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Restoring a backup from the owner's page (<c>backup:restore</c>, the owner's alone): upload a
/// backup or pick an automatic one, see what it holds, then restore it with the company's name (or
/// RESTORE) typed to confirm. How it is done safely: <see cref="RestoreService"/>. The passphrase is
/// only used, never kept or written to the log.
/// </summary>
[ApiController]
[Route("api/backups/restore")]
[Authorize(Policy = Permissions.BackupRestore)]
public sealed class RestoreController : ControllerBase
{
    private readonly RestoreService _restore;
    private readonly BackupScheduler _scheduler;
    private readonly AuditService _audit;
    private readonly AppDbContext _db;

    public RestoreController(RestoreService restore, BackupScheduler scheduler, AuditService audit, AppDbContext db)
    {
        _restore = restore;
        _scheduler = scheduler;
        _audit = audit;
        _db = db;
    }

    /// <summary>The automatic backups on the server to pick from, and whether a restore can be done here.</summary>
    [HttpGet]
    public async Task<ActionResult<RestoreOptionsDto>> Options(CancellationToken ct) => Ok(new RestoreOptionsDto(
        await _restore.UnavailableAsync(ct), RestoreService.MaxUpload, _scheduler.Folder is not null,
        _scheduler.Files().Select(f => new BackupFileDto(f.Name, f.Length, f.LastWriteTimeUtc.ToString("o"))).ToArray()));

    /// <summary>Upload a backup file (multipart, streamed to disk, then a temporary file the server names).</summary>
    [HttpPost("upload")]
    [RequestSizeLimit(RestoreService.MaxUpload + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = RestoreService.MaxUpload)]
    public async Task<ActionResult<StagedBackupDto>> Upload(IFormFile? file, CancellationToken ct)
    {
        try
        {
            var staged = await _restore.UploadAsync(file, CurrentUser.Id(User), ct);
            return Ok(await StagedAsync(staged, ct));
        }
        catch (BackupException e)
        {
            return BadRequest(new { message = e.Message, code = e.Code });
        }
    }

    /// <summary>Pick one of the automatic backups by its name.</summary>
    [HttpPost("pick")]
    public async Task<ActionResult<StagedBackupDto>> Pick([FromBody] PickBackupRequest req, CancellationToken ct)
    {
        var staged = _restore.Pick(req.Name ?? "", CurrentUser.Id(User));
        if (staged is null) return NotFound(new { message = "No such backup.", code = "not_found" });
        return Ok(await StagedAsync(staged, ct));
    }

    /// <summary>What the file holds (needs its passphrase when encrypted). Nothing changes.</summary>
    [HttpPost("{id:guid}/inspect")]
    public async Task<ActionResult<BackupContentsDto>> Inspect(Guid id, [FromBody] InspectBackupRequest req, CancellationToken ct)
    {
        var staged = _restore.Find(id, CurrentUser.Id(User));
        if (staged is null) return NotFound(new { message = "Upload or pick the backup again.", code = "not_found" });
        try
        {
            var m = await _restore.InspectAsync(staged, req.Passphrase, ct);
            return Ok(new BackupContentsDto(staged.Name, m.CreatedAt, m.Migration, m.AppVersion, m.Tables.Sum(t => t.Rows),
                m.Tables.Select(t => new BackupTableDto(t.Name, t.Rows)).ToArray()));
        }
        catch (BackupException e)
        {
            return BadRequest(new { message = e.Message, code = e.Code });
        }
    }

    /// <summary>Forget an uploaded file (it is deleted).</summary>
    [HttpDelete("{id:guid}")]
    public IActionResult Discard(Guid id)
    {
        _restore.Discard(id, CurrentUser.Id(User));
        return NoContent();
    }

    /// <summary>
    /// Restore it: the company's name or RESTORE typed to confirm. It goes on after this answers;
    /// ask <see cref="Job"/> how it went. Everyone, the owner too, then signs in again.
    /// </summary>
    [HttpPost("{id:guid}")]
    public async Task<IActionResult> Restore(Guid id, [FromBody] RestoreBackupRequest req, CancellationToken ct)
    {
        var staged = _restore.Find(id, CurrentUser.Id(User));
        if (staged is null) return NotFound(new { message = "Upload or pick the backup again.", code = "not_found" });
        var company = await _db.CompanySettings.Select(s => s.CompanyName).FirstOrDefaultAsync(ct) ?? "";
        var typed = (req.Confirm ?? "").Trim();
        if (typed.Length == 0 || !(typed == "RESTORE" || string.Equals(typed, company.Trim(), StringComparison.OrdinalIgnoreCase)))
            return BadRequest(new { message = "Type the company's name or RESTORE to confirm.", code = "restore_confirm" });
        if (await _restore.UnavailableAsync(ct) is { } why) return BadRequest(new { message = "Can't restore here.", code = why });
        try
        {
            await _restore.InspectAsync(staged, req.Passphrase, ct);
        }
        catch (BackupException e)
        {
            return BadRequest(new { message = e.Message, code = e.Code });
        }
        var job = _restore.Start(staged, req.Passphrase, (CurrentUser.Id(User), CurrentUser.Name(User), CurrentUser.BranchId(User),
            HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString()));
        if (job is null) return Conflict(new { message = "A restore is already running.", code = "restore_running" });
        return Accepted(new { jobId = job.Id });
    }

    /// <summary>
    /// How a restore is going. Open to anyone holding its id (a random one only its starter got): the
    /// restore signs everyone out, the starter too, before they hear it finished.
    /// </summary>
    [HttpGet("jobs/{id:guid}")]
    [AllowAnonymous]
    public ActionResult<RestoreJobDto> Job(Guid id)
    {
        var job = _restore.FindJob(id);
        if (job is null) return NotFound(new { message = "Not found.", code = "not_found" });
        return Ok(new RestoreJobDto(job.State, job.Step, job.Error, job.SafetyBackup, job.KeptDatabase, job.Rows, job.Restarting));
    }

    private async Task<StagedBackupDto> StagedAsync(RestoreService.Staged s, CancellationToken ct)
    {
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), s.Temporary ? "restore_upload" : "restore_pick",
            "backup", CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), s.Name);
        return new StagedBackupDto(s.Id, s.Name, s.Size, await BackupService.IsEncryptedAsync(s.Path, ct));
    }
}
