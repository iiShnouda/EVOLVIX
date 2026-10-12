using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private const string RefreshCookie = "skb_rt";
    /// <summary>The page the person was on, kept so a sign-in (here or on another device) opens there.</summary>
    public const string LastPageKey = "session:lastPage";
    private const string RefreshPath = "/api/auth";

    private readonly AuthService _auth;
    private readonly TokenService _tokens;
    private readonly AuditService _audit;
    private readonly IConfiguration _config;
    private readonly AppDbContext _db;
    private readonly AccessService _access;
    private readonly PresenceTracker _presence;

    public AuthController(AuthService auth, TokenService tokens, AuditService audit, IConfiguration config,
        AppDbContext db, AccessService access, PresenceTracker presence)
    {
        _db = db;
        _access = access;
        _auth = auth;
        _tokens = tokens;
        _audit = audit;
        _config = config;
        _presence = presence;
    }

    /// <summary>
    /// The person's own two devices (owner, 2026-10-12: "know whether the other device is running"):
    /// a phone and a computer, whether each is signed in and whether it is connected right now, and
    /// which kind this request is from — so the app can show the other device's state.
    /// </summary>
    [Authorize]
    [HttpGet("devices")]
    public async Task<IActionResult> Devices()
    {
        if (!Guid.TryParse(CurrentUser.Id(User), out var staffId)) return Unauthorized();
        var (mobile, desktop) = await DeviceGate.CurrentAsync(_db, staffId);
        var online = _presence.Snapshot()
            .Where(c => c.UserId == staffId.ToString())
            .Select(c => DeviceGate.KindOf(c.Device))
            .ToHashSet();
        return Ok(new
        {
            thisKind = DeviceGate.Kind(Request.Headers.UserAgent.ToString()),
            mobile = new { signedIn = mobile is not null, online = online.Contains("MOBILE") },
            desktop = new { signedIn = desktop is not null, online = online.Contains("DESKTOP") },
        });
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "Email and password are required", code = "VALIDATION_ERROR" });

        var result = await _auth.LoginAsync(req, Context());
        if (result is null)
            return Unauthorized(new { message = "Incorrect email or password", code = "INVALID_CREDENTIALS" });

        SetRefreshCookie(result.RefreshToken, req.RememberDevice);
        return Ok(new { user = result.User, accessToken = result.AccessToken });
    }

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh()
    {
        var raw = Request.Cookies[RefreshCookie];
        if (string.IsNullOrEmpty(raw))
            return Unauthorized(new { message = "No session", code = "NO_SESSION" });

        var result = await _auth.RefreshAsync(raw, Context());
        if (result?.Refused == "other_device")
        {
            Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = RefreshPath });
            return Unauthorized(new { message = "This account signed in on another device.", code = "SIGNED_IN_ELSEWHERE" });
        }
        if (result is null)
            return Unauthorized(new { message = "Invalid or expired session", code = "NO_SESSION" });

        // The session keeps what was chosen at sign-in: remembered on this device, or not.
        SetRefreshCookie(result.RefreshToken, result.Remember);
        return Ok(new { user = result.User, accessToken = result.AccessToken });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var raw = Request.Cookies[RefreshCookie];
        if (!string.IsNullOrEmpty(raw)) await _tokens.RevokeByRawTokenAsync(raw);
        // Signing out starts afresh (owner, 2026-10-01): no page to come back to, no kept work.
        if (Guid.TryParse(CurrentUser.Id(User), out var me))
        {
            await _db.StaffPreferences.Where(p => p.StaffId == me && p.Key == LastPageKey).ExecuteDeleteAsync();
            await _db.WorkDrafts.Where(d => d.StaffId == me).ExecuteDeleteAsync();
        }
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "auth.logout", "auth",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString());
        Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = RefreshPath });
        return Ok(new { ok = true });
    }

    /// <summary>Who's signed in: their permissions as in their token, and what they may work with now.</summary>
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var staff = Guid.TryParse(CurrentUser.Id(User), out var id)
            ? await _db.Staff.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id)
            : null;
        if (staff is null) return Unauthorized(new { message = "No session", code = "NO_SESSION" });
        return Ok(TokenService.ToDto(staff, User.FindAll("permission").Select(c => c.Value).ToArray(),
            await _access.ForAsync(staff)));
    }

    private SessionContext Context() => new(
        HttpContext.Connection.RemoteIpAddress?.ToString(),
        Request.Headers.UserAgent.ToString());

    private void SetRefreshCookie(string token, bool remember)
    {
        var secure = bool.Parse(_config["Cookie:Secure"] ?? "false");
        var ttl = int.Parse(_config["Jwt:RefreshTtlSeconds"] ?? "2592000");
        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = RefreshPath,
            Expires = remember ? DateTimeOffset.UtcNow.AddSeconds(ttl) : null,
        };
        Response.Cookies.Append(RefreshCookie, token, options);
    }
}
