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
    public PartiesController(AppDbContext db) => _db = db;

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
}
