using System.Text.Json;

namespace SKB.Api.Services;

/// <summary>
/// Updating the server from the app (owner, 2026-10-11: "see if there's a new version, what it brings,
/// press Update and it updates; else it says up to date"). The app can't and mustn't run anything on
/// the server: it only leaves a request, the word "check" or "update", in a folder it shares with the
/// server (<c>Updates:Folder</c>, /updates in the app's container). The server's own updater
/// (scripts/update-server.sh, run by systemd; install-server.sh sets it up) does the rest: it fetches
/// the newest code, builds it and restarts the app, and writes how it went in status.json and what the
/// newest code brings in latest-release-notes.json. Nothing else passes between them, and the files
/// are read as untrusted.
/// </summary>
public sealed class UpdateService
{
    /// <summary>A request the updater hasn't picked up in this long means it isn't running.</summary>
    private static readonly TimeSpan PickUpWithin = TimeSpan.FromMinutes(2);
    /// <summary>An update still "running" after this long has died midway.</summary>
    private static readonly TimeSpan UpdateWithin = TimeSpan.FromHours(2);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string? _folder;

    public UpdateService(IConfiguration config) =>
        _folder = config["Updates:Folder"] is { Length: > 0 } f ? f : null;

    /// <summary>True when the server shares an updates folder, so checking/updating is possible.</summary>
    public bool Configured => _folder is not null;

    /// <summary>What the server's updater last wrote (all optional: it is read as it comes).</summary>
    public sealed record Status(string? State, string? Step, string? Error, int? Behind, DateTime? CheckedAt,
        DateTime? StartedAt, DateTime? FinishedAt);

    /// <param name="State">idle, waiting (asked, not picked up yet), checking, updating or failed.</param>
    public sealed record View(bool Enabled, string State, string? Step, string? Error, int Behind,
        DateTime? CheckedAt, DateTime? StartedAt, DateTime? FinishedAt, IReadOnlyList<Releases.Release>? Newest);

    private string? PathOf(string name) => _folder is null ? null : Path.Combine(_folder, name);

    private static string? Read(string? path)
    {
        try
        {
            if (path is null || !File.Exists(path) || new FileInfo(path).Length > 512 * 1024) return null;
            return File.ReadAllText(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public View Read()
    {
        Status? status = null;
        try
        {
            if (Read(PathOf("status.json")) is { } json) status = JsonSerializer.Deserialize<Status>(json, Json);
        }
        catch (JsonException)
        {
        }
        // Updates from the app are on only where the server's updater has been set up and has run.
        if (status is null) return new View(false, "idle", null, null, 0, null, null, null, null);

        var state = status.State is "idle" or "checking" or "updating" or "failed" ? status.State : "idle";
        var error = status.Error is { Length: > 0 and <= 40 } e && e.All(c => char.IsAsciiLetterLower(c) || c == '_') ? e : null;
        var step = status.Step is "fetch" or "backup" or "download" or "build" or "restart" or "done" ? status.Step : null;
        if (state == "updating" && status.StartedAt is { } started && DateTime.UtcNow - started.ToUniversalTime() > UpdateWithin)
        {
            state = "failed";
            error = "timed_out";
        }
        var request = PathOf("request");
        if (state is "idle" or "failed" && request is not null && File.Exists(request))
        {
            var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(request);
            if (age < PickUpWithin) state = "waiting";
            else
            {
                state = "failed";
                error = "updater_not_running";
            }
        }
        var newest = Read(PathOf("latest-release-notes.json")) is { } notes ? Releases.Parse(notes) : null;
        return new View(true, state, step, error, Math.Max(0, status.Behind ?? 0), status.CheckedAt, status.StartedAt,
            status.FinishedAt, newest);
    }

    /// <summary>Leave a request ("check" or "update") for the server's updater.</summary>
    public void Request(string what)
    {
        if (what is not ("check" or "update")) throw new ArgumentException("Unknown request.", nameof(what));
        var path = PathOf("request") ?? throw new InvalidOperationException("Updates aren't set up on this server.");
        var part = path + ".part";
        File.WriteAllText(part, what);
        File.Move(part, path, overwrite: true);
    }
}

/// <summary>
/// Looks for a new version on its own (owner, 2026-10-14: "why do I have to press check myself?"):
/// soon after start and then every few hours it leaves a "check" request for the updater, so the
/// Updates badge appears by itself when a new version is ready. It never updates on its own — pressing
/// Update stays the owner's choice. It only checks while idle, so it never disturbs a running update.
/// </summary>
public sealed class UpdateChecker : BackgroundService
{
    private static readonly TimeSpan First = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Every = TimeSpan.FromHours(6);
    private readonly UpdateService _updates;
    private readonly ILogger<UpdateChecker> _log;

    public UpdateChecker(UpdateService updates, ILogger<UpdateChecker> log)
    {
        _updates = updates;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!_updates.Configured) return; // no updater on this server
        if (!await Wait(First, ct)) return;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (_updates.Read().State is "idle" or "failed") _updates.Request("check");
            }
            catch (Exception e)
            {
                _log.LogWarning(e, "Automatic update check failed");
            }
            if (!await Wait(Every, ct)) break;
        }
    }

    private static async Task<bool> Wait(TimeSpan span, CancellationToken ct)
    {
        try
        {
            await Task.Delay(span, ct);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
