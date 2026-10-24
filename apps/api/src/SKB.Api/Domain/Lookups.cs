using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace SKB.Api.Domain;

/// <summary>
/// Lists several pages read (owner, 2026-10-23: every permission works on its own, none needs
/// another to be open). Each opens for anyone holding a permission that uses it; what it shows is
/// still cut to what they may see (their branches, warehouses and money accounts; supply prices and
/// contacts by their own permissions). Reference lists (units, sizes, colors, seasons, departments,
/// warehouses, branches) open for every signed-in person, scoped the same way.
/// </summary>
public static class Lookups
{
    /// <summary>Customers, suppliers and shipping companies: pickers, filters and their files.</summary>
    public const string Parties = "lookup:parties";
    /// <summary>Items: the item finder, pickers and filters.</summary>
    public const string Products = "lookup:products";
    /// <summary>
    /// Cash boxes, banks and wallets: where money goes in or out. Money taken on a sale or purchase
    /// goes to the branch's own box for whoever can't list them; handovers list their own boxes.
    /// </summary>
    public const string MoneyAccounts = "lookup:money-accounts";
    /// <summary>Price lists and quantity discounts.</summary>
    public const string PriceLists = "lookup:price-lists";

    public static readonly IReadOnlyDictionary<string, string[]> Sets = new Dictionary<string, string[]>
    {
        [Parties] = Of(new[] { "parties:", "sales:", "purchases:", "delivery:", "shipments:", "settlements:", "notes:", "reports:" },
            Permissions.StatementCustomers, Permissions.StatementSuppliers, Permissions.StatementCarriers,
            Permissions.VouchersView, Permissions.ReceiptsCreate, Permissions.PaymentsCreate, Permissions.ExpensesCreate,
            Permissions.VouchersDiscount, Permissions.PriceListsView, Permissions.PriceListsCustomers,
            Permissions.InventoryView, Permissions.ProductsCreate, Permissions.ProductsEdit, Permissions.ValuationSuppliers,
            Permissions.LabelsPrint, Permissions.AiScanPurchase, Permissions.AiScanCheques),
        [Products] = Of(new[] { "inventory:", "products:", "transfers:", "price_lists:", "quantity_breaks:", "labels:", "sales:", "purchases:" },
            Permissions.PricesEdit, Permissions.ReportsItems, Permissions.ReportsProfit, Permissions.StatementWarehouses,
            Permissions.AiScanPurchase, Permissions.AiScanStocktake),
        [MoneyAccounts] = Of(new[] { "money:", "vouchers:", "money_accounts:" },
            Permissions.ReceiptsCreate, Permissions.PaymentsCreate, Permissions.ExpensesCreate, Permissions.CashTransfer,
            Permissions.SalesApprove, Permissions.DeliverySettle,
            Permissions.NotesDeposit, Permissions.NotesCollect, Permissions.NotesPay, Permissions.NotesBounce,
            Permissions.PayrollPay, Permissions.PayrollAdvance, Permissions.StatementMoney, Permissions.StaffAccess),
        [PriceLists] = Of(new[] { "price_lists:", "quantity_breaks:" }, Permissions.PartiesSetPriceLevel),
    };

    private static string[] Of(string[] prefixes, params string[] more) =>
        Permissions.All.Where(p => prefixes.Any(p.StartsWith) || more.Contains(p)).ToArray();

    /// <summary>Whether the person holds this permission.</summary>
    public static bool Has(this ClaimsPrincipal u, string permission) => u.HasClaim("permission", permission);

    /// <summary>Whether the person holds any one of these permissions.</summary>
    public static bool HasAny(this ClaimsPrincipal u, params string[] permissions) => permissions.Any(u.Has);
}

/// <summary>
/// Needs any one of these permissions: a page with several parts, or an action several pages offer,
/// opens for whoever holds one of them (owner, 2026-10-23).
/// </summary>
public sealed class AnyPermissionAttribute : AuthorizeAttribute
{
    public const string Prefix = "any:";

    public AnyPermissionAttribute(params string[] permissions) => Policy = Prefix + string.Join('|', permissions);
}

/// <summary>Builds the "any of" policies <see cref="AnyPermissionAttribute"/> names; the rest are registered.</summary>
public sealed class PermissionPolicyProvider : DefaultAuthorizationPolicyProvider
{
    public PermissionPolicyProvider(IOptions<AuthorizationOptions> options) : base(options) { }

    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        var known = await base.GetPolicyAsync(policyName);
        if (known is not null || !policyName.StartsWith(AnyPermissionAttribute.Prefix)) return known;
        var wanted = policyName[AnyPermissionAttribute.Prefix.Length..].Split('|');
        // The owner's own permissions are never offered "any of" another one.
        if (wanted.Any(Permissions.OwnerOnly.Contains))
            throw new InvalidOperationException($"Owner-only permission in an any-of policy: {policyName}");
        return new AuthorizationPolicyBuilder().RequireAuthenticatedUser()
            .RequireAssertion(ctx => wanted.Any(p => ctx.User.HasClaim("permission", p))).Build();
    }
}
