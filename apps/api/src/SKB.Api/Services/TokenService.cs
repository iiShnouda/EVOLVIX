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
        access.Departments?.Select(d => d.ToString()).ToArray(), access.MaxDiscountPercent);

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
    public async Task<(string Raw, Guid DeviceId)> CreateSessionAsync(Staff staff, SessionContext ctx, bool remember)
    {
        var raw = CryptoService.GenerateOpaqueToken();
        var ttl = int.Parse(_config["Jwt:RefreshTtlSeconds"] ?? "2592000");
        var device = Guid.NewGuid();
        var now = DateTime.UtcNow;
        await _db.Sessions.Where(s => s.StaffId == staff.Id && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now).SetProperty(x => x.RevokedReason, "other_device"));
        _db.Sessions.Add(new Session
        {
            StaffId = staff.Id,
            TokenHash = CryptoService.Sha256(raw),
            EncryptedToken = _crypto.Encrypt(raw),
            Ip = ctx.Ip,
            UserAgent = ctx.UserAgent,
            DeviceLabel = ctx.DeviceLabel,
            ExpiresAt = now.AddSeconds(ttl),
            DeviceId = device,
            Remember = remember,
        });
        staff.CurrentDeviceId = device;
        await _db.SaveChangesAsync();
        DeviceGate.Set(staff.Id, device);
        return (raw, device);
    }

    /// <summary>Why a refresh was refused: null = fine; "other_device" = signed in elsewhere since.</summary>
    public sealed record Rotated(Staff Staff, string RefreshToken, Guid DeviceId, bool Remember);

    public async Task<(Rotated? Result, string? Refused)> RotateSessionAsync(string rawToken, SessionContext ctx)
    {
        var hash = CryptoService.Sha256(rawToken);
        var session = await _db.Sessions.Include(s => s.Staff)
            .FirstOrDefaultAsync(s => s.TokenHash == hash);
        if (session is null) return (null, null);
        if (session.RevokedReason == "other_device"
            || (session.RevokedAt is null && session.Staff?.CurrentDeviceId is Guid current && current != session.DeviceId))
            return (null, "other_device");
        if (session.RevokedAt is not null || session.ExpiresAt < DateTime.UtcNow)
            return (null, null);
        if (session.Staff is null || !session.Staff.IsActive)
            return (null, null);
        if (_crypto.Decrypt(session.EncryptedToken) != rawToken)
            return (null, null);

        session.RevokedAt = DateTime.UtcNow;
        var newRaw = CryptoService.GenerateOpaqueToken();
        var ttl = int.Parse(_config["Jwt:RefreshTtlSeconds"] ?? "2592000");
        _db.Sessions.Add(new Session
        {
            StaffId = session.StaffId,
            TokenHash = CryptoService.Sha256(newRaw),
            EncryptedToken = _crypto.Encrypt(newRaw),
            Ip = ctx.Ip,
            UserAgent = ctx.UserAgent,
            DeviceLabel = ctx.DeviceLabel,
            ExpiresAt = DateTime.UtcNow.AddSeconds(ttl),
            DeviceId = session.DeviceId,
            Remember = session.Remember,
        });
        await _db.SaveChangesAsync();
        return (new Rotated(session.Staff, newRaw, session.DeviceId, session.Remember), null);
    }

    public async Task RevokeByRawTokenAsync(string rawToken)
    {
        var hash = CryptoService.Sha256(rawToken);
        await _db.Sessions.Where(s => s.TokenHash == hash && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTime.UtcNow).SetProperty(x => x.RevokedReason, "logout"));
    }
}
