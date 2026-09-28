using System.Collections.Concurrent;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// In-memory registry of who is currently connected. Ephemeral by design (durable history
/// lives in the audit log). Backs the future owner/CEO "who is online" view.
/// </summary>
public sealed class PresenceTracker
{
    private sealed class Entry
    {
        public required string FullName { get; init; }
        public required string Role { get; init; }
        public required string BranchId { get; init; }
        public string? CurrentView { get; set; }
        public DateTime ConnectedAt { get; init; } = DateTime.UtcNow;
        public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
        public HashSet<string> Connections { get; } = new();
    }

    private readonly ConcurrentDictionary<string, Entry> _byUser = new();

    public void Connect(string userId, string fullName, string role, string branchId, string connectionId)
    {
        var entry = _byUser.GetOrAdd(userId, _ => new Entry { FullName = fullName, Role = role, BranchId = branchId });
        lock (entry.Connections)
        {
            entry.Connections.Add(connectionId);
            entry.LastSeenAt = DateTime.UtcNow;
        }
    }

    public void Disconnect(string userId, string connectionId)
    {
        if (!_byUser.TryGetValue(userId, out var entry)) return;
        lock (entry.Connections)
        {
            entry.Connections.Remove(connectionId);
            if (entry.Connections.Count == 0) _byUser.TryRemove(userId, out _);
        }
    }

    public void Touch(string userId, string? currentView)
    {
        if (!_byUser.TryGetValue(userId, out var entry)) return;
        entry.LastSeenAt = DateTime.UtcNow;
        if (currentView is not null) entry.CurrentView = currentView;
    }

    public IReadOnlyList<PresenceEntryDto> List() =>
        _byUser.Select(kv => new PresenceEntryDto(
            kv.Key, kv.Value.FullName, kv.Value.Role, kv.Value.BranchId, kv.Value.CurrentView,
            kv.Value.ConnectedAt.ToString("o"), kv.Value.LastSeenAt.ToString("o"))).ToList();
}
