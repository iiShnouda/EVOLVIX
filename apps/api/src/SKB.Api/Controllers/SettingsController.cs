using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/settings")]
[Authorize]
public sealed class SettingsController : ControllerBase
{
    private readonly AppDbContext _db;
    public SettingsController(AppDbContext db) => _db = db;

    /// <summary>
    /// Non-sensitive company/pricing defaults the invoice screen needs (currency, suggested markup,
    /// the profit floor, default tax). Readable by any signed-in user; a management endpoint comes later.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<CompanySettingsDto>> Get()
    {
        var s = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        return Ok(Mapper.ToSettings(s));
    }
}
