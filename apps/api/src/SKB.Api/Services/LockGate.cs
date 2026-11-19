using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// Devices whose screen is locked (owner, 2026-11-18: idle locks a remembered device instead of signing
/// it out). Their access tokens are refused at once, not when they run out, so nothing can be read
/// behind the lock screen; the sessions say so too (<see cref="Session.LockedAt"/>), and this is read
/// from them on first use after a start.
/// </summary>
public static class LockGate
{
    private static readonly ConcurrentDictionary<Guid, byte> Locked = new();
    private static readonly SemaphoreSlim Loading = new(1, 1);
    private static volatile bool _loaded;

    public static async Task<bool> IsLockedAsync(AppDbContext db, Guid device)
    {
        if (!_loaded) await LoadAsync(db);
        return Locked.ContainsKey(device);
    }

    public static void Lock(Guid device) => Locked[device] = 0;

    public static void Unlock(Guid device) => Locked.TryRemove(device, out _);

    /// <summary>Read again from the sessions (the data was restored from a backup).</summary>
    public static void ForgetAll()
    {
        Locked.Clear();
        _loaded = false;
    }

    private static async Task LoadAsync(AppDbContext db)
    {
        await Loading.WaitAsync();
        try
        {
            if (_loaded) return;
            var now = DateTime.UtcNow;
            foreach (var device in await db.Sessions.AsNoTracking()
                         .Where(s => s.LockedAt != null && s.RevokedAt == null && s.ExpiresAt > now)
                         .Select(s => s.DeviceId).ToListAsync())
                Locked[device] = 0;
            _loaded = true;
        }
        finally
        {
            Loading.Release();
        }
    }
}
