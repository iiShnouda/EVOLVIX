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

    public async Task<LoginResult?> LoginAsync(LoginRequest req, SessionContext ctx)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        // Too many wrong passwords for this account lately: refuse without even checking this one.
        if (LoginGuard.IsLocked(email))
        {
            await _audit.RecordAsync("anonymous", req.Email, "auth.login.locked", "auth",
                ip: ctx.Ip, userAgent: ctx.UserAgent);
            return new LoginResult(null!, "", "", Refused: "locked");
        }
        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Email == email);

        var ok = staff is not null &&
                 _hasher.VerifyHashedPassword(staff, staff.PasswordHash, req.Password)
                     is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;

        if (staff is null || !ok || !staff.IsActive)
        {
            LoginGuard.Failed(email);
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
/// Password-guessing guard per account (2026-10-15 security review): 10 wrong passwords within
/// 15 minutes lock that account's sign-in for 15 minutes; a right one clears the count. Kept in
/// memory — a restart forgets it, which is fine for slowing guessing down. The per-address limit on
/// the sign-in endpoint (Program.cs, "login") covers guessing across many accounts.
/// </summary>
public static class LoginGuard
{
    private const int MaxFailures = 10;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan LockFor = TimeSpan.FromMinutes(15);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Entry> Seen = new();

    private sealed record Entry(int Count, DateTime First, DateTime? LockedUntil);

    public static bool IsLocked(string email) =>
        Seen.TryGetValue(email, out var e) && e.LockedUntil is { } until && until > DateTime.UtcNow;

    public static void Failed(string email)
    {
        var now = DateTime.UtcNow;
        Seen.AddOrUpdate(email,
            _ => new Entry(1, now, null),
            (_, e) =>
            {
                var fresh = now - e.First > Window ? new Entry(0, now, null) : e;
                var count = fresh.Count + 1;
                return fresh with { Count = count, LockedUntil = count >= MaxFailures ? now + LockFor : null };
            });
        // Don't grow without bound from guesses at made-up addresses.
        if (Seen.Count > 10_000)
            foreach (var (key, e) in Seen)
                if (now - e.First > Window && (e.LockedUntil is null || e.LockedUntil < now)) Seen.TryRemove(key, out _);
    }

    public static void Succeeded(string email) => Seen.TryRemove(email, out _);
}
