using Microsoft.EntityFrameworkCore;
using SKB.Api.Controllers;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// Clears what only grows and is no longer of use, a few times a day: notifications older than
/// <see cref="NotificationsFor"/>, sign-in sessions that ended more than <see cref="SessionsFor"/> ago
/// (every token refresh writes a new one) and drafts nobody came back to. Business records, the audit
/// log and the ledger are never touched.
/// </summary>
public sealed class Housekeeping : BackgroundService
{
    public static readonly TimeSpan NotificationsFor = TimeSpan.FromDays(90);
    public static readonly TimeSpan SessionsFor = TimeSpan.FromDays(30);
    private static readonly TimeSpan Every = TimeSpan.FromHours(6);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<Housekeeping> _log;

    public Housekeeping(IServiceScopeFactory scopes, ILogger<Housekeeping> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(2), stop);
            while (!stop.IsCancellationRequested)
            {
                try { await RunAsync(stop); }
                catch (Exception e) when (e is not OperationCanceledException) { _log.LogWarning(e, "Housekeeping failed"); }
                await Task.Delay(Every, stop);
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }

    public async Task RunAsync(CancellationToken stop = default)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        var notes = await db.Notifications.Where(n => n.CreatedAt < now - NotificationsFor).ExecuteDeleteAsync(stop);
        var ended = now - SessionsFor;
        var sessions = await db.Sessions.Where(s => s.ExpiresAt < ended || (s.RevokedAt != null && s.RevokedAt < ended))
            .ExecuteDeleteAsync(stop);
        var drafts = await db.WorkDrafts.Where(d => d.UpdatedAt < now - DraftsController.KeepFor).ExecuteDeleteAsync(stop);
        if (notes + sessions + drafts > 0)
            _log.LogInformation("Housekeeping: {Notes} notifications, {Sessions} sessions, {Drafts} drafts cleared",
                notes, sessions, drafts);
    }
}
