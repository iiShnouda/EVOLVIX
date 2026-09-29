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
    private readonly AiTranslator _translator;
    private readonly TranslationStatus _translation;
    public SettingsController(AppDbContext db, AuditService audit, AiTranslator translator, TranslationStatus translation)
    {
        _db = db;
        _audit = audit;
        _translator = translator;
        _translation = translation;
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

    /// <summary>AI translation of names: set up or not, how many names wait, and the last problem.</summary>
    [HttpGet("translation")]
    [Authorize(Policy = Permissions.SettingsView)]
    public async Task<ActionResult<TranslationStatusDto>> Translation()
    {
        var pending = await _db.Branches.CountAsync(e => e.NamePending)
            + await _db.Warehouses.CountAsync(e => e.NamePending)
            + await _db.Categories.CountAsync(e => e.NamePending)
            + await _db.Products.CountAsync(e => e.NamePending)
            + await _db.Units.CountAsync(e => e.NamePending)
            + await _db.PriceLevels.CountAsync(e => e.NamePending)
            + await _db.ProductModels.CountAsync(e => e.NamePending)
            + await _db.VariantOptions.CountAsync(e => e.NamePending);
        return Ok(new TranslationStatusDto(_translator.IsConfigured, pending, _translation.LastError,
            _translation.LastSuccessAt?.ToString("o")));
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
        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "update", "settings",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), s.Id.ToString());

        return Ok(Mapper.ToSettings(s));
    }
}
