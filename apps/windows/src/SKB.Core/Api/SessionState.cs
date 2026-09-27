using SKB.Core.Models;

namespace SKB.Core.Api;

/// <summary>
/// Holds the in-memory access token and current user. Like the web app, the token lives
/// only in memory (never written to disk) — nothing business-related is persisted locally.
/// </summary>
public sealed class SessionState
{
    public string? AccessToken { get; set; }
    public AuthUser? User { get; set; }

    public bool IsAuthenticated => !string.IsNullOrEmpty(AccessToken) && User is not null;

    public void Clear()
    {
        AccessToken = null;
        User = null;
    }
}
