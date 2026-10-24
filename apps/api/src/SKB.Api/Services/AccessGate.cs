using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// A change to what someone may do — their permissions, role, branches, or closing their account —
/// takes effect at their next request (owner, 2026-10-24), not when their access token (15 minutes)
/// runs out. Each token carries the access version it was issued at; one of an older version, or of
/// someone no longer active, is refused, and the app quietly asks for a new one, made as things now
/// stand (a closed account gets none). Versions are remembered a few seconds; a change forgets them.
/// </summary>
public static class AccessGate
{
    /// <summary>The access token's claim with the version it was issued at.</summary>
    public const string VersionClaim = "av";

    private static readonly TimeSpan Fresh = TimeSpan.FromSeconds(15);
    private static readonly ConcurrentDictionary<Guid, (bool Active, int Version, DateTime At)> Known = new();

    /// <summary>Whether the person is active, and their access version now.</summary>
    public static async Task<(bool Active, int Version)> CurrentAsync(AppDbContext db, Guid staffId)
    {
        if (Known.TryGetValue(staffId, out var k) && DateTime.UtcNow - k.At < Fresh) return (k.Active, k.Version);
        var row = await db.Staff.AsNoTracking().Where(s => s.Id == staffId)
            .Select(s => new { s.IsActive, s.AccessVersion }).FirstOrDefaultAsync();
        var now = (Active: row?.IsActive ?? false, Version: row?.AccessVersion ?? 0);
        Known[staffId] = (now.Active, now.Version, DateTime.UtcNow);
        return now;
    }

    /// <summary>What these people may do changed: their tokens are refused from their next request.</summary>
    public static async Task ChangedAsync(AppDbContext db, IQueryable<Staff> who)
    {
        var ids = await who.Select(s => s.Id).ToListAsync();
        await who.ExecuteUpdateAsync(s => s.SetProperty(x => x.AccessVersion, x => x.AccessVersion + 1));
        foreach (var id in ids) Known.TryRemove(id, out _);
    }

    /// <summary>Forget what is remembered of this person (they were removed).</summary>
    public static void Forget(Guid staffId) => Known.TryRemove(staffId, out _);
}
