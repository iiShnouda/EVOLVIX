using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Stock costing and movement. Uses the **moving weighted-average** method (§3.3 of ROADMAP):
/// on every receipt the product's average cost is recomputed; on every issue the goods leave
/// stock at the current average, and that amount becomes the cost of goods sold (COGS).
///
/// Stock is held per warehouse (<see cref="StockBalance"/>); the average cost is company-wide per
/// product (DOMAIN.md §2.4). Every change updates the product total, the warehouse balance and
/// appends a <see cref="StockMovement"/>, so the three always agree.
///
/// Usage: inside a transaction, call <see cref="LockProductsAsync"/> first. It row-locks the
/// products and loads their balances, so the availability checks and the updates that follow
/// can't race another document touching the same items. The mutating methods don't save — the
/// caller owns the transaction so a whole document commits atomically. Money is minor units.
/// </summary>
public sealed class InventoryService
{
    private readonly AppDbContext _db;
    private readonly Dictionary<(Guid Product, Guid Warehouse), StockBalance> _balances = new();
    private readonly HashSet<Guid> _locked = new();

    public InventoryService(AppDbContext db) => _db = db;

    /// <summary>
    /// Lock <paramref name="productIds"/> until the transaction ends (in id order, so two documents
    /// never deadlock) and load them tracked with their warehouse balances. Must run inside a
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
        var balances = await _db.StockBalances.Where(b => ids.Contains(b.ProductId)).ToListAsync();
        foreach (var b in balances) _balances[(b.ProductId, b.WarehouseId)] = b;
        foreach (var id in products.Keys) _locked.Add(id);
        return products;
    }

    /// <summary>Quantity of a locked product in one warehouse.</summary>
    public int Available(Guid productId, Guid warehouseId)
    {
        EnsureLocked(productId);
        return _balances.TryGetValue((productId, warehouseId), out var b) ? b.Quantity : 0;
    }

    /// <summary>
    /// Receive <paramref name="quantity"/> units at <paramref name="unitCost"/> into
    /// <paramref name="warehouse"/> and recompute the product's weighted-average cost.
    /// Returns the new average cost.
    /// </summary>
    public long Receive(Product product, Warehouse warehouse, int quantity, long unitCost,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (unitCost < 0) throw new ArgumentOutOfRangeException(nameof(unitCost), "Cost cannot be negative.");

        long oldQty = product.StockOnHand;
        long newQty = oldQty + quantity;

        // new_avg = (old_qty*old_avg + recv_qty*recv_cost) / (old_qty + recv_qty), to nearest minor unit.
        long newAvg = oldQty <= 0
            ? unitCost
            : (long)decimal.Round(
                (oldQty * product.CostPrice + (long)quantity * unitCost) / (decimal)newQty,
                MidpointRounding.AwayFromZero);

        product.CostPrice = newAvg;
        Move(product, warehouse, quantity, unitCost, type, documentId, reference);
        return newAvg;
    }

    /// <summary>
    /// Issue <paramref name="quantity"/> units out of <paramref name="warehouse"/> at the current
    /// weighted-average cost. Returns the unit cost used (the COGS per unit). The average cost is
    /// unchanged by an issue. Refuses to take a warehouse below zero.
    /// </summary>
    public long Issue(Product product, Warehouse warehouse, int quantity,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        RequireStock(product, warehouse, quantity);

        long unitCost = product.CostPrice;
        Move(product, warehouse, -quantity, unitCost, type, documentId, reference);
        return unitCost;
    }

    /// <summary>
    /// Send <paramref name="quantity"/> units back to the supplier from <paramref name="warehouse"/>
    /// at the price we originally paid (<paramref name="unitCost"/>), and back that receipt out of the
    /// weighted average: <c>new_avg = (qty·avg − ret_qty·ret_cost) / (qty − ret_qty)</c>. This is the
    /// exact inverse of <see cref="Receive"/>, so a purchase followed by its full return leaves the
    /// average where it was. Refused when the warehouse no longer holds the goods.
    /// </summary>
    public long ReturnToSupplier(Product product, Warehouse warehouse, int quantity, long unitCost,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (unitCost < 0) throw new ArgumentOutOfRangeException(nameof(unitCost), "Cost cannot be negative.");
        RequireStock(product, warehouse, quantity);

        long oldQty = product.StockOnHand;
        long newQty = oldQty - quantity;

        // With nothing left the average is meaningless, so keep the last one (the next receipt resets it).
        // A return priced far above the current average could push the remainder negative; cost can't be.
        if (newQty > 0)
        {
            var remaining = (oldQty * product.CostPrice - (long)quantity * unitCost) / (decimal)newQty;
            product.CostPrice = Math.Max(0, (long)decimal.Round(remaining, MidpointRounding.AwayFromZero));
        }

        Move(product, warehouse, -quantity, unitCost, type, documentId, reference);
        return product.CostPrice;
    }

    /// <summary>
    /// Stocktake / correction (الجرد والتسويات) in one warehouse: move stock by
    /// <paramref name="delta"/> units (positive = found more than the books say, negative =
    /// shrinkage). Both sides are valued at the current weighted-average cost, so the average itself
    /// doesn't change — only the quantity and therefore the stock value. Returns the value change
    /// (minor units, signed).
    /// </summary>
    public long Adjust(Product product, Warehouse warehouse, int delta, string reference, string? note)
    {
        if (delta == 0) throw new ArgumentOutOfRangeException(nameof(delta), "An adjustment must change the quantity.");
        if (delta < 0) RequireStock(product, warehouse, -delta);

        Move(product, warehouse, delta, product.CostPrice, StockMovementType.ADJUSTMENT, null, reference, note);
        return (long)delta * product.CostPrice;
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
        if (!_locked.Contains(productId))
            throw new InvalidOperationException("Lock the product (LockProductsAsync) before changing its stock.");
    }

    /// <summary>Apply a signed quantity to the product total and the warehouse balance, and log it.</summary>
    private void Move(Product product, Warehouse warehouse, int signedQty, long unitCost,
        StockMovementType type, Guid? documentId, string? reference, string? note = null)
    {
        EnsureLocked(product.Id);
        if (!_balances.TryGetValue((product.Id, warehouse.Id), out var balance))
        {
            balance = new StockBalance { ProductId = product.Id, WarehouseId = warehouse.Id };
            _db.StockBalances.Add(balance);
            _balances[(product.Id, warehouse.Id)] = balance;
        }

        balance.Quantity += signedQty;
        balance.UpdatedAt = DateTime.UtcNow;
        product.StockOnHand += signedQty;

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
            AvgCostAfter = product.CostPrice,
            DocumentId = documentId,
            Reference = reference,
            Note = note,
        });
    }
}
