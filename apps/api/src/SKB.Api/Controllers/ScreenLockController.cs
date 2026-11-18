using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The lock screen (owner, 2026-11-18: «remembering the device is pointless when everyone is signed out
/// after a while»). After the idle time a remembered device LOCKS instead of signing out: its session
/// stays (so the person only unlocks), but it can't be refreshed and its access tokens are refused
/// until the password — or a personal PIN, if the owner allows them — is given here. Five wrong tries
/// sign the device out. A device not remembered, or a company that chose "sign out", is signed out.
/// Every lock, unlock and wrong try is in the activity log.
/// </summary>
[ApiController]
[Route("api/auth")]
public sealed partial class ScreenLockController : ControllerBase
{
    /// <summary>Wrong passwords / PINs a locked screen takes before the device is signed out.</summary>
    public const int MaxUnlockFailures = 5;

    private readonly AppDbContext _db;
    private readonly TokenService _tokens;
    private readonly AuthService _auth;
    private readonly AuditService _audit;
    private readonly IPasswordHasher<Staff> _hasher;
    private readonly IConfiguration _config;

    public ScreenLockController(AppDbContext db, TokenService tokens, AuthService auth, AuditService audit,
        IPasswordHasher<Staff> hasher, IConfiguration config)
    {
        _db = db;
        _tokens = tokens;
        _auth = auth;
        _audit = audit;
        _hasher = hasher;
        _config = config;
    }

    private string? Ip => HttpContext.Connection.RemoteIpAddress?.ToString();
    private string UserAgent => Request.Headers.UserAgent.ToString();

    /// <summary>
    /// The app sat idle: lock this device's screen when it is remembered and the company locks;
    /// otherwise sign it out, as before.
    /// </summary>
    [Authorize]
    [HttpPost("lock")]
    public async Task<IActionResult> Lock()
    {
        var session = await _tokens.LiveSessionAsync(Request.Cookies[SessionCookie.Name]);
        var sid = User.FindFirst(TokenService.DeviceClaim)?.Value;
        if (session?.Staff is null || session.StaffId.ToString() != CurrentUser.Id(User) || session.DeviceId.ToString() != sid)
        {
            SessionCookie.Delete(Response);
            return Unauthorized(new { message = "No session", code = "NO_SESSION" });
        }
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        if (session.Remember && settings.IdleAction == "LOCK")
        {
            await _tokens.LockAsync(session);
            await _audit.RecordAsync(session.StaffId.ToString(), session.Staff.FullName, "auth.lock", "auth",
                session.Staff.BranchId.ToString(), Ip, UserAgent);
            return Ok(new { locked = true, name = session.Staff.FullName, pin = settings.PinUnlock && session.Staff.PinHash is not null });
        }
        await SignOutAsync(session, "idle", "auth.logout");
        return Ok(new { locked = false });
    }

    public sealed record UnlockRequest(string? Password, string? Pin);

    /// <summary>
    /// Open a locked screen with the password or the PIN, checked here. A wrong one counts; the fifth
    /// signs the device out. Limited per address like signing in.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [HttpPost("unlock")]
    public async Task<IActionResult> Unlock([FromBody] UnlockRequest req)
    {
        var raw = Request.Cookies[SessionCookie.Name];
        var session = await _tokens.LiveSessionAsync(raw);
        if (session?.Staff is null || !session.Staff.IsActive)
        {
            SessionCookie.Delete(Response);
            return Unauthorized(new { message = "No session", code = "NO_SESSION" });
        }
        var staff = session.Staff;
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        bool ok;
        if (!string.IsNullOrEmpty(req.Pin))
        {
            if (!settings.PinUnlock || staff.PinHash is null)
                return BadRequest(new { message = "Unlock with your password.", code = "PIN_NOT_ALLOWED" });
            ok = PinShape().IsMatch(req.Pin) && Verify(staff, staff.PinHash, req.Pin);
        }
        else if (!string.IsNullOrEmpty(req.Password))
            ok = Verify(staff, staff.PasswordHash, req.Password);
        else
            return BadRequest(new { message = "Enter your password.", code = "VALIDATION_ERROR" });

        if (!ok)
        {
            session.UnlockFailures++;
            await _db.SaveChangesAsync();
            await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.unlock.failed", "auth",
                staff.BranchId.ToString(), Ip, UserAgent, details: $"{session.UnlockFailures}/{MaxUnlockFailures}");
            if (session.UnlockFailures >= MaxUnlockFailures)
            {
                await SignOutAsync(session, "unlock_failed", "auth.unlock.signed_out");
                return Unauthorized(new { message = "Too many wrong tries: signed out.", code = "UNLOCK_SIGNED_OUT" });
            }
            return Unauthorized(new
            {
                message = "Wrong password or PIN.", code = "WRONG_UNLOCK", left = MaxUnlockFailures - session.UnlockFailures,
            });
        }

        session.LockedAt = null;
        session.UnlockFailures = 0;
        await _db.SaveChangesAsync();
        LockGate.Unlock(session.DeviceId);
        var result = await _auth.RefreshAsync(raw!, new SessionContext(Ip, UserAgent), unlocking: true);
        if (result is null || result.Refused is not null)
        {
            SessionCookie.Delete(Response);
            return Unauthorized(new
            {
                message = "Sign in again.",
                code = result?.Refused == "other_device" ? "SIGNED_IN_ELSEWHERE"
                    : result?.Refused == "license_expired" ? "LICENSE_EXPIRED" : "NO_SESSION",
            });
        }
        await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.unlock", "auth",
            staff.BranchId.ToString(), Ip, UserAgent, details: string.IsNullOrEmpty(req.Pin) ? "password" : "pin");
        SessionCookie.Set(Response, _config, result.RefreshToken, result.Remember ? result.ExpiresAt : null);
        return Ok(new { user = result.User, accessToken = result.AccessToken, remembered = result.Remember });
    }

    /// <summary>"Not me" / "Sign out" on the lock screen: the device is signed out without unlocking it.</summary>
    [AllowAnonymous]
    [HttpPost("lock/end")]
    public async Task<IActionResult> End()
    {
        var session = await _tokens.LiveSessionAsync(Request.Cookies[SessionCookie.Name]);
        if (session?.Staff is not null) await SignOutAsync(session, "logout", "auth.logout");
        else SessionCookie.Delete(Response);
        return Ok(new { ok = true });
    }

    /// <summary>Whether the person has a PIN, and whether the company lets PINs unlock.</summary>
    [Authorize]
    [HttpGet("pin")]
    public async Task<IActionResult> GetPin()
    {
        if (!Guid.TryParse(CurrentUser.Id(User), out var me)) return Unauthorized();
        var has = await _db.Staff.AsNoTracking().Where(s => s.Id == me).Select(s => s.PinHash != null).FirstOrDefaultAsync();
        var allowed = await _db.CompanySettings.AsNoTracking().Select(s => s.PinUnlock).FirstOrDefaultAsync();
        return Ok(new { hasPin = has, allowed });
    }

    public sealed record SetPinRequest(string? Pin, string? Password);

    /// <summary>Set (or change) one's own PIN: 4–6 digits, not all one digit or a plain run; the password confirms it.</summary>
    [Authorize]
    [EnableRateLimiting("login")]
    [HttpPut("pin")]
    public async Task<IActionResult> SetPin([FromBody] SetPinRequest req)
    {
        if (!Guid.TryParse(CurrentUser.Id(User), out var me)) return Unauthorized();
        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Id == me);
        if (staff is null) return Unauthorized();
        if (req.Pin is null || !PinShape().IsMatch(req.Pin))
            return BadRequest(new { message = "The PIN is 4 to 6 digits.", code = "bad_pin" });
        if (TooEasy(req.Pin))
            return BadRequest(new { message = "Choose a PIN that is harder to guess.", code = "weak_pin" });
        if (string.IsNullOrEmpty(req.Password) || !Verify(staff, staff.PasswordHash, req.Password))
        {
            await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.pin.failed", "auth",
                staff.BranchId.ToString(), Ip, UserAgent);
            return BadRequest(new { message = "The password is wrong.", code = "wrong_password" });
        }
        staff.PinHash = _hasher.HashPassword(staff, req.Pin);
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.pin.set", "auth",
            staff.BranchId.ToString(), Ip, UserAgent);
        return Ok(new { hasPin = true });
    }

    [Authorize]
    [HttpDelete("pin")]
    public async Task<IActionResult> ClearPin()
    {
        if (!Guid.TryParse(CurrentUser.Id(User), out var me)) return Unauthorized();
        var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Id == me);
        if (staff is null) return Unauthorized();
        staff.PinHash = null;
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(staff.Id.ToString(), staff.FullName, "auth.pin.clear", "auth",
            staff.BranchId.ToString(), Ip, UserAgent);
        return Ok(new { hasPin = false });
    }

    private bool Verify(Staff staff, string hash, string given) =>
        _hasher.VerifyHashedPassword(staff, hash, given)
            is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;

    /// <summary>All one digit (0000), or a plain run up or down (1234, 987654).</summary>
    private static bool TooEasy(string pin)
    {
        if (pin.Distinct().Count() == 1) return true;
        bool Run(int step) => pin.Zip(pin.Skip(1)).All(p => p.Second - p.First == step);
        return Run(1) || Run(-1);
    }

    /// <summary>The device is signed out: its session ends, and like any sign-out the kept page and drafts go.</summary>
    private async Task SignOutAsync(Session session, string reason, string action)
    {
        await _tokens.EndDeviceAsync(session.StaffId, session.DeviceId, reason);
        await _db.StaffPreferences.Where(p => p.StaffId == session.StaffId && p.Key == AuthController.LastPageKey)
            .ExecuteDeleteAsync();
        await _db.WorkDrafts.Where(d => d.StaffId == session.StaffId).ExecuteDeleteAsync();
        await _audit.RecordAsync(session.StaffId.ToString(), session.Staff?.FullName ?? "", action, "auth",
            session.Staff?.BranchId.ToString(), Ip, UserAgent, details: reason);
        SessionCookie.Delete(Response);
    }

    [GeneratedRegex("^[0-9]{4,6}$")]
    private static partial Regex PinShape();
}
