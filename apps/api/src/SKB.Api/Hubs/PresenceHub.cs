using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SKB.Api.Domain;
using SKB.Api.Services;

namespace SKB.Api.Hubs;

/// <summary>
/// SignalR hub for live presence. Every signed-in window connects (a valid access token is
/// required) and reports the screen it shows; people who may see presence
/// (<c>presence:view</c>) are told when anything changes. Nothing but "changed" is broadcast:
/// the list itself comes from <c>GET /api/presence</c>, which checks the permission.
/// </summary>
[Authorize]
public sealed class PresenceHub : Hub
{
    public const string Viewers = "presence-viewers";
    /// <summary>Supervisors who read every conversation of the chat (chat:monitor).</summary>
    public const string ChatMonitors = "chat-monitors";
    /// <summary>Each person's own windows, told when their bell has something new.</summary>
    public static string StaffGroup(Guid staffId) => $"staff:{staffId}";
    private const int MaxView = 40;
    private readonly PresenceTracker _tracker;

    public PresenceHub(PresenceTracker tracker) => _tracker = tracker;

    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        var userId = user.FindFirst("sub")?.Value;
        if (userId is not null)
        {
            var http = Context.GetHttpContext();
            _tracker.Connect(new PresenceTracker.Connection(
                Context.ConnectionId, userId,
                user.FindFirst("name")?.Value ?? user.FindFirst("email")?.Value ?? "",
                user.FindFirst("role")?.Value ?? "VIEWER",
                user.FindFirst("branchId")?.Value ?? "",
                PresenceTracker.DeviceOf(http?.Request.Headers.UserAgent.ToString()),
                http?.Connection.RemoteIpAddress?.ToString(),
                DateTime.UtcNow, null, DateTime.UtcNow));
            if (Guid.TryParse(userId, out var staffId))
                await Groups.AddToGroupAsync(Context.ConnectionId, StaffGroup(staffId));
            if (user.HasClaim("permission", Permissions.PresenceView))
                await Groups.AddToGroupAsync(Context.ConnectionId, Viewers);
            if (user.HasClaim("permission", Permissions.ChatMonitor))
                await Groups.AddToGroupAsync(Context.ConnectionId, ChatMonitors);
            await Clients.Group(Viewers).SendAsync("presence:changed");
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _tracker.Disconnect(Context.ConnectionId);
        await Clients.Group(Viewers).SendAsync("presence:changed");
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>The window shows another screen (a route key such as "sales"), or is in use.</summary>
    public async Task UpdateView(string currentView)
    {
        var view = new string((currentView ?? "").Where(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_')
            .Take(MaxView).ToArray());
        // Just "still here" doesn't need telling: the viewers' list refreshes on its own.
        if (_tracker.Touch(Context.ConnectionId, view.Length == 0 ? null : view))
            await Clients.Group(Viewers).SendAsync("presence:changed");
    }
}
