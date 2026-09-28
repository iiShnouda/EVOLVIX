using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SKB.Api.Services;

namespace SKB.Api.Hubs;

/// <summary>SignalR hub for live presence. Requires a valid access token (JWT).</summary>
[Authorize]
public sealed class PresenceHub : Hub
{
    private readonly PresenceTracker _tracker;

    public PresenceHub(PresenceTracker tracker) => _tracker = tracker;

    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        var userId = user.FindFirst("sub")?.Value;
        if (userId is not null)
        {
            _tracker.Connect(
                userId,
                user.Identity?.Name ?? user.FindFirst("email")?.Value ?? "",
                user.FindFirst("role")?.Value ?? "VIEWER",
                user.FindFirst("branchId")?.Value ?? "",
                Context.ConnectionId);
            await Clients.All.SendAsync("presence:changed");
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.User?.FindFirst("sub")?.Value;
        if (userId is not null)
        {
            _tracker.Disconnect(userId, Context.ConnectionId);
            await Clients.All.SendAsync("presence:changed");
        }
        await base.OnDisconnectedAsync(exception);
    }

    public Task UpdateView(string currentView)
    {
        var userId = Context.User?.FindFirst("sub")?.Value;
        if (userId is not null) _tracker.Touch(userId, currentView);
        return Task.CompletedTask;
    }
}
