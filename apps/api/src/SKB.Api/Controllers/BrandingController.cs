using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The company's own name and logo (owner, 2026-10-01): a buyer of Evolvix brands it with their
/// office's name and logo, shown beside the program's own mark. Read without signing in, so the
/// sign-in page can show them; only settings:manage changes the logo.
/// </summary>
[ApiController]
[Route("api/branding")]
public sealed class BrandingController : ControllerBase
{
    /// <summary>Largest logo accepted, after decoding (the app shrinks pictures before sending).</summary>
    public const int MaxLogoBytes = 512 * 1024;

    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    public BrandingController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<BrandingDto>> Get()
    {
        var s = await _db.CompanySettings.AsNoTracking()
            .Select(x => new BrandingDto(x.CompanyName, x.LogoVersion))
            .FirstOrDefaultAsync();
        return Ok(s ?? new BrandingDto("", 0));
    }

    [HttpGet("logo")]
    [AllowAnonymous]
    public async Task<IActionResult> Logo()
    {
        var logo = await _db.CompanyLogos.AsNoTracking().FirstOrDefaultAsync();
        if (logo is null) return NotFound();
        // An image only: never sniffed as anything else, never run as a page.
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
        Response.Headers.CacheControl = "no-cache";
        return File(logo.Data, logo.ContentType);
    }

    [HttpPut("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    public async Task<ActionResult<BrandingDto>> Upload([FromBody] UploadLogoRequest req)
    {
        var text = req.Data ?? "";
        var comma = text.StartsWith("data:", StringComparison.Ordinal) ? text.IndexOf(',') : -1;
        if (comma >= 0) text = text[(comma + 1)..];
        if (text.Length > MaxLogoBytes / 3 * 4 + 8)
            return BadRequest(new { message = "The logo is too big.", code = "logo_too_big" });

        byte[] data;
        try { data = Convert.FromBase64String(text); }
        catch (FormatException) { return BadRequest(new { message = "Choose a PNG, JPG or WebP picture.", code = "bad_logo" }); }
        if (data.Length > MaxLogoBytes)
            return BadRequest(new { message = "The logo is too big.", code = "logo_too_big" });
        var type = ImageType(data);
        if (type is null)
            return BadRequest(new { message = "Choose a PNG, JPG or WebP picture.", code = "bad_logo" });

        var s = await Settings();
        var logo = await _db.CompanyLogos.FirstOrDefaultAsync();
        if (logo is null) _db.CompanyLogos.Add(logo = new CompanyLogo());
        logo.Data = data;
        logo.ContentType = type;
        logo.UpdatedAt = DateTime.UtcNow;
        s.LogoVersion++;
        s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await Audit("update", s.Id);
        return Ok(new BrandingDto(s.CompanyName, s.LogoVersion));
    }

    [HttpDelete("logo")]
    [Authorize(Policy = Permissions.SettingsManage)]
    public async Task<ActionResult<BrandingDto>> Remove()
    {
        var s = await Settings();
        _db.CompanyLogos.RemoveRange(await _db.CompanyLogos.ToListAsync());
        s.LogoVersion = 0;
        s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await Audit("delete", s.Id);
        return Ok(new BrandingDto(s.CompanyName, 0));
    }

    private async Task<CompanySettings> Settings()
    {
        var s = await _db.CompanySettings.FirstOrDefaultAsync();
        if (s is null) _db.CompanySettings.Add(s = new CompanySettings());
        return s;
    }

    private Task Audit(string action, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "company_logo",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());

    /// <summary>The picture's real type from its first bytes (PNG, JPEG or WebP), else null.</summary>
    public static string? ImageType(byte[] d)
    {
        if (d.Length > 8 && d[0] == 0x89 && d[1] == 0x50 && d[2] == 0x4E && d[3] == 0x47
            && d[4] == 0x0D && d[5] == 0x0A && d[6] == 0x1A && d[7] == 0x0A) return "image/png";
        if (d.Length > 3 && d[0] == 0xFF && d[1] == 0xD8 && d[2] == 0xFF) return "image/jpeg";
        if (d.Length > 12 && d[0] == 'R' && d[1] == 'I' && d[2] == 'F' && d[3] == 'F'
            && d[8] == 'W' && d[9] == 'E' && d[10] == 'B' && d[11] == 'P') return "image/webp";
        return null;
    }
}
