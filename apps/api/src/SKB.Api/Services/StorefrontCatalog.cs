using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Builds the public storefront catalogue (owner, 2026-10-12). Deliberately scrubbed: a name, its
/// department, colours and sizes, and whether it is in stock (never the count), plus a photo ref —
/// no cost, price, stock number, supplier or customer. Shared by the owner's read endpoint and the
/// publisher that pushes it outward to the KM Collection site.
/// </summary>
public static class StorefrontCatalog
{
    public static async Task<StorefrontCatalogDto> BuildAsync(AppDbContext db, CancellationToken ct = default)
    {
        var products = await db.Products.AsNoTracking()
            .Include(p => p.Size).Include(p => p.Color)
            .Include(p => p.Category).ThenInclude(c => c!.Department)
            .Include(p => p.Model)
            .Where(p => p.IsActive)
            .ToListAsync(ct);

        var items = new List<StorefrontItemDto>();
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

        var company = (await db.CompanySettings.AsNoTracking().FirstOrDefaultAsync(ct))?.CompanyName ?? "";
        var ordered = items.OrderBy(i => i.Name, StringComparer.Ordinal).ToArray();
        return new StorefrontCatalogDto(company, DateTime.UtcNow.ToString("o"), ordered.Length, ordered);
    }

    private static string? DeptOf(Product p) =>
        p.Category?.Department is { } d ? Loc.Name(d) : p.Category is { } c ? Loc.Name(c) : null;
}
