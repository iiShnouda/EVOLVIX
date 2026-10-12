using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// One phone and one computer per account (owner, 2026-10-01; two at once 2026-10-12): an access
/// token works only while its device ("sid") is still the account's current device of its kind
/// (MOBILE or DESKTOP). The current devices are remembered here for a few seconds so each request
/// doesn't read them from the database; a sign-in updates them at once.
/// </summary>
public static class DeviceGate
{
    private static readonly TimeSpan Fresh = TimeSpan.FromSeconds(15);
    private static readonly ConcurrentDictionary<Guid, (Guid? Mobile, Guid? Desktop, DateTime At)> Known = new();

    public static void Set(Guid staffId, Guid? mobile, Guid? desktop) =>
        Known[staffId] = (mobile, desktop, DateTime.UtcNow);

    /// <summary>The account's current phone and computer devices (null = none of that kind signed in).</summary>
    public static async Task<(Guid? Mobile, Guid? Desktop)> CurrentAsync(AppDbContext db, Guid staffId)
    {
        if (Known.TryGetValue(staffId, out var k) && DateTime.UtcNow - k.At < Fresh) return (k.Mobile, k.Desktop);
        var row = await db.Staff.AsNoTracking().Where(s => s.Id == staffId)
            .Select(s => new { s.CurrentMobileDeviceId, s.CurrentDesktopDeviceId }).FirstOrDefaultAsync();
        Set(staffId, row?.CurrentMobileDeviceId, row?.CurrentDesktopDeviceId);
        return (row?.CurrentMobileDeviceId, row?.CurrentDesktopDeviceId);
    }

    /// <summary>True when <paramref name="device"/> is still one of the account's current devices.</summary>
    public static bool Allows((Guid? Mobile, Guid? Desktop) current, Guid device) =>
        device == current.Mobile || device == current.Desktop;

    /// <summary>Which kind a <see cref="PresenceTracker.DeviceOf"/> class is: a phone is MOBILE, else DESKTOP.</summary>
    public static string KindOf(string deviceClass) =>
        deviceClass is "ANDROID_APP" or "IPHONE" or "ANDROID_BROWSER" ? "MOBILE" : "DESKTOP";

    /// <summary>Which kind a device is, from its user agent: a phone/tablet is MOBILE, anything else DESKTOP.</summary>
    public static string Kind(string? userAgent) => KindOf(PresenceTracker.DeviceOf(userAgent));
}
