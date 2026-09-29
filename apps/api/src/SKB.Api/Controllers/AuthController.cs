using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private const string RefreshCookie = "skb_rt";
    private const string RefreshPath = "/api/auth";

    private readonly AuthService _auth;
    private readonly TokenService _tokens;
    private readonly AuditService _audit;
    private readonly IConfiguration _config;

    public AuthController(AuthService auth, TokenService tokens, AuditService audit, IConfiguration config)
    {
        _auth = auth;
        _tokens = tokens;
        _audit = audit;
        _config = config;
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
        if (result is null)
            return Unauthorized(new { message = "Invalid or expired session", code = "NO_SESSION" });

        SetRefreshCookie(result.RefreshToken, true);
        return Ok(new { user = result.User, accessToken = result.AccessToken });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var raw = Request.Cookies[RefreshCookie];
        if (!string.IsNullOrEmpty(raw)) await _tokens.RevokeByRawTokenAsync(raw);
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "auth.logout", "auth",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString());
        Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = RefreshPath });
        return Ok(new { ok = true });
    }

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        var role = CurrentUser.Role(User);
        var dto = new AuthUserDto(
            CurrentUser.Id(User),
            CurrentUser.Name(User),
            User.FindFirst("email")?.Value ?? "",
            role.ToString(),
            CurrentUser.BranchId(User),
            User.FindAll("permission").Select(c => c.Value).ToArray());
        return Ok(dto);
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
