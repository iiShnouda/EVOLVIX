using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// A document dated on another day than the one it is typed (owner, 2026-10-02): a supplier's
/// invoice entered late, money moved yesterday and written today. Everything the request saves —
/// the document, its stock and money movements, its journal entry — lands on that day (at the
/// time of day it is typed); the document keeps when it was really entered. Needs
/// <c>documents:backdate</c>; never in the future, never in a locked period, at most a year back.
/// </summary>
public static class Backdate
{
    private static readonly AsyncLocal<DateTime?> Current = new();

    /// <summary>The instant everything saved now is dated, or null for "now".</summary>
    public static DateTime? Instant => Current.Value;

    /// <summary>Date what is saved until the result is disposed.</summary>
    public static IDisposable To(DateTime? instant)
    {
        var before = Current.Value;
        Current.Value = instant;
        return new Restore(before);
    }

    private sealed class Restore(DateTime? before) : IDisposable
    {
        public void Dispose() => Current.Value = before;
    }

    /// <summary>
    /// The instant for a requested day (yyyy-MM-dd), null for today or none, or why it can't be.
    /// </summary>
    public static async Task<(DateTime? Instant, string? Code, string? Message)> CheckAsync(
        AppDbContext db, ClaimsPrincipal user, string? day)
    {
        if (string.IsNullOrWhiteSpace(day)) return (null, null, null);
        if (CompanyClock.ParseDay(day) is not DateOnly d) return (null, "bad_date", "Enter the date as yyyy-mm-dd.");
        var today = CompanyClock.Today;
        if (d == today) return (null, null, null);
        if (d > today) return (null, "future_date", "A document can't be dated after today.");
        if (!user.HasClaim("permission", Permissions.DocumentsBackdate))
            return (null, "backdate_not_allowed", "You may not date a document on an earlier day.");
        if (d < today.AddDays(-366)) return (null, "bad_date", "At most a year back.");
        var lockDate = await db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && d <= DateOnly.FromDateTime(locked))
            return (null, "period_locked", "That date is in a locked period.");
        return (CompanyClock.StartOf(d).Add(CompanyClock.Now.TimeOfDay), null, null);
    }
}
