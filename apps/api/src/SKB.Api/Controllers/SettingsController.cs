using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/settings")]
[Authorize]
public sealed class SettingsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    public SettingsController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    /// <summary>
    /// Company + pricing defaults the invoice screen needs (country, currency, suggested markup,
    /// the profit floor, default tax). Readable by any signed-in user.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<CompanySettingsDto>> Get()
    {
        var s = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        return Ok(Mapper.ToSettings(s));
    }

    /// <summary>Update company settings (country, currency, VAT, markup, floor). Owner/Admin only.</summary>
    [HttpPut]
    [Authorize(Policy = Permissions.SettingsManage)]
    public async Task<ActionResult<CompanySettingsDto>> Update([FromBody] UpdateSettingsRequest req)
    {
        var s = await _db.CompanySettings.FirstOrDefaultAsync();
        if (s is null)
        {
            s = new CompanySettings();
            _db.CompanySettings.Add(s);
        }

        if (!string.IsNullOrWhiteSpace(req.CompanyName)) s.CompanyName = req.CompanyName.Trim();
        if (!string.IsNullOrWhiteSpace(req.Country)) s.Country = req.Country.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(req.Currency)) s.Currency = req.Currency.Trim().ToUpperInvariant();
        if (req.DefaultTaxPercent is int tax) s.DefaultTaxPercent = Math.Clamp(tax, 0, 100);
        if (req.DefaultMarkupPercent is int mk) s.DefaultMarkupPercent = Math.Clamp(mk, 0, 1000);
        if (req.MinMarkupPercent is int min) s.MinMarkupPercent = Math.Clamp(min, 0, 1000);
        if (req.TransfersRequireReceipt is bool receipt) s.TransfersRequireReceipt = receipt;
        if (req.CompanyName is not null && req.CompanyName.Trim().Length > 200)
            return BadRequest(new { message = "The name is too long.", code = "bad_name" });
        if (req.Address is not null) s.Address = Text(req.Address, 300);
        if (req.Phone is not null) s.Phone = Text(req.Phone, 60);
        if (req.TaxNumber is not null) s.TaxNumber = Text(req.TaxNumber, 60);
        if (req.CommercialRegister is not null) s.CommercialRegister = Text(req.CommercialRegister, 60);
        if (req.Email is not null)
        {
            var e = Text(req.Email, 200)?.ToLowerInvariant();
            if (e is not null && !(System.Net.Mail.MailAddress.TryCreate(e, out var a) && a.Address == e))
                return BadRequest(new { message = "Enter a valid email.", code = "bad_email" });
            s.Email = e;
        }
        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "update", "settings",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), s.Id.ToString());

        return Ok(Mapper.ToSettings(s));
    }

    private static string? Text(string s, int max)
    {
        var t = s.Trim();
        return t.Length == 0 ? null : t[..Math.Min(max, t.Length)];
    }
}
