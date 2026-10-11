using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// The server's load for the owner's monitor (owner, 2026-10-10): the machine's processor, memory,
/// disk, temperature and uptime, each part of the server (the app, the database, the assistant, its
/// hearing and its voice) and the assistant's models. Only figures: no file names, paths, settings or
/// commands ever leave the server, and nothing can be changed.
/// <para>
/// Any server (owner, 2026-10-11: "not only the Pi"): on Linux (a Raspberry Pi, a PC, a cloud server;
/// in the app's container /proc and /sys show the whole machine) and on Windows when the app runs
/// there directly. Each part's share is read from the machine's control groups, mounted read-only
/// into the app's container (<c>System:Cgroups</c>, /host/cgroup): docker-compose.yml puts each
/// service in its own group, <c>evolvix-&lt;part&gt;.slice</c>. Counters only, no processes.
/// </para>
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

    /// <summary>The server's parts, each in its own control group (see docker-compose.yml).</summary>
    public static readonly string[] Parts = { "app", "db", "assistant", "speech", "voice" };

    public async Task<SystemMonitorDto> ReadAsync(CancellationToken ct)
    {
        // The processor's use over a short moment, the machine's and each part's over the same one.
        var me = Process.GetCurrentProcess();
        var cpuBefore = CpuTimes();
        var partsBefore = Parts.ToDictionary(p => p, PartCpuMicros);
        var appBefore = me.TotalProcessorTime;
        var clock = Stopwatch.StartNew();
        await Task.Delay(400, ct);
        var cpuAfter = CpuTimes();
        var partsAfter = Parts.ToDictionary(p => p, PartCpuMicros);
        me.Refresh();
        var appCpu = me.TotalProcessorTime - appBefore;
        var elapsedMicros = clock.Elapsed.TotalMicroseconds;
        var cores = Environment.ProcessorCount;
        double Share(double busyMicros) => Math.Round(Math.Clamp(100.0 * busyMicros / (elapsedMicros * cores), 0, 100), 1);

        var cpu = cpuBefore is { } a && cpuAfter is { } b && b.Total > a.Total
            ? Math.Round(100.0 * (b.Total - a.Total - (b.Idle - a.Idle)) / (b.Total - a.Total), 1)
            : 0;
        var (memTotal, memAvailable, swapTotal, swapFree) = Memory();

        var machine = new SystemMachineDto(
            Model(), Processor(), SystemName(), cores, cpu, Load(0), Load(1), Load(2),
            memTotal, memAvailable, swapTotal, swapFree, Temperature(), Uptime(), Disks());

        var app = new SystemAppDto(
            me.WorkingSet64, GC.GetTotalMemory(false), me.Threads.Count,
            (long)(DateTime.Now - me.StartTime).TotalSeconds, Releases.Current.Version);

        var assistant = await AssistantAsync(ct);
        var database = await DatabaseAsync(ct);

        // Each part: its group's figures when the machine's groups are there; otherwise what the part
        // itself tells (the app's own process, the models in memory, the voice's own figure).
        var services = new List<SystemServiceDto>();
        foreach (var part in Parts)
        {
            var group = PartGroup(part);
            double? partCpu = partsBefore[part] is { } before && partsAfter[part] is { } after
                ? Share(after - before)
                : part == "app" ? Share(appCpu.TotalMicroseconds) : null;
            var memory = group is null ? null : GroupMemory(group);
            memory ??= part switch
            {
                "app" => me.WorkingSet64,
                "assistant" when assistant.Models.Any(m => m.Loaded) => assistant.Models.Where(m => m.Loaded).Sum(m => m.MemoryBytes),
                "voice" when assistant.VoiceMemoryBytes > 0 => assistant.VoiceMemoryBytes,
                _ => null,
            };
            var running = group is not null
                ? GroupRunning(group)
                : part switch
                {
                    "app" or "db" => true,
                    "assistant" => assistant.Reachable,
                    "speech" => assistant.SpeechReady,
                    "voice" => assistant.VoiceReady,
                    _ => false,
                };
            if (!running && part is not ("app" or "db") && !assistant.Enabled) continue; // the assistant is turned off
            services.Add(new SystemServiceDto(part, running, running ? partCpu : null, running ? memory : null));
        }

        return new SystemMonitorDto(DateTime.UtcNow, machine, services, app, database, assistant, Backups());
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

    /// <summary>The processor's idle and total time so far (Linux /proc/stat, or Windows).</summary>
    private static (long Idle, long Total)? CpuTimes()
    {
        if (OperatingSystem.IsWindows())
            return Native.GetSystemTimes(out var idle, out var kernel, out var user)
                ? (idle, kernel + user) // kernel time includes idle time
                : null;
        var line = ReadText("/proc/stat")?.Split('\n').FirstOrDefault(l => l.StartsWith("cpu "));
        if (line is null) return null;
        var n = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1)
            .Select(x => long.TryParse(x, out var v) ? v : 0).ToArray();
        if (n.Length < 4) return null;
        return (n[3] + (n.Length > 4 ? n[4] : 0), n.Sum());
    }

    private static string[]? _load;

    private static double Load(int i)
    {
        if (i == 0) _load = ReadText("/proc/loadavg")?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return _load is { } l && l.Length > i && double.TryParse(l[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
    }

    private static long Uptime()
    {
        if (OperatingSystem.IsWindows()) return Environment.TickCount64 / 1000;
        return ReadText("/proc/uptime")?.Split(' ').FirstOrDefault() is { } up
               && double.TryParse(up, NumberStyles.Float, CultureInfo.InvariantCulture, out var secs) ? (long)secs : 0;
    }

    /// <summary>Memory and swap (total and free) in bytes.</summary>
    private static (long Total, long Available, long SwapTotal, long SwapFree) Memory()
    {
        if (OperatingSystem.IsWindows())
        {
            var m = new Native.MemoryStatus { Length = (uint)System.Runtime.InteropServices.Marshal.SizeOf<Native.MemoryStatus>() };
            if (!Native.GlobalMemoryStatusEx(ref m)) return (0, 0, 0, 0);
            var swap = Math.Max(0, (long)m.TotalPageFile - (long)m.TotalPhys);
            var swapFree = Math.Clamp((long)m.AvailPageFile - (long)m.AvailPhys, 0, swap);
            return ((long)m.TotalPhys, (long)m.AvailPhys, swap, swapFree);
        }
        var mem = MemInfo();
        return (mem.GetValueOrDefault("MemTotal"), mem.GetValueOrDefault("MemAvailable"),
            mem.GetValueOrDefault("SwapTotal"), mem.GetValueOrDefault("SwapFree"));
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

    /// <summary>
    /// The hottest of the machine's sensors, in °C: a Raspberry Pi's chip, a PC's processor (thermal
    /// zones, else the hardware monitors). Null where the machine shows none (Windows, most VMs).
    /// </summary>
    private static double? Temperature()
    {
        try
        {
            var readings = new List<string?>();
            if (Directory.Exists("/sys/class/thermal"))
                readings.AddRange(Directory.GetDirectories("/sys/class/thermal", "thermal_zone*")
                    .Select(d => ReadText(Path.Combine(d, "temp"))));
            if (readings.Count == 0 && Directory.Exists("/sys/class/hwmon"))
                readings.AddRange(Directory.GetDirectories("/sys/class/hwmon")
                    .SelectMany(d => Directory.GetFiles(d, "temp*_input")).Select(ReadText));
            var temps = readings
                .Select(t => long.TryParse(t, out var milli) ? milli / 1000.0 : (double?)null)
                .Where(t => t is > 0 and < 150).ToList();
            return temps.Count == 0 ? null : Math.Round(temps.Max()!.Value, 1);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>The machine: a Raspberry Pi's board, else the maker and model of a PC or server.</summary>
    private static string Model()
    {
        var board = ReadText("/sys/firmware/devicetree/base/model") ?? ReadText("/proc/device-tree/model");
        if (!string.IsNullOrWhiteSpace(board)) return board.TrimEnd('\0');
        var vendor = ReadText("/sys/class/dmi/id/sys_vendor");
        var product = ReadText("/sys/class/dmi/id/product_name");
        var name = string.Join(' ', new[] { vendor, product }.Where(x => !string.IsNullOrWhiteSpace(x)
            && !x!.Contains("To Be Filled", StringComparison.OrdinalIgnoreCase)
            && !x.Contains("System Product Name", StringComparison.OrdinalIgnoreCase)));
        return name.Length > 0 ? name : Environment.MachineName.Length > 0 && OperatingSystem.IsWindows() ? "Windows PC" : "";
    }

    /// <summary>The processor's name ("Cortex-A76", "Intel(R) Core(TM) i5-…").</summary>
    private static string Processor()
    {
        if (OperatingSystem.IsWindows())
            return (Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER") ?? "").Trim();
        var info = (ReadText("/proc/cpuinfo") ?? "").Split('\n');
        string? Field(string key) => info.FirstOrDefault(l => l.StartsWith(key, StringComparison.OrdinalIgnoreCase))
            ?.Split(':', 2).ElementAtOrDefault(1)?.Trim();
        var name = Field("model name") ?? Field("Hardware") ?? Field("cpu model");
        if (!string.IsNullOrEmpty(name)) return name;
        // ARM boards name the core by number (Raspberry Pi 5: 0xd0b, Cortex-A76).
        return Field("CPU part") switch
        {
            "0xd0b" => "ARM Cortex-A76",
            "0xd08" => "ARM Cortex-A72",
            "0xd03" => "ARM Cortex-A53",
            "0xd05" => "ARM Cortex-A55",
            "0xd0c" => "ARM Neoverse-N1",
            "0xd40" => "ARM Neoverse-V1",
            _ => System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        };
    }

    /// <summary>The machine's system: Linux with its kernel version, or the Windows version.</summary>
    private static string SystemName()
    {
        if (OperatingSystem.IsWindows()) return System.Runtime.InteropServices.RuntimeInformation.OSDescription;
        var kernel = ReadText("/proc/sys/kernel/osrelease");
        return kernel is null ? System.Runtime.InteropServices.RuntimeInformation.OSDescription : $"Linux {kernel}";
    }

    // ------------------------------------------------------------------ the server's parts

    /// <summary>Where the machine's control groups are mounted in the app's container (read-only).</summary>
    private string CgroupRoot => _config["System:Cgroups"] ?? "/host/cgroup";

    /// <summary>A part's group: evolvix.slice/evolvix-app.slice (systemd), or evolvix-app.slice.</summary>
    private string? PartGroup(string part)
    {
        foreach (var path in new[]
                 {
                     Path.Combine(CgroupRoot, "evolvix.slice", $"evolvix-{part}.slice"),
                     Path.Combine(CgroupRoot, $"evolvix-{part}.slice"),
                 })
            if (Directory.Exists(path)) return path;
        return null;
    }

    /// <summary>The processor time a part has used, in microseconds (cgroup v2 cpu.stat).</summary>
    private double? PartCpuMicros(string part)
    {
        var group = PartGroup(part);
        var line = group is null ? null : ReadText(Path.Combine(group, "cpu.stat"))?.Split('\n')
            .FirstOrDefault(l => l.StartsWith("usage_usec "));
        return line is not null && long.TryParse(line[11..].Trim(), out var micros) ? micros : null;
    }

    /// <summary>
    /// The memory a part uses, like "docker stats": its group's memory less the file cache it can give
    /// back. Null where the machine doesn't count memory per group (a Raspberry Pi until memory
    /// accounting is turned on: install-server.sh does it).
    /// </summary>
    private static long? GroupMemory(string group)
    {
        if (!long.TryParse(ReadText(Path.Combine(group, "memory.current")), out var current)) return null;
        var inactive = (ReadText(Path.Combine(group, "memory.stat")) ?? "").Split('\n')
            .FirstOrDefault(l => l.StartsWith("inactive_file "))?[14..].Trim();
        return Math.Max(0, current - (long.TryParse(inactive, out var cache) ? cache : 0));
    }

    /// <summary>Whether a part has a running container in its group.</summary>
    private static bool GroupRunning(string group)
    {
        try
        {
            return Directory.EnumerateDirectories(group).Any(d =>
                (ReadText(Path.Combine(d, "cgroup.procs")) is { Length: > 0 }) ||
                (ReadText(Path.Combine(d, "pids.current")) is { } pids && pids != "0"));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return false;
        }
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
        var voice = await _assistant.VoiceStatusAsync(ct);
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
        return new SystemAssistantDto(status.Enabled, status.Reachable, status.ChatReady, status.VisionReady, speech,
            voice.Languages.Length > 0, voice.MemoryBytes, models);
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

/// <summary>The machine's figures on Windows, where the app runs there without a container.</summary>
internal static class Native
{
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    internal struct MemoryStatus
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    internal static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

    /// <summary>Idle, kernel (idle included) and user time of all processors, in 100 ns.</summary>
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    internal static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
}
