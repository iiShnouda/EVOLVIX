using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <param name="Remember">Keep the session past the browser ("remember this device").</param>
/// <param name="Refused">A refresh refused because the account signed in on another device.</param>
/// <param name="ExpiresAt">When the session ends unless refreshed (a remembered device's cookie lasts as long).</param>
/// <param name="Lock">Refused because the screen is locked: whose it is, and whether a PIN opens it.</param>
public sealed record LoginResult(AuthUserDto User, string AccessToken, string RefreshToken, bool Remember = false,
    string? Refused = null, DateTime? ExpiresAt = null, LockInfo? Lock = null);

/// <summary>A locked screen: the person's name and whether their PIN may open it.</summary>
public sealed record LockInfo(string Name, bool Pin);

public sealed class AuthService
{
    private readonly AppDbContext _db;
    private readonly TokenService _tokens;
    private readonly AuditService _audit;
    private readonly IPasswordHasher<Staff> _hasher;
    private readonly PermissionService _permissions;
    private readonly AccessService _access;
    private readonly LicenseService _license;
    private readonly NotificationService _notify;

    public AuthService(AppDbContext db, TokenService tokens, AuditService audit, IPasswordHasher<Staff> hasher,
        PermissionService permissions, AccessService access, LicenseService license, NotificationService notify)
    {
        _notify = notify;
        _license = license;
        _access = access;
        _db = db;
        _tokens = tokens;
        _audit = audit;
        _hasher = hasher;
        _permissions = permissions;
    }

    public string HashPassword(string plain) => _hasher.HashPassword(new Staff(), plain);

    // For constant-ish timing when the email doesn't exist: a throwaway account and a real hash to
    // verify against, so the hasher runs the same work it would for a genuine account.
    private static readonly Staff DummyStaff = new();
    private string? _dummyHash;
    private string DummyHash => _dummyHash ??= _hasher.HashPassword(DummyStaff, "timing-equalizer");

    public async Task<LoginResult?> LoginAsync(LoginRequest req, SessionContext ctx)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        // Too many wrong passwords lately — for this account, or hammered from this address — refuse
        // without even checking this one. Both paths answer the same "locked", so a locked response
        // never reveals whether the email exists.
        // While locked, don't re-count the try: the window stays fixed from when it tripped, so a
        // relentless guesser can never hold the owner out past it.
        if (LoginGuard.IsLocked(email) || LoginGuard.IsAddressLocked(ctx.Ip))
        {
            await _audit.RecordAsync("anonymous", req.Email, "auth.login.locked", "auth",
                ip: ctx.Ip, userAgent: ctx.UserAgent);
            return new LoginResult(null!, "", "", Refused: "locked");
        }
        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Email == email);

        bool ok;
        if (staff is not null)
            ok = _hasher.VerifyHashedPassword(staff, staff.PasswordHash, req.Password)
                     is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
        else
        {
            // No such account: still run the password hasher against a throwaway hash so the reply
            // takes about as long as for a real account — the time taken never reveals which emails
            // exist. The result is discarded.
            _hasher.VerifyHashedPassword(DummyStaff, DummyHash, req.Password);
            ok = false;
        }

        if (staff is null || !ok || !staff.IsActive)
        {
            LoginGuard.Failed(email);
            LoginGuard.AddressFailed(ctx.Ip);
            await _audit.RecordAsync("anonymous", req.Email, "auth.login.failed", "auth",
                ip: ctx.Ip, userAgent: ctx.UserAgent);
            return null;
        }

        LoginGuard.Succeeded(email);
        // The subscription ended (past its grace days): only the owner may sign in, to renew it.
        if (await _license.SignInBlockedAsync(staff))
            return new LoginResult(null!, "", "", Refused: "license_expired");
        var permissions = await _permissions.ForAsync(staff);
        var scope = await _access.ForAsync(staff);
        // A browser or app this account was not signed in from before: its owner is told (security).
        await _notify.NewSignInAsync(staff, ctx);
        var (refresh, device, remember, expires) = await _tokens.CreateSessionAsync(staff, ctx, req.RememberDevice);
        var access = _tokens.IssueAccessToken(staff, permissions, scope, device);
        await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.login", "auth",
            staff.BranchId.ToString(), ctx.Ip, ctx.UserAgent);
        return new LoginResult(TokenService.ToDto(staff, permissions, scope), access, refresh, remember, ExpiresAt: expires);
    }

    /// <summary>Whose a locked session is, for the lock screen.</summary>
    public async Task<LockInfo?> LockInfoAsync(string rawToken)
    {
        var session = await _tokens.LiveSessionAsync(rawToken);
        if (session?.Staff is null || session.LockedAt is null) return null;
        var pinUnlock = await _db.CompanySettings.AsNoTracking().Select(s => s.PinUnlock).FirstOrDefaultAsync();
        return new LockInfo(session.Staff.FullName, pinUnlock && session.Staff.PinHash is not null);
    }

    /// <param name="unlocking">After the password or PIN opened a locked screen.</param>
    public async Task<LoginResult?> RefreshAsync(string rawToken, SessionContext ctx, bool unlocking = false)
    {
        var (rotated, refused) = await _tokens.RotateSessionAsync(rawToken, ctx, unlocking);
        if (refused == "locked")
            return new LoginResult(null!, "", "", Refused: refused, Lock: await LockInfoAsync(rawToken));
        if (refused is not null)
            return new LoginResult(null!, "", "", Refused: refused);
        if (rotated is null) return null;
        var staff = rotated.Staff;
        if (await _license.SignInBlockedAsync(staff))
            return new LoginResult(null!, "", "", Refused: "license_expired");
        var permissions = await _permissions.ForAsync(staff);
        var scope = await _access.ForAsync(staff);
        var access = _tokens.IssueAccessToken(staff, permissions, scope, rotated.DeviceId);
        return new LoginResult(TokenService.ToDto(staff, permissions, scope), access, rotated.RefreshToken, rotated.Remember,
            ExpiresAt: rotated.ExpiresAt);
    }
}

/// <summary>
/// Password-guessing guard (2026-10-15 security review; thresholds made configurable + a per-address
/// failed-login counter added, owner 2026-11-20). Two in-memory counters that only count FAILURES, so
/// ordinary users are never slowed:
///  • per account — N wrong passwords within the window lock that account's sign-in for a spell; a
///    right password clears its count. This counts the email string whether or not the account exists,
///    so a "locked" answer never reveals which emails are real.
///  • per address — a guesser hammering many different (often made-up) emails from one address is
///    blocked after N wrong tries within the window, without locking out every real account they name.
/// Kept in memory — a restart forgets it, which is fine for slowing guessing down; nobody is locked out
/// for good, and the owner can always sign in once the window passes. Configure(): Security:Login*.
/// The per-address request cap on the sign-in endpoint (Program.cs, "login") is a coarser backstop.
/// </summary>
public static class LoginGuard
{
    // Safe defaults; overridden from configuration at startup (Configure).
    private static int _maxFailures = 8;
    private static int _addressMaxFailures = 20;
    private static TimeSpan _window = TimeSpan.FromMinutes(15);
    private static TimeSpan _lockFor = TimeSpan.FromMinutes(15);

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Entry> Accounts = new();
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Entry> Addresses = new();

    private sealed record Entry(int Count, DateTime First, DateTime? LockedUntil);

    /// <summary>
    /// Read the thresholds from configuration (safe defaults if unset). Minutes may be fractional so a
    /// test can use a tiny window. N is held to a sane 3–50 so the company can never be shut out.
    /// </summary>
    public static void Configure(IConfiguration config)
    {
        _maxFailures = Math.Clamp(config.GetValue("Security:LoginMaxFailures", 8), 3, 50);
        _addressMaxFailures = Math.Clamp(config.GetValue("Security:LoginAddressMaxFailures", 20), 5, 500);
        _window = TimeSpan.FromMinutes(Math.Clamp(config.GetValue("Security:LoginWindowMinutes", 15.0), 0.01, 1440));
        _lockFor = TimeSpan.FromMinutes(Math.Clamp(config.GetValue("Security:LoginLockMinutes", 15.0), 0.01, 1440));
    }

    public static bool IsLocked(string email) => Blocked(Accounts, email);

    public static bool IsAddressLocked(string? ip) => ip is not null && Blocked(Addresses, ip);

    public static void Failed(string email) => Record(Accounts, email, _maxFailures);

    public static void AddressFailed(string? ip)
    {
        if (ip is not null) Record(Addresses, ip, _addressMaxFailures);
    }

    public static void Succeeded(string email) => Accounts.TryRemove(email, out _);

    private static bool Blocked(System.Collections.Concurrent.ConcurrentDictionary<string, Entry> map, string key) =>
        map.TryGetValue(key, out var e) && e.LockedUntil is { } until && until > DateTime.UtcNow;

    private static void Record(System.Collections.Concurrent.ConcurrentDictionary<string, Entry> map, string key, int max)
    {
        var now = DateTime.UtcNow;
        map.AddOrUpdate(key,
            _ => new Entry(1, now, 1 >= max ? now + _lockFor : null),
            (_, e) =>
            {
                var fresh = now - e.First > _window ? new Entry(0, now, null) : e;
                var count = fresh.Count + 1;
                return fresh with { Count = count, LockedUntil = count >= max ? now + _lockFor : null };
            });
        // Don't grow without bound from guesses at made-up addresses/emails.
        if (map.Count > 10_000)
            foreach (var (k, e) in map)
                if (now - e.First > _window && (e.LockedUntil is null || e.LockedUntil < now)) map.TryRemove(k, out _);
    }
}
