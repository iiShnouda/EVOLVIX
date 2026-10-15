using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The licence page (owner, 2026-10-15; see <see cref="Licensing"/>), the owner's alone:
/// <list type="bullet">
/// <item>every company: its install id (to send to the vendor), its licence (customer, users bought,
/// users active, end date) and entering a new licence code;</item>
/// <item>the vendor's own server: loading the vendor's signing key once, then issuing licence codes
/// for customers and keeping a list of them. A key that isn't the vendor's is refused.</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/license")]
[Authorize(Policy = Permissions.LicenseManage)]
public sealed class LicenseController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly LicenseService _license;
    private readonly AuditService _audit;
    private readonly CryptoService _crypto;

    public LicenseController(AppDbContext db, LicenseService license, AuditService audit, CryptoService crypto)
    {
        _db = db;
        _license = license;
        _audit = audit;
        _crypto = crypto;
    }

    public sealed record StatusDto(string State, string InstallId, string? Customer, int? MaxUsers, int ActiveUsers,
        string? ExpiresAt, bool CanIssue, string? Error);
    public sealed record InstallRequest(string? Code);
    public sealed record KeyRequest(string? Pem);
    public sealed record IssueRequest(string? Customer, string? InstallId, int MaxUsers, string? ExpiresAt);
    public sealed record IssuedDto(string Id, string Customer, string InstallId, int MaxUsers, string? ExpiresAt,
        string Code, string IssuedBy, string CreatedAt);

    [HttpGet]
    public async Task<ActionResult<StatusDto>> Get() => Ok(ToDto(await _license.ReadAsync()));

    /// <summary>Enter the licence code the vendor sent (it must be genuine and for this server).</summary>
    [HttpPut]
    public async Task<ActionResult<StatusDto>> Install([FromBody] InstallRequest req)
    {
        var settings = await _db.CompanySettings.FirstOrDefaultAsync();
        if (settings is null) return NotFound();
        var (lic, error) = Licensing.Verify(req.Code, settings.InstallId);
        if (lic is null)
            return BadRequest(new { message = "This licence code isn't valid for this server.", code = error });
        settings.LicenseCode = string.Concat(req.Code!.Where(c => !char.IsWhiteSpace(c)));
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("install", $"{lic.C} · {(lic.U == 0 ? "∞" : lic.U)} · {lic.E:yyyy-MM-dd}");
        return Ok(ToDto(await _license.ReadAsync()));
    }

    /// <summary>The vendor loads their signing key once (PEM). Only the vendor's real key is accepted.</summary>
    [HttpPut("vendor-key")]
    public async Task<IActionResult> PutKey([FromBody] KeyRequest req)
    {
        var pkcs8 = req.Pem is { Length: > 0 and < 10_000 } pem ? Licensing.ReadPem(pem) : null;
        if (pkcs8 is null || !Licensing.IsVendorKey(pkcs8))
            return BadRequest(new { message = "This isn't the vendor's licence key.", code = "not_vendor_key" });
        var settings = await _db.CompanySettings.FirstAsync();
        settings.LicenseSigningKey = _crypto.Encrypt(Convert.ToBase64String(pkcs8));
        await _db.SaveChangesAsync();
        await AuditAsync("vendor_key");
        return NoContent();
    }

    [HttpDelete("vendor-key")]
    public async Task<IActionResult> DeleteKey()
    {
        var settings = await _db.CompanySettings.FirstAsync();
        settings.LicenseSigningKey = null;
        await _db.SaveChangesAsync();
        await AuditAsync("vendor_key_removed");
        return NoContent();
    }

    /// <summary>Issue a licence code for a customer (vendor's server only).</summary>
    [HttpPost("issue")]
    public async Task<ActionResult<IssuedDto>> Issue([FromBody] IssueRequest req)
    {
        var key = await _db.CompanySettings.Select(s => s.LicenseSigningKey).FirstOrDefaultAsync();
        if (key is null) return BadRequest(new { message = "Load the vendor key first.", code = "no_vendor_key" });
        var customer = req.Customer?.Trim();
        if (string.IsNullOrEmpty(customer) || customer.Length > 120)
            return BadRequest(new { message = "Enter the customer's name.", code = "bad_customer" });
        var any = req.InstallId?.Trim() == "*";
        if (!any && !Guid.TryParse(req.InstallId?.Trim(), out _))
            return BadRequest(new { message = "Paste the customer's install id.", code = "bad_install_id" });
        if (req.MaxUsers is < 0 or > 10_000)
            return BadRequest(new { message = "Enter how many users (0 = no limit).", code = "bad_users" });
        DateTime? expires = null;
        if (!string.IsNullOrWhiteSpace(req.ExpiresAt))
        {
            if (!DateOnly.TryParse(req.ExpiresAt, out var day) || day <= DateOnly.FromDateTime(DateTime.UtcNow))
                return BadRequest(new { message = "Choose an end date after today.", code = "bad_expiry" });
            expires = day.ToDateTime(new TimeOnly(23, 59, 59), DateTimeKind.Utc);
        }
        var installId = any ? "*" : Guid.Parse(req.InstallId!.Trim()).ToString();
        var pkcs8 = Convert.FromBase64String(_crypto.Decrypt(key));
        var code = Licensing.Sign(pkcs8, new Licensing.Payload(customer, installId, req.MaxUsers, expires, DateTime.UtcNow));
        var row = new IssuedLicense
        {
            Customer = customer, InstallId = any ? Guid.Empty : Guid.Parse(installId), MaxUsers = req.MaxUsers,
            ExpiresAt = expires, Code = code, IssuedBy = CurrentUser.Name(User),
        };
        _db.IssuedLicenses.Add(row);
        await _db.SaveChangesAsync();
        await AuditAsync("issue", $"{customer} · {(req.MaxUsers == 0 ? "∞" : req.MaxUsers)} · {expires:yyyy-MM-dd}");
        return Ok(ToDto(row));
    }

    [HttpGet("issued")]
    public async Task<ActionResult<IssuedDto[]>> Issued()
    {
        var rows = await _db.IssuedLicenses.AsNoTracking().OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync();
        return Ok(rows.Select(ToDto).ToArray());
    }

    private static StatusDto ToDto(LicenseService.Status s) => new(s.State, s.InstallId.ToString(), s.Customer,
        s.MaxUsers, s.ActiveUsers, s.ExpiresAt?.ToString("yyyy-MM-dd"), s.CanIssue, s.Error);

    private static IssuedDto ToDto(IssuedLicense r) => new(r.Id.ToString(), r.Customer,
        r.InstallId == Guid.Empty ? "*" : r.InstallId.ToString(), r.MaxUsers, r.ExpiresAt?.ToString("yyyy-MM-dd"),
        r.Code, r.IssuedBy, r.CreatedAt.ToString("o"));

    private Task AuditAsync(string action, string? details = null) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "license",
            CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(), details: details);
}
