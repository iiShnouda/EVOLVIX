namespace SKB.Api.Services;

/// <summary>
/// In-memory registry of who is connected right now, one entry per open app window (a person may
/// have the phone app and a computer open at once). Ephemeral by design: durable history lives
/// in the audit log. Backs the owner's "who's online" view.
/// </summary>
public sealed class PresenceTracker
{
    public sealed record Connection(
        string ConnectionId, string UserId, string FullName, string Role, string BranchId, string Device,
        string? Ip, DateTime ConnectedAt, string? CurrentView, DateTime LastActiveAt);

    private readonly object _gate = new();
    private readonly Dictionary<string, Connection> _connections = new();

    public void Connect(Connection c)
    {
        lock (_gate) _connections[c.ConnectionId] = c;
    }

    public void Disconnect(string connectionId)
    {
        lock (_gate) _connections.Remove(connectionId);
    }

    /// <summary>The window moved to another screen, or its person is using it. True when the screen changed.</summary>
    public bool Touch(string connectionId, string? currentView)
    {
        lock (_gate)
        {
            if (!_connections.TryGetValue(connectionId, out var c)) return false;
            _connections[connectionId] = c with
            {
                CurrentView = currentView ?? c.CurrentView, LastActiveAt = DateTime.UtcNow,
            };
            return currentView is not null && currentView != c.CurrentView;
        }
    }

    public IReadOnlyList<Connection> Snapshot()
    {
        lock (_gate) return _connections.Values.ToList();
    }

    /// <summary>Which app a window is, from its user agent (the Android and Windows apps add their own tag).</summary>
    public static string DeviceOf(string? userAgent)
    {
        var ua = userAgent ?? "";
        if (ua.Contains("SKBAndroid", StringComparison.Ordinal)) return "ANDROID_APP";
        if (ua.Contains("SKBDesktop", StringComparison.Ordinal)) return "WINDOWS_APP";
        if (ua.Contains("iPhone", StringComparison.Ordinal) || ua.Contains("iPad", StringComparison.Ordinal))
            return "IPHONE";
        if (ua.Contains("Android", StringComparison.Ordinal)) return "ANDROID_BROWSER";
        if (ua.Contains("Windows", StringComparison.Ordinal)) return "WINDOWS_BROWSER";
        if (ua.Contains("Macintosh", StringComparison.Ordinal)) return "MAC_BROWSER";
        return "BROWSER";
    }
}
