using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// AI translation settings (section "Translation"). The key lives only in server configuration
/// (e.g. env var <c>Translation__ApiKey</c>); it never reaches a browser. Any OpenAI-compatible
/// chat-completions service works; the default is CodeCraft (codecraftapi.com).
/// </summary>
public sealed class TranslationOptions
{
    public string BaseUrl { get; set; } = "https://codecraftapi.com/v1";
    public string? ApiKey { get; set; }
    /// <summary>Model id; empty = pick one from the service's /models list.</summary>
    public string? Model { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>How often to look for untranslated names when nothing wakes the worker.</summary>
    public int PollSeconds { get; set; } = 60;
    public int BatchSize { get; set; } = 25;
}

/// <summary>Wakes the translation worker right after a name is saved, so translations arrive in seconds.</summary>
public sealed class TranslationQueue
{
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Notify()
    {
        try { _signal.Release(); } catch (SemaphoreFullException) { /* already signalled */ }
    }

    public async Task WaitAsync(TimeSpan timeout, CancellationToken ct)
    {
        try { await _signal.WaitAsync(timeout, ct); } catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
    }
}

/// <summary>What the Settings screen shows about translation.</summary>
public sealed class TranslationStatus
{
    public string? LastError { get; private set; }
    public DateTime? LastSuccessAt { get; private set; }
    public void Succeeded() { LastError = null; LastSuccessAt = DateTime.UtcNow; }
    public void Failed(string error) => LastError = error;
}

/// <summary>Calls an OpenAI-compatible chat-completions API to translate short business names.</summary>
public sealed class AiTranslator
{
    private const string SystemPrompt =
        "You translate short names used in an Egyptian wholesale business app (branches, warehouses, " +
        "product categories and products) between Arabic and English. Translate the meaning naturally, " +
        "the way a local business would write it. Arabic: Modern Standard Arabic, no diacritics. Keep " +
        "brand names, model numbers, sizes, units and numbers as they are (e.g. 1.5L, 330ml, 25g). " +
        "Never add notes. Reply with JSON only: {\"items\": [\"...\"]} — exactly one translation per " +
        "input item, in the same order.";

    private readonly HttpClient _http;
    private readonly TranslationOptions _options;
    private static string? _model; // discovered once per process

    public AiTranslator(HttpClient http, Microsoft.Extensions.Options.IOptions<TranslationOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    public bool IsConfigured => _options.Enabled && !string.IsNullOrWhiteSpace(_options.ApiKey);

    /// <summary>Translate <paramref name="texts"/> from one language to the other ("ar"/"en").</summary>
    public async Task<string[]> TranslateAsync(string kind, string from, string to, IReadOnlyList<string> texts,
        CancellationToken ct)
    {
        var model = await ModelAsync(ct);
        var user = JsonSerializer.Serialize(new
        {
            from = from == "ar" ? "Arabic" : "English",
            to = to == "ar" ? "Arabic" : "English",
            kind,
            items = texts,
        });
        var body = JsonSerializer.Serialize(new
        {
            model,
            temperature = 0.2,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = SystemPrompt },
                new { role = "user", content = user },
            },
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/chat/completions")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        using var response = await _http.SendAsync(request, ct);
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Translation service answered {(int)response.StatusCode}.");

        using var doc = JsonDocument.Parse(json);
        var content = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
        // Some models wrap JSON in prose or code fences: take the outermost object.
        var start = content.IndexOf('{');
        var end = content.LastIndexOf('}');
        if (start < 0 || end <= start) throw new InvalidOperationException("Translation reply was not JSON.");
        using var reply = JsonDocument.Parse(content[start..(end + 1)]);
        var items = reply.RootElement.GetProperty("items").EnumerateArray()
            .Select(e => (e.GetString() ?? "").Trim()).ToArray();
        if (items.Length != texts.Count || items.Any(string.IsNullOrEmpty))
            throw new InvalidOperationException("Translation reply had the wrong number of items.");
        return items.Select(i => i[..Math.Min(200, i.Length)]).ToArray();
    }

    /// <summary>The configured model, or the first cheap-looking one the service lists.</summary>
    private async Task<string> ModelAsync(CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(_options.Model)) return _options.Model!;
        if (_model is not null) return _model;

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/models");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        using var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Model list answered {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var ids = doc.RootElement.GetProperty("data").EnumerateArray()
            .Select(m => m.GetProperty("id").GetString() ?? "").Where(id => id.Length > 0).ToList();
        if (ids.Count == 0) throw new InvalidOperationException("The translation service lists no models.");
        string[] preferred = { "mini", "flash", "haiku", "turbo", "qwen", "deepseek", "gemma" };
        _model = preferred.Select(p => ids.FirstOrDefault(id => id.Contains(p, StringComparison.OrdinalIgnoreCase)))
            .FirstOrDefault(id => id is not null) ?? ids[0];
        return _model;
    }
}

/// <summary>
/// Background worker: finds names whose other language is still waiting (NamePending) and fills it
/// with an AI translation. When the service or the internet is unreachable — e.g. the company
/// server running offline — nothing is lost: names stay pending (both languages show the typed
/// text) and the worker retries with growing waits until it gets through.
/// </summary>
public sealed class TranslationWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly TranslationQueue _queue;
    private readonly TranslationStatus _status;
    private readonly TranslationOptions _options;
    private readonly ILogger<TranslationWorker> _log;

    public TranslationWorker(IServiceScopeFactory scopes, TranslationQueue queue, TranslationStatus status,
        Microsoft.Extensions.Options.IOptions<TranslationOptions> options, ILogger<TranslationWorker> log)
    {
        _scopes = scopes;
        _queue = queue;
        _status = status;
        _options = options.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var poll = TimeSpan.FromSeconds(Math.Max(5, _options.PollSeconds));
        var wait = TimeSpan.FromSeconds(2);
        var failures = 0;
        while (!ct.IsCancellationRequested)
        {
            await _queue.WaitAsync(wait, ct);
            if (ct.IsCancellationRequested) break;
            try
            {
                using var scope = _scopes.CreateScope();
                var translator = scope.ServiceProvider.GetRequiredService<AiTranslator>();
                if (!translator.IsConfigured)
                {
                    wait = poll;
                    continue;
                }
                var done = await RunOnceAsync(scope.ServiceProvider, translator, ct);
                if (done > 0) _status.Succeeded();
                failures = 0;
                wait = done > 0 ? TimeSpan.FromMilliseconds(200) : poll;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                failures++;
                _status.Failed(ex.Message);
                wait = TimeSpan.FromSeconds(Math.Min(300, 5 * Math.Pow(2, Math.Min(failures, 6))));
                _log.LogWarning("Translation paused ({Error}); retrying in {Seconds}s.", ex.Message, (int)wait.TotalSeconds);
            }
        }
    }

    /// <summary>Translate one batch of each kind of name. Returns how many names were filled.</summary>
    private async Task<int> RunOnceAsync(IServiceProvider services, AiTranslator translator, CancellationToken ct)
    {
        var db = services.GetRequiredService<AppDbContext>();
        var done = 0;
        done += await ProcessAsync(db, db.Branches, "branch name", translator, ct);
        done += await ProcessAsync(db, db.Warehouses, "warehouse name", translator, ct);
        done += await ProcessAsync(db, db.Categories, "product category", translator, ct);
        done += await ProcessAsync(db, db.Products, "product name", translator, ct);
        return done;
    }

    private async Task<int> ProcessAsync<T>(AppDbContext db, DbSet<T> set, string kind, AiTranslator translator,
        CancellationToken ct) where T : class, ILocalizedName
    {
        var pending = await set.AsNoTracking().Where(e => e.NamePending).Take(_options.BatchSize).ToListAsync(ct);
        var done = 0;
        foreach (var group in pending.GroupBy(e => e.NameSource == "ar" ? "ar" : "en"))
        {
            var from = group.Key;
            var to = from == "ar" ? "en" : "ar";
            var rows = group.Select(e => (Entity: e, Text: from == "ar" ? e.NameAr ?? e.Name : e.NameEn ?? e.Name))
                .Where(r => !string.IsNullOrWhiteSpace(r.Text)).ToList();
            if (rows.Count == 0) continue;

            var translated = await translator.TranslateAsync(kind, from, to, rows.Select(r => r.Text).ToList(), ct);

            // Apply only where nothing changed meanwhile (someone may have edited the name).
            for (var i = 0; i < rows.Count; i++)
            {
                var entity = await set.FindAsync(new object[] { GetId(rows[i].Entity) }, ct);
                if (entity is null || !entity.NamePending) continue;
                var current = from == "ar" ? entity.NameAr ?? entity.Name : entity.NameEn ?? entity.Name;
                if (current != rows[i].Text || (entity.NameSource == "ar" ? "ar" : "en") != from) continue;

                if (to == "ar") entity.NameAr = translated[i]; else entity.NameEn = translated[i];
                entity.NameAuto = to;
                entity.NamePending = false;
                done++;
            }
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        // Pending rows with nothing to translate: settle them so they don't loop forever.
        foreach (var e in pending.Where(e => string.IsNullOrWhiteSpace(e.NameSource == "ar" ? e.NameAr ?? e.Name : e.NameEn ?? e.Name)))
        {
            var entity = await set.FindAsync(new object[] { GetId(e) }, ct);
            if (entity is not null) entity.NamePending = false;
        }
        await db.SaveChangesAsync(ct);
        return done;
    }

    private static Guid GetId(ILocalizedName e) => e switch
    {
        Branch b => b.Id,
        Warehouse w => w.Id,
        Category c => c.Id,
        Product p => p.Id,
        _ => throw new ArgumentOutOfRangeException(nameof(e)),
    };
}
