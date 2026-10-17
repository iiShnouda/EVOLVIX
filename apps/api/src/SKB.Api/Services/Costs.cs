using System.Security.Claims;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Who may see what goods cost and what a sale earned (owner decision 2026-09-30: the owner, plus
/// whoever the owner gives <see cref="Permissions.CostsView"/>). The server removes these numbers from
/// its answers for everyone else — hiding them on screen alone would not keep them private.
///
/// Hidden (set to 0) without the permission: cost and profit on sales invoices, returns and
/// quotations; an item's average cost; stock values (inventory, item card, warehouses, transfers,
/// stocktakes, dead stock); profit in sales performance. Whole reports that are only about cost or
/// profit (profitability, stock valuation, income statement) are refused instead.
/// Supplier-side price levels, which sit close to cost, are only shown to people who work with
/// purchases (<see cref="Permissions.PurchasesView"/>) or may see costs.
/// Purchase documents keep their prices: what we paid is the purchase side's own business.
/// </summary>
public static class Costs
{
    public static bool CanSee(ClaimsPrincipal user) => user.HasClaim("permission", Permissions.CostsView);

    /// <summary>Profit has its own permission (owner, 2026-10-17), apart from what goods cost.</summary>
    public static bool CanSeeProfit(ClaimsPrincipal user) => user.HasClaim("permission", Permissions.ProfitView);

    /// <summary>Reports made of both (profit and loss, the books' statements) need both.</summary>
    public static bool CanSeeBoth(ClaimsPrincipal user) => CanSee(user) && CanSeeProfit(user);

    public static bool CanSeePurchasePrices(ClaimsPrincipal user) =>
        CanSee(user) || user.HasClaim("permission", Permissions.PurchasesView);

    /// <summary>A sales invoice, return or quotation without its cost and profit.</summary>
    public static SalesDetailDto Guard(ClaimsPrincipal user, SalesDetailDto d)
    {
        bool cost = CanSee(user), profit = CanSeeProfit(user);
        if (cost && profit) return d;
        return d with
        {
            Lines = d.Lines.Select(l => l with
            {
                UnitCost = cost ? l.UnitCost : 0,
                LineCost = cost ? l.LineCost : 0,
                LineProfit = profit ? l.LineProfit : 0,
            }).ToArray(),
            CostTotal = cost ? d.CostTotal : 0,
            ProfitTotal = profit ? d.ProfitTotal : 0,
        };
    }

    /// <summary>An item without its average cost, and without supplier prices for sales-only staff.</summary>
    public static ProductDto Guard(ClaimsPrincipal user, ProductDto p, IReadOnlySet<string> purchaseLevels)
    {
        if (CanSee(user)) return p;
        var seePurchase = CanSeePurchasePrices(user);
        return p with
        {
            CostPrice = 0,
            Units = seePurchase ? p.Units : p.Units.Select(u => u with
            {
                Prices = u.Prices.Where(x => !purchaseLevels.Contains(x.PriceLevelId)).ToArray(),
            }).ToArray(),
        };
    }

    public static ProductDetailDto Guard(ClaimsPrincipal user, ProductDetailDto p, IReadOnlySet<string> purchaseLevels) =>
        CanSee(user) ? p : p with
        {
            CostPrice = 0,
            Prices = CanSeePurchasePrices(user) ? p.Prices
                : p.Prices.Where(x => !purchaseLevels.Contains(x.PriceLevelId)).ToArray(),
        };

    public static ModelDetailDto Guard(ClaimsPrincipal user, ModelDetailDto m, IReadOnlySet<string> purchaseLevels) =>
        CanSeePurchasePrices(user) ? m : m with
        {
            Prices = m.Prices.Where(x => !purchaseLevels.Contains(x.PriceLevelId)).ToArray(),
        };

    public static InventoryItemDto Guard(ClaimsPrincipal user, InventoryItemDto i) =>
        CanSee(user) ? i : i with { AvgCost = 0, StockValue = 0 };

    public static StockMovementDto Guard(ClaimsPrincipal user, StockMovementDto m) =>
        CanSee(user) ? m : m with { UnitCost = 0, AvgCostAfter = 0 };

    public static WarehouseStockDto Guard(ClaimsPrincipal user, WarehouseStockDto w) =>
        CanSee(user) ? w : w with { Value = 0 };

    public static WarehouseDto Guard(ClaimsPrincipal user, WarehouseDto w) =>
        CanSee(user) ? w : w with { Value = 0 };

    public static StockTransferDto Guard(ClaimsPrincipal user, StockTransferDto t) => CanSee(user) ? t : t with
    {
        Value = 0,
        Lines = t.Lines.Select(l => l with { UnitCost = 0, Value = 0 }).ToArray(),
    };

    public static PerformanceDto Guard(ClaimsPrincipal user, PerformanceDto p) => CanSeeProfit(user) ? p : p with
    {
        Profit = 0,
        Rows = p.Rows.Select(r => r with { Profit = 0 }).ToArray(),
    };

    public static DeadItemDto Guard(ClaimsPrincipal user, DeadItemDto d) =>
        CanSee(user) ? d : d with { StockValue = 0 };

    /// <summary>The refusal for a report that is only about cost or profit.</summary>
    public static object Refusal => new
    {
        message = "Seeing costs and profit needs permission.",
        code = "costs_not_allowed",
    };
}
