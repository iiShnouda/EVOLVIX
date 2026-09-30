using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Which warehouses a user may see and post to: those of their branches (see <see cref="Access"/>),
/// and only the ones the owner named if they narrowed it — the same rule that scopes documents.
/// </summary>
public sealed class WarehouseService
{
    private readonly AppDbContext _db;
    public WarehouseService(AppDbContext db) => _db = db;

    public sealed record WarehouseError(string Code, string Message);

    /// <summary>
    /// Warehouses visible to <paramref name="user"/> (active or not): the stores of their branches
    /// (only those named, if the owner narrowed it) — plus the system TRANSIT warehouse, which
    /// everyone may look at but nobody posts to directly.
    /// </summary>
    public IQueryable<Warehouse> Visible(ClaimsPrincipal user)
    {
        var q = _db.Warehouses.AsQueryable();
        if (Access.Branches(user) is { } branches)
            q = q.Where(w => branches.Contains(w.BranchId) || w.Kind == WarehouseKind.TRANSIT);
        if (Access.Warehouses(user) is { } only)
            q = q.Where(w => only.Contains(w.Id) || w.Kind == WarehouseKind.TRANSIT);
        return q;
    }

    /// <summary>
    /// The stores whose stock a person sees, or null when they see every branch and warehouse (then
    /// totals are the whole company's, goods in transit included).
    /// </summary>
    public async Task<HashSet<Guid>?> LimitAsync(ClaimsPrincipal user)
    {
        if (Access.AllBranches(user) && Access.Warehouses(user) is null) return null;
        return (await Visible(user).Where(w => w.Kind == WarehouseKind.STORE).Select(w => w.Id).ToListAsync()).ToHashSet();
    }

    /// <summary>May the person use this warehouse (see it, sell from it, count it)?</summary>
    public static bool CanUse(ClaimsPrincipal user, Warehouse w) =>
        w.Kind == WarehouseKind.TRANSIT
        || (Access.CanUseBranch(user, w.BranchId) && (Access.Warehouses(user) is not { } only || only.Contains(w.Id)));

    /// <summary>The branch's default store (or its first active one if none is marked default).</summary>
    public async Task<Warehouse?> DefaultForBranchAsync(Guid branchId) =>
        await _db.Warehouses
            .Where(w => w.BranchId == branchId && w.IsActive && w.Kind == WarehouseKind.STORE)
            .OrderByDescending(w => w.IsDefault).ThenBy(w => w.Name)
            .FirstOrDefaultAsync();

    /// <summary>
    /// The single system warehouse that holds goods between sending and receiving a transfer.
    /// Created on first use, attached to the oldest branch (it belongs to no branch in practice).
    /// </summary>
    public async Task<Warehouse> TransitAsync()
    {
        var transit = await _db.Warehouses.FirstOrDefaultAsync(w => w.Kind == WarehouseKind.TRANSIT);
        if (transit is not null) return transit;
        var branch = await _db.Branches.OrderBy(b => b.CreatedAt).FirstAsync();
        transit = new Warehouse
        {
            Name = "In transit",
            Code = "TRANSIT", BranchId = branch.Id, Branch = branch,
            Kind = WarehouseKind.TRANSIT, IsActive = true,
        };
        _db.Warehouses.Add(transit);
        return transit;
    }

    /// <summary>
    /// Resolve the warehouse a document line posts to: the one requested (must be active and
    /// visible to the user), or when none is given the default warehouse of their working branch
    /// (their first one there, if the owner narrowed their warehouses).
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
            var branchId = Access.Work(user);
            warehouse = await DefaultForBranchAsync(branchId);
            if (warehouse is not null && !CanUse(user, warehouse))
                warehouse = await Visible(user)
                    .Where(w => w.BranchId == branchId && w.IsActive && w.Kind == WarehouseKind.STORE)
                    .OrderByDescending(w => w.IsDefault).ThenBy(w => w.Name).FirstOrDefaultAsync();
            if (warehouse is null)
                return (null, new("no_warehouse", "Your branch has no active warehouse. Ask an admin to add one."));
        }
        else
        {
            if (!Guid.TryParse(key, out var id))
                return (null, new("warehouse_not_found", "Warehouse not found."));
            warehouse = await Visible(user).FirstOrDefaultAsync(w => w.Id == id && w.Kind == WarehouseKind.STORE);
            if (warehouse is null)
                return (null, new("warehouse_not_found", "Warehouse not found."));
            if (!warehouse.IsActive)
                return (null, new("warehouse_inactive", $"{Loc.Name(warehouse)} is closed and can't be used."));
        }

        if (cache is not null) cache[key] = warehouse;
        return (warehouse, null);
    }
}
