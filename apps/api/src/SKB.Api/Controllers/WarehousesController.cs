using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Branches and their warehouses (الفروع والمخازن). Everyone signed in can list the branches and
/// warehouses they may use (every page picks them); adding, changing and deleting a branch or a
/// warehouse are a permission each (owner, 2026-10-23). A branch or warehouse with nothing recorded
/// in it can be deleted; once it has documents, stock or money it can only be closed. Names are kept
/// exactly as typed.
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
    [Authorize]
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
    [AnyPermission(Permissions.InventoryTransfer, Permissions.InventoryTransferEdit)]
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
    [Authorize]
    public async Task<ActionResult<BranchDto[]>> Branches()
    {
        // Only the person's own branches and the warehouses they see in them (owner, 2026-10-02:
        // "all branches" never means more than the branches one may open).
        var q = _db.Branches.AsNoTracking().Include(b => b.Warehouses).AsQueryable();
        if (Access.Branches(User) is { } mine) q = q.Where(b => mine.Contains(b.Id));
        var branches = await q.OrderBy(b => b.CreatedAt).ToListAsync();
        var visible = (await _warehouses.Visible(User).Select(w => w.Id).ToListAsync()).ToHashSet();
        foreach (var b in branches) b.Warehouses = b.Warehouses.Where(w => visible.Contains(w.Id)).ToList();
        var stats = await StatsAsync();
        return Ok(branches.Select(b => ToDto(b, stats)).ToArray());
    }

    /// <summary>Add a branch; it gets a default store straight away so documents can post there.</summary>
    [HttpPost("branches")]
    [Authorize(Policy = Permissions.BranchesCreate)]
    public async Task<ActionResult<BranchDto>> CreateBranch([FromBody] CreateBranchRequest req,
        [FromServices] AccessService access)
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
        // …and its cash box, where paid-now amounts land (DOMAIN.md §2.6); it hands its cash up to the
        // main box.
        var cashBox = new MoneyAccount
        {
            Branch = branch, Kind = MoneyAccountKind.CASH_BOX, IsDefault = true,
            Name = Loc.Lang == "ar" ? "خزينة الفرع" : "Branch cash box",
            Currency = await CurrencyAsync(),
        };
        var storeBox = await StoreBoxAsync(store, branch, cashBox.Name);
        _db.Branches.Add(branch);
        _db.Warehouses.Add(store);
        _db.MoneyAccounts.Add(cashBox);
        _db.MoneyAccounts.Add(storeBox);
        // The new branch, its store and its cash boxes are seen by whoever is given them.
        await access.KeepNewHiddenAsync(NewKind.Branch, branch.Id, CurrentUser.Id(User));
        await access.KeepNewHiddenAsync(NewKind.Warehouse, store.Id, CurrentUser.Id(User));
        await access.KeepNewHiddenAsync(NewKind.MoneyAccount, cashBox.Id, CurrentUser.Id(User));
        await access.KeepNewHiddenAsync(NewKind.MoneyAccount, storeBox.Id, CurrentUser.Id(User));
        await _db.SaveChangesAsync();

        await AuditAsync("create", "branch", branch.Id, branch.Id);
        return Created($"/api/branches/{branch.Id}", ToDto(branch, await StatsAsync()));
    }

    [HttpPut("branches/{id:guid}")]
    [Authorize(Policy = Permissions.BranchesEdit)]
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
    [Authorize(Policy = Permissions.WarehousesCreate)]
    public async Task<ActionResult<WarehouseDto>> Create([FromBody] CreateWarehouseRequest req,
        [FromServices] AccessService access)
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
        await access.KeepNewHiddenAsync(NewKind.Warehouse, warehouse.Id, CurrentUser.Id(User));
        // Each warehouse has its own cash box, handed up to the branch's (owner, 2026-10-02).
        var box = await StoreBoxAsync(warehouse, branch, null);
        _db.MoneyAccounts.Add(box);
        await access.KeepNewHiddenAsync(NewKind.MoneyAccount, box.Id, CurrentUser.Id(User));

        await _db.SaveChangesAsync();
        await AuditAsync("create", "warehouse", warehouse.Id, warehouse.BranchId);
        return Created($"/api/warehouses/{warehouse.Id}", ToDto(warehouse, await StatsAsync()));
    }

    [HttpPut("warehouses/{id:guid}")]
    [Authorize(Policy = Permissions.WarehousesEdit)]
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

    /// <summary>Delete a warehouse that has nothing recorded in it, with its own cash box.</summary>
    [HttpDelete("warehouses/{id:guid}")]
    [Authorize(Policy = Permissions.WarehousesDelete)]
    public async Task<IActionResult> DeleteWarehouse(Guid id)
    {
        var warehouse = await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == id && w.Kind == WarehouseKind.STORE);
        if (warehouse is null) return NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" });
        if (warehouse.IsDefault)
        {
            var others = await _db.Warehouses.AnyAsync(w =>
                w.BranchId == warehouse.BranchId && w.Id != id && w.Kind == WarehouseKind.STORE && w.IsActive);
            return BadRequest(others
                ? new { message = "This is the branch's default warehouse. Make another warehouse the default first.", code = "warehouse_is_default" }
                : new { message = "A branch needs a warehouse: delete the branch instead.", code = "last_warehouse" });
        }
        if (await InUseAsync(() => RemoveWarehouseAsync(warehouse))) return InUse();
        await AuditAsync("delete", "warehouse", id, warehouse.BranchId, Loc.Name(warehouse));
        return NoContent();
    }

    /// <summary>Delete a branch that has nothing recorded in it, with its warehouses and cash boxes.</summary>
    [HttpDelete("branches/{id:guid}")]
    [Authorize(Policy = Permissions.BranchesDelete)]
    public async Task<IActionResult> DeleteBranch(Guid id)
    {
        var branch = await _db.Branches.FirstOrDefaultAsync(b => b.Id == id);
        if (branch is null) return NotFound(new { message = "Branch not found.", code = "branch_not_found" });
        if (!await _db.Branches.AnyAsync(b => b.Id != id))
            return BadRequest(new { message = "The company needs at least one branch.", code = "last_branch" });
        if (await _db.Staff.AnyAsync(s => s.BranchId == id))
            return BadRequest(new { message = "Some staff belong to this branch. Move them to another branch first.", code = "branch_has_staff" });
        // Records that point at the branch without a database link (or with one that would take them along).
        if (await _db.SalesDocuments.AnyAsync(d => d.BranchId == id)
            || await _db.JournalEntries.AnyAsync(e => e.BranchId == id)
            || await _db.StockMovements.AnyAsync(m => m.BranchId == id))
            return InUse();

        var failed = await InUseAsync(async () =>
        {
            foreach (var w in await _db.Warehouses.Where(w => w.BranchId == id).ToListAsync())
                await RemoveWarehouseAsync(w);
            await RemoveMoneyAccountsAsync(await _db.MoneyAccounts.Where(a => a.BranchId == id && a.WarehouseId == null).ToListAsync());
            _db.StockCosts.RemoveRange(await _db.StockCosts.Where(c => c.PoolId == id).ToListAsync());
            foreach (var s in await _db.Staff.Where(s => s.BranchIds.Contains(id)).ToListAsync())
                s.BranchIds = s.BranchIds.Where(b => b != id).ToList();
            _db.Branches.Remove(branch);
        });
        if (failed) return InUse();
        await AuditAsync("delete", "branch", id, id, Loc.Name(branch));
        return NoContent();
    }

    private BadRequestObjectResult InUse() => BadRequest(new
    {
        message = "It has documents, stock or money recorded. Close it instead.",
        code = "place_in_use",
    });

    /// <summary>
    /// Runs <paramref name="remove"/> and saves in one transaction. True (and nothing changed) when
    /// something still refers to what was removed: the database refuses, the transaction rolls back.
    /// </summary>
    private async Task<bool> InUseAsync(Func<Task> remove)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        try
        {
            await remove();
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            return false;
        }
        catch (Exception e) when (e is PlaceInUse
                                   || e is DbUpdateException { InnerException: Npgsql.PostgresException { SqlState: "23503" } })
        {
            await tx.RollbackAsync();
            _db.ChangeTracker.Clear();
            return true;
        }
    }

    /// <summary>A warehouse, its department links, empty stock rows, its cash box, and people's access to it.</summary>
    private async Task RemoveWarehouseAsync(Warehouse warehouse)
    {
        var id = warehouse.Id;
        _db.WarehouseDepartments.RemoveRange(await _db.WarehouseDepartments.Where(l => l.WarehouseId == id).ToListAsync());
        // A row left at zero is not a record; any quantity still held keeps it (the database refuses).
        _db.StockBalances.RemoveRange(await _db.StockBalances.Where(b => b.WarehouseId == id && b.Quantity == 0).ToListAsync());
        await RemoveMoneyAccountsAsync(await _db.MoneyAccounts.Where(a => a.WarehouseId == id).ToListAsync());
        foreach (var s in await _db.Staff.Where(s => s.WarehouseIds.Contains(id)).ToListAsync())
            s.WarehouseIds = s.WarehouseIds.Where(w => w != id).ToList();
        _db.Warehouses.Remove(warehouse);
    }

    /// <summary>Cash boxes and their ledger sub-accounts; one with any movement makes the database refuse.</summary>
    private async Task RemoveMoneyAccountsAsync(List<MoneyAccount> accounts)
    {
        var ids = accounts.Select(a => a.Id).ToList();
        if (ids.Count == 0) return;
        if (await _db.MoneyMovements.AnyAsync(m => ids.Contains(m.AccountId)))
            throw new PlaceInUse();
        _db.LedgerAccounts.RemoveRange(await _db.LedgerAccounts.Where(l => l.MoneyAccountId != null && ids.Contains(l.MoneyAccountId.Value)).ToListAsync());
        foreach (var s in await _db.Staff.Where(s => s.MoneyAccountIds.Count > 0).ToListAsync())
            if (s.MoneyAccountIds.Any(ids.Contains)) s.MoneyAccountIds = s.MoneyAccountIds.Where(a => !ids.Contains(a)).ToList();
        _db.MoneyAccounts.RemoveRange(accounts);
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

    /// <summary>
    /// A warehouse with its stock; the stock only for people who see the stock or the branches, its
    /// value only for people who may see costs. Its name is everyone's (every page picks warehouses).
    /// </summary>
    private WarehouseDto ToDto(Warehouse w, Dictionary<Guid, Stats> stats)
    {
        var seesStock = User.HasAny(Permissions.InventoryView, Permissions.BranchesView, Permissions.BranchesEdit,
            Permissions.WarehousesEdit, Permissions.WarehousesDelete, Permissions.BranchesDelete);
        var s = seesStock ? stats.GetValueOrDefault(w.Id) ?? new Stats(0, 0, 0) : new Stats(0, 0, 0);
        return Costs.Guard(User, new WarehouseDto(w.Id.ToString(), w.Code, Loc.Name(w), w.BranchId.ToString(),
            Loc.Name(w.Branch), w.Kind.ToString(), w.IsDefault, w.IsActive, s.Items, s.Quantity, s.Value,
            w.Prefix, _departments.GetValueOrDefault(w.Id, Array.Empty<string>())));
    }

    private Task AuditAsync(string action, string resource, Guid id, Guid branchId, string? details = null) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString(), details);

    /// <summary>A warehouse's own cash box, named after it (with its code if that name is taken).</summary>
    private async Task<MoneyAccount> StoreBoxAsync(Warehouse store, Branch branch, string? alsoTaken)
    {
        var name = store.Name;
        var lower = name.ToLower();
        if (lower == alsoTaken?.ToLower()
            || await _db.MoneyAccounts.AnyAsync(a => a.BranchId == branch.Id && a.IsActive && a.Name.ToLower() == lower))
            name = $"{store.Name} ({store.Code})";
        return new MoneyAccount
        {
            Branch = branch, BranchId = branch.Id, Kind = MoneyAccountKind.CASH_BOX, Name = name,
            WarehouseId = store.Id, Currency = await CurrencyAsync(),
        };
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP";

    /// <summary>Something recorded still uses the place being deleted.</summary>
    private sealed class PlaceInUse : Exception;
}
