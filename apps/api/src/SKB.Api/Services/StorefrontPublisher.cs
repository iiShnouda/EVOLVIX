using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// Keeps the public storefront in step with the shop, automatically and near-realtime (owner,
/// 2026-10-13: "update the products we add in realtime"). A change to an item or its photo marks it
/// dirty; a short debounce batches a burst, then the scrubbed catalogue and any changed photos are
/// pushed OUTWARD to the host (see <see cref="IStorefrontUploader"/>). A periodic pass also refreshes
/// in-stock / out-of-stock. The company server only pushes; nothing comes back in.
/// </summary>
public sealed class StorefrontPublisher : BackgroundService
{
    private static readonly TimeSpan Poll = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan Debounce = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan Refresh = TimeSpan.FromMinutes(3);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IServiceProvider _sp;
    private readonly IStorefrontUploader _uploader;
    private readonly ILogger<StorefrontPublisher> _log;
    private readonly ConcurrentDictionary<Guid, DateTime> _publishedImages = new();
    private volatile bool _dirty;

    public StorefrontPublisher(IServiceProvider sp, IStorefrontUploader uploader, ILogger<StorefrontPublisher> log)
    {
        _sp = sp;
        _uploader = uploader;
        _log = log;
        Status = new StatusView(uploader.Enabled, uploader.PublicBaseUrl, null, 0, 0, null);
    }

    public sealed record StatusView(bool Enabled, string? PublicBaseUrl, DateTime? LastPublishedAt,
        int ItemCount, int LastPushedFiles, string? Error);

    public StatusView Status { get; private set; }

    /// <summary>A product or its photo changed: publish again soon.</summary>
    public void MarkDirty() => _dirty = true;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!_uploader.Enabled) return;
        try { await PublishAsync(ct); } catch (Exception e) { Note(e); } // make the site current at startup
        var lastRefresh = DateTime.UtcNow;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Poll, ct);
                var due = DateTime.UtcNow - lastRefresh >= Refresh;
                if (!_dirty && !due) continue;
                if (_dirty) await Task.Delay(Debounce, ct); // batch a burst of changes into one publish
                _dirty = false;
                await PublishAsync(ct);
                lastRefresh = DateTime.UtcNow;
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Note(e); _dirty = false; }
        }
    }

    /// <summary>Build the scrubbed catalogue and push it plus any changed photos. Safe to call directly.</summary>
    public async Task PublishAsync(CancellationToken ct = default)
    {
        using var scope = _sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var dto = await StorefrontCatalog.BuildAsync(db, ct);

        var pushed = 1;
        await _uploader.PutAsync("catalog.json", JsonSerializer.SerializeToUtf8Bytes(dto, Json),
            "application/json; charset=utf-8", ct);

        foreach (var item in dto.Items)
        {
            if (!item.HasImage || !Guid.TryParse(item.Ref, out var pid)) continue;
            var img = await db.ProductImages.AsNoTracking().FirstOrDefaultAsync(x => x.ProductId == pid, ct);
            if (img is null) continue;
            if (_publishedImages.TryGetValue(pid, out var at) && at == img.UploadedAt) continue; // unchanged
            await _uploader.PutAsync($"images/{item.Ref}", img.Data, img.ContentType, ct);
            _publishedImages[pid] = img.UploadedAt;
            pushed++;
        }

        Status = new StatusView(true, _uploader.PublicBaseUrl, DateTime.UtcNow, dto.Count, pushed, null);
    }

    private void Note(Exception e)
    {
        _log.LogWarning(e, "Storefront publish failed");
        Status = Status with { Error = e.GetType().Name };
    }
}
