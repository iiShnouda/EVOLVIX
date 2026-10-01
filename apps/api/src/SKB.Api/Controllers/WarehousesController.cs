using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Branches and their warehouses (الفروع والمخازن). Everyone who sees inventory can list the
/// warehouses they may use; managing branches and warehouses (add, rename, close, choose the branch
/// default) needs <c>branches:manage</c>. Nothing is ever deleted: a warehouse is closed, and only
/// once it is empty. Names are kept exactly as typed.
/// </summary>
[ApiController]
[Route("api")]
public sealed class WarehousesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly StockValuation _valuation;
    private readonly AuditService _audit;

    public WarehousesController(AppDbContext db, WarehouseService warehouses, StockValuation valuation,
        AuditService audit)
    {
        _db = db;
        _warehouses = warehouses;
        _valuation = valuation;
        _audit = audit;
    }

    /// <summary>
    /// Warehouses the user may use, with what each one holds. Default first per branch. The system
    /// "In transit" warehouse is left out unless <paramref name="includeTransit"/> is set.
    /// </summary>
    [HttpGet("warehouses")]
    [Authorize(Policy = Permissions.InventoryView)]
    public async Task<ActionResult<WarehouseDto[]>> List(
        [FromQuery] bool activeOnly = false, [FromQuery] bool includeTransit = false)
    {
        var q = _warehouses.Visible(User).AsNoTracking().Include(w => w.Branch).AsQueryable();
        if (activeOnly) q = q.Where(w => w.IsActive);
        if (!includeTransit) q = q.Where(w => w.Kind == WarehouseKind.STORE);
        var rows = await q.ToListAsync();
        var stats = await StatsAsync();
        return Ok(rows
            .OrderBy(w => Loc.Name(w.Branch)).ThenByDescending(w => w.IsDefault).ThenBy(w => Loc.Name(w))
            .Select(w => ToDto(w, stats)).ToArray());
    }

    /// <summary>
    /// Every open store in every branch — where goods may be sent on a transfer. Names only, so
    /// branch-scoped staff can pick another branch as the destination.
    /// </summary>
    [HttpGet("warehouses/destinations")]
    [Authorize(Policy = Permissions.InventoryTransfer)]
    public async Task<ActionResult<WarehouseOptionDto[]>> Destinations()
    {
        var rows = await _db.Warehouses.AsNoTracking().Include(w => w.Branch)
            .Where(w => w.IsActive && w.Kind == WarehouseKind.STORE)
            .ToListAsync();
        return Ok(rows.OrderBy(w => Loc.Name(w.Branch)).ThenByDescending(w => w.IsDefault).ThenBy(w => Loc.Name(w))
            .Select(w => new WarehouseOptionDto(w.Id.ToString(), Loc.Name(w), Loc.Name(w.Branch))).ToArray());
    }

    /// <summary>Every branch with its warehouses (active and closed).</summary>
    [HttpGet("branches")]
    [Authorize(Policy = Permissions.BranchesView)]
    public async Task<ActionResult<BranchDto[]>> Branches()
    {
        var branches = await _db.Branches.AsNoTracking().Include(b => b.Warehouses)
            .OrderBy(b => b.CreatedAt).ToListAsync();
        var stats = await StatsAsync();
        return Ok(branches.Select(b => ToDto(b, stats)).ToArray());
    }

    /// <summary>Add a branch; it gets a default store straight away so documents can post there.</summary>
    [HttpPost("branches")]
    [Authorize(Policy = Permissions.BranchesManage)]
    public async Task<ActionResult<BranchDto>> CreateBranch([FromBody] CreateBranchRequest req)
    {
        var branchName = Loc.Clean(req.Name);
        if (branchName is null) return BadRequest(new { message = "Branch name is required.", code = "bad_name" });
        var branch = new Branch { Name = branchName, Location = Clean(req.Location, 200) };
        var (_, branchPrefix, badPrefix) = Catalog.Prefix(req.Prefix);
        if (badPrefix) return BadPrefix();

        var code = string.IsNullOrWhiteSpace(req.Code) ? await NextBranchCodeAsync() : req.Code.Trim().ToUpperInvariant();
        if (code.Length > 20)
            return BadRequest(new { message = "Code is at most 20 characters.", code = "bad_code" });
        if (await _db.Branches.AnyAsync(b => b.Code.ToUpper() == code))
            return BadRequest(new { message = $"Code {code} is already used.", code = "duplicate_code" });
        branch.Code = code;
        branch.Prefix = branchPrefix ?? code[..Math.Min(10, code.Length)];

        // Its first store, named in the language of the screen it was added from.
        var store = new Warehouse
        {
            Branch = branch, Code = await NextWarehouseCodeAsync(code), IsDefault = true, Prefix = "1",
            Name = Loc.Lang == "ar" ? "المخزن الرئيسي" : "Main store",
        };
        // …and its cash box, where paid-now amounts land (DOMAIN.md §2.6).
        var cashBox = new MoneyAccount
        {
            Branch = branch, Kind = MoneyAccountKind.CASH_BOX, IsDefault = true,
            Name = Loc.Lang == "ar" ? "الخزينة الرئيسية" : "Main cash box",
            Currency = await _db.CompanySettings.Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP",
        };
        _db.Branches.Add(branch);
        _db.Warehouses.Add(store);
        _db.MoneyAccounts.Add(cashBox);
        await _db.SaveChangesAsync();

        await AuditAsync("create", "branch", branch.Id, branch.Id);
        return Created($"/api/branches/{branch.Id}", ToDto(branch, await StatsAsync()));
    }

    [HttpPut("branches/{id:guid}")]
    [Authorize(Policy = Permissions.BranchesManage)]
    public async Task<ActionResult<BranchDto>> UpdateBranch(Guid id, [FromBody] UpdateBranchRequest req)
    {
        var branch = await _db.Branches.Include(b => b.Warehouses).FirstOrDefaultAsync(b => b.Id == id);
        if (branch is null) return NotFound(new { message = "Branch not found.", code = "branch_not_found" });
        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return BadRequest(new { message = "Branch name is required.", code = "bad_name" });
            branch.Name = name;
        }
        if (req.Location is not null) branch.Location = Clean(req.Location, 200);
        var (prefixGiven, prefix, bad) = Catalog.Prefix(req.Prefix);
        if (bad) return BadPrefix();
        if (prefixGiven) branch.Prefix = prefix;

        await _db.SaveChangesAsync();
        await AuditAsync("update", "branch", branch.Id, branch.Id);
        return Ok(ToDto(branch, await StatsAsync()));
    }

    [HttpPost("warehouses")]
    [Authorize(Policy = Permissions.BranchesManage)]
    public async Task<ActionResult<WarehouseDto>> Create([FromBody] CreateWarehouseRequest req)
    {
        if (!Guid.TryParse(req.BranchId, out var branchId))
            return BadRequest(new { message = "Choose a branch.", code = "branch_not_found" });
        var branch = await _db.Branches.FirstOrDefaultAsync(b => b.Id == branchId);
        if (branch is null) return BadRequest(new { message = "Choose a branch.", code = "branch_not_found" });

        var warehouseName = Loc.Clean(req.Name);
        if (warehouseName is null)
            return BadRequest(new { message = "Warehouse name is required.", code = "bad_name" });
        var warehouse = new Warehouse { BranchId = branchId, Branch = branch, Name = warehouseName };
        var (_, whPrefix, badWh) = Catalog.Prefix(req.Prefix);
        if (badWh) return BadPrefix();

        var code = string.IsNullOrWhiteSpace(req.Code) ? await NextWarehouseCodeAsync(branch.Code) : req.Code.Trim().ToUpperInvariant();
        if (code.Length > 20)
            return BadRequest(new { message = "Code is at most 20 characters.", code = "bad_code" });
        if (await _db.Warehouses.AnyAsync(w => w.Code.ToUpper() == code))
            return BadRequest(new { message = $"Code {code} is already used.", code = "duplicate_code" });
        warehouse.Code = code;
        warehouse.Prefix = whPrefix ?? code.Split('-')[^1][..Math.Min(10, code.Split('-')[^1].Length)];
        var linkError = await DepartmentsAsync(warehouse.Id, req.DepartmentIds);
        if (linkError is not null) return linkError;

        var hasDefault = await _db.Warehouses.AnyAsync(w =>
            w.BranchId == branchId && w.IsActive && w.IsDefault && w.Kind == WarehouseKind.STORE);
        _db.Warehouses.Add(warehouse);
        if (req.IsDefault || !hasDefault) await MakeDefaultAsync(warehouse);

        await _db.SaveChangesAsync();
        await AuditAsync("create", "warehouse", warehouse.Id, warehouse.BranchId);
        return Created($"/api/warehouses/{warehouse.Id}", ToDto(warehouse, await StatsAsync()));
    }

    [HttpPut("warehouses/{id:guid}")]
    [Authorize(Policy = Permissions.BranchesManage)]
    public async Task<ActionResult<WarehouseDto>> Update(Guid id, [FromBody] UpdateWarehouseRequest req)
    {
        var warehouse = await _db.Warehouses.Include(w => w.Branch)
            .FirstOrDefaultAsync(w => w.Id == id && w.Kind == WarehouseKind.STORE);
        if (warehouse is null) return NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" });

        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return BadRequest(new { message = "Warehouse name is required.", code = "bad_name" });
            warehouse.Name = name;
        }

        var (whPrefixGiven, newPrefix, badPrefix) = Catalog.Prefix(req.Prefix);
        if (badPrefix) return BadPrefix();
        if (whPrefixGiven) warehouse.Prefix = newPrefix;
        var linksError = await DepartmentsAsync(warehouse.Id, req.DepartmentIds);
        if (linksError is not null) return linksError;

        if (req.IsActive == false && warehouse.IsActive)
        {
            if (warehouse.IsDefault)
                return BadRequest(new
                {
                    message = "This is the branch's default warehouse. Make another warehouse the default first.",
                    code = "warehouse_is_default",
                });
            var held = await _db.StockBalances.Where(b => b.WarehouseId == id).SumAsync(b => (int?)b.Quantity) ?? 0;
            if (held != 0)
                return BadRequest(new
                {
                    message = $"{Loc.Name(warehouse)} still holds {held} units. Move or count them out before closing it.",
                    code = "warehouse_has_stock",
                });
            warehouse.IsActive = false;
        }
        else if (req.IsActive == true)
        {
            warehouse.IsActive = true;
        }

        if (req.IsDefault == true && !warehouse.IsDefault)
        {
            if (!warehouse.IsActive)
                return BadRequest(new { message = "A closed warehouse can't be the default.", code = "warehouse_inactive" });
            await MakeDefaultAsync(warehouse);
        }
        else if (req.IsDefault == false && warehouse.IsDefault)
        {
            return BadRequest(new
            {
                message = "Every branch needs a default warehouse. Make another one the default instead.",
                code = "default_required",
            });
        }

        await _db.SaveChangesAsync();
        await AuditAsync("update", "warehouse", warehouse.Id, warehouse.BranchId);
        return Ok(ToDto(warehouse, await StatsAsync()));
    }

    private BadRequestObjectResult BadPrefix() =>
        BadRequest(new { message = "A prefix is up to 10 letters or digits.", code = "bad_prefix" });

    /// <summary>
    /// The departments a warehouse has (owner decision 2026-10-01): null = leave them; [] = none
    /// picked (it offers every department). Saved with the warehouse.
    /// </summary>
    private async Task<ActionResult?> DepartmentsAsync(Guid warehouseId, string[]? raw)
    {
        if (raw is null) return null;
        var ids = raw.Select(r => Guid.TryParse(r, out var g) ? g : Guid.Empty).Distinct().ToList();
        if (ids.Contains(Guid.Empty) || await _db.Departments.CountAsync(d => ids.Contains(d.Id)) != ids.Count)
            return BadRequest(new { message = "Department not found.", code = "department_not_found" });
        _db.WarehouseDepartments.RemoveRange(await _db.WarehouseDepartments.Where(l => l.WarehouseId == warehouseId).ToListAsync());
        foreach (var d in ids) _db.WarehouseDepartments.Add(new WarehouseDepartment { WarehouseId = warehouseId, DepartmentId = d });
        return null;
    }

    /// <summary>Mark <paramref name="warehouse"/> as its branch's only default.</summary>
    private async Task MakeDefaultAsync(Warehouse warehouse)
    {
        var others = await _db.Warehouses
            .Where(w => w.BranchId == warehouse.BranchId && w.Id != warehouse.Id && w.IsDefault).ToListAsync();
        foreach (var w in others) w.IsDefault = false;
        warehouse.IsDefault = true;
    }

    private async Task<string> NextWarehouseCodeAsync(string branchCode)
    {
        var prefix = $"{branchCode.ToUpperInvariant()}-";
        var used = await _db.Warehouses.Where(w => w.Code.StartsWith(prefix)).Select(w => w.Code).ToListAsync();
        var n = 1;
        while (used.Contains($"{prefix}{n}", StringComparer.OrdinalIgnoreCase)) n++;
        return $"{prefix}{n}";
    }

    private async Task<string> NextBranchCodeAsync()
    {
        var used = await _db.Branches.Select(b => b.Code).ToListAsync();
        var n = used.Count + 1;
        while (used.Contains($"BR{n}", StringComparer.OrdinalIgnoreCase)) n++;
        return $"BR{n}";
    }

    private static string? Clean(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private sealed record Stats(int Items, int Quantity, long Value);

    /// <summary>What each warehouse holds today: items in stock, units, value at its branch's average cost.</summary>
    private Dictionary<Guid, string[]> _departments = new();

    private async Task<Dictionary<Guid, Stats>> StatsAsync()
    {
        _departments = (await _db.WarehouseDepartments.AsNoTracking().ToListAsync())
            .GroupBy(l => l.WarehouseId).ToDictionary(g => g.Key, g => g.Select(l => l.DepartmentId.ToString()).ToArray());
        var state = await _valuation.CurrentAsync();
        return state.Quantity.GroupBy(kv => kv.Key.Warehouse).ToDictionary(g => g.Key, g => new Stats(
            g.Count(kv => kv.Value > 0), g.Sum(kv => kv.Value),
            g.Sum(kv => state.ValueOf(kv.Key.Product, kv.Key.Warehouse))));
    }

    private BranchDto ToDto(Branch b, Dictionary<Guid, Stats> stats) => new(
        b.Id.ToString(), b.Code, Loc.Name(b), b.Location, b.IsActive,
        b.Warehouses
            .Where(w => w.Kind == WarehouseKind.STORE)
            .OrderByDescending(w => w.IsActive).ThenByDescending(w => w.IsDefault).ThenBy(w => Loc.Name(w))
            .Select(w => { w.Branch = b; return ToDto(w, stats); })
            .ToArray(), b.Prefix);

    /// <summary>A warehouse with its stock; the stock's value only for people who may see costs.</summary>
    private WarehouseDto ToDto(Warehouse w, Dictionary<Guid, Stats> stats)
    {
        var s = stats.GetValueOrDefault(w.Id) ?? new Stats(0, 0, 0);
        return Costs.Guard(User, new WarehouseDto(w.Id.ToString(), w.Code, Loc.Name(w), w.BranchId.ToString(),
            Loc.Name(w.Branch), w.Kind.ToString(), w.IsDefault, w.IsActive, s.Items, s.Quantity, s.Value,
            w.Prefix, _departments.GetValueOrDefault(w.Id, Array.Empty<string>())));
    }

    private Task AuditAsync(string action, string resource, Guid id, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
