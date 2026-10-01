using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// One device per account (owner, 2026-10-01): an access token works only while its device ("sid")
/// is still the account's current one. The current device is remembered here for a few seconds so
/// each request doesn't read it from the database; a sign-in here updates it at once.
/// </summary>
public static class DeviceGate
{
    private static readonly TimeSpan Fresh = TimeSpan.FromSeconds(15);
    private static readonly ConcurrentDictionary<Guid, (Guid? Device, DateTime At)> Known = new();

    public static void Set(Guid staffId, Guid? device) => Known[staffId] = (device, DateTime.UtcNow);

    /// <summary>The account's current device (null = none set yet: any token of it works).</summary>
    public static async Task<Guid?> CurrentAsync(AppDbContext db, Guid staffId)
    {
        if (Known.TryGetValue(staffId, out var k) && DateTime.UtcNow - k.At < Fresh) return k.Device;
        var device = await db.Staff.AsNoTracking().Where(s => s.Id == staffId)
            .Select(s => s.CurrentDeviceId).FirstOrDefaultAsync();
        Set(staffId, device);
        return device;
    }
}
