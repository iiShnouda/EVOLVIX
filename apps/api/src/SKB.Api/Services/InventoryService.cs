using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Stock costing and movement, using the **moving weighted-average** method (§3.3 of ROADMAP)
/// **per branch** (owner decision 2026-09-29, DOMAIN.md §2.4).
///
/// Cost pools: all store warehouses of one branch share that branch's average cost; the system
/// transit warehouse is a pool of its own (<see cref="StockCost"/>). A pool's quantity is the sum
/// of its warehouses' balances. A receipt recomputes its pool's average; an issue leaves at the
/// pool's average (that becomes COGS). Moving goods to another pool (a transfer leg) takes them out
/// at a cost and brings them in at the same cost, so value is never created or lost.
/// <c>Product.CostPrice</c> is kept as the company-wide average (total value ÷ total quantity) for
/// display.
///
/// Every change updates the product total, the warehouse balance and the pool, and appends a
/// <see cref="StockMovement"/>, so <c>StockOnHand = Σ balances = Σ movements</c> always holds.
///
/// Usage: inside a transaction, call <see cref="LockProductsAsync"/> first. It row-locks the
/// products and loads their balances and pools, so the checks and updates that follow can't race
/// another document touching the same items. Nothing here saves — the caller owns the transaction
/// so a whole document commits atomically. Money is minor units.
/// </summary>
public sealed class InventoryService
{
    private readonly AppDbContext _db;
    private readonly Dictionary<(Guid Product, Guid Warehouse), StockBalance> _balances = new();
    private readonly Dictionary<(Guid Product, Guid Pool), StockCost> _pools = new();
    private readonly Dictionary<Guid, Guid> _poolOfWarehouse = new();
    private readonly Dictionary<Guid, Product> _locked = new();

    public InventoryService(AppDbContext db) => _db = db;

    /// <summary>The cost pool a warehouse belongs to: its branch, or itself for the transit warehouse.</summary>
    public static Guid PoolOf(Warehouse w) => w.Kind == WarehouseKind.TRANSIT ? w.Id : w.BranchId;

    /// <summary>
    /// Lock <paramref name="productIds"/> until the transaction ends (in id order, so two documents
    /// never deadlock) and load them tracked with their balances and cost pools. Must run inside a
    /// transaction and before these products are loaded any other way in this request.
    /// </summary>
    public async Task<Dictionary<Guid, Product>> LockProductsAsync(IEnumerable<Guid> productIds)
    {
        if (_db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Stock can only be locked inside a transaction.");

        var ids = productIds.Distinct().OrderBy(id => id).ToArray();
        if (ids.Length == 0) return new Dictionary<Guid, Product>();

        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"Products\" WHERE \"Id\" = ANY({ids}) ORDER BY \"Id\" FOR UPDATE");

        var products = await _db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        foreach (var b in await _db.StockBalances.Where(b => ids.Contains(b.ProductId)).ToListAsync())
            _balances[(b.ProductId, b.WarehouseId)] = b;
        foreach (var c in await _db.StockCosts.Where(c => ids.Contains(c.ProductId)).ToListAsync())
            _pools[(c.ProductId, c.PoolId)] = c;
        foreach (var w in await _db.Warehouses.AsNoTracking()
                     .Select(w => new { w.Id, w.BranchId, w.Kind }).ToListAsync())
            _poolOfWarehouse[w.Id] = w.Kind == WarehouseKind.TRANSIT ? w.Id : w.BranchId;
        foreach (var (id, p) in products) _locked[id] = p;
        return products;
    }

    /// <summary>Quantity of a locked product in one warehouse.</summary>
    public int Available(Guid productId, Guid warehouseId)
    {
        EnsureLocked(productId);
        return _balances.TryGetValue((productId, warehouseId), out var b) ? b.Quantity : 0;
    }

    /// <summary>Current average cost of a locked product in the pool of <paramref name="warehouse"/>.</summary>
    public long CostAt(Product product, Warehouse warehouse) => Pool(product, PoolOf(warehouse)).AvgCost;

    /// <summary>
    /// Receive <paramref name="quantity"/> units at <paramref name="unitCost"/> into
    /// <paramref name="warehouse"/> and recompute that pool's weighted-average cost. Returns it.
    /// </summary>
    public long Receive(Product product, Warehouse warehouse, int quantity, long unitCost,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (unitCost < 0) throw new ArgumentOutOfRangeException(nameof(unitCost), "Cost cannot be negative.");

        var pool = Pool(product, PoolOf(warehouse));
        AddIn(pool, PoolQty(product.Id, pool.PoolId), quantity, unitCost);
        Move(product, warehouse, quantity, unitCost, type, documentId, reference);
        return pool.AvgCost;
    }

    /// <summary>
    /// Issue <paramref name="quantity"/> units out of <paramref name="warehouse"/> at its pool's
    /// average cost. Returns the unit cost used (COGS per unit). The average is unchanged by an
    /// issue. Refuses to take a warehouse below zero.
    /// </summary>
    public long Issue(Product product, Warehouse warehouse, int quantity,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        RequireStock(product, warehouse, quantity);

        var unitCost = Pool(product, PoolOf(warehouse)).AvgCost;
        Move(product, warehouse, -quantity, unitCost, type, documentId, reference);
        return unitCost;
    }

    /// <summary>
    /// Send <paramref name="quantity"/> units back to the supplier from <paramref name="warehouse"/>
    /// at the price we originally paid (<paramref name="unitCost"/>), and back that receipt out of
    /// the pool's average: <c>new_avg = (qty·avg − ret_qty·ret_cost) / (qty − ret_qty)</c> — the
    /// exact inverse of <see cref="Receive"/>. Refused when the warehouse no longer holds the goods.
    /// </summary>
    public long ReturnToSupplier(Product product, Warehouse warehouse, int quantity, long unitCost,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (unitCost < 0) throw new ArgumentOutOfRangeException(nameof(unitCost), "Cost cannot be negative.");
        RequireStock(product, warehouse, quantity);

        var pool = Pool(product, PoolOf(warehouse));
        TakeOut(pool, PoolQty(product.Id, pool.PoolId), quantity, unitCost);
        Move(product, warehouse, -quantity, unitCost, type, documentId, reference);
        return pool.AvgCost;
    }

    /// <summary>
    /// Stocktake / correction (الجرد والتسويات) in one warehouse: move stock by
    /// <paramref name="delta"/> units at the pool's average cost (the average itself doesn't change,
    /// only the quantity and so the value). Returns the value change (minor units, signed).
    /// </summary>
    public long Adjust(Product product, Warehouse warehouse, int delta, string reference, string? note)
    {
        if (delta == 0) throw new ArgumentOutOfRangeException(nameof(delta), "An adjustment must change the quantity.");
        if (delta < 0) RequireStock(product, warehouse, -delta);

        var unitCost = Pool(product, PoolOf(warehouse)).AvgCost;
        Move(product, warehouse, delta, unitCost, StockMovementType.ADJUSTMENT, null, reference, note);
        return (long)delta * unitCost;
    }

    /// <summary>
    /// Move <paramref name="quantity"/> units between two warehouses (a transfer leg), logged as
    /// TRANSFER_OUT of <paramref name="from"/> and TRANSFER_IN to <paramref name="to"/>. The units
    /// leave at <paramref name="unitCost"/> (default: the source pool's average) and arrive at the
    /// same cost, so the company's stock value is unchanged. Between two pools the source average is
    /// backed out exactly and the destination average recomputed; within one pool nothing changes.
    /// Returns the unit cost used.
    /// </summary>
    public long Relocate(Product product, Warehouse from, Warehouse to, int quantity,
        Guid documentId, string reference, long? unitCost = null, string? note = null)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (from.Id == to.Id) throw new ArgumentException("Source and destination must differ.");
        RequireStock(product, from, quantity);

        var source = Pool(product, PoolOf(from));
        var cost = unitCost ?? source.AvgCost;
        var target = Pool(product, PoolOf(to));
        if (source.PoolId != target.PoolId)
        {
            TakeOut(source, PoolQty(product.Id, source.PoolId), quantity, cost);
            AddIn(target, PoolQty(product.Id, target.PoolId), quantity, cost);
        }
        Move(product, from, -quantity, cost, StockMovementType.TRANSFER_OUT, documentId, reference, note);
        Move(product, to, quantity, cost, StockMovementType.TRANSFER_IN, documentId, reference, note);
        return cost;
    }

    // ------------------------------------------------------------------ pools

    /// <summary>new_avg = (Q·A + q·u) / (Q + q), to the nearest minor unit; an empty pool takes u.</summary>
    private static void AddIn(StockCost pool, int poolQty, int quantity, long unitCost)
    {
        pool.AvgCost = poolQty <= 0
            ? unitCost
            : (long)decimal.Round(
                (poolQty * (decimal)pool.AvgCost + (decimal)quantity * unitCost) / (poolQty + quantity),
                MidpointRounding.AwayFromZero);
        pool.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// new_avg = (Q·A − q·u) / (Q − q), the inverse of <see cref="AddIn"/>. With nothing left the
    /// average is kept (the next receipt resets it); it never goes below zero.
    /// </summary>
    private static void TakeOut(StockCost pool, int poolQty, int quantity, long unitCost)
    {
        var left = poolQty - quantity;
        if (left > 0)
        {
            var remaining = (poolQty * (decimal)pool.AvgCost - (decimal)quantity * unitCost) / left;
            pool.AvgCost = Math.Max(0, (long)decimal.Round(remaining, MidpointRounding.AwayFromZero));
        }
        pool.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>The pool row, created on first use at the company average (the best estimate).</summary>
    private StockCost Pool(Product product, Guid poolId)
    {
        EnsureLocked(product.Id);
        if (!_pools.TryGetValue((product.Id, poolId), out var pool))
        {
            pool = new StockCost { ProductId = product.Id, PoolId = poolId, AvgCost = product.CostPrice };
            _db.StockCosts.Add(pool);
            _pools[(product.Id, poolId)] = pool;
        }
        return pool;
    }

    private int PoolQty(Guid productId, Guid poolId) =>
        _balances.Where(kv => kv.Key.Product == productId
                              && _poolOfWarehouse.TryGetValue(kv.Key.Warehouse, out var p) && p == poolId)
            .Sum(kv => kv.Value.Quantity);

    /// <summary>Company average = Σ(pool qty × pool avg) ÷ total qty; unchanged when nothing is left.</summary>
    private void RefreshCompanyCost(Product product)
    {
        long qty = 0;
        decimal value = 0;
        foreach (var ((pid, poolId), pool) in _pools)
        {
            if (pid != product.Id) continue;
            var q = PoolQty(pid, poolId);
            qty += q;
            value += (decimal)q * pool.AvgCost;
        }
        if (qty > 0) product.CostPrice = (long)decimal.Round(value / qty, MidpointRounding.AwayFromZero);
    }

    private void RequireStock(Product product, Warehouse warehouse, int quantity)
    {
        var available = Available(product.Id, warehouse.Id);
        if (quantity > available)
            throw new InvalidOperationException(
                $"Only {available} of {product.Name} in {warehouse.Name}, {quantity} requested.");
    }

    private void EnsureLocked(Guid productId)
    {
        if (!_locked.ContainsKey(productId))
            throw new InvalidOperationException("Lock the product (LockProductsAsync) before changing its stock.");
    }

    /// <summary>Apply a signed quantity to the product total and the warehouse balance, and log it.</summary>
    private void Move(Product product, Warehouse warehouse, int signedQty, long unitCost,
        StockMovementType type, Guid? documentId, string? reference, string? note = null)
    {
        EnsureLocked(product.Id);
        _poolOfWarehouse.TryAdd(warehouse.Id, PoolOf(warehouse));
        if (!_balances.TryGetValue((product.Id, warehouse.Id), out var balance))
        {
            balance = new StockBalance { ProductId = product.Id, WarehouseId = warehouse.Id };
            _db.StockBalances.Add(balance);
            _balances[(product.Id, warehouse.Id)] = balance;
        }

        balance.Quantity += signedQty;
        balance.UpdatedAt = DateTime.UtcNow;
        product.StockOnHand += signedQty;
        RefreshCompanyCost(product);

        _db.StockMovements.Add(new StockMovement
        {
            ProductId = product.Id,
            BranchId = warehouse.BranchId,
            WarehouseId = warehouse.Id,
            Type = type,
            Quantity = signedQty,
            UnitCost = unitCost,
            BalanceAfter = product.StockOnHand,
            WarehouseBalanceAfter = balance.Quantity,
            AvgCostAfter = Pool(product, PoolOf(warehouse)).AvgCost,
            DocumentId = documentId,
            Reference = reference,
            Note = note,
        });
    }
}
