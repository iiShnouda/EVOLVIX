namespace SKB.Api.Domain;

/// <summary>Permission strings of the form "resource:action". Server is the sole enforcer.</summary>
public static class Permissions
{
    public const string DashboardView = "dashboard:view";
    public const string SalesView = "sales:view";
    public const string SalesCreate = "sales:create";
    /// <summary>
    /// Change a posted sales invoice (owner decision 2026-10-01): its effects (stock, balance, money,
    /// ledger) are reversed and it is posted again under its own number.
    /// </summary>
    public const string SalesEdit = "sales:edit";
    /// <summary>Cancel (delete) a posted sales invoice: everything it moved is reversed; it stays listed as cancelled.</summary>
    public const string SalesCancel = "sales:cancel";
    /// <summary>Price a sale at the customer's last price for the item, or at its supply cost, instead of the selling price.</summary>
    public const string SalesPriceBasis = "sales:price_basis";
    /// <summary>Change the shipping company or address the customer's file gives a sale.</summary>
    public const string SalesChangeShipping = "sales:change_shipping";
    /// <summary>Mark a customer as a cash customer (عميل نقدي), who pays every invoice in full.</summary>
    public const string PartiesCashCustomer = "parties:cash_customer";
    /// <summary>See the report of cancelled and changed sales invoices.</summary>
    public const string SalesChangesReport = "sales:changes_report";
    /// <summary>Allowed to sell below the configured profit floor (never below cost).</summary>
    public const string SalesOverrideFloor = "sales:override_floor";
    /// <summary>
    /// Issue a sales return (restock + credit the customer). Separate from SalesCreate on purpose:
    /// a return moves money back out, so it is not granted to the SALES role by default.
    /// </summary>
    public const string SalesReturn = "sales:return";
    /// <summary>A sales return typed without picking an invoice.</summary>
    public const string SalesReturnFree = "sales:return_free";
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
    /// <summary>A purchase return typed without picking an invoice.</summary>
    public const string PurchasesReturnFree = "purchases:return_free";
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
    /// <summary>Take a small amount left on a customer's or supplier's account off (خصم تسوية).</summary>
    public const string VouchersDiscount = "vouchers:discount";
    /// <summary>Add and edit cash boxes, custody, bank accounts and wallets (with an opening balance).</summary>
    public const string MoneyAccountsManage = "money_accounts:manage";
    /// <summary>Choose and name the company's main cash box (owner, 2026-10-02).</summary>
    public const string MoneyAccountsMain = "money_accounts:main";
    /// <summary>Send a box's cash up to the next box (warehouse → branch → main), to be confirmed there.</summary>
    public const string CashHandoverSend = "cash:handover_send";
    /// <summary>Confirm cash sent up to a box one holds has arrived (or send it back).</summary>
    public const string CashHandoverReceive = "cash:handover_receive";
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
    /// <summary>Record a note as lost or stolen (owner, 2026-10-02): the party owes again.</summary>
    public const string NotesLost = "notes:lost";

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
    /// <summary>
    /// See and change a party's contact details — phones, email, addresses, owner or person in charge,
    /// national ID and tax number (owner, 2026-10-19: not shown to whoever only picks a supplier).
    /// </summary>
    public const string PartiesContact = "parties:contact";
    public const string PartiesEdit = "parties:edit";
    /// <summary>Close a party's account (or reopen it).</summary>
    public const string PartiesClose = "parties:close";
    /// <summary>
    /// Add a customer, a supplier (factories are suppliers) or a shipping company: one permission each
    /// (owner, 2026-10-19).
    /// </summary>
    public const string PartiesCreateCustomer = "parties:create_customer";
    public const string PartiesCreateSupplier = "parties:create_supplier";
    public const string PartiesCreateCarrier = "parties:create_carrier";
    /// <summary>See and keep photos of customers' and shipping companies' ID cards.</summary>
    public const string PartiesIdCards = "parties:id_cards";
    /// <summary>See deliveries, shipments and carrier settlements.</summary>
    public const string DeliveryView = "delivery:view";
    /// <summary>Hand parcels to carriers and move deliveries along (out, delivered, returned).</summary>
    public const string DeliveryManage = "delivery:manage";
    /// <summary>Record a carrier paying for its cash-on-delivery parcels.</summary>
    public const string DeliverySettle = "delivery:settle";
    public const string InventoryView = "inventory:view";
    public const string InventoryEdit = "inventory:edit";
    /// <summary>Count a warehouse and post the differences (الجرد).</summary>
    public const string InventoryStocktake = "inventory:stocktake";
    /// <summary>Send goods to another warehouse, receive them, or call a transfer back.</summary>
    public const string InventoryTransfer = "inventory:transfer";
    /// <summary>Change a transfer already sent: its items, quantities, destination or notes (owner, 2026-10-19).</summary>
    public const string InventoryTransferEdit = "inventory:transfer_edit";
    public const string StaffView = "staff:view";
    /// <summary>Add staff, change their role, branch or password, and deactivate them.</summary>
    public const string StaffManage = "staff:manage";
    /// <summary>Change what each role may do, and give or take permissions from one person.</summary>
    public const string RolesManage = "roles:manage";
    /// <summary>Keep a person's password for the owner's reminder and read it back (owner, 2026-10-02).</summary>
    public const string StaffPasswordNote = "staff:password_note";
    /// <summary>Choose the branches, warehouses and money accounts one person may use.</summary>
    public const string StaffAccess = "staff:access";
    public const string BranchesView = "branches:view";
    /// <summary>Create, rename, deactivate warehouses and pick each branch's default warehouse.</summary>
    public const string BranchesManage = "branches:manage";
    /// <summary>Delete a branch that has nothing recorded in it (owner, 2026-10-10).</summary>
    public const string BranchesDelete = "branches:delete";
    /// <summary>Delete a warehouse that has nothing recorded in it (owner, 2026-10-10).</summary>
    public const string WarehousesDelete = "warehouses:delete";
    /// <summary>
    /// See the server's load: processor, memory, disk, temperature, the database and the assistant
    /// (owner, 2026-10-10). The owner's alone: not given to the admin, nor grantable (see OwnerOnly).
    /// </summary>
    public const string SystemMonitor = "system:monitor";
    /// <summary>
    /// See whether a new version is out, what it brings, and update the server to it (owner,
    /// 2026-10-11). The owner's alone, like the monitor.
    /// </summary>
    public const string SystemUpdate = "system:update";
    /// <summary>
    /// Load items, customers and suppliers in bulk from an Excel file the owner uploads (owner,
    /// 2026-10-14). The owner's alone, like the monitor and updates (see OwnerOnly).
    /// </summary>
    public const string DataImport = "data:import";
    /// <summary>
    /// See and enter this company's licence (users bought, end date); on the vendor's own server,
    /// also issue licences to customers (owner, 2026-10-15). The owner's alone.
    /// </summary>
    public const string LicenseManage = "license:manage";
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
    /// <summary>See profit (owner, 2026-10-17: a permission of its own, apart from supply prices).</summary>
    public const string ProfitView = "profit:view";
    /// <summary>Download a backup of everything (the owner's alone by default).</summary>
    public const string BackupCreate = "backup:create";
    public const string PresenceView = "presence:view";

    // ---- Catalog (owner decision 2026-09-29: every action has its own permission) ----
    /// <summary>Add items and item models (with their size × color variants).</summary>
    public const string ProductsCreate = "products:create";
    /// <summary>Edit items and models: names, category, units, barcodes, sizes/colors, reorder level, deactivate.</summary>
    public const string ProductsEdit = "products:edit";
    /// <summary>Stop an item (or reopen it).</summary>
    public const string ProductsClose = "products:close";
    // The item's whole story on its card (owner, 2026-10-02): each part needs its own permission.
    /// <summary>The item card's purchases: from which supplier, when, how many and the supplier's discount.</summary>
    public const string ProductsCardPurchases = "products:card_purchases";
    /// <summary>The item card's sales: to whom, when, how many, at what price and discount.</summary>
    public const string ProductsCardSales = "products:card_sales";
    /// <summary>The item card's returns, from customers and to suppliers.</summary>
    public const string ProductsCardReturns = "products:card_returns";
    /// <summary>The item card's price changes: its price on each invoice against the one before.</summary>
    public const string ProductsCardPrices = "products:card_prices";
    /// <summary>
    /// Date an invoice, receipt, payment, expense or transfer on an earlier day than today (owner,
    /// 2026-10-02); when it was really entered is kept on it.
    /// </summary>
    public const string DocumentsBackdate = "documents:backdate";
    /// <summary>Set item and model prices at each price level.</summary>
    public const string PricesEdit = "prices:edit";
    /// <summary>Add, rename, reorder and close price levels, and pick each side's default.</summary>
    public const string PriceLevelsManage = "price_levels:manage";
    /// <summary>Make and change price lists (special prices) and quantity discounts.</summary>
    public const string PriceListsManage = "price_lists:manage";
    public const string CategoriesManage = "categories:manage";
    /// <summary>Delete a department that has nothing recorded under it (owner, 2026-10-11).</summary>
    public const string DepartmentsDelete = "departments:delete";
    /// <summary>Print barcode labels for items (label printer or sticker sheets).</summary>
    public const string LabelsPrint = "labels:print";

    // ---- Staff chat (owner, 2026-10-06) ----
    /// <summary>Talk with colleagues in the app's chat (a supervisor can stop someone writing).</summary>
    public const string ChatUse = "chat:use";
    /// <summary>Read every conversation, not only one's own.</summary>
    public const string ChatMonitor = "chat:monitor";
    /// <summary>Make group conversations and stop or allow people writing.</summary>
    public const string ChatManage = "chat:manage";

    // ---- Offline assistant on the company server (owner, 2026-10-06) ----
    /// <summary>Ask the company's assistant; it only reads what the person may see.</summary>
    public const string AiChat = "ai:chat";
    /// <summary>Read a photo of a supplier invoice or cheques into a draft to check and save.</summary>
    public const string AiScan = "ai:scan";
    public const string UnitsManage = "units:manage";
    /// <summary>Add and rename the company's sizes and colors.</summary>
    public const string VariantOptionsManage = "variant_options:manage";
    /// <summary>Add a season by hand (summer and winter are added by the system every year).</summary>
    public const string SeasonsManage = "seasons:manage";
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

    // ---- Invoice charges (DOMAIN.md step 4) ----
    /// <summary>Give a whole-invoice discount on a sale (خصم على الفاتورة), from the customer's invoice view.</summary>
    public const string SalesDiscount = "sales:discount";
    /// <summary>Give a discount on one line/item of a sale (خصم على صنف), from the customer's invoice view.</summary>
    public const string SalesDiscountLine = "sales:discount_line";
    /// <summary>Give one discount across a customer's combined invoices (خصم على الفواتير المجمعة).</summary>
    public const string SalesDiscountCombined = "sales:discount_combined";
    /// <summary>Freeze or reopen a sales invoice for editing and deleting (قفل/فتح الفاتورة) — the accountant.</summary>
    public const string SalesLock = "sales:lock";
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
        DashboardView, SalesView, SalesCreate, SalesEdit, SalesCancel, SalesPriceBasis, SalesChangeShipping,
        PartiesCashCustomer, SalesChangesReport, SalesOverrideFloor, SalesReturn, SalesQuote,
        SalesOrder, SalesApprove, PartiesCreditLimit, SalesRaisePrice, SalesInvoiceAlerts,
        PurchasesView, PurchasesCreate, PurchasesReturn, ReceiptsView,
        PartiesView, PartiesContact, PartiesEdit, PartiesClose, InventoryView, InventoryEdit, InventoryStocktake, InventoryTransfer, InventoryTransferEdit,
        ProductsClose, SalesReturnFree, PurchasesReturnFree,
        ProductsCardPurchases, ProductsCardSales, ProductsCardReturns, ProductsCardPrices, DocumentsBackdate,
        StaffPasswordNote, StaffView, StaffManage, RolesManage, StaffAccess,
        BranchesView, BranchesManage, BranchesDelete, WarehousesDelete,
        AnalyticsView, SettingsView, SettingsManage, AuditView, PresenceView, BackupCreate, CostsView, ProfitView,
        ProductsCreate, ProductsEdit, PricesEdit, PriceLevelsManage, PriceListsManage, CategoriesManage, DepartmentsDelete, UnitsManage,
        VariantOptionsManage, SeasonsManage, SalesChangePrice, SalesChoosePriceLevel, PurchasesChangePrice,
        PurchasesChoosePriceLevel, PartiesSetPriceLevel,
        SalesDiscount, SalesDiscountLine, SalesDiscountCombined, SalesLock, SalesBonus, SalesChangeTax, SalesAdditions,
        PurchasesDiscount, PurchasesBonus, PurchasesChangeTax, PurchasesAdditions,
        PartiesCreateCustomer, PartiesCreateSupplier, PartiesCreateCarrier, PartiesIdCards, DeliveryView, DeliveryManage, DeliverySettle,
        ReceiptsCreate, PaymentsCreate, ExpensesCreate, CashTransfer, VouchersCancel,
        MoneyAccountsManage, ExpenseCategoriesManage, MoneyAccountsMain, VouchersDiscount, CashHandoverSend, CashHandoverReceive,
        LedgerView, LedgerPost, LedgerManage, LedgerLock,
        NotesView, NotesReceive, NotesIssue, NotesDeposit, NotesCollect, NotesPay, NotesBounce, NotesEndorse,
        NotesCancel, NotesLost,
        PayrollView, EmployeesManage, AttendanceEdit, PayrollAdjust, PayrollAdvance, PayrollPost, PayrollPay,
        LabelsPrint, ChatUse, ChatMonitor, ChatManage, AiChat, AiScan, SystemMonitor, SystemUpdate, DataImport, LicenseManage,
    };

    /// <summary>Held by the owner alone: never by the admin, a role or a grant.</summary>
    public static readonly string[] OwnerOnly = { SystemMonitor, SystemUpdate, DataImport, LicenseManage };
}

public static class RolePermissions
{
    private static readonly string[] All = Permissions.All;

    public static readonly IReadOnlyDictionary<Role, string[]> Map = new Dictionary<Role, string[]>
    {
        [Role.OWNER] = All,
        // The admin has every permission, and every one added later (owner decision 2026-10-02),
        // except the owner's own.
        [Role.ADMIN] = All.Except(Permissions.OwnerOnly).ToArray(),
        [Role.ACCOUNTANT] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate, Permissions.SalesEdit,
            Permissions.SalesCancel, Permissions.SalesPriceBasis, Permissions.SalesChangeShipping,
            Permissions.PartiesCashCustomer, Permissions.SalesChangesReport,
            Permissions.SalesOverrideFloor, Permissions.SalesReturn, Permissions.SalesQuote,
            // Invoices post at once and the accountant is told (owner decision 2026-09-30); approving
            // stays only for pending invoices someone may still be asked to save.
            Permissions.SalesApprove, Permissions.SalesInvoiceAlerts, Permissions.SalesRaisePrice,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ReceiptsView, Permissions.PartiesView, Permissions.PartiesContact, Permissions.PartiesEdit,
            Permissions.InventoryView, Permissions.InventoryEdit, Permissions.InventoryStocktake,
            Permissions.InventoryTransfer, Permissions.ProductsClose, Permissions.PartiesClose,
            Permissions.SalesReturnFree, Permissions.PurchasesReturnFree,
            Permissions.ProductsCardSales, Permissions.ProductsCardReturns, Permissions.ProductsCardPrices,
            Permissions.DocumentsBackdate,
            Permissions.AnalyticsView, Permissions.SettingsView,
            Permissions.ProductsCreate, Permissions.ProductsEdit, Permissions.PricesEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.SalesChangePrice, Permissions.SalesChoosePriceLevel,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel, Permissions.PartiesSetPriceLevel,
            Permissions.PartiesCreditLimit,
            Permissions.SalesDiscount, Permissions.SalesDiscountLine, Permissions.SalesDiscountCombined,
            Permissions.SalesLock,
            Permissions.SalesBonus, Permissions.SalesChangeTax, Permissions.SalesAdditions,
            Permissions.PurchasesDiscount, Permissions.PurchasesBonus, Permissions.PurchasesChangeTax,
            Permissions.PurchasesAdditions,
            Permissions.PartiesCreateCustomer, Permissions.PartiesCreateSupplier,
            Permissions.PartiesCreateCarrier, Permissions.PartiesIdCards,
            Permissions.DeliveryView, Permissions.DeliveryManage, Permissions.DeliverySettle,
            Permissions.ReceiptsCreate, Permissions.PaymentsCreate, Permissions.ExpensesCreate,
            Permissions.CashTransfer, Permissions.VouchersCancel, Permissions.MoneyAccountsManage,
            Permissions.ExpenseCategoriesManage, Permissions.CashHandoverSend, Permissions.CashHandoverReceive,
            Permissions.VouchersDiscount,
            Permissions.LedgerView, Permissions.LedgerPost, Permissions.LedgerManage,
            Permissions.NotesView, Permissions.NotesReceive, Permissions.NotesIssue, Permissions.NotesDeposit,
            Permissions.NotesCollect, Permissions.NotesPay, Permissions.NotesBounce, Permissions.NotesEndorse,
            Permissions.NotesCancel, Permissions.NotesLost,
            Permissions.PayrollView, Permissions.AttendanceEdit, Permissions.PayrollAdjust, Permissions.PayrollAdvance,
            Permissions.PayrollPost, Permissions.PayrollPay,
            Permissions.LabelsPrint, Permissions.ChatUse,
        },
        // Sales staff sell at the customer's price level and may only add to a price; lowering it or
        // changing the level needs a manager (owner decisions 2026-09-29, 2026-09-30). Their
        // invoices post at once; the accountant is told and takes the payment.
        [Role.SALES] = new[]
        {
            Permissions.DashboardView, Permissions.SalesView, Permissions.SalesCreate,
            Permissions.SalesQuote, Permissions.SalesRaisePrice,
            // The seller writes a customer's return; it goes straight back into its warehouse.
            Permissions.SalesReturn, Permissions.SalesReturnFree,
            Permissions.PartiesView, Permissions.PartiesContact, Permissions.PartiesEdit, Permissions.InventoryView,
            Permissions.PartiesCreateCustomer, Permissions.PartiesCreateSupplier,
            Permissions.PartiesCreateCarrier, Permissions.PartiesIdCards, Permissions.DeliveryView, Permissions.DeliveryManage,
            Permissions.ChatUse,
        },
        // Store staff add items and enter supplier invoices as printed; they don't set selling prices.
        [Role.INVENTORY] = new[]
        {
            Permissions.DashboardView, Permissions.InventoryView, Permissions.InventoryEdit,
            Permissions.InventoryStocktake, Permissions.InventoryTransfer, Permissions.ProductsClose,
            Permissions.PurchasesReturnFree, Permissions.ProductsCardPurchases, Permissions.ProductsCardReturns,
            Permissions.PurchasesView, Permissions.PurchasesCreate, Permissions.PurchasesReturn,
            Permissions.ProductsCreate, Permissions.ProductsEdit,
            Permissions.CategoriesManage, Permissions.UnitsManage, Permissions.VariantOptionsManage,
            Permissions.PurchasesChangePrice, Permissions.PurchasesChoosePriceLevel,
            Permissions.PurchasesDiscount, Permissions.PurchasesBonus, Permissions.PurchasesChangeTax,
            Permissions.PurchasesAdditions,
            Permissions.DeliveryView, Permissions.DeliveryManage,
            // A store keeper hands the store's cash up to the branch.
            Permissions.CashHandoverSend,
            Permissions.LabelsPrint, Permissions.ChatUse,
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
