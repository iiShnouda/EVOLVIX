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
    /// <summary>The currencies amounts can be kept in: two decimals, as every amount is stored in hundredths.</summary>
    private static readonly HashSet<string> MoneyCurrencies =
        new() { "EGP", "SAR", "AED", "QAR", "USD", "EUR", "GBP", "TRY", "MAD", "DZD" };

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
        return Ok(Visible(Mapper.ToSettings(s)));
    }

    /// <summary>
    /// The settings as this person may see them: the selling markups on cost would let anyone work
    /// out what items cost, so only whoever sets prices or sees supply prices gets them.
    /// </summary>
    private CompanySettingsDto Visible(CompanySettingsDto dto) =>
        User.Has(Permissions.SettingsPricing) || Costs.CanSee(User)
            ? dto
            : dto with { DefaultMarkupPercent = 0, MinMarkupPercent = 0 };

    /// <summary>
    /// Update company settings. Each part is changed with its own permission (owner, 2026-10-23):
    /// the company's details, prices and tax, the stock and invoice rules, and security. A part sent
    /// back unchanged by someone who may not change it is left as it is; changing it is refused.
    /// </summary>
    [HttpPut]
    [AnyPermission(Permissions.SettingsCompany, Permissions.SettingsPricing, Permissions.SettingsRules,
        Permissions.SettingsSecurity)]
    public async Task<ActionResult<CompanySettingsDto>> Update([FromBody] UpdateSettingsRequest req)
    {
        var s = await _db.CompanySettings.FirstOrDefaultAsync();
        if (s is null)
        {
            s = new CompanySettings();
            _db.CompanySettings.Add(s);
        }
        static bool Differs<T>(T? asked, T now) where T : struct => asked is { } a && !a.Equals(now);
        static bool TextDiffers(string? asked, string? now, int max) => asked is not null && Text(asked, max) != now;
        var parts = new (string Permission, bool Changes)[]
        {
            (Permissions.SettingsCompany,
                (!string.IsNullOrWhiteSpace(req.CompanyName) && req.CompanyName.Trim() != s.CompanyName)
                || (!string.IsNullOrWhiteSpace(req.Country) && req.Country.Trim().ToUpperInvariant() != s.Country)
                || (!string.IsNullOrWhiteSpace(req.Currency) && req.Currency.Trim().ToUpperInvariant() != s.Currency)
                || (req.TimeZone is not null && req.TimeZone != s.TimeZone)
                || TextDiffers(req.Address, s.Address, 300) || TextDiffers(req.Phone, s.Phone, 60)
                || TextDiffers(req.TaxNumber, s.TaxNumber, 60) || TextDiffers(req.CommercialRegister, s.CommercialRegister, 60)
                || (req.Email is not null && Text(req.Email, 200)?.ToLowerInvariant() != s.Email)),
            (Permissions.SettingsPricing,
                Differs(req.DefaultTaxPercent is int t ? (int?)Math.Clamp(t, 0, 100) : null, s.DefaultTaxPercent)
                || Differs(req.DefaultMarkupPercent is int m ? (int?)Math.Clamp(m, 0, 1000) : null, s.DefaultMarkupPercent)
                || Differs(req.MinMarkupPercent is int n ? (int?)Math.Clamp(n, 0, 1000) : null, s.MinMarkupPercent)
                || Differs(req.MaxDiscountPercent is int d ? (int?)Math.Clamp(d, 0, 100) : null, s.MaxDiscountPercent)),
            (Permissions.SettingsRules,
                Differs(req.TransfersRequireReceipt, s.TransfersRequireReceipt)
                || Differs(req.PendingHoldDays is int h ? (int?)Math.Clamp(h, 0, 365) : null, s.PendingHoldDays)
                || Differs(req.RequireDepartment, s.RequireDepartment)
                || Differs(req.ReturnAfterHours is int r ? (int?)Math.Clamp(r, 0, 720) : null, s.ReturnAfterHours)
                || Differs(req.HideNewPlaces, s.HideNewPlaces)
                || (req.CurrentSeasonId is { } cs && cs != (s.CurrentSeasonId?.ToString() ?? ""))),
            (Permissions.SettingsSecurity, Differs(req.IdleMinutes is int i ? (int?)Math.Clamp(i, 0, 24 * 60) : null, s.IdleMinutes)),
        };
        if (parts.FirstOrDefault(x => x.Changes && !User.Has(x.Permission)) is { Permission: { } part })
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden", part });
        // Amounts are kept in hundredths: only a currency with two decimals (owner, 2026-10-24).
        if (!string.IsNullOrWhiteSpace(req.Currency) && req.Currency.Trim().ToUpperInvariant() is var asked
            && asked != s.Currency && !MoneyCurrencies.Contains(asked))
            return BadRequest(new { message = "Amounts are kept with two decimals: choose another currency.", code = "bad_currency" });

        if (!string.IsNullOrWhiteSpace(req.CompanyName)) s.CompanyName = req.CompanyName.Trim();
        if (!string.IsNullOrWhiteSpace(req.Country)) s.Country = req.Country.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(req.Currency)) s.Currency = req.Currency.Trim().ToUpperInvariant();
        if (req.DefaultTaxPercent is int tax) s.DefaultTaxPercent = Math.Clamp(tax, 0, 100);
        if (req.DefaultMarkupPercent is int mk) s.DefaultMarkupPercent = Math.Clamp(mk, 0, 1000);
        if (req.MinMarkupPercent is int min) s.MinMarkupPercent = Math.Clamp(min, 0, 1000);
        if (req.TransfersRequireReceipt is bool receipt) s.TransfersRequireReceipt = receipt;
        var limitChanged = req.MaxDiscountPercent is int newLimit && Math.Clamp(newLimit, 0, 100) != s.MaxDiscountPercent;
        if (req.MaxDiscountPercent is int maxDiscount) s.MaxDiscountPercent = Math.Clamp(maxDiscount, 0, 100);
        if (req.PendingHoldDays is int holdDays) s.PendingHoldDays = Math.Clamp(holdDays, 0, 365);
        if (req.RequireDepartment is bool requireDepartment) s.RequireDepartment = requireDepartment;
        if (req.ReturnAfterHours is int returnAfter) s.ReturnAfterHours = Math.Clamp(returnAfter, 0, 720);
        if (req.HideNewPlaces is bool hideNew) s.HideNewPlaces = hideNew;
        if (req.IdleMinutes is int idle) s.IdleMinutes = Math.Clamp(idle, 0, 24 * 60);
        // "" = back to automatic; else a season that exists and is in use.
        if (req.CurrentSeasonId is { } seasonId)
        {
            if (seasonId.Length == 0) s.CurrentSeasonId = null;
            else if (Guid.TryParse(seasonId, out var sid) && await _db.Seasons.AnyAsync(x => x.Id == sid && x.IsActive))
                s.CurrentSeasonId = sid;
            else return BadRequest(new { message = "Choose a season.", code = "bad_season" });
        }
        if (req.CompanyName is not null && req.CompanyName.Trim().Length > 200)
            return BadRequest(new { message = "The name is too long.", code = "bad_name" });
        if (req.Address is not null) s.Address = Text(req.Address, 300);
        if (req.Phone is not null) s.Phone = Text(req.Phone, 60);
        if (req.TaxNumber is not null) s.TaxNumber = Text(req.TaxNumber, 60);
        if (req.CommercialRegister is not null) s.CommercialRegister = Text(req.CommercialRegister, 60);
        if (req.TimeZone is not null)
        {
            if (!CompanyClock.IsKnown(req.TimeZone))
                return BadRequest(new { message = "Choose a time zone from the list.", code = "bad_time_zone" });
            s.TimeZone = req.TimeZone;
        }
        if (req.Email is not null)
        {
            var e = Text(req.Email, 200)?.ToLowerInvariant();
            if (e is not null && !(System.Net.Mail.MailAddress.TryCreate(e, out var a) && a.Address == e))
                return BadRequest(new { message = "Enter a valid email.", code = "bad_email" });
            s.Email = e;
        }
        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        // The company's discount limit is in everyone's sign-in: it holds from their next request.
        if (limitChanged) await AccessGate.ChangedAsync(_db, _db.Staff);
        CompanyClock.Use(s.TimeZone);
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "update", "settings",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), s.Id.ToString());

        return Ok(Visible(Mapper.ToSettings(s)));
    }

    /// <summary>The document kinds whose serial number (الرقم المسلسل) the company may shape.</summary>
    private static readonly DocumentType[] Numbered =
    {
        DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.QUOTATION, DocumentType.SALES_ORDER,
        DocumentType.PURCHASE_INVOICE, DocumentType.PURCHASE_RETURN,
    };

    /// <summary>How each kind of document is numbered, and the number the next one gets.</summary>
    [HttpGet("numbering")]
    public async Task<ActionResult<NumberingDto[]>> GetNumbering()
    {
        var rows = await _db.DocumentNumberings.AsNoTracking().ToDictionaryAsync(n => n.Type);
        var result = new List<NumberingDto>();
        foreach (var type in Numbered)
        {
            rows.TryGetValue(type.ToString(), out var n);
            result.Add(new NumberingDto(type.ToString(), n?.Prefix ?? "", n?.StartAt ?? 1, n?.Digits ?? 6, n is not null,
                await DocumentNumbers.NextAsync(_db, type)));
        }
        return Ok(result.ToArray());
    }

    /// <summary>
    /// Set how one kind of document is numbered (owner, 2026-10-01): a prefix such as "KM-" ({YYYY} =
    /// the year), the number to start at and the digits. Numbers never go back: the next one is
    /// past the highest already used with that prefix. An empty prefix = the built-in numbering.
    /// </summary>
    [HttpPut("numbering")]
    [Authorize(Policy = Permissions.SettingsNumbering)]
    public async Task<ActionResult<NumberingDto[]>> SaveNumbering([FromBody] SaveNumberingRequest req)
    {
        if (!Enum.TryParse<DocumentType>(req.Type, out var type) || !Numbered.Contains(type))
            return BadRequest(new { message = "Unknown document kind.", code = "bad_type" });
        var prefix = req.Prefix?.Trim() ?? "";
        var row = await _db.DocumentNumberings.FirstOrDefaultAsync(n => n.Type == type.ToString());
        if (prefix.Length == 0)
        {
            if (row is not null) _db.DocumentNumberings.Remove(row);
        }
        else
        {
            if (prefix.Length > 20 || !System.Text.RegularExpressions.Regex.IsMatch(prefix, @"^([A-Za-z0-9/._-]|\{YYYY\})+$")
                || char.IsDigit(prefix[^1]))
                return BadRequest(new { message = "Use letters, digits, - / . _ and {YYYY}, not ending in a digit.", code = "bad_prefix" });
            if (req.StartAt < 1 || req.StartAt > 999_999_999)
                return BadRequest(new { message = "Start from 1 to 999999999.", code = "bad_start" });
            if (req.Digits < 1 || req.Digits > 10)
                return BadRequest(new { message = "From 1 to 10 digits.", code = "bad_digits" });
            if (row is null) _db.DocumentNumberings.Add(row = new DocumentNumbering { Type = type.ToString() });
            row.Prefix = prefix;
            row.StartAt = req.StartAt;
            row.Digits = req.Digits;
            row.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "update", "numbering",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), type.ToString());
        return await GetNumbering();
    }

    private static string? Text(string s, int max)
    {
        var t = s.Trim();
        return t.Length == 0 ? null : t[..Math.Min(max, t.Length)];
    }
}
