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

    public static AuthUserDto ToDto(Staff staff)
    {
        var perms = RolePermissions.For(staff.Role);
        return new AuthUserDto(
            staff.Id.ToString(), staff.FullName, staff.Email, staff.Role.ToString(),
            staff.BranchId.ToString(), perms);
    }

    public string IssueAccessToken(Staff staff)
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
        foreach (var p in RolePermissions.For(staff.Role))
            claims.Add(new Claim("permission", p));

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"] ?? "skb",
            audience: _config["Jwt:Audience"] ?? "skb",
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddSeconds(ttl),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<string> CreateSessionAsync(Guid staffId, SessionContext ctx)
    {
        var raw = CryptoService.GenerateOpaqueToken();
        var ttl = int.Parse(_config["Jwt:RefreshTtlSeconds"] ?? "2592000");
        _db.Sessions.Add(new Session
        {
            StaffId = staffId,
            TokenHash = CryptoService.Sha256(raw),
            EncryptedToken = _crypto.Encrypt(raw),
            Ip = ctx.Ip,
            UserAgent = ctx.UserAgent,
            DeviceLabel = ctx.DeviceLabel,
            ExpiresAt = DateTime.UtcNow.AddSeconds(ttl),
        });
        await _db.SaveChangesAsync();
        return raw;
    }

    public async Task<(Staff staff, string refreshToken)?> RotateSessionAsync(string rawToken, SessionContext ctx)
    {
        var hash = CryptoService.Sha256(rawToken);
        var session = await _db.Sessions.Include(s => s.Staff)
            .FirstOrDefaultAsync(s => s.TokenHash == hash);
        if (session is null || session.RevokedAt is not null || session.ExpiresAt < DateTime.UtcNow)
            return null;
        if (session.Staff is null || !session.Staff.IsActive)
            return null;
        if (_crypto.Decrypt(session.EncryptedToken) != rawToken)
            return null;

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
        });
        await _db.SaveChangesAsync();
        return (session.Staff, newRaw);
    }

    public async Task RevokeByRawTokenAsync(string rawToken)
    {
        var hash = CryptoService.Sha256(rawToken);
        await _db.Sessions.Where(s => s.TokenHash == hash && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTime.UtcNow));
    }
}
