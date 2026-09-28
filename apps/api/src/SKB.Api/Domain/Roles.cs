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
    public const string PurchasesView = "purchases:view";
    public const string PurchasesCreate = "purchases:create";
    public const string ReceiptsView = "receipts:view";
    public const string PartiesView = "parties:view";
    public const string PartiesEdit = "parties:edit";
    public const string InventoryView = "inventory:view";
    public const string InventoryEdit = "inventory:edit";
    public const string StaffView = "staff:view";
    public const string BranchesView = "branches:view";
    public const string AnalyticsView = "analytics:view";
    public const string SettingsView = "settings:view";
    public const string SettingsManage = "settings:manage";
    public const string AuditView = "audit:view";
    public const string PresenceView = "presence:view";

    /// <summary>Every permission, used to register one authorization policy per permission.</summary>
    public static readonly string[] All =
    {
        DashboardView, SalesView, SalesCreate, SalesEdit, SalesOverrideFloor,
        PurchasesView, PurchasesCreate, ReceiptsView,
        PartiesView, PartiesEdit, InventoryView, InventoryEdit, StaffView, BranchesView,
        AnalyticsView, SettingsView, SettingsManage, AuditView, PresenceView,
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
            Permissions.SalesOverrideFloor, Permissions.PurchasesView, Permissions.PurchasesCreate,
            Permissions.ReceiptsView, Permissions.PartiesView, Permissions.PartiesEdit,
            Permissions.InventoryView, Permissions.InventoryEdit, Permissions.AnalyticsView, Permissions.SettingsView,
        },
        [Role.SALES] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.PartiesView, Permissions.PartiesEdit, Permissions.InventoryView,
        },
        [Role.INVENTORY] = new[]
        {
            Permissions.DashboardView, Permissions.InventoryView, Permissions.InventoryEdit,
            Permissions.PurchasesView, Permissions.PurchasesCreate,
        },
        [Role.VIEWER] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.PurchasesView, Permissions.ReceiptsView,
            Permissions.PartiesView, Permissions.InventoryView, Permissions.AnalyticsView,
        },
    };

    public static string[] For(Role role) => Map.TryGetValue(role, out var p) ? p : Array.Empty<string>();
}
