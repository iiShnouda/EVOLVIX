using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Stock costing and movement. Uses the **moving weighted-average** method (§3.3 of ROADMAP):
/// on every receipt the product's average cost is recomputed; on every issue the goods leave
/// stock at the current average, and that amount becomes the cost of goods sold (COGS).
///
/// These methods mutate the tracked <see cref="Product"/> and append a <see cref="StockMovement"/>,
/// but do NOT save — the calling controller owns the transaction so a whole document commits atomically.
/// Money is integer minor units throughout.
/// </summary>
public sealed class InventoryService
{
    private readonly AppDbContext _db;
    public InventoryService(AppDbContext db) => _db = db;

    /// <summary>
    /// Receive <paramref name="quantity"/> units at <paramref name="unitCost"/> into stock and
    /// recompute the product's weighted-average cost. Returns the new average cost.
    /// </summary>
    public long Receive(Product product, int quantity, long unitCost, Guid branchId,
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
        product.StockOnHand = (int)newQty;

        AddMovement(product, quantity, unitCost, branchId, type, documentId, reference);
        return newAvg;
    }

    /// <summary>
    /// Issue <paramref name="quantity"/> units out of stock at the current weighted-average cost.
    /// Returns the unit cost used (the COGS per unit). The average cost is unchanged by an issue.
    /// </summary>
    public long Issue(Product product, int quantity, Guid branchId,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");

        long unitCost = product.CostPrice;
        product.StockOnHand -= quantity;

        AddMovement(product, -quantity, unitCost, branchId, type, documentId, reference);
        return unitCost;
    }

    /// <summary>
    /// Send <paramref name="quantity"/> units back to the supplier at the price we originally paid
    /// (<paramref name="unitCost"/>), and back that receipt out of the weighted average:
    /// <c>new_avg = (qty·avg − ret_qty·ret_cost) / (qty − ret_qty)</c>. This is the exact inverse of
    /// <see cref="Receive"/>, so a purchase followed by its full return leaves the average where it was.
    /// If the goods are no longer in stock the caller must refuse the return (checked here too).
    /// </summary>
    public long ReturnToSupplier(Product product, int quantity, long unitCost, Guid branchId,
        StockMovementType type, Guid? documentId, string? reference)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");
        if (unitCost < 0) throw new ArgumentOutOfRangeException(nameof(unitCost), "Cost cannot be negative.");
        if (quantity > product.StockOnHand)
            throw new InvalidOperationException($"Only {product.StockOnHand} of {product.Name} in stock.");

        long oldQty = product.StockOnHand;
        long newQty = oldQty - quantity;

        // With nothing left the average is meaningless, so keep the last one (the next receipt resets it).
        // A return priced far above the current average could push the remainder negative; cost can't be.
        if (newQty > 0)
        {
            var remaining = (oldQty * product.CostPrice - (long)quantity * unitCost) / (decimal)newQty;
            product.CostPrice = Math.Max(0, (long)decimal.Round(remaining, MidpointRounding.AwayFromZero));
        }
        product.StockOnHand = (int)newQty;

        AddMovement(product, -quantity, unitCost, branchId, type, documentId, reference);
        return product.CostPrice;
    }

    private void AddMovement(Product product, int signedQty, long unitCost, Guid branchId,
        StockMovementType type, Guid? documentId, string? reference)
    {
        _db.StockMovements.Add(new StockMovement
        {
            ProductId = product.Id,
            BranchId = branchId,
            Type = type,
            Quantity = signedQty,
            UnitCost = unitCost,
            BalanceAfter = product.StockOnHand,
            AvgCostAfter = product.CostPrice,
            DocumentId = documentId,
            Reference = reference,
        });
    }
}
