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
