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
        var unit = new Unit { Pieces = Math.Clamp(req.Pieces ?? 1, 1, 100000) };
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
        if (req.Pieces is int pieces) unit.Pieces = Math.Clamp(pieces, 1, 100000);
        await SaveAsync("update", "unit", unit.Id);
        return Ok(ToDto(unit, await _db.ItemUnits.CountAsync(u => u.UnitId == id)));
    }


    /// <summary>Delete a unit no item, model, price or invoice uses (owner, 2026-10-21); else close it.</summary>
    [HttpDelete("units/{id:guid}")]
    [Authorize(Policy = Permissions.SetupDelete)]
    public async Task<IActionResult> DeleteUnit(Guid id)
    {
        var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == id);
        if (unit is null) return NotFound(new { message = "Unit not found.", code = "unit_not_found" });
        if (await _db.ItemUnits.AnyAsync(u => u.UnitId == id) || await _db.ModelUnits.AnyAsync(u => u.UnitId == id)
            || await _db.PriceListItems.AnyAsync(u => u.UnitId == id) || await _db.DocumentLines.AnyAsync(l => l.UnitId == id))
            return InUse();
        _db.Units.Remove(unit);
        return await RemoveAsync("unit", id, Loc.Name(unit));
    }

    // ------------------------------------------------------------------ categories

    [HttpGet("categories")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<CategoryDto[]>> Categories()
    {
        var categories = await _db.Categories.AsNoTracking().Include(c => c.Department).ToListAsync();
        var counts = await _db.Products.Where(p => p.IsActive).GroupBy(p => p.CategoryId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(categories.OrderBy(c => Loc.Name(c))
            .Select(c => ToDto(c, counts.GetValueOrDefault(c.Id)))
            .ToArray());
    }

    [HttpPost("categories")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<CategoryDto>> CreateCategory([FromBody] CreateCategoryRequest req)
    {
        var category = new Category();
        var error = await NameAsync(category, req.Name, _db.Categories, "category")
                    ?? await DepartmentAsync(category, req.DepartmentId);
        if (error is not null) return error;
        _db.Categories.Add(category);
        await SaveAsync("create", "category", category.Id);
        return Created($"/api/categories/{category.Id}", ToDto(category, 0));
    }

    [HttpPut("categories/{id:guid}")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<CategoryDto>> UpdateCategory(Guid id, [FromBody] UpdateCategoryRequest req)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id);
        if (category is null) return NotFound(new { message = "Category not found.", code = "category_not_found" });
        var error = await RenameAsync(category, new UpdateNamedRequest(req.Name), _db.Categories, "category")
                    ?? await DepartmentAsync(category, req.DepartmentId);
        if (error is not null) return error;
        await SaveAsync("update", "category", category.Id);
        return Ok(ToDto(category, await _db.Products.CountAsync(p => p.CategoryId == id && p.IsActive)));
    }

    /// <summary>Put a category in a department ("" = none; null = leave it).</summary>
    private async Task<ActionResult?> DepartmentAsync(Category category, string? raw)
    {
        if (raw is null) return null;
        if (raw.Length == 0)
        {
            category.DepartmentId = null;
            category.Department = null;
            return null;
        }
        var department = Guid.TryParse(raw, out var id)
            ? await _db.Departments.FirstOrDefaultAsync(d => d.Id == id && d.IsActive)
            : null;
        if (department is null) return BadRequest(new { message = "Department not found.", code = "department_not_found" });
        category.DepartmentId = department.Id;
        category.Department = department;
        return null;
    }

    private static CategoryDto ToDto(Category c, int count) => new(c.Id.ToString(), Loc.Name(c), count,
        c.DepartmentId?.ToString(), c.Department is null ? null : Loc.Name(c.Department));

    // ------------------------------------------------------------------ department tree

    /// <summary>
    /// Every group of every department's tree (owner, 2026-10-06), for the setup screen, the filters
    /// and the item-name reader. Anyone signed in may read them, like departments.
    /// </summary>
    [HttpGet("groups")]
    [Authorize]
    public async Task<ActionResult<GroupDto[]>> Groups()
    {
        var all = await _db.Categories.AsNoTracking().ToListAsync();
        var counts = await _db.Products.Where(p => p.IsActive).GroupBy(p => p.CategoryId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(all.Where(c => !c.IsRoot && c.DepartmentId != null)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
            .Select(c => ToGroupDto(c, Catalog.Subtree(c.Id, all).Sum(id => counts.GetValueOrDefault(id))))
            .ToArray());
    }

    [HttpPost("groups")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<GroupDto>> CreateGroup([FromBody] CreateGroupRequest req)
    {
        var department = Guid.TryParse(req.DepartmentId, out var did)
            ? await _db.Departments.FirstOrDefaultAsync(d => d.Id == did) : null;
        if (department is null) return BadRequest(new { message = "Department not found.", code = "department_not_found" });
        var group = new Category { DepartmentId = department.Id };
        var error = await ParentAsync(group, req.ParentId ?? "") ?? GroupFields(group, req.Name, req.Prefix, req.Keywords)
                    ?? await SiblingClashAsync(group);
        if (error is not null) return error;
        group.SortOrder = await _db.Categories.CountAsync(c => c.DepartmentId == department.Id && c.ParentId == group.ParentId && !c.IsRoot);
        _db.Categories.Add(group);
        await SaveAsync("create", "group", group.Id);
        return Created($"/api/groups/{group.Id}", ToGroupDto(group, 0));
    }

    [HttpPut("groups/{id:guid}")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<GroupDto>> UpdateGroup(Guid id, [FromBody] UpdateGroupRequest req)
    {
        var group = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id && !c.IsRoot && c.DepartmentId != null);
        if (group is null) return NotFound(new { message = "Group not found.", code = "group_not_found" });
        var error = (req.ParentId is null ? null : await ParentAsync(group, req.ParentId))
                    ?? GroupFields(group, req.Name, req.Prefix, req.Keywords)
                    ?? await SiblingClashAsync(group);
        if (error is not null) return error;
        if (req.IsActive is bool active) group.IsActive = active;
        if (req.SortOrder is int order) group.SortOrder = Math.Clamp(order, 0, 10000);
        await SaveAsync("update", "group", group.Id);
        var all = await _db.Categories.AsNoTracking().ToListAsync();
        var under = Catalog.Subtree(id, all);
        return Ok(ToGroupDto(group, await _db.Products.CountAsync(p => p.IsActive && under.Contains(p.CategoryId))));
    }

    /// <summary>Delete a sub-group with no items and no sub-groups under it (owner, 2026-10-21).</summary>
    [HttpDelete("groups/{id:guid}")]
    [Authorize(Policy = Permissions.SetupDelete)]
    public async Task<IActionResult> DeleteGroup(Guid id)
    {
        var group = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id && !c.IsRoot && c.DepartmentId != null);
        if (group is null) return NotFound(new { message = "Group not found.", code = "group_not_found" });
        if (await _db.Categories.AnyAsync(c => c.ParentId == id) || await _db.Products.AnyAsync(p => p.CategoryId == id)
            || await _db.ProductModels.AnyAsync(m => m.CategoryId == id))
            return InUse();
        _db.Categories.Remove(group);
        return await RemoveAsync("group", id, Loc.Name(group));
    }

    /// <summary>Put a group under another of the same department ("" = straight under the department), never under itself.</summary>
    private async Task<ActionResult?> ParentAsync(Category group, string raw)
    {
        if (raw.Length == 0)
        {
            group.ParentId = null;
            return null;
        }
        var all = await _db.Categories.AsNoTracking().ToListAsync();
        var parent = Guid.TryParse(raw, out var pid) ? all.FirstOrDefault(c => c.Id == pid && !c.IsRoot) : null;
        if (parent is null || parent.DepartmentId != group.DepartmentId)
            return BadRequest(new { message = "Choose a group of the same department.", code = "group_not_found" });
        if (Catalog.Subtree(group.Id, all).Contains(parent.Id))
            return BadRequest(new { message = "A group can't go under itself.", code = "group_loop" });
        group.ParentId = parent.Id;
        return null;
    }

    /// <summary>Name, code prefix and keywords of a group (null = leave as is).</summary>
    private ActionResult? GroupFields(Category group, string? name, string? prefix, string[]? keywords)
    {
        if (name is not null || group.Name.Length == 0)
        {
            var clean = Loc.Clean(name);
            if (clean is null) return BadRequest(new { message = "The group needs a name.", code = "bad_name" });
            group.Name = clean;
        }
        var (given, value, bad) = Catalog.Prefix(prefix);
        if (bad) return BadRequest(new { message = "A prefix is up to 10 letters or digits.", code = "bad_prefix" });
        if (given) group.Prefix = value;
        if (keywords is not null)
        {
            var words = keywords.Select(k => Loc.Clean(k)).Where(k => k is not null)
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(40).ToArray();
            var joined = string.Join('\n', words);
            group.Keywords = joined.Length == 0 ? null : joined[..Math.Min(2000, joined.Length)];
        }
        return null;
    }

    /// <summary>Two groups side by side (same department and parent) can't share a name.</summary>
    private async Task<ActionResult?> SiblingClashAsync(Category group)
    {
        var name = group.Name.ToLower();
        var clash = await _db.Categories.AsNoTracking().AnyAsync(c => c.Id != group.Id && !c.IsRoot
            && c.DepartmentId == group.DepartmentId && c.ParentId == group.ParentId && c.Name.ToLower() == name);
        return clash
            ? BadRequest(new { message = $"There is already a group called {group.Name} here.", code = "duplicate_name" })
            : null;
    }

    private static GroupDto ToGroupDto(Category c, int count) => new(c.Id.ToString(), Loc.Name(c),
        c.DepartmentId!.Value.ToString(), c.ParentId?.ToString(), c.Prefix,
        (c.Keywords ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries), c.IsActive, c.SortOrder, count);

    // ------------------------------------------------------------------ sales departments

    /// <summary>The sales departments (أقسام), open ones first. Anyone signed in may read them.</summary>
    [HttpGet("departments")]
    [Authorize]
    public async Task<ActionResult<DepartmentDto[]>> Departments()
    {
        var departments = await _db.Departments.AsNoTracking().ToListAsync();
        var counts = await _db.Categories.Where(c => c.DepartmentId != null).GroupBy(c => c.DepartmentId!.Value)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var items = await _db.Products.Where(p => p.IsActive && p.Category!.DepartmentId != null)
            .GroupBy(p => p.Category!.DepartmentId!.Value)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var links = (await _db.WarehouseDepartments.AsNoTracking().ToListAsync())
            .GroupBy(l => l.DepartmentId).ToDictionary(g => g.Key, g => g.Select(l => l.WarehouseId.ToString()).ToArray());
        return Ok(departments.OrderByDescending(d => d.IsActive).ThenBy(d => Loc.Name(d))
            .Select(d => ToDto(d, counts.GetValueOrDefault(d.Id)) with
            {
                WarehouseIds = links.GetValueOrDefault(d.Id, Array.Empty<string>()),
                ItemCount = items.GetValueOrDefault(d.Id),
            }).ToArray());
    }

    /// <summary>
    /// A new department, in the warehouses chosen (owner, 2026-10-11: "it should ask which branch it is
    /// in"); every other warehouse goes on without it.
    /// </summary>
    [HttpPost("departments")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<DepartmentDto>> CreateDepartment([FromBody] CreateNamedRequest req,
        [FromServices] AccessService access, [FromServices] WarehouseService warehouses)
    {
        var department = new Department();
        var error = await NameAsync(department, req.Name, _db.Departments, "department")
                    ?? PrefixOf(department, req.Prefix);
        if (error is not null) return error;
        _db.Departments.Add(department);
        error = await PlaceAsync(department.Id, req.WarehouseIds, warehouses, creating: true);
        if (error is not null) return error;
        await access.KeepNewHiddenAsync(NewKind.Department, department.Id, CurrentUser.Id(User));
        await SaveAsync("create", "department", department.Id);
        return Created($"/api/departments/{department.Id}", ToDto(department, 0) with
        {
            WarehouseIds = await LinksAsync(department.Id),
        });
    }

    /// <summary>Rename, close or reopen a department, or change its warehouses. Its old sales keep its name.</summary>
    [HttpPut("departments/{id:guid}")]
    [Authorize(Policy = Permissions.CategoriesManage)]
    public async Task<ActionResult<DepartmentDto>> UpdateDepartment(Guid id, [FromBody] UpdateNamedRequest req,
        [FromServices] WarehouseService warehouses)
    {
        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id);
        if (department is null) return NotFound(new { message = "Department not found.", code = "department_not_found" });
        var error = await RenameAsync(department, req, _db.Departments, "department")
                    ?? PrefixOf(department, req.Prefix)
                    ?? await PlaceAsync(id, req.WarehouseIds, warehouses);
        if (error is not null) return error;
        if (req.IsActive is bool active) department.IsActive = active;
        await SaveAsync("update", "department", department.Id);
        return Ok(ToDto(department, await _db.Categories.CountAsync(c => c.DepartmentId == id)) with
        {
            WarehouseIds = await LinksAsync(id),
        });
    }

    /// <summary>
    /// Delete a department that has nothing recorded under it (owner, 2026-10-11): no items, and no
    /// sales, returns or quotations. Its groups go with it, and it leaves the warehouses and people
    /// that had it. One that has things recorded can be closed instead.
    /// </summary>
    [HttpDelete("departments/{id:guid}")]
    [Authorize(Policy = Permissions.DepartmentsDelete)]
    public async Task<IActionResult> DeleteDepartment(Guid id)
    {
        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id);
        if (department is null) return NotFound(new { message = "Department not found.", code = "department_not_found" });
        if (await _db.SalesDocuments.AnyAsync(d => d.DepartmentId == id)
            || await _db.Products.AnyAsync(p => p.Category!.DepartmentId == id))
            return InUse();
        await using var tx = await _db.Database.BeginTransactionAsync();
        try
        {
            // Its groups (none has an item): unhooked from each other first, then removed.
            var groups = await _db.Categories.Where(c => c.DepartmentId == id).ToListAsync();
            foreach (var g in groups) g.ParentId = null;
            await _db.SaveChangesAsync();
            _db.Categories.RemoveRange(groups);
            _db.WarehouseDepartments.RemoveRange(await _db.WarehouseDepartments.Where(l => l.DepartmentId == id).ToListAsync());
            foreach (var s in await _db.Staff.Where(s => s.DepartmentIds.Contains(id)).ToListAsync())
                s.DepartmentIds = s.DepartmentIds.Where(d => d != id).ToList();
            _db.Departments.Remove(department);
            await SaveAsync("delete", "department", id, Loc.Name(department));
            await tx.CommitAsync();
        }
        catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23503" })
        {
            await tx.RollbackAsync();
            _db.ChangeTracker.Clear();
            return InUse();
        }
        return NoContent();

        ObjectResult InUse() => Conflict(new
        {
            message = "The department has items or invoices; close it instead.", code = "department_in_use",
        });
    }

    /// <summary>
    /// Put a department in exactly the warehouses given, among those the person sees: null leaves an
    /// existing one as it is and puts a new one in every warehouse. A warehouse with no departments
    /// picked offers every one, so before such a warehouse is changed, the departments it offers now
    /// are picked for it, and nothing else changes for it. Leaving a warehouse with none at all would
    /// turn it back to "every department": refused.
    /// </summary>
    private async Task<ActionResult?> PlaceAsync(Guid departmentId, string[]? raw, WarehouseService warehouses,
        bool creating = false)
    {
        if (raw is null && !creating) return null;
        var visible = await warehouses.Visible(User).Where(w => w.Kind == WarehouseKind.STORE)
            .Select(w => w.Id).ToListAsync();
        var wanted = raw is null
            ? visible.ToHashSet()
            : raw.Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        if (raw is null && visible.Count == 0) return null;
        if (wanted.Contains(Guid.Empty) || wanted.Any(w => !visible.Contains(w)))
            return BadRequest(new { message = "Warehouse not found.", code = "warehouse_not_found" });
        if (wanted.Count == 0)
            return BadRequest(new { message = "Choose at least one warehouse.", code = "choose_warehouse" });

        var links = await _db.WarehouseDepartments.Where(l => visible.Contains(l.WarehouseId)).ToListAsync();
        var others = await _db.Departments.Where(d => d.Id != departmentId).Select(d => d.Id).ToListAsync();
        foreach (var w in visible)
        {
            var mine = links.Where(l => l.WarehouseId == w).ToList();
            var has = mine.Any(l => l.DepartmentId == departmentId);
            if (mine.Count == 0)
            {
                // It offers every department now: pick them all for it, then add or leave this one out.
                // (Not wanted, with no other department at all: it stays offering every one, just this.)
                foreach (var d in others) _db.WarehouseDepartments.Add(new WarehouseDepartment { WarehouseId = w, DepartmentId = d });
                if (wanted.Contains(w))
                    _db.WarehouseDepartments.Add(new WarehouseDepartment { WarehouseId = w, DepartmentId = departmentId });
            }
            else if (wanted.Contains(w) && !has)
                _db.WarehouseDepartments.Add(new WarehouseDepartment { WarehouseId = w, DepartmentId = departmentId });
            else if (!wanted.Contains(w) && has)
            {
                if (mine.Count == 1)
                    return BadRequest(new { message = "A warehouse needs a department.", code = "warehouse_needs_department" });
                _db.WarehouseDepartments.Remove(mine.First(l => l.DepartmentId == departmentId));
            }
        }
        return null;
    }

    private async Task<string[]> LinksAsync(Guid departmentId) =>
        (await _db.WarehouseDepartments.Where(l => l.DepartmentId == departmentId).Select(l => l.WarehouseId).ToListAsync())
        .Select(w => w.ToString()).ToArray();

    private static DepartmentDto ToDto(Department d, int count) =>
        new(d.Id.ToString(), Loc.Name(d), d.IsActive, count, d.Prefix);

    /// <summary>Set a department's code prefix (null = leave it).</summary>
    private ActionResult? PrefixOf(Department department, string? raw)
    {
        var (given, value, bad) = Catalog.Prefix(raw);
        if (bad) return BadRequest(new { message = "A prefix is up to 10 letters or digits.", code = "bad_prefix" });
        if (given) department.Prefix = value;
        return null;
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
        var hex = HexOf(req.Hex);
        if (hex == "") return BadRequest(new { message = "Pick a color like #1d4ed8.", code = "bad_color" });
        var option = new VariantOption
        {
            Kind = kind,
            Hex = kind == VariantKind.COLOR ? hex : null,
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
        if (req.Hex is not null && option.Kind == VariantKind.COLOR)
        {
            var hex = HexOf(req.Hex);
            if (hex == "") return BadRequest(new { message = "Pick a color like #1d4ed8.", code = "bad_color" });
            option.Hex = hex;
        }
        if (req.IsActive is bool active) option.IsActive = active;
        await SaveAsync("update", "variant_option", option.Id);
        // Variant names are made from it: "Shirt X — Red / L".
        await Catalog.RefreshVariantNamesAsync(_db, Array.Empty<Guid>(), new[] { option.Id });
        return Ok(Mapper.ToVariantOption(option));
    }

    /// <summary>Delete a size or color no item uses (owner, 2026-10-21); else close it.</summary>
    [HttpDelete("variant-options/{id:guid}")]
    [Authorize(Policy = Permissions.SetupDelete)]
    public async Task<IActionResult> DeleteVariantOption(Guid id)
    {
        var option = await _db.VariantOptions.FirstOrDefaultAsync(o => o.Id == id);
        if (option is null) return NotFound(new { message = "Size or color not found.", code = "variant_option_not_found" });
        if (await _db.Products.AnyAsync(p => p.SizeId == id || p.ColorId == id)) return InUse();
        _db.VariantOptions.Remove(option);
        return await RemoveAsync("variant_option", id, Loc.Name(option));
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>Save a removal; something still pointing at it (a foreign key) refuses it.</summary>
    private async Task<IActionResult> RemoveAsync(string resource, Guid id, string name)
    {
        try
        {
            await SaveAsync("delete", resource, id, name);
        }
        catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23503" })
        {
            _db.ChangeTracker.Clear();
            return InUse();
        }
        return NoContent();
    }

    private ObjectResult InUse() => Conflict(new { message = "It is in use; close it instead.", code = "in_use" });

    /// <summary>A color swatch "#rrggbb": null = none, "" = not a color.</summary>
    private static string? HexOf(string? raw)
    {
        var t = raw?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(t)) return null;
        return System.Text.RegularExpressions.Regex.IsMatch(t, "^#[0-9a-f]{6}$") ? t : "";
    }

    private static UnitDto ToDto(Unit u, int count) => new(u.Id.ToString(), Loc.Name(u), u.IsActive, count, u.Pieces);

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
        Department d => d.Id,
        PriceLevel l => l.Id,
        VariantOption o => o.Id,
        _ => Guid.Empty,
    };

    private async Task SaveAsync(string action, string resource, Guid id, string? details = null)
    {
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString(), details);
    }
}
