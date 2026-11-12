using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SKB.Api.Domain;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>A line of the log as the owner's page shows it. <c>Id</c> is its place in the day (for paging).</summary>
public record LogEntryDto(long Id, DateTime Time, string Level, string Source, string? Category, string Message,
    string? Exception, string? RequestId, string? Method, string? Path, int? Status, long? Ms, string? UserId,
    string? User, string? Branch, string? Route, string? Version, string? UserAgent);

/// <summary>
/// A page of a day's log, newest first. Days: the days that have one. Older: pass as <c>before</c>
/// for the next page (null at the day's start). End: pass as <c>after</c> for what was logged since.
/// </summary>
public record LogPageDto(bool Enabled, string Day, IReadOnlyList<string> Days, IReadOnlyList<LogEntryDto> Entries,
    long? Older, long End);

/// <summary>An error a person's app ran into: no business data, each part cut to a size.</summary>
public record ClientErrorRequest(string? Kind, string? Message, string? Stack, string? Route, string? Version);

/// <summary>
/// The server's log in the app (owner, 2026-11-12), the owner's alone (<c>system:logs</c>): a day's
/// lines by level, source, text or request id, and the day as a text file. The day is the only thing
/// the client chooses: the server picks the file, and no folder or file name is ever sent back.
/// Looking and downloading are audited.
/// </summary>
[ApiController]
[Route("api/system/logs")]
[Authorize(Policy = Permissions.SystemLogs)]
public sealed class LogsController : ControllerBase
{
    /// <summary>One "viewed" audit line per person and day in this long, however often the page refreshes.</summary>
    private static readonly TimeSpan ViewAuditEvery = TimeSpan.FromMinutes(10);
    private static readonly ConcurrentDictionary<string, DateTime> Viewed = new();

    private readonly LogStore _logs;
    private readonly AuditService _audit;

    public LogsController(LogStore logs, AuditService audit)
    {
        _logs = logs;
        _audit = audit;
    }

    private static string Text(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>A day exactly as yyyy-MM-dd (today when none): never part of a path typed by the client.</summary>
    private static bool TryDay(string? raw, out DateOnly day)
    {
        day = CompanyClock.Today;
        return string.IsNullOrEmpty(raw) ||
               DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);
    }

    [HttpGet]
    public async Task<ActionResult<LogPageDto>> List([FromQuery] string? day, [FromQuery] string? level,
        [FromQuery] string? source, [FromQuery] string? q, [FromQuery] string? requestId, [FromQuery] long? before,
        [FromQuery] long? after, [FromQuery] int limit = 100)
    {
        if (!TryDay(day, out var d)) return BadRequest(new { message = "The day isn't a date.", code = "VALIDATION_ERROR" });
        var filter = new LogFilter(
            level is "debug" or "info" or "warning" or "error" ? level : null,
            source is "server" or "client" ? source : null,
            string.IsNullOrWhiteSpace(q) ? null : q.Trim()[..Math.Min(100, q.Trim().Length)],
            string.IsNullOrWhiteSpace(requestId) ? null : requestId.Trim()[..Math.Min(40, requestId.Trim().Length)]);
        var page = _logs.Read(d, filter, before, after, Math.Clamp(limit, 1, 500));

        var key = CurrentUser.Id(User) + "|" + Text(d);
        var now = DateTime.UtcNow;
        if (!Viewed.TryGetValue(key, out var last) || now - last > ViewAuditEvery)
        {
            foreach (var old in Viewed.Where(v => now - v.Value > ViewAuditEvery).Select(v => v.Key).ToList())
                Viewed.TryRemove(old, out _);
            Viewed[key] = now;
            await AuditAsync("view", Text(d));
        }

        return Ok(new LogPageDto(_logs.Enabled, Text(d), _logs.Days().Select(Text).ToList(),
            page.Entries.Select(e => new LogEntryDto(e.Id, e.Line.Time, e.Line.Level, e.Line.Source, e.Line.Category,
                e.Line.Message, e.Line.Exception, e.Line.RequestId, e.Line.Method, e.Line.Path, e.Line.Status, e.Line.Ms,
                e.Line.UserId, e.Line.User, e.Line.Branch, e.Line.Route, e.Line.Version, e.Line.UserAgent)).ToList(),
            page.Older, page.End));
    }

    /// <summary>The day's log as a text file.</summary>
    [HttpGet("download")]
    public async Task<IActionResult> Download([FromQuery] string? day, CancellationToken ct)
    {
        if (!TryDay(day, out var d)) return BadRequest(new { message = "The day isn't a date.", code = "VALIDATION_ERROR" });
        if (!_logs.Days().Contains(d)) return NotFound(new { message = "No log for that day.", code = "NOT_FOUND" });
        await AuditAsync("export", Text(d));
        Response.ContentType = "text/plain; charset=utf-8";
        Response.Headers.ContentDisposition = $"attachment; filename=\"evolvix-log-{Text(d)}.txt\"";
        Response.Headers.CacheControl = "no-store";
        await _logs.WriteTextAsync(d, Response.Body, ct);
        return new EmptyResult();
    }

    /// <summary>For the checks, on a development server only: an error nobody handles.</summary>
    [HttpGet("fail")]
    public IActionResult Fail([FromServices] IWebHostEnvironment env)
    {
        if (!env.IsDevelopment()) return NotFound();
        throw new InvalidOperationException("A forced error for the checks. Password=forced-secret-1; " +
                                            "Authorization: Bearer forced.secret.token2");
    }

    private Task AuditAsync(string action, string day) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "server_logs",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), day);
}

/// <summary>
/// Errors the app itself ran into on a person's device (a page that failed to draw, an error nobody
/// caught), sent by any signed-in person and written to the server's log as client errors. A few a
/// minute per person, small, scrubbed like everything else in the log.
/// </summary>
[ApiController]
[Route("api/client-errors")]
[Authorize]
public sealed class ClientErrorsController : ControllerBase
{
    public const string RateLimit = "client-errors";

    [HttpPost]
    [EnableRateLimiting(RateLimit)]
    [RequestSizeLimit(32 * 1024)]
    public IActionResult Report([FromBody] ClientErrorRequest req, [FromServices] LogStore logs)
    {
        var message = LogScrub.Message(req.Message, 500);
        if (message.Length == 0) return BadRequest(new { message = "Nothing to report.", code = "VALIDATION_ERROR" });
        // The page only: no query string or fragment.
        var route = (req.Route ?? "").Split('?', '#')[0];
        var branch = CurrentUser.BranchId(User);
        logs.Write(new LogLine
        {
            Time = DateTime.UtcNow,
            Level = "error",
            Source = "client",
            Category = req.Kind is "render" or "rejection" ? req.Kind : "error",
            Message = message,
            Exception = string.IsNullOrWhiteSpace(req.Stack) ? null : LogScrub.Stack(req.Stack, 4000),
            RequestId = RequestLog.IdOf(HttpContext),
            UserId = LogScrub.Clean(CurrentUser.Id(User), 40),
            User = LogScrub.Clean(CurrentUser.Name(User), 80),
            Branch = branch.Length > 0 ? LogScrub.Clean(branch, 40) : null,
            Route = LogScrub.Clean(route, 200),
            Version = LogScrub.Clean(req.Version, 40),
            UserAgent = LogScrub.Clean(Request.Headers.UserAgent.ToString(), 300),
        });
        return NoContent();
    }
}
