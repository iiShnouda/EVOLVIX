using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The public storefront catalog (owner, 2026-10-12: show the office's products on the KM Collection
/// site). This endpoint is OWNER-ONLY (<c>settings:manage</c>): the company server never faces the
/// public. The owner reads this scrubbed catalog and publishes it OUTWARD to the storefront host; the
/// site reads the published copy, so there is no inbound path to this server to attack. The catalog
/// carries only what is meant to be public — names, departments, colours, sizes, and in-stock or not
/// — never a cost, a price, a stock count, a supplier or a customer. Photos are fetched per item from
/// the authenticated products/{id}/image endpoint while publishing, so no image hole is opened either.
/// </summary>
[ApiController]
[Route("api/storefront")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class StorefrontController : ControllerBase
{
    private readonly AppDbContext _db;

    public StorefrontController(AppDbContext db) => _db = db;

    [HttpGet("catalog")]
    public async Task<ActionResult<StorefrontCatalogDto>> Catalog()
    {
        var products = await _db.Products.AsNoTracking()
            .Include(p => p.Size).Include(p => p.Color)
            .Include(p => p.Category).ThenInclude(c => c!.Department)
            .Include(p => p.Model)
            .Where(p => p.IsActive)
            .ToListAsync();

        var items = new List<StorefrontItemDto>();
        // A model's size/colour variants roll up into one catalogue line; a standalone item stands alone.
        foreach (var group in products.GroupBy(p => p.ModelId))
        {
            if (group.Key is not null)
            {
                var vs = group.ToList();
                var first = vs.FirstOrDefault(v => v.HasImage) ?? vs[0];
                items.Add(new StorefrontItemDto(
                    first.Id.ToString(),
                    first.Model is { } m ? Loc.Name(m) : Loc.Name(first),
                    DeptOf(first),
                    vs.Where(v => v.Color is not null).Select(v => Loc.Name(v.Color!)).Distinct().ToArray(),
                    vs.Where(v => v.Size is not null).Select(v => Loc.Name(v.Size!)).Distinct().ToArray(),
                    vs.Any(v => v.StockOnHand > 0),
                    vs.Any(v => v.HasImage)));
            }
            else
            {
                foreach (var p in group)
                    items.Add(new StorefrontItemDto(
                        p.Id.ToString(), Loc.Name(p), DeptOf(p),
                        p.Color is not null ? [Loc.Name(p.Color)] : [],
                        p.Size is not null ? [Loc.Name(p.Size)] : [],
                        p.StockOnHand > 0, p.HasImage));
            }
        }

        var company = (await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync())?.CompanyName ?? "";
        var ordered = items.OrderBy(i => i.Name, StringComparer.Ordinal).ToArray();
        return Ok(new StorefrontCatalogDto(company, DateTime.UtcNow.ToString("o"), ordered.Length, ordered));
    }

    private static string? DeptOf(Product p) =>
        p.Category?.Department is { } d ? Loc.Name(d) : p.Category is { } c ? Loc.Name(c) : null;
}
