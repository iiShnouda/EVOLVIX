using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Read side of per-branch costing: what each warehouse holds and what it is worth, now or at the
/// end of any past moment. A warehouse's stock is valued at the average cost of its pool (its
/// branch, or the transit warehouse itself), exactly as <see cref="InventoryService"/> posts it —
/// so lists, item cards, valuations and warehouse totals always tie to each other.
/// </summary>
public sealed class StockValuation
{
    private readonly AppDbContext _db;
    public StockValuation(AppDbContext db) => _db = db;

    /// <summary>Stock state: quantity per (product, warehouse) and average cost per (product, pool).</summary>
    public sealed class State
    {
        public Dictionary<(Guid Product, Guid Warehouse), int> Quantity { get; } = new();
        public Dictionary<(Guid Product, Guid Pool), long> AvgCost { get; } = new();
        public Dictionary<Guid, Guid> PoolOfWarehouse { get; } = new();

        /// <summary>Unit cost of a product in a warehouse's pool (0 when the pool has no history).</summary>
        public long CostIn(Guid productId, Guid warehouseId) =>
            PoolOfWarehouse.TryGetValue(warehouseId, out var pool) && AvgCost.TryGetValue((productId, pool), out var c)
                ? c
                : 0;

        public long ValueOf(Guid productId, Guid warehouseId) =>
            Quantity.TryGetValue((productId, warehouseId), out var q) ? (long)q * CostIn(productId, warehouseId) : 0;

        /// <summary>Total quantity and value of one product, in one warehouse or all.</summary>
        public (int Quantity, long Value) Of(Guid productId, Guid? warehouseId = null)
        {
            int qty = 0;
            long value = 0;
            foreach (var ((pid, wid), q) in Quantity)
            {
                if (pid != productId || (warehouseId is Guid only && wid != only)) continue;
                qty += q;
                value += (long)q * CostIn(pid, wid);
            }
            return (qty, value);
        }
    }

    /// <summary>Today's state from the live balances and cost pools.</summary>
    public async Task<State> CurrentAsync(Guid? productId = null)
    {
        var state = await NewStateAsync();
        var balances = _db.StockBalances.AsNoTracking().Where(b => b.Quantity != 0);
        var costs = _db.StockCosts.AsNoTracking().AsQueryable();
        if (productId is Guid pid)
        {
            balances = balances.Where(b => b.ProductId == pid);
            costs = costs.Where(c => c.ProductId == pid);
        }
        foreach (var b in await balances.ToListAsync()) state.Quantity[(b.ProductId, b.WarehouseId)] = b.Quantity;
        foreach (var c in await costs.ToListAsync()) state.AvgCost[(c.ProductId, c.PoolId)] = c.AvgCost;
        return state;
    }

    /// <summary>
    /// State just before <paramref name="end"/>, replayed from the movement ledger: each warehouse's
    /// running balance after its last movement, and each pool's average after its last movement.
    /// </summary>
    public async Task<State> AtAsync(DateTime end, Guid? productId = null)
    {
        var state = await NewStateAsync();
        var all = productId is null;
        var pid = productId ?? Guid.Empty;

        var places = await _db.Database.SqlQuery<PlaceRow>($"""
            SELECT DISTINCT ON (m."ProductId", m."WarehouseId")
                   m."ProductId", m."WarehouseId", m."WarehouseBalanceAfter" AS "Quantity"
            FROM "StockMovements" m
            WHERE m."CreatedAt" < {end} AND ({all} OR m."ProductId" = {pid})
            ORDER BY m."ProductId", m."WarehouseId", m."CreatedAt" DESC
            """).ToListAsync();
        foreach (var r in places.Where(r => r.Quantity != 0)) state.Quantity[(r.ProductId, r.WarehouseId)] = r.Quantity;

        var pools = await _db.Database.SqlQuery<PoolRow>($"""
            SELECT DISTINCT ON (m."ProductId", CASE WHEN w."Kind" = 'TRANSIT' THEN w."Id" ELSE w."BranchId" END)
                   m."ProductId",
                   CASE WHEN w."Kind" = 'TRANSIT' THEN w."Id" ELSE w."BranchId" END AS "PoolId",
                   m."AvgCostAfter" AS "AvgCost"
            FROM "StockMovements" m
            JOIN "Warehouses" w ON w."Id" = m."WarehouseId"
            WHERE m."CreatedAt" < {end} AND ({all} OR m."ProductId" = {pid})
            ORDER BY m."ProductId", CASE WHEN w."Kind" = 'TRANSIT' THEN w."Id" ELSE w."BranchId" END, m."CreatedAt" DESC
            """).ToListAsync();
        foreach (var r in pools) state.AvgCost[(r.ProductId, r.PoolId)] = r.AvgCost;
        return state;
    }

    private async Task<State> NewStateAsync()
    {
        var state = new State();
        foreach (var w in await _db.Warehouses.AsNoTracking().Select(w => new { w.Id, w.BranchId, w.Kind }).ToListAsync())
            state.PoolOfWarehouse[w.Id] = w.Kind == WarehouseKind.TRANSIT ? w.Id : w.BranchId;
        return state;
    }

    public sealed class PlaceRow
    {
        public Guid ProductId { get; set; }
        public Guid WarehouseId { get; set; }
        public int Quantity { get; set; }
    }

    public sealed class PoolRow
    {
        public Guid ProductId { get; set; }
        public Guid PoolId { get; set; }
        public long AvgCost { get; set; }
    }
}
