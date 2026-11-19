using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SKB.Api.Data;
using SKB.Api.Hubs;

namespace SKB.Api.Services;

/// <summary>
/// Putting a backup back from the owner's page (owner, 2026-11-16: "data recovery … from the
/// program's own backup"). The live database is never emptied or written over:
/// <list type="number">
/// <item>The file is uploaded (streamed to a temporary file, size-capped) or picked from the server's
/// backup folder by its name; the server chooses every path.</item>
/// <item>The owner sees what it holds (date, version, rows per table) before anything changes; a wrong
/// passphrase, a damaged file or one from a newer version is refused here.</item>
/// <item>Restoring takes a safety backup of the current data (into the backup folder, when one is
/// set), fills a <b>new</b> database from the file with the same code as the server command (older
/// backups are brought up to this version), then, in a moment, swaps the databases by name: the
/// current one is kept, renamed <c>&lt;name&gt;_before_&lt;time&gt;</c>, and the restored one takes
/// its name. Nothing is lost if any step fails: the new database is dropped and the current one is
/// left as it was.</item>
/// <item>Everyone is signed out (signed-in sessions aren't in a backup, and every access version moves
/// past any token issued before); the restore is in the audit log of both databases.</item>
/// <item>In a container (the office server), the app then restarts itself so nothing remembered from
/// the old data stays; elsewhere what it remembers is cleared.</item>
/// </list>
/// While it runs, changes from other people are refused (they'd be lost), and only one runs at a time.
/// The database user needs the right to create databases (the office server's has it); otherwise the
/// page says so and the server command remains.
/// </summary>
public sealed class RestoreService
{
    public const long MaxUpload = 8L * 1024 * 1024 * 1024;
    private static readonly TimeSpan StageLife = TimeSpan.FromMinutes(30);

    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly BackupScheduler _scheduler;
    private readonly IHostApplicationLifetime _life;
    private readonly ILogger<RestoreService> _log;
    private readonly ConcurrentDictionary<Guid, Staged> _staged = new();
    private readonly ConcurrentDictionary<Guid, Job> _jobs = new();
    private readonly SemaphoreSlim _one = new(1, 1);

    /// <summary>A restore is running: other people's changes are refused meanwhile (see Program.cs).</summary>
    public static volatile bool Running;

    public RestoreService(IServiceScopeFactory scopes, IConfiguration config, BackupScheduler scheduler,
        IHostApplicationLifetime life, ILogger<RestoreService> log)
    {
        _scopes = scopes;
        _config = config;
        _scheduler = scheduler;
        _life = life;
        _log = log;
        // Left over from before a restart: nobody can use them any more.
        try
        {
            if (Directory.Exists(Folder)) Directory.Delete(Folder, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _log.LogWarning(e, "Could not clear {Folder}", Folder);
        }
    }

    private static string Folder => Path.Combine(Path.GetTempPath(), "skb-restore");

    /// <summary>A backup file waiting to be looked at or restored, by whoever put it there.</summary>
    public sealed record Staged(Guid Id, string Path, string Name, long Size, string OwnerId, DateTime At, bool Temporary);

    public sealed record Job(Guid Id, string OwnerId)
    {
        public string State { get; set; } = "running";
        public string Step { get; set; } = "checking";
        public string? Error { get; set; }
        public string? SafetyBackup { get; set; }
        public string? KeptDatabase { get; set; }
        public long Rows { get; set; }
        public bool Restarting { get; set; }
    }

    // ------------------------------------------------------------------ the file

    /// <summary>
    /// Copy the uploaded file (ASP.NET has streamed it to disk, size-capped) to a temporary file named
    /// by the server, at most <see cref="MaxUpload"/>.
    /// </summary>
    public async Task<Staged> UploadAsync(IFormFile? upload, string ownerId, CancellationToken ct)
    {
        Sweep();
        if (upload is null || upload.Length == 0) throw new BackupException("Choose a backup file.", "no_file");
        if (upload.Length > MaxUpload) throw new BackupException("The file is too large.", "file_too_big");
        Directory.CreateDirectory(Folder);
        var id = Guid.NewGuid();
        var path = Path.Combine(Folder, $"{id:N}.bak");
        try
        {
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
            await upload.CopyToAsync(file, ct);
        }
        catch
        {
            File.Delete(path);
            throw;
        }
        var name = Path.GetFileName(upload.FileName ?? "backup");
        var staged = new Staged(id, path, name.Length > 120 ? name[..120] : name, upload.Length, ownerId, DateTime.UtcNow, true);
        _staged[id] = staged;
        return staged;
    }

    /// <summary>One of the automatic backups in the server's folder, by its name (never a path).</summary>
    public Staged? Pick(string name, string ownerId)
    {
        Sweep();
        if (!BackupScheduler.FileName().IsMatch(name)) return null;
        var file = _scheduler.Files().FirstOrDefault(f => f.Name == name);
        if (file is null) return null;
        var staged = new Staged(Guid.NewGuid(), file.FullName, file.Name, file.Length, ownerId, DateTime.UtcNow, false);
        _staged[staged.Id] = staged;
        return staged;
    }

    public Staged? Find(Guid id, string ownerId) =>
        _staged.TryGetValue(id, out var s) && s.OwnerId == ownerId && DateTime.UtcNow - s.At < StageLife ? s : null;

    public void Discard(Guid id, string ownerId)
    {
        if (Find(id, ownerId) is { } s) Remove(s);
    }

    private void Remove(Staged s)
    {
        _staged.TryRemove(s.Id, out _);
        if (s.Temporary) File.Delete(s.Path);
    }

    private void Sweep()
    {
        foreach (var s in _staged.Values.Where(s => DateTime.UtcNow - s.At >= StageLife).ToList()) Remove(s);
    }

    /// <summary>What the file holds; refuses a wrong passphrase, a damaged file or a newer version.</summary>
    public async Task<BackupService.Manifest> InspectAsync(Staged staged, string? passphrase, CancellationToken ct)
    {
        var manifest = await BackupService.InspectFileAsync(staged.Path, passphrase, ct);
        using var scope = _scopes.CreateScope();
        scope.ServiceProvider.GetRequiredService<BackupService>().CheckVersion(manifest);
        return manifest;
    }

    /// <summary>Why a restore can't be done from the page here (null = it can): the database user's rights.</summary>
    public async Task<string?> UnavailableAsync(CancellationToken ct)
    {
        try
        {
            await using var conn = new NpgsqlConnection(Maintenance());
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("""
                SELECT r.rolsuper OR (r.rolcreatedb AND d.datdba = r.oid)
                FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = @db
                """, conn);
            cmd.Parameters.AddWithValue("db", Live().Database ?? "");
            return await cmd.ExecuteScalarAsync(ct) is true ? null : "restore_no_rights";
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
        {
            _log.LogWarning(e, "Could not check the database rights for a restore");
            return "restore_no_rights";
        }
    }

    // ------------------------------------------------------------------ restoring

    public Job? FindJob(Guid id) => _jobs.TryGetValue(id, out var j) ? j : null;

    /// <summary>
    /// Start the restore of <paramref name="staged"/>; it goes on after the request answers. Null when
    /// another one is running.
    /// </summary>
    public Job? Start(Staged staged, string? passphrase, (string Id, string Name, string? Branch, string? Ip, string? Agent) actor)
    {
        if (!_one.Wait(0)) return null;
        var job = new Job(Guid.NewGuid(), actor.Id);
        _jobs[job.Id] = job;
        _staged.TryRemove(staged.Id, out _);
        Running = true;
        _ = Task.Run(async () =>
        {
            try
            {
                await RunAsync(job, staged, passphrase, actor);
                job.State = "done";
            }
            catch (Exception e)
            {
                job.State = "failed";
                job.Error = e is BackupException b ? b.Code : "restore_failed";
                _log.LogError(e, "Restore failed at step {Step}", job.Step);
            }
            finally
            {
                if (staged.Temporary) File.Delete(staged.Path);
                Running = false;
                _one.Release();
            }
            if (job.Restarting)
            {
                // Give the page a moment to hear it's done, then start afresh (the container comes back up).
                await Task.Delay(TimeSpan.FromSeconds(5));
                _log.LogWarning("Restarting after a restore");
                _life.StopApplication();
            }
        });
        return job;
    }

    private async Task RunAsync(Job job, Staged staged, string? passphrase,
        (string Id, string Name, string? Branch, string? Ip, string? Agent) actor)
    {
        if (await UnavailableAsync(CancellationToken.None) is { } why) throw new BackupException("Can't restore here.", why);

        // 1. A safety backup of what is there now (the current database is kept as well, below).
        job.Step = "safety";
        if (_scheduler.Folder is not null)
        {
            try
            {
                job.SafetyBackup = (await _scheduler.RunAsync()).Name;
            }
            catch (IOException)
            {
                // One was written this very second (its name is the time): the next second's.
                await Task.Delay(1100);
                job.SafetyBackup = (await _scheduler.RunAsync()).Name;
            }
        }

        var live = Live();
        var name = live.Database ?? throw new BackupException("No database is set.", "restore_failed");
        var stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var fresh = Trim($"{name}_restore_{stamp}");
        var kept = Trim($"{name}_before_{stamp}");

        // 2. The backup goes into a new database, brought up to this version.
        job.Step = "loading";
        await using (var conn = new NpgsqlConnection(Maintenance()))
        {
            await conn.OpenAsync();
            await Exec(conn, $"CREATE DATABASE {Quote(fresh)}");
        }
        int oldTop;
        BackupService.Manifest manifest;
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(Connection(fresh)).Options;
            await using (var db = new AppDbContext(options))
            {
                manifest = await new BackupService(db).RestoreFileAsync(staged.Path,
                    () => passphrase ?? throw new BackupException("A passphrase is needed.", "wrong_passphrase"),
                    line => _log.LogInformation("Restore: {Line}", line));
                job.Rows = manifest.Tables.Sum(t => t.Rows);
                await LedgerService.SetupAsync(db);
            }

            // Everyone signs in again: past every token issued on either database.
            using (var scope = _scopes.CreateScope())
            {
                var current = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                oldTop = await current.Staff.MaxAsync(s => (int?)s.AccessVersion) ?? 0;
                await scope.ServiceProvider.GetRequiredService<AuditService>().RecordAsync(actor.Id, actor.Name, "restore",
                    "backup", actor.Branch, actor.Ip, actor.Agent, staged.Name, Details(manifest, job, kept));
            }
            await using (var db = new AppDbContext(options))
            using (var scope = _scopes.CreateScope())
            {
                await db.Staff.ExecuteUpdateAsync(s => s.SetProperty(x => x.AccessVersion,
                    x => (x.AccessVersion > oldTop ? x.AccessVersion : oldTop) + 1));
                var sp = scope.ServiceProvider;
                await new AuditService(db, sp.GetRequiredService<ILogger<AuditService>>(),
                        sp.GetRequiredService<IHubContext<PresenceHub>>())
                    .RecordAsync(actor.Id, actor.Name, "restore", "backup", actor.Branch, actor.Ip, actor.Agent, staged.Name,
                        Details(manifest, job, kept));
            }
        }
        catch
        {
            await DropQuietlyAsync(fresh);
            throw;
        }

        // 3. The swap, by name: the current database is kept aside, the restored one takes its place.
        job.Step = "switching";
        await SwapAsync(name, fresh, kept);
        job.KeptDatabase = kept;

        // 4. Nothing remembered from the old data stays.
        AccessGate.ForgetAll();
        DeviceGate.ForgetAll();
        LockGate.ForgetAll();
        using (var scope = _scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            CompanyClock.Use(await db.CompanySettings.Select(s => s.TimeZone).FirstOrDefaultAsync());
        }
        job.Restarting = _config.GetValue("Restore:Restart",
            Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true");
        job.Step = "done";
        _log.LogWarning("Restored {File} ({Rows} rows); the previous data is kept in database {Kept}", staged.Name, job.Rows, kept);
    }

    private static string Details(BackupService.Manifest m, Job job, string kept) =>
        $"backup of {m.CreatedAt}; {m.Tables.Sum(t => t.Rows)} rows; safety backup {job.SafetyBackup ?? "-"}; previous data in {kept}";

    private async Task SwapAsync(string live, string fresh, string kept)
    {
        await using var conn = new NpgsqlConnection(Maintenance());
        await conn.OpenAsync();
        await Exec(conn, $"ALTER DATABASE {Quote(live)} WITH ALLOW_CONNECTIONS false");
        try
        {
            for (var attempt = 1; ; attempt++)
            {
                NpgsqlConnection.ClearAllPools();
                await using (var kill = new NpgsqlCommand(
                                 "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", conn))
                {
                    kill.Parameters.AddWithValue("db", live);
                    await kill.ExecuteNonQueryAsync();
                }
                try
                {
                    await Exec(conn, $"ALTER DATABASE {Quote(live)} RENAME TO {Quote(kept)}");
                    break;
                }
                catch (PostgresException e) when (e.SqlState == "55006" && attempt < 20)
                {
                    await Task.Delay(250); // a connection is still closing
                }
            }
        }
        catch
        {
            await Exec(conn, $"ALTER DATABASE {Quote(live)} WITH ALLOW_CONNECTIONS true");
            throw;
        }
        try
        {
            await Exec(conn, $"ALTER DATABASE {Quote(fresh)} RENAME TO {Quote(live)}");
        }
        catch
        {
            // Put the current one back as it was.
            await Exec(conn, $"ALTER DATABASE {Quote(kept)} RENAME TO {Quote(live)}");
            await Exec(conn, $"ALTER DATABASE {Quote(live)} WITH ALLOW_CONNECTIONS true");
            throw;
        }
        await Exec(conn, $"ALTER DATABASE {Quote(kept)} WITH ALLOW_CONNECTIONS true");
        NpgsqlConnection.ClearAllPools();
    }

    private async Task DropQuietlyAsync(string database)
    {
        try
        {
            NpgsqlConnection.ClearAllPools();
            await using var conn = new NpgsqlConnection(Maintenance());
            await conn.OpenAsync();
            await Exec(conn, $"DROP DATABASE IF EXISTS {Quote(database)} WITH (FORCE)");
        }
        catch (Exception e)
        {
            _log.LogWarning(e, "Could not drop {Database} after a failed restore", database);
        }
    }

    // ------------------------------------------------------------------ connections

    private NpgsqlConnectionStringBuilder Live() =>
        new(_config.GetConnectionString("Default") ?? throw new InvalidOperationException("No database is set."));

    private string Connection(string database)
    {
        var b = Live();
        b.Database = database;
        b.Pooling = false;
        return b.ConnectionString;
    }

    private string Maintenance() => Connection(_config["Restore:MaintenanceDatabase"] ?? "postgres");

    /// <summary>A database name within PostgreSQL's 63 bytes, keeping its time at the end.</summary>
    private static string Trim(string name) => name.Length <= 63 ? name : name[^63..];

    private static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";

    private static async Task Exec(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }
}
