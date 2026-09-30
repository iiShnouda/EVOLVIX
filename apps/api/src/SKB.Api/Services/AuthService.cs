using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

public sealed record LoginResult(AuthUserDto User, string AccessToken, string RefreshToken);

public sealed class AuthService
{
    private readonly AppDbContext _db;
    private readonly TokenService _tokens;
    private readonly AuditService _audit;
    private readonly IPasswordHasher<Staff> _hasher;
    private readonly PermissionService _permissions;
    private readonly AccessService _access;

    public AuthService(AppDbContext db, TokenService tokens, AuditService audit, IPasswordHasher<Staff> hasher,
        PermissionService permissions, AccessService access)
    {
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
        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Email == email);

        var ok = staff is not null &&
                 _hasher.VerifyHashedPassword(staff, staff.PasswordHash, req.Password)
                     is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;

        if (staff is null || !ok || !staff.IsActive)
        {
            await _audit.RecordAsync("anonymous", req.Email, "auth.login.failed", "auth",
                ip: ctx.Ip, userAgent: ctx.UserAgent);
            return null;
        }

        var permissions = await _permissions.ForAsync(staff);
        var scope = await _access.ForAsync(staff);
        var access = _tokens.IssueAccessToken(staff, permissions, scope);
        var refresh = await _tokens.CreateSessionAsync(staff.Id, ctx);
        await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.login", "auth",
            staff.BranchId.ToString(), ctx.Ip, ctx.UserAgent);
        return new LoginResult(TokenService.ToDto(staff, permissions, scope), access, refresh);
    }

    public async Task<LoginResult?> RefreshAsync(string rawToken, SessionContext ctx)
    {
        var rotated = await _tokens.RotateSessionAsync(rawToken, ctx);
        if (rotated is null) return null;
        var (staff, refresh) = rotated.Value;
        var permissions = await _permissions.ForAsync(staff);
        var scope = await _access.ForAsync(staff);
        var access = _tokens.IssueAccessToken(staff, permissions, scope);
        return new LoginResult(TokenService.ToDto(staff, permissions, scope), access, refresh);
    }
}
