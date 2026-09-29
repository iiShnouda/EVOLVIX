namespace SKB.Api.Domain;

/// <summary>Permission strings of the form "resource:action". Server is the sole enforcer.</summary>
public static class Permissions
{
    public const string DashboardView = "dashboard:view";
    public const string SalesView = "sales:view";
    public const string SalesCreate = "sales:create";
    public const string SalesEdit = "sales:edit";
    /// <summary>Allowed to sell below the configured profit floor (never below cost).</summary>
    public const string SalesOverrideFloor = "sales:override_floor";
    /// <summary>
    /// Issue a sales return (restock + credit the customer). Separate from SalesCreate on purpose:
    /// a return moves money back out, so it is not granted to the SALES role by default.
    /// </summary>
    public const string SalesReturn = "sales:return";
    public const string PurchasesView = "purchases:view";
    public const string PurchasesCreate = "purchases:create";
    /// <summary>Return goods to a supplier (stock out at the original cost + reduce the payable).</summary>
    public const string PurchasesReturn = "purchases:return";
    public const string ReceiptsView = "receipts:view";
    public const string PartiesView = "parties:view";
    public const string PartiesEdit = "parties:edit";
    public const string InventoryView = "inventory:view";
    public const string InventoryEdit = "inventory:edit";
    public const string StaffView = "staff:view";
    public const string BranchesView = "branches:view";
    /// <summary>Create, rename, deactivate warehouses and pick each branch's default warehouse.</summary>
    public const string BranchesManage = "branches:manage";
    public const string AnalyticsView = "analytics:view";
    public const string SettingsView = "settings:view";
    public const string SettingsManage = "settings:manage";
    public const string AuditView = "audit:view";
    public const string PresenceView = "presence:view";

    // ---- Catalog (owner decision 2026-09-29: every action has its own permission) ----
    /// <summary>Add items and item models (with their size × color variants).</summary>
    public const string ProductsCreate = "products:create";
    /// <summary>Edit items and models: names, category, units, barcodes, sizes/colors, reorder level, deactivate.</summary>
    public const string ProductsEdit = "products:edit";
    /// <summary>Set item and model prices at each price level.</summary>
    public const string PricesEdit = "prices:edit";
    /// <summary>Add, rename, reorder and close price levels, and pick each side's default.</summary>
    public const string PriceLevelsManage = "price_levels:manage";
    public const string CategoriesManage = "categories:manage";
    public const string UnitsManage = "units:manage";
    /// <summary>Add and rename the company's sizes and colors.</summary>
    public const string VariantOptionsManage = "variant_options:manage";
    /// <summary>Sell at a price other than the price level's (and give a line discount).</summary>
    public const string SalesChangePrice = "sales:change_price";
    /// <summary>Price a sales invoice at a level other than the customer's own.</summary>
    public const string SalesChoosePriceLevel = "sales:choose_price_level";
    /// <summary>Buy at a cost other than the supplier price level's.</summary>
    public const string PurchasesChangePrice = "purchases:change_price";
    /// <summary>Price a purchase invoice at a level other than the supplier's own.</summary>
    public const string PurchasesChoosePriceLevel = "purchases:choose_price_level";
    /// <summary>Set a customer's or supplier's default price level.</summary>
    public const string PartiesSetPriceLevel = "parties:set_price_level";

    /// <summary>Every permission, used to register one authorization policy per permission.</summary>
    public static readonly string[] All =
    {
        DashboardView, SalesView, SalesCreate, SalesEdit, SalesOverrideFloor, SalesReturn,
        PurchasesView, PurchasesCreate, PurchasesReturn, ReceiptsView,
        PartiesView, PartiesEdit, InventoryView, InventoryEdit, StaffView, BranchesView, BranchesManage,
        AnalyticsView, SettingsView, SettingsManage, AuditView, PresenceView,
        ProductsCreate, ProductsEdit, PricesEdit, PriceLevelsManage, CategoriesManage, UnitsManage,
        VariantOptionsManage, SalesChangePrice, SalesChoosePriceLevel, PurchasesChangePrice,
        PurchasesChoosePriceLevel, PartiesSetPriceLevel,
    };
}

public static class RolePermissions
{
    private static readonly string[] All = Permissions.All;

    public static readonly IReadOnlyDictionary<Role, string[]> Map = new Dictionary<Role, string[]>
    {
        [Role.OWNER] = All,
        [Role.ADMIN] = All.Where(p => p != Permissions.AuditView).ToArray(),
        [Role.ACCOUNTANT] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.SalesOverrideFloor, Permissions.SalesReturn,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ReceiptsView, Permissions.PartiesView, Permissions.PartiesEdit,
            Permissions.InventoryView, Permissions.InventoryEdit, Permissions.AnalyticsView, Permissions.SettingsView,
            Permissions.ProductsCreate, Permissions.ProductsEdit, Permissions.PricesEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.SalesChangePrice, Permissions.SalesChoosePriceLevel,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel, Permissions.PartiesSetPriceLevel,
        },
        // Sales staff sell at the customer's price level; changing a price or the level needs a
        // manager (owner decision 2026-09-29).
        [Role.SALES] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.PartiesView, Permissions.PartiesEdit, Permissions.InventoryView,
        },
        // Store staff add items and enter supplier invoices as printed; they don't set selling prices.
        [Role.INVENTORY] = new[]
        {
            Permissions.DashboardView, Permissions.InventoryView, Permissions.InventoryEdit,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ProductsCreate, Permissions.ProductsEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel,
        },
        [Role.VIEWER] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.PurchasesView, Permissions.ReceiptsView,
            Permissions.PartiesView, Permissions.InventoryView, Permissions.AnalyticsView,
        },
    };

    public static string[] For(Role role) => Map.TryGetValue(role, out var p) ? p : Array.Empty<string>();
}
