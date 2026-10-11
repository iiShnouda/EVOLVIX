using Microsoft.AspNetCore.SignalR;
using SKB.Api.Data;
using SKB.Api.Hubs;

namespace SKB.Api.Services;

/// <summary>
/// Writes the activity log (كل حركة تُسجَّل) and, as each entry is written, tells the people watching
/// "who's online" so they see a live feed of what staff are doing (owner, 2026-10-12). Only a signed
/// summary line is pushed — the full log still comes from <c>GET /api/audit</c>, which checks the
/// permission.
/// </summary>
public sealed class AuditService
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuditService> _logger;
    private readonly IHubContext<PresenceHub> _hub;

    public AuditService(AppDbContext db, ILogger<AuditService> logger, IHubContext<PresenceHub> hub)
    {
        _db = db;
        _logger = logger;
        _hub = hub;
    }

    public async Task RecordAsync(string actorId, string actorName, string action, string resource,
        string? branchId = null, string? ip = null, string? userAgent = null, string? resourceId = null,
        string? details = null)
    {
        var entry = new AuditEntry
        {
            ActorId = actorId,
            ActorName = actorName,
            Action = action,
            Resource = resource,
            ResourceId = resourceId,
            Details = string.IsNullOrWhiteSpace(details) ? null : details.Trim()[..Math.Min(500, details.Trim().Length)],
            BranchId = branchId,
            Ip = ip,
            UserAgent = userAgent,
        };
        try
        {
            _db.AuditEntries.Add(entry);
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write audit entry for {Action}", action);
            return;
        }
        // A live line for the "who's online" page; best-effort, never holds up the request.
        try
        {
            await _hub.Clients.Group(PresenceHub.Viewers).SendAsync("activity", new
            {
                id = entry.Id.ToString(),
                actorId = entry.ActorId,
                actorName = entry.ActorName,
                action = entry.Action,
                resource = entry.Resource,
                resourceId = entry.ResourceId,
                details = entry.Details,
                device = DeviceKind(entry.UserAgent),
                at = entry.CreatedAt.ToString("o"),
            });
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not push the live activity line.");
        }
    }

    /// <summary>The kind of device behind a browser's user-agent, for the log and the live feed.</summary>
    public static string DeviceKind(string? userAgent)
    {
        var ua = userAgent ?? "";
        if (ua.Contains("SKBAndroid") || ua.Contains("Android")) return "android";
        if (ua.Contains("SKBDesktop") || ua.Contains("Windows")) return "windows";
        if (ua.Contains("iPhone") || ua.Contains("iPad") || ua.Contains("iOS")) return "ios";
        if (ua.Contains("Mac")) return "mac";
        if (ua.Contains("Linux")) return "linux";
        return "web";
    }
}
