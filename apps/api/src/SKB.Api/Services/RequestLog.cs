using System.Diagnostics;
using System.Security.Cryptography;

namespace SKB.Api.Services;

/// <summary>
/// One line in the log for each request to the API (owner, 2026-11-12): its id, method, path, status,
/// how long it took and who made it. Never a body, a header, a cookie or a token; the query string
/// only as <see cref="LogScrub.Query"/> leaves it. An error nobody handled is logged with its stack
/// trace, and the person gets a short answer with the request's id to quote. Slow requests, refusals
/// and too many tries are warnings.
/// </summary>
public sealed class RequestLog
{
    private static readonly AsyncLocal<RequestLog?> Ambient = new();
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>The request being served on this call path, so every line logged during it carries its id.</summary>
    public static RequestLog? Current => Ambient.Value;

    public string Id { get; } = NewId();

    /// <summary>Made here, never taken from the client: 10 letters and digits that are easy to read out.</summary>
    private static string NewId() =>
        string.Create(10, 0, static (span, _) =>
        {
            Span<byte> bytes = stackalloc byte[10];
            RandomNumberGenerator.Fill(bytes);
            for (var i = 0; i < span.Length; i++) span[i] = Alphabet[bytes[i] % Alphabet.Length];
        });

    public static string? IdOf(HttpContext ctx) => (ctx.Items[typeof(RequestLog)] as RequestLog)?.Id;

    public static async Task Middleware(HttpContext ctx, RequestDelegate next, LogStore store, ILogger fallback)
    {
        var request = new RequestLog();
        Ambient.Value = request;
        ctx.Items[typeof(RequestLog)] = request;
        ctx.Response.Headers["X-Request-Id"] = request.Id;
        var watch = Stopwatch.StartNew();
        Exception? failure = null;
        try
        {
            await next(ctx);
        }
        catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
        {
            // The person left the page: nothing went wrong.
            if (!ctx.Response.HasStarted) ctx.Response.StatusCode = 499;
        }
        catch (BadHttpRequestException e)
        {
            // A request the server can't read (too large, cut short): the client's doing.
            if (!ctx.Response.HasStarted)
            {
                ctx.Response.StatusCode = e.StatusCode;
                await ctx.Response.WriteAsJsonAsync(new { message = "The request couldn't be read.", code = "bad_request", requestId = request.Id });
            }
        }
        catch (Exception e)
        {
            failure = e;
            if (!store.Enabled) fallback.LogError(e, "Unhandled error in request {RequestId}", request.Id);
            if (!ctx.Response.HasStarted)
            {
                ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
                ctx.Response.Headers.Remove("Content-Length");
                await ctx.Response.WriteAsJsonAsync(new
                {
                    message = "Something went wrong on the server.", code = "server_error", requestId = request.Id,
                });
            }
        }
        finally
        {
            watch.Stop();
            Write(ctx, request, store, watch.ElapsedMilliseconds, failure);
            Ambient.Value = null;
        }
    }

    private static void Write(HttpContext ctx, RequestLog request, LogStore store, long ms, Exception? failure)
    {
        if (!store.Enabled) return;
        var path = ctx.Request.Path.Value ?? "";
        var status = ctx.Response.StatusCode;
        var api = path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
        var hub = path.StartsWith("/hubs/", StringComparison.OrdinalIgnoreCase);
        var failed = failure is not null || status >= 500;
        if (!failed)
        {
            // Pages, pictures and scripts aren't logged; nor the health probe, nor reading the log itself.
            if (!api && !hub) return;
            if (status < 400 && (path.Equals("/api/health", StringComparison.OrdinalIgnoreCase)
                                 || path.StartsWith("/api/system/logs", StringComparison.OrdinalIgnoreCase))) return;
        }
        // Answers that take their time by nature (the assistant, the live connection) aren't "slow".
        var slow = ms > store.SlowMs && api && !path.StartsWith("/api/assistant", StringComparison.OrdinalIgnoreCase);
        var level = failed ? LogLevel.Error : slow || status is 403 or 429 ? LogLevel.Warning : LogLevel.Information;
        if (level < store.MinLevel) return;

        var method = LogScrub.Clean(ctx.Request.Method, 10);
        var shown = LogScrub.Clean(path, 200) + LogScrub.Query(ctx.Request.Query);
        var user = ctx.User;
        var signedIn = user.Identity?.IsAuthenticated == true;
        var branch = signedIn ? CurrentUser.BranchId(user) : "";
        if (ctx.Request.Headers.TryGetValue(Access.BranchHeader, out var picked) && Guid.TryParse(picked.ToString(), out var b))
            branch = b.ToString();
        store.Write(new LogLine
        {
            Time = DateTime.UtcNow,
            Level = FileLoggerProvider.LevelName(level),
            Category = failure is not null ? "Error" : slow ? "Slow" : "Request",
            Message = $"{method} {shown} → {status} in {ms} ms",
            Exception = failure is null ? null : LogScrub.Stack(failure.ToString()),
            RequestId = request.Id,
            Method = method,
            Path = shown,
            Status = status,
            Ms = ms,
            UserId = signedIn ? LogScrub.Clean(CurrentUser.Id(user), 40) : null,
            User = signedIn ? LogScrub.Clean(CurrentUser.Name(user), 80) : null,
            Branch = branch.Length > 0 ? LogScrub.Clean(branch, 40) : null,
        });
    }
}
