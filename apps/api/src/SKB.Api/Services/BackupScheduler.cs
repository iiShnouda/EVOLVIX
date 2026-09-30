using System.Globalization;
using System.Text.RegularExpressions;

namespace SKB.Api.Services;

/// <summary>
/// Automatic backups: once a day, at <c>Backup:Hour</c> (the company's time, Settings → time zone), a backup is
/// written to <c>Backup:Folder</c> and only the newest <c>Backup:Keep</c> are kept. It's
/// encrypted when <c>Backup:Passphrase</c> is set. Off when no folder is configured (e.g. on a
/// cloud host, whose disk doesn't last — download backups there instead).
/// A day's backup that was missed while the server was off is made when it starts.
/// </summary>
public sealed partial class BackupScheduler : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<BackupScheduler> _log;
    private readonly SemaphoreSlim _running = new(1, 1);

    public BackupScheduler(IServiceScopeFactory scopes, IConfiguration config, ILogger<BackupScheduler> log)
    {
        _scopes = scopes;
        _log = log;
        var folder = config["Backup:Folder"];
        Folder = string.IsNullOrWhiteSpace(folder) ? null : Path.GetFullPath(folder);
        Hour = Math.Clamp(config.GetValue("Backup:Hour", 2), 0, 23);
        Keep = Math.Clamp(config.GetValue("Backup:Keep", 14), 1, 365);
        Passphrase = config["Backup:Passphrase"] is { Length: >= BackupService.MinPassphrase } p ? p : null;
    }

    public string? Folder { get; }
    public int Hour { get; }
    public int Keep { get; }
    public string? Passphrase { get; }
    public DateTime? LastRunAt { get; private set; }
    public string? LastFile { get; private set; }
    public string? LastError { get; private set; }

    [GeneratedRegex(@"^skb-\d{8}-\d{6}\.(skbak|zip)$")]
    public static partial Regex FileName();

    public IReadOnlyList<FileInfo> Files() =>
        Folder is null || !Directory.Exists(Folder)
            ? Array.Empty<FileInfo>()
            : new DirectoryInfo(Folder).GetFiles("skb-*").Where(f => FileName().IsMatch(f.Name))
                .OrderByDescending(f => f.Name, StringComparer.Ordinal).ToList();

    /// <summary>When the next automatic backup is due (UTC), or null when they're off. The hour is the company's.</summary>
    public DateTime? NextRunAt()
    {
        if (Folder is null) return null;
        var now = CompanyClock.Now;
        var due = now.Date.AddHours(Hour);
        if (DoneToday()) return CompanyClock.ToUtc(due.AddDays(1));
        return now < due ? CompanyClock.ToUtc(due) : DateTime.UtcNow;
    }

    private bool DoneToday() =>
        Files().FirstOrDefault() is { } newest
        && DateTime.TryParseExact(newest.Name[4..12], "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
        && d.Date == CompanyClock.Now.Date;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (Folder is null) return;
        _log.LogInformation("Automatic backups to {Folder} daily at {Hour}:00, keeping {Keep}.", Folder, Hour, Keep);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (CompanyClock.Now.Hour >= Hour && !DoneToday()) await RunAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogError(e, "Automatic backup failed.");
            }
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Make a backup in the folder now, then drop the oldest beyond <see cref="Keep"/>.</summary>
    public async Task<FileInfo> RunAsync(CancellationToken ct = default)
    {
        if (Folder is null) throw new BackupException("No backup folder is set on the server.");
        await _running.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(Folder);
            var name = $"skb-{CompanyClock.Now:yyyyMMdd-HHmmss}.{(Passphrase is null ? "zip" : "skbak")}";
            var path = Path.Combine(Folder, name);
            var part = path + ".part";
            try
            {
                using var scope = _scopes.CreateScope();
                var backup = scope.ServiceProvider.GetRequiredService<BackupService>();
                await backup.WriteFileAsync(part, Passphrase, ct);
                File.Move(part, path);
            }
            catch (Exception e)
            {
                File.Delete(part);
                LastError = e.Message;
                throw;
            }
            LastRunAt = DateTime.UtcNow;
            LastFile = name;
            LastError = null;
            foreach (var old in Files().Skip(Keep)) old.Delete();
            _log.LogInformation("Backup written: {File}", name);
            return new FileInfo(path);
        }
        finally
        {
            _running.Release();
        }
    }
}
