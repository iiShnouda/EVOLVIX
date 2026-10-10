using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// The server's load for the owner's monitor (owner, 2026-10-10): the machine's processor, memory,
/// disk, temperature and uptime, this app, the database and the assistant's models. Only figures:
/// no file names, paths, settings or commands ever leave the server, and nothing can be changed.
/// Read from Linux's /proc and /sys, which inside the app's container show the whole machine.
/// </summary>
public sealed class SystemMonitor
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _http;
    private readonly AssistantService _assistant;

    public SystemMonitor(AppDbContext db, IConfiguration config, IHttpClientFactory http, AssistantService assistant)
    {
        _db = db;
        _config = config;
        _http = http;
        _assistant = assistant;
    }

    public async Task<SystemMonitorDto> ReadAsync(CancellationToken ct)
    {
        var cpu = await CpuPercentAsync(ct);
        var mem = MemInfo();
        var load = ReadText("/proc/loadavg")?.Split(' ', StringSplitOptions.RemoveEmptyEntries) ?? Array.Empty<string>();
        double Load(int i) => load.Length > i && double.TryParse(load[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
        var uptime = ReadText("/proc/uptime")?.Split(' ').FirstOrDefault() is { } up
                     && double.TryParse(up, NumberStyles.Float, CultureInfo.InvariantCulture, out var secs) ? (long)secs : 0;

        var machine = new SystemMachineDto(
            Model(), Environment.ProcessorCount, cpu, Load(0), Load(1), Load(2),
            mem.GetValueOrDefault("MemTotal"), mem.GetValueOrDefault("MemAvailable"),
            mem.GetValueOrDefault("SwapTotal"), mem.GetValueOrDefault("SwapFree"),
            Temperature(), uptime, Disks());

        var me = Process.GetCurrentProcess();
        var app = new SystemAppDto(
            me.WorkingSet64, GC.GetTotalMemory(false), me.Threads.Count,
            (long)(DateTime.Now - me.StartTime).TotalSeconds,
            typeof(SystemMonitor).Assembly.GetName().Version?.ToString() ?? "");

        return new SystemMonitorDto(DateTime.UtcNow, machine, app, await DatabaseAsync(ct),
            await AssistantAsync(ct), Backups());
    }

    // ------------------------------------------------------------------ machine

    private static string? ReadText(string path)
    {
        try
        {
            return File.Exists(path) ? File.ReadAllText(path).Trim() : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>The processor's use over a short moment, in percent of all its cores.</summary>
    private static async Task<double> CpuPercentAsync(CancellationToken ct)
    {
        static (long Idle, long Total)? Sample()
        {
            var line = ReadText("/proc/stat")?.Split('\n').FirstOrDefault(l => l.StartsWith("cpu "));
            if (line is null) return null;
            var n = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1)
                .Select(x => long.TryParse(x, out var v) ? v : 0).ToArray();
            if (n.Length < 4) return null;
            var idle = n[3] + (n.Length > 4 ? n[4] : 0);
            return (idle, n.Sum());
        }
        var a = Sample();
        await Task.Delay(400, ct);
        var b = Sample();
        if (a is null || b is null || b.Value.Total <= a.Value.Total) return 0;
        var total = b.Value.Total - a.Value.Total;
        var busy = total - (b.Value.Idle - a.Value.Idle);
        return Math.Round(100.0 * busy / total, 1);
    }

    /// <summary>/proc/meminfo in bytes.</summary>
    private static Dictionary<string, long> MemInfo()
    {
        var map = new Dictionary<string, long>();
        foreach (var line in (ReadText("/proc/meminfo") ?? "").Split('\n'))
        {
            var parts = line.Split(':', 2);
            if (parts.Length != 2) continue;
            var value = parts[1].Trim().Split(' ')[0];
            if (long.TryParse(value, out var kb)) map[parts[0].Trim()] = kb * 1024;
        }
        return map;
    }

    /// <summary>The hottest of the machine's sensors, in °C (a Raspberry Pi has one on its chip).</summary>
    private static double? Temperature()
    {
        try
        {
            if (!Directory.Exists("/sys/class/thermal")) return null;
            var temps = Directory.GetDirectories("/sys/class/thermal", "thermal_zone*")
                .Select(d => ReadText(Path.Combine(d, "temp")))
                .Select(t => long.TryParse(t, out var milli) ? milli / 1000.0 : (double?)null)
                .Where(t => t is > 0 and < 150).ToList();
            return temps.Count == 0 ? null : Math.Round(temps.Max()!.Value, 1);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>The machine's name: a Raspberry Pi's board, else the processor's.</summary>
    private static string Model()
    {
        var board = ReadText("/sys/firmware/devicetree/base/model") ?? ReadText("/proc/device-tree/model");
        if (!string.IsNullOrWhiteSpace(board)) return board.TrimEnd('\0');
        var cpu = (ReadText("/proc/cpuinfo") ?? "").Split('\n')
            .FirstOrDefault(l => l.StartsWith("model name") || l.StartsWith("Model"));
        return cpu?.Split(':', 2).ElementAtOrDefault(1)?.Trim() ?? "";
    }

    /// <summary>
    /// The disks the server keeps data on: the system disk and, when it is another one, the backups
    /// disk. Only their size and free space, named by role, never by path.
    /// </summary>
    private List<SystemDiskDto> Disks()
    {
        var list = new List<SystemDiskDto>();
        void Add(string role, string? path)
        {
            if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) return;
            try
            {
                var d = new DriveInfo(path);
                if (!d.IsReady || d.TotalSize <= 0) return;
                if (list.Any(x => x.Total == d.TotalSize && Math.Abs(x.Free - d.AvailableFreeSpace) < 64L * 1024 * 1024)) return;
                list.Add(new SystemDiskDto(role, d.TotalSize, d.AvailableFreeSpace));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
            {
            }
        }
        Add("system", "/");
        Add("backups", _config["Backup:Folder"]);
        return list;
    }

    // ------------------------------------------------------------------ database, assistant, backups

    private async Task<SystemDatabaseDto> DatabaseAsync(CancellationToken ct)
    {
        var conn = _db.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            async Task<T?> Scalar<T>(string sql)
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                var v = await cmd.ExecuteScalarAsync(ct);
                return v is null or DBNull ? default : (T)Convert.ChangeType(v, typeof(T), CultureInfo.InvariantCulture);
            }
            var size = await Scalar<long>("SELECT pg_database_size(current_database())");
            var connections = await Scalar<long>("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()");
            var version = await Scalar<string>("SHOW server_version") ?? "";
            return new SystemDatabaseDto(size, (int)connections, version.Split(' ')[0]);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private async Task<SystemAssistantDto> AssistantAsync(CancellationToken ct)
    {
        var status = await _assistant.StatusAsync(ct);
        var speech = await _assistant.SpeechReadyAsync(ct);
        var models = new List<SystemModelDto>();
        if (status.Reachable)
        {
            var endpoint = (_config["Assistant:Endpoint"] ?? "http://127.0.0.1:11434").TrimEnd('/');
            var http = _http.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(4);
            try
            {
                // Models in memory now (Ollama unloads one a while after its last use) and their size there.
                var memory = new Dictionary<string, long>();
                try
                {
                    var ps = await http.GetFromJsonAsync<JsonObject>($"{endpoint}/api/ps", ct);
                    foreach (var m in ps?["models"]?.AsArray() ?? new JsonArray())
                        memory[m?["name"]?.GetValue<string>() ?? ""] = m?["size"]?.GetValue<long>() ?? 0;
                }
                catch (HttpRequestException)
                {
                }
                var tags = await http.GetFromJsonAsync<JsonObject>($"{endpoint}/api/tags", ct);
                foreach (var m in tags?["models"]?.AsArray() ?? new JsonArray())
                {
                    var name = m?["name"]?.GetValue<string>() ?? "";
                    models.Add(new SystemModelDto(name, m?["size"]?.GetValue<long>() ?? 0,
                        memory.ContainsKey(name), memory.GetValueOrDefault(name)));
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or InvalidOperationException)
            {
            }
        }
        return new SystemAssistantDto(status.Enabled, status.Reachable, status.ChatReady, status.VisionReady, speech, models);
    }

    private SystemBackupsDto Backups()
    {
        var folder = _config["Backup:Folder"];
        if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return new SystemBackupsDto(0, 0, null);
        try
        {
            var files = new DirectoryInfo(folder).GetFiles("*", SearchOption.TopDirectoryOnly);
            return new SystemBackupsDto(files.Length, files.Sum(f => f.Length),
                files.Length == 0 ? null : files.Max(f => f.LastWriteTimeUtc));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new SystemBackupsDto(0, 0, null);
        }
    }
}
