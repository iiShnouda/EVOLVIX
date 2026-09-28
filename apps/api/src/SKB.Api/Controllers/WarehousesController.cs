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
/// once it is empty. Names are kept in Arabic and English — typing one is enough, the other is
/// translated by AI in the background (<see cref="TranslationWorker"/>).
/// </summary>
[ApiController]
[Route("api")]
public sealed class WarehousesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly StockValuation _valuation;
    private readonly TranslationQueue _translations;
    private readonly AuditService _audit;

    public WarehousesController(AppDbContext db, WarehouseService warehouses, StockValuation valuation,
        TranslationQueue translations, AuditService audit)
    {
        _db = db;
        _warehouses = warehouses;
        _valuation = valuation;
        _translations = translations;
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
    [Authorize(Policy = Permissions.InventoryEdit)]
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
        var branch = new Branch { Location = Clean(req.Location, 200) };
        var (bAr, bEn) = Loc.FromRequest(req.NameAr, req.NameEn, req.Name);
        if (!Loc.Apply(branch, bAr, bEn))
            return BadRequest(new { message = "Branch name is required.", code = "bad_name" });

        var code = string.IsNullOrWhiteSpace(req.Code) ? await NextBranchCodeAsync() : req.Code.Trim().ToUpperInvariant();
        if (code.Length > 20)
            return BadRequest(new { message = "Code is at most 20 characters.", code = "bad_code" });
        if (await _db.Branches.AnyAsync(b => b.Code.ToUpper() == code))
            return BadRequest(new { message = $"Code {code} is already used.", code = "duplicate_code" });
        branch.Code = code;

        // Its first store: named in both languages already, so it needs no translation.
        var store = new Warehouse
        {
            Branch = branch, Code = await NextWarehouseCodeAsync(code), IsDefault = true,
            Name = "Main store", NameEn = "Main store", NameAr = "المخزن الرئيسي", NameSource = "en",
        };
        _db.Branches.Add(branch);
        _db.Warehouses.Add(store);
        await _db.SaveChangesAsync();
        _translations.Notify();

        await AuditAsync("create", "branch", branch.Id, branch.Id);
        return Created($"/api/branches/{branch.Id}", ToDto(branch, await StatsAsync()));
    }

    [HttpPut("branches/{id:guid}")]
    [Authorize(Policy = Permissions.BranchesManage)]
    public async Task<ActionResult<BranchDto>> UpdateBranch(Guid id, [FromBody] UpdateBranchRequest req)
    {
        var branch = await _db.Branches.Include(b => b.Warehouses).FirstOrDefaultAsync(b => b.Id == id);
        if (branch is null) return NotFound(new { message = "Branch not found.", code = "branch_not_found" });
        var (uAr, uEn) = Loc.FromRequest(req.NameAr, req.NameEn, req.Name);
        if (!Loc.Apply(branch, uAr, uEn))
            return BadRequest(new { message = "Branch name is required.", code = "bad_name" });
        if (req.Location is not null) branch.Location = Clean(req.Location, 200);

        await _db.SaveChangesAsync();
        _translations.Notify();
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

        var warehouse = new Warehouse { BranchId = branchId, Branch = branch };
        var (wAr, wEn) = Loc.FromRequest(req.NameAr, req.NameEn, req.Name);
        if (!Loc.Apply(warehouse, wAr, wEn))
            return BadRequest(new { message = "Warehouse name is required (up to 100 characters).", code = "bad_name" });

        var code = string.IsNullOrWhiteSpace(req.Code) ? await NextWarehouseCodeAsync(branch.Code) : req.Code.Trim().ToUpperInvariant();
        if (code.Length > 20)
            return BadRequest(new { message = "Code is at most 20 characters.", code = "bad_code" });
        if (await _db.Warehouses.AnyAsync(w => w.Code.ToUpper() == code))
            return BadRequest(new { message = $"Code {code} is already used.", code = "duplicate_code" });
        warehouse.Code = code;

        var hasDefault = await _db.Warehouses.AnyAsync(w =>
            w.BranchId == branchId && w.IsActive && w.IsDefault && w.Kind == WarehouseKind.STORE);
        _db.Warehouses.Add(warehouse);
        if (req.IsDefault || !hasDefault) await MakeDefaultAsync(warehouse);

        await _db.SaveChangesAsync();
        _translations.Notify();
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

        var (nAr, nEn) = Loc.FromRequest(req.NameAr, req.NameEn, req.Name);
        if ((nAr is not null || nEn is not null) && !Loc.Apply(warehouse, nAr, nEn))
            return BadRequest(new { message = "Warehouse name is required (up to 100 characters).", code = "bad_name" });

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
        _translations.Notify();
        await AuditAsync("update", "warehouse", warehouse.Id, warehouse.BranchId);
        return Ok(ToDto(warehouse, await StatsAsync()));
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
    private async Task<Dictionary<Guid, Stats>> StatsAsync()
    {
        var state = await _valuation.CurrentAsync();
        return state.Quantity.GroupBy(kv => kv.Key.Warehouse).ToDictionary(g => g.Key, g => new Stats(
            g.Count(kv => kv.Value > 0), g.Sum(kv => kv.Value),
            g.Sum(kv => state.ValueOf(kv.Key.Product, kv.Key.Warehouse))));
    }

    private static BranchDto ToDto(Branch b, Dictionary<Guid, Stats> stats) => new(
        b.Id.ToString(), b.Code, Loc.Name(b), b.Location, b.IsActive,
        b.Warehouses
            .Where(w => w.Kind == WarehouseKind.STORE)
            .OrderByDescending(w => w.IsActive).ThenByDescending(w => w.IsDefault).ThenBy(w => Loc.Name(w))
            .Select(w => { w.Branch = b; return ToDto(w, stats); })
            .ToArray(),
        Mapper.ToNames(b));

    private static WarehouseDto ToDto(Warehouse w, Dictionary<Guid, Stats> stats)
    {
        var s = stats.GetValueOrDefault(w.Id) ?? new Stats(0, 0, 0);
        return new WarehouseDto(w.Id.ToString(), w.Code, Loc.Name(w), w.BranchId.ToString(), Loc.Name(w.Branch),
            w.Kind.ToString(), w.IsDefault, w.IsActive, s.Items, s.Quantity, s.Value, Mapper.ToNames(w));
    }

    private Task AuditAsync(string action, string resource, Guid id, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
