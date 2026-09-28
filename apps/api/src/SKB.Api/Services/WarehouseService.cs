using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// Which warehouses a user may see and post to. Roles that see every branch may use any
/// warehouse; everyone else is limited to the warehouses of their own branch — the same rule
/// that already scopes documents by branch.
/// </summary>
public sealed class WarehouseService
{
    private readonly AppDbContext _db;
    public WarehouseService(AppDbContext db) => _db = db;

    public sealed record WarehouseError(string Code, string Message);

    /// <summary>Warehouses visible to <paramref name="user"/> (active or not).</summary>
    public IQueryable<Warehouse> Visible(ClaimsPrincipal user)
    {
        var q = _db.Warehouses.AsQueryable();
        if (CurrentUser.CanSeeAllBranches(user))
            return q;
        Guid.TryParse(CurrentUser.BranchId(user), out var branchId);
        return q.Where(w => w.BranchId == branchId);
    }

    /// <summary>The branch's default warehouse (or its first active one if none is marked default).</summary>
    public async Task<Warehouse?> DefaultForBranchAsync(Guid branchId) =>
        await _db.Warehouses
            .Where(w => w.BranchId == branchId && w.IsActive)
            .OrderByDescending(w => w.IsDefault).ThenBy(w => w.Name)
            .FirstOrDefaultAsync();

    /// <summary>
    /// Resolve the warehouse a document line posts to: the one requested (must be active and
    /// visible to the user), or the default warehouse of the user's branch when none is given.
    /// Results are cached per request id, so resolving many lines costs one query per warehouse.
    /// </summary>
    public async Task<(Warehouse? Warehouse, WarehouseError? Error)> ResolveAsync(
        ClaimsPrincipal user, string? requested, Dictionary<string, Warehouse>? cache = null)
    {
        var key = string.IsNullOrWhiteSpace(requested) ? "" : requested.Trim();
        if (cache is not null && cache.TryGetValue(key, out var hit)) return (hit, null);

        Warehouse? warehouse;
        if (key == "")
        {
            Guid.TryParse(CurrentUser.BranchId(user), out var branchId);
            warehouse = await DefaultForBranchAsync(branchId);
            if (warehouse is null)
                return (null, new("no_warehouse", "Your branch has no active warehouse. Ask an admin to add one."));
        }
        else
        {
            if (!Guid.TryParse(key, out var id))
                return (null, new("warehouse_not_found", "Warehouse not found."));
            warehouse = await Visible(user).FirstOrDefaultAsync(w => w.Id == id);
            if (warehouse is null)
                return (null, new("warehouse_not_found", "Warehouse not found."));
            if (!warehouse.IsActive)
                return (null, new("warehouse_inactive", $"{warehouse.Name} is closed and can't be used."));
        }

        if (cache is not null) cache[key] = warehouse;
        return (warehouse, null);
    }
}
