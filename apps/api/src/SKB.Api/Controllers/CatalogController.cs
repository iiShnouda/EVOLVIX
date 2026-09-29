using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The company-wide lists items are built from (DOMAIN.md §2.2): units of measure (وحدات),
/// categories (مجموعات), price levels (مستويات الأسعار) and the sizes and colors (مقاسات / ألوان) of
/// item models. Anyone who sees stock can read them; each list is managed under its own permission.
/// Names are kept exactly as typed. Nothing is deleted: entries are closed, so history keeps its names.
/// </summary>
[ApiController]
[Route("api")]
public sealed class CatalogController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public CatalogController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    // ------------------------------------------------------------------ units

    [HttpGet("units")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<UnitDto[]>> Units()
    {
        var units = await _db.Units.AsNoTracking().ToListAsync();
        var counts = await _db.ItemUnits.GroupBy(u => u.UnitId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(units.OrderByDescending(u => u.IsActive).ThenBy(u => Loc.Name(u))
            .Select(u => ToDto(u, counts.GetValueOrDefault(u.Id))).ToArray());
    }

    [HttpPost("units")]
    [Authorize(Policy = Permissions.UnitsManage)]
    public async Task<ActionResult<UnitDto>> CreateUnit([FromBody] CreateNamedRequest req)
    {
        var unit = new Unit();
        var error = await NameAsync(unit, req.Name, _db.Units, "unit");
        if (error is not null) return error;
        _db.Units.Add(unit);
        await SaveAsync("create", "unit", unit.Id);
        return Created($"/api/units/{unit.Id}", ToDto(unit, 0));
    }

    [HttpPut("units/{id:guid}")]
    [Authorize(Policy = Permissions.UnitsManage)]
    public async Task<ActionResult<UnitDto>> UpdateUnit(Guid id, [FromBody] UpdateNamedRequest req)
    {
        var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == id);
        if (unit is null) return NotFound(new { message = "Unit not found.", code = "unit_not_found" });
        var error = await RenameAsync(unit, req, _db.Units, "unit");
        if (error is not null) return error;
        if (req.IsActive is bool active) unit.IsActive = active;
        await SaveAsync("update", "unit", unit.Id);
        return Ok(ToDto(unit, await _db.ItemUnits.CountAsync(u => u.UnitId == id)));
    }

    // ------------------------------------------------------------------ categories

    [HttpGet("categories")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<CategoryDto[]>> Categories()
    {
        var categories = await _db.Categories.AsNoTracking().ToListAsync();
        var counts = await _db.Products.Where(p => p.IsActive).GroupBy(p => p.CategoryId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(categories.OrderBy(c => Loc.Name(c))
            .Select(c => new CategoryDto(c.Id.ToString(), Loc.Name(c), counts.GetValueOrDefault(c.Id)))
            .ToArray());
    }

    [HttpPost("categories")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<CategoryDto>> CreateCategory([FromBody] CreateNamedRequest req)
    {
        var category = new Category();
        var error = await NameAsync(category, req.Name, _db.Categories, "category");
        if (error is not null) return error;
        _db.Categories.Add(category);
        await SaveAsync("create", "category", category.Id);
        return Created($"/api/categories/{category.Id}",
            new CategoryDto(category.Id.ToString(), Loc.Name(category), 0));
    }

    [HttpPut("categories/{id:guid}")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<CategoryDto>> UpdateCategory(Guid id, [FromBody] UpdateNamedRequest req)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id);
        if (category is null) return NotFound(new { message = "Category not found.", code = "category_not_found" });
        var error = await RenameAsync(category, req, _db.Categories, "category");
        if (error is not null) return error;
        await SaveAsync("update", "category", category.Id);
        return Ok(new CategoryDto(category.Id.ToString(), Loc.Name(category),
            await _db.Products.CountAsync(p => p.CategoryId == id && p.IsActive)));
    }

    // ------------------------------------------------------------------ price levels

    [HttpGet("price-levels")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<PriceLevelDto[]>> PriceLevels() =>
        Ok((await PriceBook.LevelsAsync(_db)).Select(Mapper.ToPriceLevel).ToArray());

    [HttpPost("price-levels")]
    [Authorize(Policy = Permissions.PriceLevelsManage)]
    public async Task<ActionResult<PriceLevelDto>> CreatePriceLevel([FromBody] CreatePriceLevelRequest req)
    {
        if (!Enum.TryParse<PriceSide>(req.Side, true, out var side))
            return BadRequest(new { message = "Choose sales or purchases.", code = "bad_side" });
        var sameSide = _db.PriceLevels.Where(l => l.Side == side);
        var level = new PriceLevel
        {
            Side = side,
            SortOrder = (await sameSide.MaxAsync(l => (int?)l.SortOrder) ?? 0) + 1,
            IsDefault = !await sameSide.AnyAsync(l => l.IsActive && l.IsDefault),
        };
        var error = await NameAsync(level, req.Name, sameSide, "price level");
        if (error is not null) return error;
        _db.PriceLevels.Add(level);
        await SaveAsync("create", "price_level", level.Id);
        return Created($"/api/price-levels/{level.Id}", Mapper.ToPriceLevel(level));
    }

    [HttpPut("price-levels/{id:guid}")]
    [Authorize(Policy = Permissions.PriceLevelsManage)]
    public async Task<ActionResult<PriceLevelDto>> UpdatePriceLevel(Guid id, [FromBody] UpdatePriceLevelRequest req)
    {
        var level = await _db.PriceLevels.FirstOrDefaultAsync(l => l.Id == id);
        if (level is null) return NotFound(new { message = "Price level not found.", code = "price_level_not_found" });
        var error = await RenameAsync(level, new UpdateNamedRequest(req.Name),
            _db.PriceLevels.Where(l => l.Side == level.Side), "price level");
        if (error is not null) return error;
        if (req.SortOrder is int order) level.SortOrder = Math.Clamp(order, 0, 1000);

        if (req.IsActive == false && level.IsActive)
        {
            if (level.IsDefault)
                return BadRequest(new
                {
                    message = "This is the default price level. Make another level the default first.",
                    code = "price_level_is_default",
                });
            level.IsActive = false;
        }
        else if (req.IsActive == true) level.IsActive = true;

        if (req.IsDefault == true && !level.IsDefault)
        {
            if (!level.IsActive)
                return BadRequest(new { message = "A closed price level can't be the default.", code = "price_level_inactive" });
            foreach (var other in await _db.PriceLevels.Where(l => l.Side == level.Side && l.Id != id && l.IsDefault).ToListAsync())
                other.IsDefault = false;
            level.IsDefault = true;
        }
        else if (req.IsDefault == false && level.IsDefault)
        {
            return BadRequest(new
            {
                message = "Each side needs a default price level. Make another one the default instead.",
                code = "default_required",
            });
        }

        await SaveAsync("update", "price_level", level.Id);
        // The default sales level is the list price shown on stock screens.
        if (level.Side == PriceSide.SALE && req.IsDefault == true)
        {
            await PriceBook.SyncListPricesAsync(_db, await _db.Products.Select(p => p.Id).ToListAsync());
            await _db.SaveChangesAsync();
        }
        return Ok(Mapper.ToPriceLevel(level));
    }

    // ------------------------------------------------------------------ sizes & colors

    [HttpGet("variant-options")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<VariantOptionDto[]>> VariantOptions([FromQuery] string? kind = null)
    {
        var q = _db.VariantOptions.AsNoTracking();
        if (Enum.TryParse<VariantKind>(kind, true, out var k)) q = q.Where(o => o.Kind == k);
        var rows = await q.ToListAsync();
        return Ok(rows.OrderBy(o => o.Kind).ThenBy(o => o.SortOrder).ThenBy(o => Loc.Name(o))
            .Select(Mapper.ToVariantOption).ToArray());
    }

    [HttpPost("variant-options")]
    [Authorize(Policy = Permissions.VariantOptionsManage)]
    public async Task<ActionResult<VariantOptionDto>> CreateVariantOption([FromBody] CreateVariantOptionRequest req)
    {
        if (!Enum.TryParse<VariantKind>(req.Kind, true, out var kind))
            return BadRequest(new { message = "Choose size or color.", code = "bad_kind" });
        var sameKind = _db.VariantOptions.Where(o => o.Kind == kind);
        var option = new VariantOption
        {
            Kind = kind,
            SortOrder = (await sameKind.MaxAsync(o => (int?)o.SortOrder) ?? 0) + 1,
        };
        var error = await NameAsync(option, req.Name, sameKind,
            kind == VariantKind.SIZE ? "size" : "color");
        if (error is not null) return error;
        _db.VariantOptions.Add(option);
        await SaveAsync("create", "variant_option", option.Id);
        return Created($"/api/variant-options/{option.Id}", Mapper.ToVariantOption(option));
    }

    [HttpPut("variant-options/{id:guid}")]
    [Authorize(Policy = Permissions.VariantOptionsManage)]
    public async Task<ActionResult<VariantOptionDto>> UpdateVariantOption(Guid id, [FromBody] UpdateNamedRequest req)
    {
        var option = await _db.VariantOptions.FirstOrDefaultAsync(o => o.Id == id);
        if (option is null) return NotFound(new { message = "Size or color not found.", code = "variant_option_not_found" });
        var error = await RenameAsync(option, req, _db.VariantOptions.Where(o => o.Kind == option.Kind),
            option.Kind == VariantKind.SIZE ? "size" : "color");
        if (error is not null) return error;
        if (req.SortOrder is int order) option.SortOrder = Math.Clamp(order, 0, 1000);
        if (req.IsActive is bool active) option.IsActive = active;
        await SaveAsync("update", "variant_option", option.Id);
        // Variant names are made from it: "Shirt X — Red / L".
        await Catalog.RefreshVariantNamesAsync(_db, Array.Empty<Guid>(), new[] { option.Id });
        return Ok(Mapper.ToVariantOption(option));
    }

    // ------------------------------------------------------------------ helpers

    private static UnitDto ToDto(Unit u, int count) => new(u.Id.ToString(), Loc.Name(u), u.IsActive, count);

    /// <summary>Name a new entry from a create form; refuse an empty name or one another entry of the list has.</summary>
    private async Task<ActionResult?> NameAsync<T>(T entity, string? name, IQueryable<T> list, string what)
        where T : class, INamed
    {
        var clean = Loc.Clean(name);
        if (clean is null) return BadRequest(new { message = $"The {what} needs a name.", code = "bad_name" });
        entity.Name = clean;
        return await DuplicateAsync(entity, list, what);
    }

    private async Task<ActionResult?> RenameAsync<T>(T entity, UpdateNamedRequest req, IQueryable<T> list, string what)
        where T : class, INamed
    {
        if (req.Name is null) return null;
        return await NameAsync(entity, req.Name, list, what);
    }

    /// <summary>Two entries of one list can't share a name (ignoring case).</summary>
    private async Task<ActionResult?> DuplicateAsync<T>(T entity, IQueryable<T> list, string what)
        where T : class, INamed
    {
        var name = entity.Name.ToLower();
        var others = await list.AsNoTracking().ToListAsync();
        var clash = others.FirstOrDefault(o => IdOf(o) != IdOf(entity) && o.Name.ToLower() == name);
        return clash is null
            ? null
            : BadRequest(new { message = $"There is already a {what} called {clash.Name}.", code = "duplicate_name" });
    }

    private static Guid IdOf(INamed e) => e switch
    {
        Unit u => u.Id,
        Category c => c.Id,
        PriceLevel l => l.Id,
        VariantOption o => o.Id,
        _ => Guid.Empty,
    };

    private async Task SaveAsync(string action, string resource, Guid id)
    {
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
    }
}
