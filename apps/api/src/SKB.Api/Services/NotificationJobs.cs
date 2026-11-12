using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// The bell's daily work (owner, 2026-11-12), checked each minute: cheques and notes falling due or
/// overdue are told once each (every hour, so a new cheque due tomorrow is not missed), and at the
/// company's chosen time (Settings; company clock) the day's summary goes to whoever is given it, once
/// a day. Nothing leaves the server.
/// </summary>
public sealed class NotificationJobs : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<NotificationJobs> _log;
    private DateTime _notesAt = DateTime.MinValue;

    public NotificationJobs(IServiceScopeFactory scopes, ILogger<NotificationJobs> log)
    {
        _scopes = scopes;
        _log = log;
    }

    /// <summary>What a summary sent now is about: before noon the day before, else today.</summary>
    public static DateOnly SummaryDay() =>
        CompanyClock.Now.Hour < 12 ? CompanyClock.Today.AddDays(-1) : CompanyClock.Today;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(90), stop);
            while (!stop.IsCancellationRequested)
            {
                try { await RunAsync(); }
                catch (Exception e) when (e is not OperationCanceledException) { _log.LogWarning(e, "Notification jobs failed"); }
                await Task.Delay(TimeSpan.FromMinutes(1), stop);
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }

    private async Task RunAsync()
    {
        using var scope = _scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var notify = sp.GetRequiredService<NotificationService>();
        if (DateTime.UtcNow - _notesAt >= TimeSpan.FromHours(1))
        {
            _notesAt = DateTime.UtcNow;
            await notify.NoteAlertsAsync();
        }

        var settings = await db.CompanySettings.FirstOrDefaultAsync();
        if (settings?.DailySummaryMinute is not int minute) return;
        var now = CompanyClock.Now;
        var today = CompanyClock.TodayDate;
        if (now.Hour * 60 + now.Minute < minute || settings.DailySummaryDay == today) return;
        // Marked first: a summary that fails is not sent twice over.
        settings.DailySummaryDay = today;
        await db.SaveChangesAsync();
        var told = await notify.DailySummaryAsync(SummaryDay(), sp.GetRequiredService<AccessService>(),
            sp.GetRequiredService<MoneyService>(), sp.GetRequiredService<WarehouseService>());
        _log.LogInformation("Daily summary sent to {Count} people", told);
    }
}
