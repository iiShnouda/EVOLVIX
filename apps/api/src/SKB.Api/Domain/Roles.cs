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
    /// <summary>Make and cancel price quotations (turning one into an invoice needs sales:create).</summary>
    public const string SalesQuote = "sales:quote";
    /// <summary>
    /// Save a pending invoice (فاتورة معلّقة) for the accountant (owner decision 2026-09-30): priced
    /// and checked like an invoice, its goods held for it, but nothing posted until approved.
    /// </summary>
    public const string SalesOrder = "sales:order";
    /// <summary>Approve a pending invoice: adjust its discounts, take the payment and post it.</summary>
    public const string SalesApprove = "sales:approve";
    public const string PurchasesView = "purchases:view";
    public const string PurchasesCreate = "purchases:create";
    /// <summary>Return goods to a supplier (stock out at the original cost + reduce the payable).</summary>
    public const string PurchasesReturn = "purchases:return";
    /// <summary>See money accounts, their movements (daily cash) and vouchers.</summary>
    public const string ReceiptsView = "receipts:view";
    /// <summary>Record money received from a customer or other party (سند قبض).</summary>
    public const string ReceiptsCreate = "receipts:create";
    /// <summary>Record money paid to a supplier or other party (سند صرف).</summary>
    public const string PaymentsCreate = "payments:create";
    /// <summary>Record an expense (مصروف) paid from a money account.</summary>
    public const string ExpensesCreate = "expenses:create";
    /// <summary>Move money between accounts (cash box ↔ cash box, deposit / withdraw at the bank).</summary>
    public const string CashTransfer = "cash:transfer";
    /// <summary>Cancel a receipt, payment, expense or transfer (its money moves back).</summary>
    public const string VouchersCancel = "vouchers:cancel";
    /// <summary>Add and edit cash boxes, custody, bank accounts and wallets (with an opening balance).</summary>
    public const string MoneyAccountsManage = "money_accounts:manage";
    /// <summary>Add and rename expense categories.</summary>
    public const string ExpenseCategoriesManage = "expense_categories:manage";

    // ---- Ledger (DOMAIN.md step 6) ----
    /// <summary>See the chart of accounts, journal, account statements and the trial balance.</summary>
    public const string LedgerView = "ledger:view";
    /// <summary>Post a manual (compound) journal entry.</summary>
    public const string LedgerPost = "ledger:post";
    /// <summary>Add and rename ledger accounts.</summary>
    public const string LedgerManage = "ledger:manage";
    /// <summary>Set the period lock date (nothing on or before it can change).</summary>
    public const string LedgerLock = "ledger:lock";

    // ---- Cheques & promissory notes (DOMAIN.md step 7) ----
    /// <summary>See cheques and notes, their history and deposit portfolios.</summary>
    public const string NotesView = "notes:view";
    /// <summary>Take a cheque / promissory note from a customer (or other party).</summary>
    public const string NotesReceive = "notes:receive";
    /// <summary>Issue our cheque / promissory note to a supplier (or other party).</summary>
    public const string NotesIssue = "notes:issue";
    /// <summary>Lodge notes at a bank for collection.</summary>
    public const string NotesDeposit = "notes:deposit";
    /// <summary>Record a note we held as paid to us.</summary>
    public const string NotesCollect = "notes:collect";
    /// <summary>Record a note we issued as paid.</summary>
    public const string NotesPay = "notes:pay";
    /// <summary>Record a note as bounced (مرتد); the party owes again.</summary>
    public const string NotesBounce = "notes:bounce";
    /// <summary>Endorse a note we hold to a supplier (تظهير).</summary>
    public const string NotesEndorse = "notes:endorse";
    /// <summary>Cancel a note (give it back / withdraw it).</summary>
    public const string NotesCancel = "notes:cancel";

    // Payroll & attendance (DOMAIN.md §2.9). Salaries are private: nobody sees them by default
    // except the owner, admin and accountant.
    public const string PayrollView = "payroll:view";
    /// <summary>Add and edit employees (including their salary), shifts and the payroll rules.</summary>
    public const string EmployeesManage = "employees:manage";
    public const string AttendanceEdit = "attendance:edit";
    /// <summary>Bonuses and deductions.</summary>
    public const string PayrollAdjust = "payroll:adjust";
    public const string PayrollAdvance = "payroll:advance";
    /// <summary>Make, recalculate and post a month's payroll.</summary>
    public const string PayrollPost = "payroll:post";
    public const string PayrollPay = "payroll:pay";
    public const string PartiesView = "parties:view";
    public const string PartiesEdit = "parties:edit";
    /// <summary>Add a customer, supplier (factories are suppliers) or shipping company.</summary>
    public const string PartiesCreate = "parties:create";
    /// <summary>See deliveries, shipments and carrier settlements.</summary>
    public const string DeliveryView = "delivery:view";
    /// <summary>Hand parcels to carriers and move deliveries along (out, delivered, returned).</summary>
    public const string DeliveryManage = "delivery:manage";
    /// <summary>Record a carrier paying for its cash-on-delivery parcels.</summary>
    public const string DeliverySettle = "delivery:settle";
    public const string InventoryView = "inventory:view";
    public const string InventoryEdit = "inventory:edit";
    public const string StaffView = "staff:view";
    /// <summary>Add staff, change their role, branch or password, and deactivate them.</summary>
    public const string StaffManage = "staff:manage";
    /// <summary>Change what each role may do, and give or take permissions from one person.</summary>
    public const string RolesManage = "roles:manage";
    /// <summary>Choose the branches, warehouses and money accounts one person may use.</summary>
    public const string StaffAccess = "staff:access";
    public const string BranchesView = "branches:view";
    /// <summary>Create, rename, deactivate warehouses and pick each branch's default warehouse.</summary>
    public const string BranchesManage = "branches:manage";
    public const string AnalyticsView = "analytics:view";
    public const string SettingsView = "settings:view";
    public const string SettingsManage = "settings:manage";
    public const string AuditView = "audit:view";
    /// <summary>
    /// See what goods cost and what sales earned: cost and profit on sales documents, items' average
    /// cost, stock values and the profit reports. The owner's alone unless given (owner decision
    /// 2026-09-30); without it the server leaves these numbers out (see Services/Costs.cs).
    /// </summary>
    public const string CostsView = "costs:view";
    /// <summary>Download a backup of everything (the owner's alone by default).</summary>
    public const string BackupCreate = "backup:create";
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
    /// <summary>Make and change price lists (special prices) and quantity discounts.</summary>
    public const string PriceListsManage = "price_lists:manage";
    public const string CategoriesManage = "categories:manage";
    public const string UnitsManage = "units:manage";
    /// <summary>Add and rename the company's sizes and colors.</summary>
    public const string VariantOptionsManage = "variant_options:manage";
    /// <summary>Sell at a price other than the price level's (and give a line discount).</summary>
    public const string SalesChangePrice = "sales:change_price";
    /// <summary>
    /// Sell above the price level's price, on this invoice only (owner decision 2026-09-30): the
    /// seller may add to a piece's price but never go under it (that needs sales:change_price).
    /// </summary>
    public const string SalesRaisePrice = "sales:raise_price";
    /// <summary>Be told of each new sales invoice (customer and department), e.g. the accountant who takes the payment.</summary>
    public const string SalesInvoiceAlerts = "sales:invoice_alerts";
    /// <summary>Price a sales invoice at a level other than the customer's own.</summary>
    public const string SalesChoosePriceLevel = "sales:choose_price_level";
    /// <summary>Buy at a cost other than the supplier price level's.</summary>
    public const string PurchasesChangePrice = "purchases:change_price";
    /// <summary>Price a purchase invoice at a level other than the supplier's own.</summary>
    public const string PurchasesChoosePriceLevel = "purchases:choose_price_level";
    /// <summary>Set a customer's or supplier's default price level.</summary>
    public const string PartiesSetPriceLevel = "parties:set_price_level";
    /// <summary>Set a customer's credit limit (حد الائتمان).</summary>
    public const string PartiesCreditLimit = "parties:credit_limit";
    /// <summary>Post a sale that takes a customer over their credit limit.</summary>
    public const string SalesOverCredit = "sales:over_credit";

    // ---- Invoice charges (DOMAIN.md step 4) ----
    /// <summary>Give an invoice-level discount on a sale (خصم مسموح به / خصم إضافي).</summary>
    public const string SalesDiscount = "sales:discount";
    /// <summary>Add free goods (بونص) to a sale.</summary>
    public const string SalesBonus = "sales:bonus";
    /// <summary>Charge another tax rate than the company's, or another tax, on a sale.</summary>
    public const string SalesChangeTax = "sales:change_tax";
    /// <summary>Add charges such as a delivery fee to a sale.</summary>
    public const string SalesAdditions = "sales:additions";
    public const string PurchasesDiscount = "purchases:discount";
    public const string PurchasesBonus = "purchases:bonus";
    public const string PurchasesChangeTax = "purchases:change_tax";
    public const string PurchasesAdditions = "purchases:additions";

    /// <summary>Every permission, used to register one authorization policy per permission.</summary>
    public static readonly string[] All =
    {
        DashboardView, SalesView, SalesCreate, SalesEdit, SalesOverrideFloor, SalesReturn, SalesQuote,
        SalesOrder, SalesApprove, SalesOverCredit, PartiesCreditLimit, SalesRaisePrice, SalesInvoiceAlerts,
        PurchasesView, PurchasesCreate, PurchasesReturn, ReceiptsView,
        PartiesView, PartiesEdit, InventoryView, InventoryEdit, StaffView, StaffManage, RolesManage, StaffAccess,
        BranchesView, BranchesManage,
        AnalyticsView, SettingsView, SettingsManage, AuditView, PresenceView, BackupCreate, CostsView,
        ProductsCreate, ProductsEdit, PricesEdit, PriceLevelsManage, PriceListsManage, CategoriesManage, UnitsManage,
        VariantOptionsManage, SalesChangePrice, SalesChoosePriceLevel, PurchasesChangePrice,
        PurchasesChoosePriceLevel, PartiesSetPriceLevel,
        SalesDiscount, SalesBonus, SalesChangeTax, SalesAdditions,
        PurchasesDiscount, PurchasesBonus, PurchasesChangeTax, PurchasesAdditions,
        PartiesCreate, DeliveryView, DeliveryManage, DeliverySettle,
        ReceiptsCreate, PaymentsCreate, ExpensesCreate, CashTransfer, VouchersCancel,
        MoneyAccountsManage, ExpenseCategoriesManage,
        LedgerView, LedgerPost, LedgerManage, LedgerLock,
        NotesView, NotesReceive, NotesIssue, NotesDeposit, NotesCollect, NotesPay, NotesBounce, NotesEndorse,
        NotesCancel,
        PayrollView, EmployeesManage, AttendanceEdit, PayrollAdjust, PayrollAdvance, PayrollPost, PayrollPay,
    };
}

public static class RolePermissions
{
    private static readonly string[] All = Permissions.All;

    public static readonly IReadOnlyDictionary<Role, string[]> Map = new Dictionary<Role, string[]>
    {
        [Role.OWNER] = All,
        // Costs and profit stay with the owner by default; the owner can give them to anyone.
        [Role.ADMIN] = All.Where(p => p != Permissions.AuditView && p != Permissions.BackupCreate
            && p != Permissions.CostsView).ToArray(),
        [Role.ACCOUNTANT] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.SalesOverrideFloor, Permissions.SalesReturn, Permissions.SalesQuote,
            // Invoices post at once and the accountant is told (owner decision 2026-09-30); approving
            // stays only for pending invoices someone may still be asked to save.
            Permissions.SalesApprove, Permissions.SalesInvoiceAlerts, Permissions.SalesRaisePrice,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ReceiptsView, Permissions.PartiesView, Permissions.PartiesEdit,
            Permissions.InventoryView, Permissions.InventoryEdit, Permissions.AnalyticsView, Permissions.SettingsView,
            Permissions.ProductsCreate, Permissions.ProductsEdit, Permissions.PricesEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.SalesChangePrice, Permissions.SalesChoosePriceLevel,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel, Permissions.PartiesSetPriceLevel,
            Permissions.PartiesCreditLimit,
            Permissions.SalesDiscount, Permissions.SalesBonus, Permissions.SalesChangeTax, Permissions.SalesAdditions,
            Permissions.PurchasesDiscount, Permissions.PurchasesBonus, Permissions.PurchasesChangeTax,
            Permissions.PurchasesAdditions,
            Permissions.PartiesCreate, Permissions.DeliveryView, Permissions.DeliveryManage, Permissions.DeliverySettle,
            Permissions.ReceiptsCreate, Permissions.PaymentsCreate, Permissions.ExpensesCreate,
            Permissions.CashTransfer, Permissions.VouchersCancel, Permissions.MoneyAccountsManage,
            Permissions.ExpenseCategoriesManage,
            Permissions.LedgerView, Permissions.LedgerPost, Permissions.LedgerManage,
            Permissions.NotesView, Permissions.NotesReceive, Permissions.NotesIssue, Permissions.NotesDeposit,
            Permissions.NotesCollect, Permissions.NotesPay, Permissions.NotesBounce, Permissions.NotesEndorse,
            Permissions.NotesCancel,
            Permissions.PayrollView, Permissions.AttendanceEdit, Permissions.PayrollAdjust, Permissions.PayrollAdvance,
            Permissions.PayrollPost, Permissions.PayrollPay,
        },
        // Sales staff sell at the customer's price level and may only add to a price; lowering it or
        // changing the level needs a manager (owner decisions 2026-09-29, 2026-09-30). Their
        // invoices post at once; the accountant is told and takes the payment.
        [Role.SALES] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.SalesQuote, Permissions.SalesRaisePrice,
            // The seller writes a customer's return; it goes straight back into its warehouse.
            Permissions.SalesReturn,
            Permissions.PartiesView, Permissions.PartiesEdit, Permissions.InventoryView,
            Permissions.PartiesCreate, Permissions.DeliveryView, Permissions.DeliveryManage,
        },
        // Store staff add items and enter supplier invoices as printed; they don't set selling prices.
        [Role.INVENTORY] = new[]
        {
            Permissions.DashboardView, Permissions.InventoryView, Permissions.InventoryEdit,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ProductsCreate, Permissions.ProductsEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel,
            Permissions.PurchasesDiscount, Permissions.PurchasesBonus, Permissions.PurchasesChangeTax,
            Permissions.PurchasesAdditions,
            Permissions.DeliveryView, Permissions.DeliveryManage,
        },
        [Role.VIEWER] = new[]
        {
            Permissions.DeliveryView,
            Permissions.DashboardView, Permissions.SalesView, Permissions.PurchasesView, Permissions.ReceiptsView,
            Permissions.PartiesView, Permissions.InventoryView, Permissions.AnalyticsView,
        },
    };

    public static string[] For(Role role) => Map.TryGetValue(role, out var p) ? p : Array.Empty<string>();
}
