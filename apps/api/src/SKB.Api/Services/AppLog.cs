using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace SKB.Api.Services;

/// <summary>
/// One line of the server's log (owner, 2026-11-12: logs for debugging, seen in the app). Kept as one
/// JSON object per line, so a value typed by a person can never start a line of its own.
/// </summary>
public sealed class LogLine
{
    [JsonPropertyName("t")] public DateTime Time { get; set; }
    /// <summary>debug, info, warning or error.</summary>
    [JsonPropertyName("l")] public string Level { get; set; } = "info";
    /// <summary>server, or client for an error a person's app reported.</summary>
    [JsonPropertyName("s")] public string Source { get; set; } = "server";
    [JsonPropertyName("c")] public string? Category { get; set; }
    [JsonPropertyName("m")] public string Message { get; set; } = "";
    /// <summary>The exception with its stack trace.</summary>
    [JsonPropertyName("x")] public string? Exception { get; set; }
    [JsonPropertyName("rid")] public string? RequestId { get; set; }
    [JsonPropertyName("method")] public string? Method { get; set; }
    [JsonPropertyName("path")] public string? Path { get; set; }
    [JsonPropertyName("status")] public int? Status { get; set; }
    [JsonPropertyName("ms")] public long? Ms { get; set; }
    [JsonPropertyName("uid")] public string? UserId { get; set; }
    [JsonPropertyName("user")] public string? User { get; set; }
    [JsonPropertyName("branch")] public string? Branch { get; set; }
    /// <summary>A client error: the page it happened on, the app's version and the browser.</summary>
    [JsonPropertyName("route")] public string? Route { get; set; }
    [JsonPropertyName("ver")] public string? Version { get; set; }
    [JsonPropertyName("ua")] public string? UserAgent { get; set; }
}

/// <summary>
/// What never reaches the log: secrets (passwords, tokens, keys, connection strings), control
/// characters a person could use to forge a line, and the server's folders in a stack trace.
/// </summary>
public static partial class LogScrub
{
    private const string Hidden = "***";

    /// <summary>Names whose value is a secret, wherever they appear (a query string, a message).</summary>
    private const string SecretName =
        "password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|licen[sc]e|signature|credential|otp|pin";

    [GeneratedRegex(@"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*")]
    private static partial Regex Jwt();

    [GeneratedRegex(@"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", RegexOptions.IgnoreCase)]
    private static partial Regex AuthScheme();

    [GeneratedRegex(@"\b(?:Host|Server|Data Source)\s*=\s*[^;\s""']+(?:\s*;\s*[A-Za-z ]+=[^;""'\r\n]*)*;?", RegexOptions.IgnoreCase)]
    private static partial Regex ConnectionString();

    [GeneratedRegex(@"([\w.-]*(?:" + SecretName + @")[\w.-]*)(""?\s*[=:]\s*""?)([^\s&;,""']+)", RegexOptions.IgnoreCase)]
    private static partial Regex SecretPair();

    [GeneratedRegex(SecretName + "|email|phone|mobile|name|search|query|text|note|address|^q$", RegexOptions.IgnoreCase)]
    private static partial Regex PrivateKey();

    [GeneratedRegex(@"^[A-Za-z0-9_.:,\-]{0,64}$")]
    private static partial Regex PlainValue();

    [GeneratedRegex(@" in (?:[^\r\n]*[/\\])?([^/\\\r\n:]+):line (\d+)")]
    private static partial Regex SourcePath();

    /// <summary>
    /// A value without control or direction-changing characters, cut to a length. Line breaks stay
    /// only where asked (a stack trace), else they become spaces: nothing typed can forge a line.
    /// </summary>
    public static string Clean(string? value, int max, bool keepLines = false)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var sb = new StringBuilder(Math.Min(value.Length, max));
        foreach (var ch in value)
        {
            if (sb.Length >= max) { sb.Append('…'); break; }
            if (ch == '\n' && keepLines) sb.Append('\n');
            else if (ch is '\n' or '\t' or (char)0x2028 or (char)0x2029) sb.Append(' ');
            else if (ch == '\r') { if (!keepLines) sb.Append(' '); }
            else if (char.IsControl(ch) || ch is >= (char)0x202A and <= (char)0x202E or >= (char)0x2066 and <= (char)0x2069 or (char)0xFEFF) continue;
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>Tokens, passwords, keys and connection strings replaced, whatever text they sit in.</summary>
    public static string Secrets(string value)
    {
        if (value.Length == 0) return value;
        value = Jwt().Replace(value, "[token]");
        value = AuthScheme().Replace(value, "$1 [token]");
        value = ConnectionString().Replace(value, "[connection]");
        return SecretPair().Replace(value, "$1$2" + Hidden);
    }

    /// <summary>A message as it is logged: one line, no secrets.</summary>
    public static string Message(string? value, int max = 2000) => Secrets(Clean(value, max));

    /// <summary>An exception as it is logged: its lines kept, no secrets, source files without their folders.</summary>
    public static string Stack(string? value, int max = 12000) =>
        SourcePath().Replace(Secrets(Clean(value, max, keepLines: true)), " in $1:line $2");

    /// <summary>
    /// A query string as it is logged: the names, and a value only when it is plainly an id, a number,
    /// a date or a word; anything secret, personal or typed freely is hidden.
    /// </summary>
    public static string Query(IQueryCollection query)
    {
        if (query.Count == 0) return "";
        var sb = new StringBuilder("?");
        foreach (var (key, values) in query)
        {
            if (sb.Length > 300) { sb.Append('…'); break; }
            if (sb.Length > 1) sb.Append('&');
            var name = Clean(key, 40);
            var value = values.Count == 1 ? values[0] ?? "" : Hidden;
            sb.Append(name).Append('=')
                .Append(value.Length == 0 ? "" : PrivateKey().IsMatch(name) || !PlainValue().IsMatch(value) ? Hidden : value);
        }
        return sb.ToString();
    }

    /// <summary>An email for a failed sign-in: enough to know the account, not the whole address.</summary>
    public static string Email(string? email)
    {
        var e = Clean(email, 120).Trim();
        var at = e.IndexOf('@');
        if (at <= 0) return e.Length <= 2 ? Hidden : e[..2] + Hidden;
        return e[..Math.Min(2, at)] + Hidden + e[at..];
    }
}

/// <summary>What the log viewer asks for.</summary>
public sealed record LogFilter(string? Level, string? Source, string? Text, string? RequestId)
{
    public static int Rank(string? level) => level switch { "debug" => 0, "info" => 1, "warning" => 2, "error" => 3, _ => 1 };

    public bool Matches(LogLine l)
    {
        if (Level is not null && Rank(l.Level) < Rank(Level)) return false;
        if (Source is not null && !string.Equals(l.Source, Source, StringComparison.Ordinal)) return false;
        if (RequestId is not null && !string.Equals(l.RequestId, RequestId, StringComparison.OrdinalIgnoreCase)) return false;
        if (Text is null) return true;
        return Has(l.Message) || Has(l.Category) || Has(l.Exception) || Has(l.Path) || Has(l.User) || Has(l.Route) || Has(l.RequestId);
    }

    private bool Has(string? s) => s is not null && s.Contains(Text!, StringComparison.OrdinalIgnoreCase);
}

/// <summary>A page of a day's log, newest first. <c>Older</c> continues it; <c>End</c> asks for what came after.</summary>
public sealed record LogPage(IReadOnlyList<(long Id, LogLine Line)> Entries, long? Older, long End);

/// <summary>
/// The server's log files (owner, 2026-11-12): one file per company day in <c>Logs:Folder</c>
/// (<c>logs</c> beside the app by default), each up to <c>Logs:MaxDayMb</c>, kept <c>Logs:KeepDays</c>
/// days, readable by the service's user alone. Written by one background thread, so logging never
/// waits on the disk. The viewer reads a day by its date only: no name or path ever comes from a client.
/// </summary>
public sealed class LogStore : IDisposable
{
    private const string Prefix = "evolvix-";
    private const int Chunk = 256 * 1024;
    private static readonly JsonSerializerOptions Json = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // Arabic stays readable; quotes and control characters are still escaped
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string? _folder;
    private readonly long _maxDayBytes;
    private readonly int _keepDays;
    private readonly BlockingCollection<LogLine> _queue = new(8192);
    private readonly Thread? _writer;
    private FileStream? _file;
    private DateOnly _day;
    private long _bytes;
    private bool _capped;
    private volatile bool _broken;

    /// <summary>A request slower than this is logged as a warning (<c>Logs:SlowMs</c>).</summary>
    public int SlowMs { get; }
    /// <summary>The least level kept: debug, info, warning or error (<c>Logs:Level</c>).</summary>
    public LogLevel MinLevel { get; }
    /// <summary>False when logging to files is off (<c>Logs:Enabled=false</c>) or the folder can't be written.</summary>
    public bool Enabled => _folder is not null && !_broken;

    public LogStore(IConfiguration config)
    {
        SlowMs = Math.Max(1, config.GetValue("Logs:SlowMs", 3000));
        MinLevel = Enum.TryParse<LogLevel>(config["Logs:Level"], true, out var lvl) ? lvl : LogLevel.Information;
        _maxDayBytes = Math.Clamp(config.GetValue("Logs:MaxDayMb", 50), 1, 2000) * 1024L * 1024L;
        _keepDays = Math.Clamp(config.GetValue("Logs:KeepDays", 30), 1, 3650);
        if (!config.GetValue("Logs:Enabled", true)) return;
        var folder = config["Logs:Folder"] is { Length: > 0 } f ? f : Path.Combine(AppContext.BaseDirectory, "logs");
        try
        {
            if (OperatingSystem.IsWindows()) Directory.CreateDirectory(folder);
            else
            {
                Directory.CreateDirectory(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                // A folder that was already there: closed to everyone but the service's user.
                File.SetUnixFileMode(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
        {
            return;
        }
        _folder = folder;
        _writer = new Thread(WriteLoop) { IsBackground = true, Name = "log-writer" };
        _writer.Start();
    }

    private string PathOf(DateOnly day) =>
        Path.Combine(_folder!, Prefix + day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".log");

    private static DateOnly? DayOfFile(string path)
    {
        var name = Path.GetFileName(path);
        if (!name.StartsWith(Prefix, StringComparison.Ordinal) || !name.EndsWith(".log", StringComparison.Ordinal)) return null;
        return DateOnly.TryParseExact(name.AsSpan(Prefix.Length, name.Length - Prefix.Length - 4), "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    }

    /// <summary>Queue a line; dropped rather than waited for when the disk can't keep up.</summary>
    public void Write(LogLine line)
    {
        if (!Enabled || _queue.IsAddingCompleted) return;
        try { _queue.TryAdd(line); }
        catch (InvalidOperationException) { /* shutting down */ }
    }

    private void WriteLoop()
    {
        foreach (var line in _queue.GetConsumingEnumerable())
        {
            try
            {
                Append(line);
                if (_queue.Count == 0) _file?.Flush();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                // The disk is full or the folder was taken away: stop, the app carries on.
                _broken = true;
                try { _file?.Dispose(); } catch (IOException) { }
                _file = null;
                return;
            }
        }
        _file?.Dispose();
    }

    private void Append(LogLine line)
    {
        var day = CompanyClock.DayOf(line.Time);
        if (_file is null || day != _day)
        {
            _file?.Dispose();
            var options = new FileStreamOptions
            {
                Mode = FileMode.Append, Access = FileAccess.Write, Share = FileShare.Read | FileShare.Delete, BufferSize = 64 * 1024,
            };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            _file = new FileStream(PathOf(day), options);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(_file.SafeFileHandle, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            _day = day;
            _bytes = _file.Length;
            _capped = _bytes > _maxDayBytes;
            Prune(day);
        }
        // A day that filled up keeps only warnings and errors, and nothing at all past twice the size.
        if (_bytes > _maxDayBytes)
        {
            if (!_capped)
            {
                _capped = true;
                Put(new LogLine
                {
                    Time = line.Time, Level = "warning", Category = "Logs",
                    Message = "The day's log reached its size limit; only warnings and errors are kept from here.",
                });
            }
            if (LogFilter.Rank(line.Level) < 2 || _bytes > _maxDayBytes * 2) return;
        }
        Put(line);
    }

    private void Put(LogLine line)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(line, Json);
        _file!.Write(bytes);
        _file.WriteByte((byte)'\n');
        _bytes += bytes.Length + 1;
    }

    /// <summary>Removes days older than the keep period. Only this app's own log files are touched.</summary>
    private void Prune(DateOnly today)
    {
        try
        {
            foreach (var path in Directory.EnumerateFiles(_folder!, Prefix + "*.log"))
                if (DayOfFile(path) is { } d && d < today.AddDays(-_keepDays + 1)) File.Delete(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>The days that have a log, newest first.</summary>
    public IReadOnlyList<DateOnly> Days()
    {
        if (_folder is null) return Array.Empty<DateOnly>();
        try
        {
            return Directory.EnumerateFiles(_folder, Prefix + "*.log").Select(DayOfFile).OfType<DateOnly>()
                .OrderByDescending(d => d).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return Array.Empty<DateOnly>();
        }
    }

    private FileStream? Open(DateOnly day)
    {
        if (_folder is null) return null;
        try
        {
            var path = PathOf(day);
            return File.Exists(path)
                ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, Chunk)
                : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static LogLine? Parse(ReadOnlySpan<byte> json)
    {
        if (json.Length < 2) return null;
        try { return JsonSerializer.Deserialize<LogLine>(json, Json); }
        catch (JsonException) { return null; }
    }

    /// <summary>
    /// A page of a day, newest first: the newest lines, the ones before <paramref name="before"/>
    /// (a page's <c>Older</c>), or everything written after <paramref name="after"/> (a page's <c>End</c>).
    /// </summary>
    public LogPage Read(DateOnly day, LogFilter filter, long? before, long? after, int limit)
    {
        var found = new List<(long, LogLine)>();
        using var fs = Open(day);
        if (fs is null) return new LogPage(found, null, 0);
        var length = fs.Length;

        if (after is { } from)
        {
            // What came since: forward from where the last page ended, whole lines only.
            from = Math.Clamp(from, 0, length);
            fs.Position = from;
            var end = from;
            var buf = new byte[Chunk];
            var carry = new MemoryStream();
            var lineStart = from;
            int n;
            while ((n = fs.Read(buf, 0, buf.Length)) > 0)
            {
                var start = 0;
                for (var i = 0; i < n; i++)
                {
                    if (buf[i] != (byte)'\n') continue;
                    carry.Write(buf, start, i - start);
                    var size = carry.Length;
                    if (Parse(carry.GetBuffer().AsSpan(0, (int)size)) is { } l && filter.Matches(l)) found.Add((lineStart, l));
                    carry.SetLength(0);
                    lineStart += size + 1;
                    end = lineStart;
                    start = i + 1;
                }
                carry.Write(buf, start, n - start);
                if (carry.Length > 4 * Chunk) break; // not a log line
            }
            found.Reverse();
            if (found.Count > limit) found.RemoveRange(limit, found.Count - limit);
            return new LogPage(found, null, end);
        }

        // Backwards from the end (or from an earlier page's last line), a chunk at a time.
        var pos = Math.Clamp(before ?? length, 0, length);
        long? older = null;
        long tail = -1;
        var rest = Array.Empty<byte>(); // the start of a line whose beginning lies in the chunk before
        while (pos > 0 && older is null)
        {
            var n = (int)Math.Min(Chunk, pos);
            pos -= n;
            var block = new byte[n + rest.Length];
            fs.Position = pos;
            fs.ReadExactly(block, 0, n);
            rest.CopyTo(block, n);
            var first = pos == 0 ? 0 : Array.IndexOf(block, (byte)'\n') + 1;
            if (first == 0 && pos > 0) { rest = block; if (rest.Length > 4 * Chunk) break; continue; }
            // Lines end with a line break; what follows the last one is still being written.
            var lineEnd = Array.LastIndexOf(block, (byte)'\n');
            if (tail < 0) tail = lineEnd < 0 ? pos : pos + lineEnd + 1;
            while (lineEnd >= first)
            {
                var lineStart = lineEnd == 0 ? 0 : Array.LastIndexOf(block, (byte)'\n', lineEnd - 1) + 1;
                if (lineStart < first) lineStart = first;
                if (Parse(block.AsSpan(lineStart, lineEnd - lineStart)) is { } l && filter.Matches(l))
                {
                    found.Add((pos + lineStart, l));
                    if (found.Count >= limit)
                    {
                        if (pos + lineStart > 0) older = pos + lineStart;
                        break;
                    }
                }
                lineEnd = lineStart - 1;
            }
            rest = block[..first];
        }
        return new LogPage(found, older, tail < 0 ? Math.Clamp(before ?? length, 0, length) : tail);
    }

    /// <summary>The whole day as plain text, oldest first: what the owner downloads.</summary>
    public async Task<bool> WriteTextAsync(DateOnly day, Stream output, CancellationToken ct)
    {
        await using var fs = Open(day);
        if (fs is null) return false;
        using var reader = new StreamReader(fs, Encoding.UTF8);
        await using var writer = new StreamWriter(output, new UTF8Encoding(false), 64 * 1024, leaveOpen: true);
        while (await reader.ReadLineAsync(ct) is { } raw)
        {
            if (Parse(Encoding.UTF8.GetBytes(raw)) is not { } l) continue;
            var sb = new StringBuilder(256);
            sb.Append(l.Time.ToString("yyyy-MM-dd HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)).Append(' ')
                .Append(l.Level.ToUpperInvariant().PadRight(7)).Append(' ').Append(l.Source);
            if (l.RequestId is not null) sb.Append(" [").Append(l.RequestId).Append(']');
            if (l.Category is not null) sb.Append(' ').Append(l.Category).Append(':');
            sb.Append(' ').Append(l.Message.ReplaceLineEndings(" "));
            if (l.User is not null) sb.Append(" | user ").Append(l.User.ReplaceLineEndings(" "));
            if (l.Route is not null) sb.Append(" | page ").Append(l.Route.ReplaceLineEndings(" "));
            if (l.Version is not null) sb.Append(" | version ").Append(l.Version.ReplaceLineEndings(" "));
            if (l.UserAgent is not null) sb.Append(" | ").Append(l.UserAgent.ReplaceLineEndings(" "));
            sb.Append('\n');
            // A stack trace's lines are indented, so none of them can pass for a line of the log.
            if (l.Exception is not null)
                foreach (var part in l.Exception.Split('\n'))
                    sb.Append("    ").Append(part.TrimEnd('\r')).Append('\n');
            await writer.WriteAsync(sb, ct);
        }
        await writer.FlushAsync(ct);
        return true;
    }

    public void Dispose()
    {
        _queue.CompleteAdding();
        _writer?.Join(TimeSpan.FromSeconds(3));
    }
}

/// <summary>The <see cref="ILogger"/> side: everything the server logs goes to the day's file, scrubbed.</summary>
[ProviderAlias("File")]
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly LogStore _store;
    private readonly ConcurrentDictionary<string, FileLogger> _loggers = new();

    public FileLoggerProvider(LogStore store) => _store = store;

    public ILogger CreateLogger(string categoryName) => _loggers.GetOrAdd(categoryName, c => new FileLogger(c, _store));

    public void Dispose() { }

    private sealed class FileLogger : ILogger
    {
        private readonly string _category;
        private readonly LogStore _store;

        public FileLogger(string category, LogStore store)
        {
            // "SKB.Api.Services.BackupScheduler" reads as "BackupScheduler".
            _category = category.StartsWith("SKB.Api.", StringComparison.Ordinal) ? category[(category.LastIndexOf('.') + 1)..] : category;
            _store = store;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None && _store.Enabled;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            _store.Write(new LogLine
            {
                Time = DateTime.UtcNow,
                Level = LevelName(logLevel),
                Category = LogScrub.Clean(_category, 100),
                Message = LogScrub.Message(formatter(state, exception)),
                Exception = exception is null ? null : LogScrub.Stack(exception.ToString()),
                RequestId = RequestLog.Current?.Id,
            });
        }
    }

    public static string LevelName(LogLevel level) => level switch
    {
        LogLevel.Trace or LogLevel.Debug => "debug",
        LogLevel.Information => "info",
        LogLevel.Warning => "warning",
        _ => "error",
    };
}
