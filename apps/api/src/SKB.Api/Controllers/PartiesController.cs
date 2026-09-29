using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/parties")]
[Authorize(Policy = Permissions.PartiesView)]
public sealed class PartiesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public PartiesController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedDto<PartyDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? type = null, [FromQuery] string? search = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.Parties.AsQueryable();
        if (!string.IsNullOrWhiteSpace(type)) q = q.Where(p => p.Types.Contains(type));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(p => p.Name.ToLower().Contains(s));
        }

        var total = await q.CountAsync();
        var rows = await q.OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new PaginatedDto<PartyDto>(rows.Select(Mapper.ToParty).ToArray(), total, page, pageSize));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PartyDto>> GetOne(Guid id)
    {
        var party = await _db.Parties.FindAsync(id);
        if (party is null) return NotFound(new { message = "Party not found" });
        return Ok(Mapper.ToParty(party));
    }

    /// <summary>
    /// A customer's / supplier's own price level: new invoices to them start at it. A null field is
    /// left as it is; "" goes back to the default level. Needs <c>parties:set_price_level</c>.
    /// </summary>
    [HttpPut("{id:guid}/price-levels")]
    [Authorize(Policy = Permissions.PartiesSetPriceLevel)]
    public async Task<ActionResult<PartyDto>> SetPriceLevels(Guid id, [FromBody] SetPartyPriceLevelsRequest req)
    {
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });

        async Task<(Guid? Id, bool Ok)> Pick(string? raw, PriceSide side)
        {
            if (raw == "") return (null, true);
            if (!Guid.TryParse(raw, out var levelId)) return (null, false);
            var ok = await _db.PriceLevels.AnyAsync(l => l.Id == levelId && l.Side == side && l.IsActive);
            return (levelId, ok);
        }

        if (req.SalesPriceLevelId is not null)
        {
            var (level, ok) = await Pick(req.SalesPriceLevelId, PriceSide.SALE);
            if (!ok) return BadRequest(new { message = "Price level not found.", code = "price_level_not_found" });
            party.SalesPriceLevelId = level;
        }
        if (req.PurchasePriceLevelId is not null)
        {
            var (level, ok) = await Pick(req.PurchasePriceLevelId, PriceSide.PURCHASE);
            if (!ok) return BadRequest(new { message = "Price level not found.", code = "price_level_not_found" });
            party.PurchasePriceLevelId = level;
        }
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "price_levels", "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
        return Ok(Mapper.ToParty(party));
    }
}
