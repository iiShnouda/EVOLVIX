using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

public sealed record SessionContext(string? Ip, string? UserAgent, string? DeviceLabel = null);

public sealed class TokenService
{
    private readonly AppDbContext _db;
    private readonly CryptoService _crypto;
    private readonly IConfiguration _config;

    public TokenService(AppDbContext db, CryptoService crypto, IConfiguration config)
    {
        _db = db;
        _crypto = crypto;
        _config = config;
    }

    /// <param name="permissions">The person's effective permissions (<see cref="PermissionService"/>).</param>
    /// <param name="access">What they may work with (<see cref="AccessService"/>).</param>
    public static AuthUserDto ToDto(Staff staff, string[] permissions, StaffAccess access) => new(
        staff.Id.ToString(), staff.FullName, staff.Email, staff.Role.ToString(),
        staff.BranchId.ToString(), permissions, access.AllBranches,
        access.Branches.Select(b => new BranchOptionDto(b.Id.ToString(), Loc.Name(b), b.IsActive)).ToArray(),
        access.Warehouses?.Select(w => w.ToString()).ToArray(),
        access.MoneyAccounts?.Select(a => a.ToString()).ToArray(),
        access.Departments?.Select(d => d.ToString()).ToArray(), access.MaxDiscountPercent,
        staff.CustomRole?.Name, access.MoneyHistoryDays);

    /// <summary>The access token's claim naming the device (sign-in) it belongs to.</summary>
    public const string DeviceClaim = "sid";

    public string IssueAccessToken(Staff staff, string[] permissions, StaffAccess access, Guid? deviceId = null)
    {
        var secret = _config["Jwt:AccessSecret"]!;
        var ttl = int.Parse(_config["Jwt:AccessTtlSeconds"] ?? "900");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new("sub", staff.Id.ToString()),
            new("email", staff.Email),
            new("role", staff.Role.ToString()),
            new("branchId", staff.BranchId.ToString()),
            new("name", staff.FullName),
        };
        if (deviceId is Guid device) claims.Add(new Claim(DeviceClaim, device.ToString()));
        claims.Add(new Claim(AccessGate.VersionClaim, staff.AccessVersion.ToString()));
        foreach (var p in permissions)
            claims.Add(new Claim("permission", p));
        claims.AddRange(Access.Claims(access));

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"] ?? "skb",
            audience: _config["Jwt:Audience"] ?? "skb",
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddSeconds(ttl),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// A new sign-in: its own device id, and (owner, 2026-10-01) the only one the account works on —
    /// every other session of it ends ("other_device"), so the device signed in before is signed out.
    /// </summary>
    public async Task<(string Raw, Guid DeviceId, bool Remember, DateTime ExpiresAt)> CreateSessionAsync(
        Staff staff, SessionContext ctx, bool remember)
    {
        var raw = CryptoService.GenerateOpaqueToken();
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        // Remembered only when the owner offers it (Settings → security: 0 days = not offered).
        remember = remember && settings.RememberDays > 0;
        var expires = ExpiryOf(remember, settings);
        var device = Guid.NewGuid();
        var kind = DeviceGate.Kind(ctx.UserAgent);
        var now = DateTime.UtcNow;
        // End only the other sign-ins of this kind (a new phone frees the old phone; the computer stays).
        await _db.Sessions.Where(s => s.StaffId == staff.Id && s.RevokedAt == null && s.Kind == kind)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevokedReason, "other_device"));
        _db.Sessions.Add(new Session
        {
            StaffId = staff.Id,
            TokenHash = CryptoService.Sha256(raw),
            EncryptedToken = _crypto.Encrypt(raw),
            Ip = ctx.Ip,
            UserAgent = ctx.UserAgent,
            DeviceLabel = ctx.DeviceLabel,
            ExpiresAt = expires,
            DeviceId = device,
            Kind = kind,
            Remember = remember,
        });
        if (kind == "MOBILE") staff.CurrentMobileDeviceId = device;
        else staff.CurrentDesktopDeviceId = device;
        await _db.SaveChangesAsync();
        DeviceGate.Set(staff.Id, staff.CurrentMobileDeviceId, staff.CurrentDesktopDeviceId);
        return (raw, device, remember, expires);
    }

    /// <summary>A session not remembered lasts while the app is in use, at most this long between refreshes.</summary>
    public static readonly TimeSpan NotRemembered = TimeSpan.FromHours(12);

    /// <summary>
    /// When a session ends unless refreshed (owner, 2026-11-18): a remembered device keeps it for the
    /// days the owner chose; one not remembered for <see cref="NotRemembered"/> (its cookie ends with
    /// the browser anyway).
    /// </summary>
    public static DateTime ExpiryOf(bool remember, CompanySettings settings) =>
        remember && settings.RememberDays > 0
            ? DateTime.UtcNow.AddDays(settings.RememberDays)
            : DateTime.UtcNow.Add(NotRemembered);

    /// <summary>Why a refresh was refused: null = fine; "other_device" = signed in elsewhere since.</summary>
    public sealed record Rotated(Staff Staff, string RefreshToken, Guid DeviceId, bool Remember, DateTime ExpiresAt);

    /// <summary>The live session a refresh token belongs to (not ended, not run out), with its person.</summary>
    public async Task<Session?> LiveSessionAsync(string? rawToken)
    {
        if (string.IsNullOrEmpty(rawToken)) return null;
        var hash = CryptoService.Sha256(rawToken);
        var session = await _db.Sessions.Include(s => s.Staff).FirstOrDefaultAsync(s => s.TokenHash == hash);
        if (session is null || session.RevokedAt is not null || session.ExpiresAt < DateTime.UtcNow
            || _crypto.Decrypt(session.EncryptedToken) != rawToken)
            return null;
        return session;
    }

    /// <param name="unlocking">Unlocking a locked screen: the time it sat idle doesn't count.</param>
    /// <returns>Refused: "other_device" (signed in elsewhere since) or "locked" (the screen is locked).</returns>
    public async Task<(Rotated? Result, string? Refused)> RotateSessionAsync(string rawToken, SessionContext ctx,
        bool unlocking = false)
    {
        var hash = CryptoService.Sha256(rawToken);
        var session = await _db.Sessions.Include(s => s.Staff)
            .FirstOrDefaultAsync(s => s.TokenHash == hash);
        if (session is null) return (null, null);
        // Superseded only by a newer sign-in of the SAME kind (the other kind's device doesn't affect it).
        var slot = session.Kind == "MOBILE" ? session.Staff?.CurrentMobileDeviceId : session.Staff?.CurrentDesktopDeviceId;
        if (session.RevokedReason == "other_device"
            || (session.RevokedAt is null && slot is Guid current && current != session.DeviceId))
            return (null, "other_device");
        // A refresh token used again after it was exchanged: someone else may have a copy (owner,
        // 2026-10-24). The device's sign-in ends, so neither copy works; the same token twice in a
        // moment (two requests at once) is no theft.
        if (session.RevokedReason is null or "rotated" && session.RevokedAt is DateTime rotatedAt
            && DateTime.UtcNow - rotatedAt > TimeSpan.FromSeconds(30))
        {
            await EndDeviceAsync(session.StaffId, session.DeviceId, "reused");
            return (null, null);
        }
        if (session.RevokedAt is not null || session.ExpiresAt < DateTime.UtcNow)
            return (null, null);
        if (session.Staff is null || !session.Staff.IsActive)
            return (null, null);
        if (_crypto.Decrypt(session.EncryptedToken) != rawToken)
            return (null, null);
        // A locked screen opens only with the password or PIN (owner, 2026-11-18).
        if (session.LockedAt is not null) return (null, "locked");
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        // Not refreshed for longer than the idle time (and an access token's life): the app was closed or
        // asleep that long. A remembered device that locks is locked; any other one is signed out.
        var accessTtl = int.Parse(_config["Jwt:AccessTtlSeconds"] ?? "900");
        if (!unlocking && settings.IdleMinutes > 0
            && DateTime.UtcNow - session.CreatedAt > TimeSpan.FromMinutes(settings.IdleMinutes) + TimeSpan.FromSeconds(accessTtl))
        {
            if (session.Remember && settings.IdleAction == "LOCK")
            {
                await LockAsync(session);
                return (null, "locked");
            }
            await EndDeviceAsync(session.StaffId, session.DeviceId, "idle");
            return (null, null);
        }

        session.RevokedAt = DateTime.UtcNow;
        session.RevokedReason = "rotated";
        var newRaw = CryptoService.GenerateOpaqueToken();
        var expires = ExpiryOf(session.Remember, settings);
        _db.Sessions.Add(new Session
        {
            StaffId = session.StaffId,
            TokenHash = CryptoService.Sha256(newRaw),
            EncryptedToken = _crypto.Encrypt(newRaw),
            Ip = ctx.Ip,
            UserAgent = ctx.UserAgent,
            DeviceLabel = ctx.DeviceLabel,
            ExpiresAt = expires,
            DeviceId = session.DeviceId,
            Kind = session.Kind,
            Remember = session.Remember,
        });
        await _db.SaveChangesAsync();
        return (new Rotated(session.Staff, newRaw, session.DeviceId, session.Remember, expires), null);
    }

    /// <summary>Lock a device's screen: no refresh and no access token works until it is unlocked.</summary>
    public async Task LockAsync(Session session)
    {
        session.LockedAt = DateTime.UtcNow;
        session.UnlockFailures = 0;
        await _db.SaveChangesAsync();
        LockGate.Lock(session.DeviceId);
    }

    /// <summary>End one device's sign-in: its sessions, and its place as the account's device of its kind.</summary>
    public async Task EndDeviceAsync(Guid staffId, Guid deviceId, string reason)
    {
        var now = DateTime.UtcNow;
        await _db.Sessions.Where(s => s.StaffId == staffId && s.DeviceId == deviceId && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevokedReason, reason));
        await _db.Staff.Where(s => s.Id == staffId && s.CurrentMobileDeviceId == deviceId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.CurrentMobileDeviceId, (Guid?)null));
        await _db.Staff.Where(s => s.Id == staffId && s.CurrentDesktopDeviceId == deviceId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.CurrentDesktopDeviceId, (Guid?)null));
        var row = await _db.Staff.AsNoTracking().Where(s => s.Id == staffId)
            .Select(s => new { s.CurrentMobileDeviceId, s.CurrentDesktopDeviceId }).FirstOrDefaultAsync();
        DeviceGate.Set(staffId, row?.CurrentMobileDeviceId, row?.CurrentDesktopDeviceId);
        LockGate.Unlock(deviceId);
        // Its access tokens stop at once too (the account's other device just asks for a new one).
        await AccessGate.ChangedAsync(_db, _db.Staff.Where(s => s.Id == staffId));
    }

    public async Task RevokeByRawTokenAsync(string rawToken)
    {
        var hash = CryptoService.Sha256(rawToken);
        await _db.Sessions.Where(s => s.TokenHash == hash && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTime.UtcNow).SetProperty(x => x.RevokedReason, "logout"));
    }

    /// <summary>
    /// Sign the whole account out everywhere (owner, 2026-10-14: for a lost or virus-hit device).
    /// Every live session ends and both device slots are cleared, so each other device is refused at
    /// its next refresh, and its access token stops working at once.
    /// </summary>
    public async Task RevokeAllForStaffAsync(Guid staffId)
    {
        var now = DateTime.UtcNow;
        await _db.Sessions.Where(s => s.StaffId == staffId && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevokedReason, "signed_out_all"));
        await _db.Staff.Where(s => s.Id == staffId).ExecuteUpdateAsync(s =>
            s.SetProperty(x => x.CurrentMobileDeviceId, (Guid?)null)
             .SetProperty(x => x.CurrentDesktopDeviceId, (Guid?)null));
        DeviceGate.Set(staffId, null, null);
        // …and their access tokens stop at once, not when they run out (owner, 2026-10-24).
        await AccessGate.ChangedAsync(_db, _db.Staff.Where(s => s.Id == staffId));
    }
}
