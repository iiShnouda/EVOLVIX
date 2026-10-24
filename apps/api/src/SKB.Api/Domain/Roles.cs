namespace SKB.Api.Domain;

/// <summary>
/// Permission strings of the form "resource:action". Server is the sole enforcer. Every action on
/// every page is its own permission and none needs another (owner, 2026-10-23); the groups and
/// sections the accounts page shows them in are in @skb/shared (permissions.ts). Keep both in lockstep.
/// </summary>
public static class Permissions
{
    // ──── Dashboard ────
    /// <summary>Dashboard · Cards: Sales total.</summary>
    public const string DashboardKpiSales = "dashboard:kpi_sales";
    /// <summary>Dashboard · Cards: Purchases total.</summary>
    public const string DashboardKpiPurchases = "dashboard:kpi_purchases";
    /// <summary>Dashboard · Cards: Owed by customers.</summary>
    public const string DashboardKpiReceivables = "dashboard:kpi_receivables";
    /// <summary>Dashboard · Cards: Owed to suppliers.</summary>
    public const string DashboardKpiPayables = "dashboard:kpi_payables";
    /// <summary>Dashboard · Cards: Cash position.</summary>
    public const string DashboardKpiCash = "dashboard:kpi_cash";
    /// <summary>Dashboard · Cards: Low stock count.</summary>
    public const string DashboardKpiLowStock = "dashboard:kpi_low_stock";
    /// <summary>Dashboard · Cards: Sales and purchases chart.</summary>
    public const string DashboardTrend = "dashboard:trend";
    /// <summary>Dashboard · Cards: Today's sales.</summary>
    public const string DashboardToday = "dashboard:today";
    /// <summary>Dashboard · Cards: This month against the last.</summary>
    public const string DashboardMonth = "dashboard:month";
    /// <summary>Dashboard · Cards: Best-selling items.</summary>
    public const string DashboardTopItems = "dashboard:top_items";
    /// <summary>Dashboard · Cards: Best customers.</summary>
    public const string DashboardTopCustomers = "dashboard:top_customers";
    /// <summary>Dashboard · Cards: Sales by branch.</summary>
    public const string DashboardBranches = "dashboard:branches";
    /// <summary>Dashboard · Cards: Latest invoices.</summary>
    public const string DashboardRecent = "dashboard:recent";
    /// <summary>Dashboard · Cards: Cash and bank balances.</summary>
    public const string DashboardAccounts = "dashboard:accounts";
    /// <summary>Dashboard · Cards: Cheques due.</summary>
    public const string DashboardNotesDue = "dashboard:notes_due";
    /// <summary>Dashboard · Cards: Invoices awaiting approval.</summary>
    public const string DashboardAwaiting = "dashboard:awaiting";
    /// <summary>Dashboard · Cards: Customers over their limit.</summary>
    public const string DashboardOverLimit = "dashboard:over_limit";
    /// <summary>Dashboard · Cards: Low stock list.</summary>
    public const string DashboardLowStock = "dashboard:low_stock";
    /// <summary>Dashboard · Cards: Stock value.</summary>
    public const string DashboardStockValue = "dashboard:stock_value";
    /// <summary>Dashboard · Cards: Profit and loss.</summary>
    public const string DashboardProfit = "dashboard:profit";

    // ──── Sales ────
    /// <summary>See the sales invoices list and open an invoice.</summary>
    public const string SalesView = "sales:view";
    /// <summary>Sales · View: Sales returns.</summary>
    public const string SalesReturnsView = "sales:returns_view";
    /// <summary>Sales · View: A customer's invoices together.</summary>
    public const string SalesTogether = "sales:together";
    /// <summary>Sales · View: Print invoices.</summary>
    public const string SalesPrint = "sales:print";
    /// <summary>Sales · Invoices: New sales invoice.</summary>
    public const string SalesCreate = "sales:create";
    /// <summary>
    /// Save a pending invoice (فاتورة معلّقة) for the accountant (owner decision 2026-09-30): priced
    /// and checked like an invoice, its goods held for it, but nothing posted until approved.
    /// </summary>
    public const string SalesOrder = "sales:order";
    /// <summary>Make and cancel price quotations (turning one into an invoice needs sales:create).</summary>
    public const string SalesQuote = "sales:quote";
    /// <summary>
    /// Change a posted sales invoice (owner decision 2026-10-01): its effects (stock, balance, money,
    /// ledger) are reversed and it is posted again under its own number.
    /// </summary>
    public const string SalesEdit = "sales:edit";
    /// <summary>Cancel (delete) a posted sales invoice: everything it moved is reversed; it stays listed as cancelled.</summary>
    public const string SalesCancel = "sales:cancel";
    /// <summary>Approve a pending invoice or one over the customer's limit: adjust its discounts, take the payment and post it.</summary>
    public const string SalesApprove = "sales:approve";
    /// <summary>Sales · Invoices: Turn down a pending or over-limit invoice.</summary>
    public const string SalesReject = "sales:reject";
    /// <summary>Freeze or reopen a sales invoice for editing and deleting (قفل/فتح الفاتورة) — the accountant.</summary>
    public const string SalesLock = "sales:lock";
    /// <summary>Be told of each new sales invoice (customer and department), e.g. the accountant who takes the payment.</summary>
    public const string SalesInvoiceAlerts = "sales:invoice_alerts";
    /// <summary>
    /// Issue a sales return (restock + credit the customer). Separate from SalesCreate on purpose:
    /// a return moves money back out, so it is not granted to the SALES role by default.
    /// </summary>
    public const string SalesReturn = "sales:return";
    /// <summary>A sales return typed without picking an invoice.</summary>
    public const string SalesReturnFree = "sales:return_free";
    /// <summary>Sell at a price other than the price level's (and give a line discount).</summary>
    public const string SalesChangePrice = "sales:change_price";
    /// <summary>
    /// Sell above the price level's price, on this invoice only (owner decision 2026-09-30): the
    /// seller may add to a piece's price but never go under it (that needs sales:change_price).
    /// </summary>
    public const string SalesRaisePrice = "sales:raise_price";
    /// <summary>Price a sales invoice at a level other than the customer's own.</summary>
    public const string SalesChoosePriceLevel = "sales:choose_price_level";
    /// <summary>Price a sale at the customer's last price for the item, or at its supply cost, instead of the selling price.</summary>
    public const string SalesPriceBasis = "sales:price_basis";
    /// <summary>Allowed to sell below the configured profit floor (never below cost).</summary>
    public const string SalesOverrideFloor = "sales:override_floor";
    /// <summary>Give a whole-invoice discount on a sale (خصم على الفاتورة), from the customer's invoice view.</summary>
    public const string SalesDiscount = "sales:discount";
    /// <summary>Give a discount on one line/item of a sale (خصم على صنف), from the customer's invoice view.</summary>
    public const string SalesDiscountLine = "sales:discount_line";
    /// <summary>Give one discount across a customer's combined invoices (خصم على الفواتير المجمعة).</summary>
    public const string SalesDiscountCombined = "sales:discount_combined";
    /// <summary>Add free goods (بونص) to a sale.</summary>
    public const string SalesBonus = "sales:bonus";
    /// <summary>Charge another tax rate than the company's, or another tax, on a sale.</summary>
    public const string SalesChangeTax = "sales:change_tax";
    /// <summary>Add charges such as a delivery fee to a sale.</summary>
    public const string SalesAdditions = "sales:additions";
    /// <summary>Change the shipping company or address the customer's file gives a sale.</summary>
    public const string SalesChangeShipping = "sales:change_shipping";

    // ──── Delivery ────
    /// <summary>See the deliveries list.</summary>
    public const string DeliveryView = "delivery:view";
    /// <summary>Delivery · View: Shipments.</summary>
    public const string ShipmentsView = "shipments:view";
    /// <summary>Delivery · View: Carrier settlements.</summary>
    public const string SettlementsView = "settlements:view";
    /// <summary>Delivery · Actions: Change the delivery status.</summary>
    public const string DeliveryStatus = "delivery:status";
    /// <summary>Delivery · Actions: Hand a shipment to a carrier.</summary>
    public const string ShipmentsCreate = "shipments:create";
    /// <summary>Delivery · Actions: Mark picked up and delivered.</summary>
    public const string ShipmentsProgress = "shipments:progress";
    /// <summary>Delivery · Actions: Mark a shipment returned.</summary>
    public const string ShipmentsReturn = "shipments:return";
    /// <summary>Delivery · Actions: Cancel a shipment.</summary>
    public const string ShipmentsCancel = "shipments:cancel";
    /// <summary>Record a carrier paying for its cash-on-delivery parcels.</summary>
    public const string DeliverySettle = "delivery:settle";

    // ──── Purchases ────
    /// <summary>See the purchase invoices list and open an invoice.</summary>
    public const string PurchasesView = "purchases:view";
    /// <summary>Purchases · View: Purchase returns.</summary>
    public const string PurchasesReturnsView = "purchases:returns_view";
    /// <summary>Purchases · View: An invoice's price sheet.</summary>
    public const string PurchasesPriceSheet = "purchases:price_sheet";
    /// <summary>Purchases · View: Print invoices.</summary>
    public const string PurchasesPrint = "purchases:print";
    /// <summary>Enter a supplier invoice and add its items to stock.</summary>
    public const string PurchasesCreate = "purchases:create";
    /// <summary>Purchases · Invoices: Supplier invoice photos.</summary>
    public const string PurchasesPhotos = "purchases:photos";
    /// <summary>Return goods to a supplier (stock out at the original cost + reduce the payable).</summary>
    public const string PurchasesReturn = "purchases:return";
    /// <summary>A purchase return typed without picking an invoice.</summary>
    public const string PurchasesReturnFree = "purchases:return_free";
    /// <summary>Buy at a cost other than the supplier price level's.</summary>
    public const string PurchasesChangePrice = "purchases:change_price";
    /// <summary>Price a purchase invoice at a level other than the supplier's own.</summary>
    public const string PurchasesChoosePriceLevel = "purchases:choose_price_level";
    /// <summary>Purchases · Prices and discounts: Discount.</summary>
    public const string PurchasesDiscount = "purchases:discount";
    /// <summary>Purchases · Prices and discounts: Free goods.</summary>
    public const string PurchasesBonus = "purchases:bonus";
    /// <summary>Purchases · Prices and discounts: Change the tax.</summary>
    public const string PurchasesChangeTax = "purchases:change_tax";
    /// <summary>Purchases · Prices and discounts: Charges on the invoice.</summary>
    public const string PurchasesAdditions = "purchases:additions";

    // ──── Stock ────
    /// <summary>See the item list (its totals and valuation are permissions of their own).</summary>
    public const string InventoryView = "inventory:view";
    /// <summary>Stock · Items: Print.</summary>
    public const string InventoryPrint = "inventory:print";
    /// <summary>Stock · Items: Excel.</summary>
    public const string InventoryExport = "inventory:export";
    /// <summary>Add items and item models (with their size × color variants).</summary>
    public const string ProductsCreate = "products:create";
    /// <summary>Change items and models: names, department, units, sizes and colors.</summary>
    public const string ProductsEdit = "products:edit";
    /// <summary>Stop an item (or reopen it).</summary>
    public const string ProductsClose = "products:close";
    /// <summary>Stock · Items: Make barcodes.</summary>
    public const string ProductsBarcodes = "products:barcodes";
    /// <summary>Stock · Items: Item photos.</summary>
    public const string ProductsImages = "products:images";
    /// <summary>Set item and model prices at each price level.</summary>
    public const string PricesEdit = "prices:edit";
    /// <summary>Add, rename, reorder and close price levels, and pick each side's default.</summary>
    public const string PriceLevelsManage = "price_levels:manage";
    /// <summary>The inventory's totals, each its own (owner, 2026-10-21): items in stock, pieces, value at
    /// sale price, value at cost (also needs costs:view) and pieces sold.</summary>
    public const string InventoryTotalItems = "inventory:total_items";
    /// <summary>Stock · Totals: Number of pieces.</summary>
    public const string InventoryTotalQuantity = "inventory:total_quantity";
    /// <summary>Stock · Totals: Value at sale price.</summary>
    public const string InventoryTotalSaleValue = "inventory:total_sale_value";
    /// <summary>Stock · Totals: Value at supply price.</summary>
    public const string InventoryTotalSupplyValue = "inventory:total_supply_value";
    /// <summary>Stock · Totals: Sold.</summary>
    public const string InventoryTotalSold = "inventory:total_sold";
    /// <summary>Stock · Item card: Open the item card.</summary>
    public const string InventoryCard = "inventory:card";
    /// <summary>The item card's purchases: from which supplier, when, how many and the supplier's discount.</summary>
    public const string ProductsCardPurchases = "products:card_purchases";
    /// <summary>The item card's sales: to whom, when, how many, at what price and discount.</summary>
    public const string ProductsCardSales = "products:card_sales";
    /// <summary>The item card's returns, from customers and to suppliers.</summary>
    public const string ProductsCardReturns = "products:card_returns";
    /// <summary>The item card's price changes: its price on each invoice against the one before.</summary>
    public const string ProductsCardPrices = "products:card_prices";
    /// <summary>Open the stock valuation (تقييم المخزن); its values need costs:view besides (owner, 2026-10-19).</summary>
    public const string InventoryValuation = "inventory:valuation";
    /// <summary>The valuation by department.</summary>
    public const string ValuationDepartments = "inventory:valuation_departments";
    /// <summary>The valuation by warehouse.</summary>
    public const string ValuationWarehouses = "inventory:valuation_warehouses";
    /// <summary>The valuation item by item (and by model).</summary>
    public const string ValuationItems = "inventory:valuation_items";
    /// <summary>The valuation's sale-price column.</summary>
    public const string ValuationPrices = "inventory:valuation_prices";
    /// <summary>The valuation's supplier column and supplier filter.</summary>
    public const string ValuationSuppliers = "inventory:valuation_suppliers";
    /// <summary>Stock · Stocktake: Open the stocktake and print the count sheet.</summary>
    public const string InventoryStocktakeView = "inventory:stocktake_view";
    /// <summary>Post a count's differences (الجرد); opening the count is inventory:stocktake_view.</summary>
    public const string InventoryStocktake = "inventory:stocktake";
    /// <summary>Stock · Transfers: Transfer list.</summary>
    public const string TransfersView = "transfers:view";
    /// <summary>Stock · Transfers: Print a transfer.</summary>
    public const string TransfersPrint = "transfers:print";
    /// <summary>Send goods to another warehouse.</summary>
    public const string InventoryTransfer = "inventory:transfer";
    /// <summary>Change a transfer already sent: its items, quantities, destination or notes (owner, 2026-10-19).</summary>
    public const string InventoryTransferEdit = "inventory:transfer_edit";
    /// <summary>Stock · Transfers: Receive a transfer.</summary>
    public const string InventoryTransferReceive = "inventory:transfer_receive";
    /// <summary>Stock · Transfers: Call a transfer back.</summary>
    public const string InventoryTransferCancel = "inventory:transfer_cancel";
    /// <summary>Print barcode labels for items (label printer or sticker sheets).</summary>
    public const string LabelsPrint = "labels:print";
    /// <summary>Stock · Price lists and quantity discounts: See price lists.</summary>
    public const string PriceListsView = "price_lists:view";
    /// <summary>Stock · Price lists and quantity discounts: New list.</summary>
    public const string PriceListsCreate = "price_lists:create";
    /// <summary>Stock · Price lists and quantity discounts: Change a list.</summary>
    public const string PriceListsEdit = "price_lists:edit";
    /// <summary>Stock · Price lists and quantity discounts: A list's prices.</summary>
    public const string PriceListsPrices = "price_lists:prices";
    /// <summary>Stock · Price lists and quantity discounts: A list's customers.</summary>
    public const string PriceListsCustomers = "price_lists:customers";
    /// <summary>Stock · Price lists and quantity discounts: Delete a list.</summary>
    public const string PriceListsDelete = "price_lists:delete";
    /// <summary>Stock · Price lists and quantity discounts: See quantity discounts.</summary>
    public const string QuantityBreaksView = "quantity_breaks:view";
    /// <summary>Stock · Price lists and quantity discounts: Change quantity discounts.</summary>
    public const string QuantityBreaksEdit = "quantity_breaks:edit";

    // ──── Item setup ────
    /// <summary>Item setup · Departments: Add.</summary>
    public const string DepartmentsCreate = "departments:create";
    /// <summary>Item setup · Departments: Change.</summary>
    public const string DepartmentsEdit = "departments:edit";
    /// <summary>Item setup · Departments: Stop.</summary>
    public const string DepartmentsClose = "departments:close";
    /// <summary>Delete a department that has nothing recorded under it (owner, 2026-10-11).</summary>
    public const string DepartmentsDelete = "departments:delete";
    /// <summary>Item setup · Sub-groups: Add.</summary>
    public const string GroupsCreate = "groups:create";
    /// <summary>Item setup · Sub-groups: Change.</summary>
    public const string GroupsEdit = "groups:edit";
    /// <summary>Item setup · Sub-groups: Stop.</summary>
    public const string GroupsClose = "groups:close";
    /// <summary>Item setup · Sub-groups: Delete.</summary>
    public const string GroupsDelete = "groups:delete";
    /// <summary>Item setup · Units: Add.</summary>
    public const string UnitsCreate = "units:create";
    /// <summary>Item setup · Units: Change.</summary>
    public const string UnitsEdit = "units:edit";
    /// <summary>Item setup · Units: Stop.</summary>
    public const string UnitsClose = "units:close";
    /// <summary>Item setup · Units: Delete.</summary>
    public const string UnitsDelete = "units:delete";
    /// <summary>Item setup · Sizes: Add.</summary>
    public const string SizesCreate = "sizes:create";
    /// <summary>Item setup · Sizes: Change.</summary>
    public const string SizesEdit = "sizes:edit";
    /// <summary>Item setup · Sizes: Stop.</summary>
    public const string SizesClose = "sizes:close";
    /// <summary>Item setup · Sizes: Delete.</summary>
    public const string SizesDelete = "sizes:delete";
    /// <summary>Item setup · Colors: Add.</summary>
    public const string ColorsCreate = "colors:create";
    /// <summary>Item setup · Colors: Change.</summary>
    public const string ColorsEdit = "colors:edit";
    /// <summary>Item setup · Colors: Stop.</summary>
    public const string ColorsClose = "colors:close";
    /// <summary>Item setup · Colors: Delete.</summary>
    public const string ColorsDelete = "colors:delete";
    /// <summary>Item setup · Seasons: Add.</summary>
    public const string SeasonsCreate = "seasons:create";
    /// <summary>Item setup · Seasons: Change.</summary>
    public const string SeasonsEdit = "seasons:edit";
    /// <summary>Item setup · Seasons: Delete.</summary>
    public const string SeasonsDelete = "seasons:delete";

    // ──── Customers and suppliers ────
    /// <summary>See the customers, suppliers and shipping companies list.</summary>
    public const string PartiesView = "parties:view";
    /// <summary>
    /// See and change a party's contact details — phones, email, addresses, owner or person in charge,
    /// national ID and tax number (owner, 2026-10-19: not shown to whoever only picks a supplier).
    /// </summary>
    public const string PartiesContact = "parties:contact";
    /// <summary>Customers and suppliers · View: ID card photos.</summary>
    public const string PartiesIdCardsView = "parties:id_cards_view";
    /// <summary>Customers and suppliers · View: Print.</summary>
    public const string PartiesPrint = "parties:print";
    /// <summary>Add a customer (owner, 2026-10-19: customer, supplier and shipping company one each).</summary>
    public const string PartiesCreateCustomer = "parties:create_customer";
    /// <summary>Add a supplier (factories are suppliers).</summary>
    public const string PartiesCreateSupplier = "parties:create_supplier";
    /// <summary>Add a shipping company.</summary>
    public const string PartiesCreateCarrier = "parties:create_carrier";
    /// <summary>Customers and suppliers · Adding and changing: Change.</summary>
    public const string PartiesEdit = "parties:edit";
    /// <summary>Close a party's account (or reopen it).</summary>
    public const string PartiesClose = "parties:close";
    /// <summary>Customers and suppliers · Adding and changing: Add and remove ID card photos.</summary>
    public const string PartiesIdCardsEdit = "parties:id_cards_edit";
    /// <summary>Set a customer's or supplier's default price level.</summary>
    public const string PartiesSetPriceLevel = "parties:set_price_level";
    /// <summary>Set a customer's credit limit (حد الائتمان).</summary>
    public const string PartiesCreditLimit = "parties:credit_limit";
    /// <summary>Mark a customer as a cash customer (عميل نقدي), who pays every invoice in full.</summary>
    public const string PartiesCashCustomer = "parties:cash_customer";

    // ──── Statements ────
    /// <summary>Statements · Accounts: Customers.</summary>
    public const string StatementCustomers = "statement:customers";
    /// <summary>Statements · Accounts: Suppliers.</summary>
    public const string StatementSuppliers = "statement:suppliers";
    /// <summary>Statements · Accounts: Shipping companies.</summary>
    public const string StatementCarriers = "statement:carriers";
    /// <summary>Statements · Accounts: Cash and banks.</summary>
    public const string StatementMoney = "statement:money";
    /// <summary>Statements · Accounts: Expense items.</summary>
    public const string StatementExpenses = "statement:expenses";
    /// <summary>Statements · Accounts: Warehouses.</summary>
    public const string StatementWarehouses = "statement:warehouses";
    /// <summary>Statements · Accounts: Ledger accounts.</summary>
    public const string StatementLedger = "statement:ledger";
    /// <summary>Statements · Printing: Print.</summary>
    public const string StatementPrint = "statement:print";
    /// <summary>Statements · Printing: Excel.</summary>
    public const string StatementExport = "statement:export";

    // ──── Cash and banks ────
    /// <summary>Cash and banks · View: Accounts and balances.</summary>
    public const string MoneyAccounts = "money:accounts";
    /// <summary>Cash and banks · View: Vouchers.</summary>
    public const string VouchersView = "vouchers:view";
    /// <summary>Cash and banks · View: Expense items.</summary>
    public const string ExpenseCategoriesView = "expense_categories:view";
    /// <summary>Cash and banks · View: Print.</summary>
    public const string MoneyPrint = "money:print";
    /// <summary>Cash and banks · View: Excel.</summary>
    public const string MoneyExport = "money:export";
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
    /// <summary>Cash and banks · Accounts: Add an account.</summary>
    public const string MoneyAccountsCreate = "money_accounts:create";
    /// <summary>Cash and banks · Accounts: Change an account.</summary>
    public const string MoneyAccountsEdit = "money_accounts:edit";
    /// <summary>Cash and banks · Accounts: Delete an account.</summary>
    public const string MoneyAccountsDelete = "money_accounts:delete";
    /// <summary>Choose and name the company's main cash box (owner, 2026-10-02).</summary>
    public const string MoneyAccountsMain = "money_accounts:main";
    /// <summary>Cash and banks · Expense items: Add.</summary>
    public const string ExpenseCategoriesCreate = "expense_categories:create";
    /// <summary>Cash and banks · Expense items: Change.</summary>
    public const string ExpenseCategoriesEdit = "expense_categories:edit";
    /// <summary>Cash and banks · Expense items: Stop.</summary>
    public const string ExpenseCategoriesClose = "expense_categories:close";
    /// <summary>Cash and banks · Expense items: Delete.</summary>
    public const string ExpenseCategoriesDelete = "expense_categories:delete";
    /// <summary>Send a box's cash up to the next box (warehouse → branch → main), to be confirmed there.</summary>
    public const string CashHandoverSend = "cash:handover_send";
    /// <summary>Confirm cash sent up to a box one holds has arrived (or send it back).</summary>
    public const string CashHandoverReceive = "cash:handover_receive";

    // ──── Cheques ────
    /// <summary>Cheques · View: Cheques received.</summary>
    public const string NotesViewReceivable = "notes:view_receivable";
    /// <summary>Cheques · View: Cheques issued.</summary>
    public const string NotesViewPayable = "notes:view_payable";
    /// <summary>Cheques · View: Deposit batches.</summary>
    public const string NotesPortfolios = "notes:portfolios";
    /// <summary>Cheques · View: Cheque photos.</summary>
    public const string NotesPhotos = "notes:photos";
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

    // ──── Ledger ────
    /// <summary>Ledger · View: Chart of accounts.</summary>
    public const string LedgerAccounts = "ledger:accounts";
    /// <summary>Ledger · View: Journal.</summary>
    public const string LedgerJournal = "ledger:journal";
    /// <summary>Ledger · View: Trial balance.</summary>
    public const string LedgerTrialBalance = "ledger:trial_balance";
    /// <summary>Ledger · View: Income statement.</summary>
    public const string LedgerIncomeStatement = "ledger:income_statement";
    /// <summary>Ledger · View: Balance sheet.</summary>
    public const string LedgerBalanceSheet = "ledger:balance_sheet";
    /// <summary>Ledger · View: Print.</summary>
    public const string LedgerPrint = "ledger:print";
    /// <summary>Ledger · View: Excel.</summary>
    public const string LedgerExport = "ledger:export";
    /// <summary>Ledger · Actions: Add an account.</summary>
    public const string LedgerAccountsCreate = "ledger:accounts_create";
    /// <summary>Ledger · Actions: Change an account.</summary>
    public const string LedgerAccountsEdit = "ledger:accounts_edit";
    /// <summary>Post a manual (compound) journal entry.</summary>
    public const string LedgerPost = "ledger:post";
    /// <summary>Ledger · Actions: Reverse an entry.</summary>
    public const string LedgerReverse = "ledger:reverse";
    /// <summary>Set the period lock date (nothing on or before it can change).</summary>
    public const string LedgerLock = "ledger:lock";
    /// <summary>Ledger · Actions: Close the year.</summary>
    public const string LedgerCloseYear = "ledger:close_year";

    // ──── Payroll ────
    /// <summary>Payroll · View: Payroll runs.</summary>
    public const string PayrollRuns = "payroll:runs";
    /// <summary>Payroll · View: Attendance.</summary>
    public const string PayrollAttendance = "payroll:attendance";
    /// <summary>Payroll · View: Employees.</summary>
    public const string PayrollEmployees = "payroll:employees";
    /// <summary>Payroll · View: Advances.</summary>
    public const string PayrollAdvances = "payroll:advances";
    /// <summary>Payroll · View: Setup.</summary>
    public const string PayrollSetup = "payroll:setup";
    /// <summary>Payroll · View: Print.</summary>
    public const string PayrollPrint = "payroll:print";
    /// <summary>Payroll · Employees: Add an employee.</summary>
    public const string EmployeesCreate = "employees:create";
    /// <summary>Payroll · Employees: Change an employee.</summary>
    public const string EmployeesEdit = "employees:edit";
    /// <summary>Payroll · Employees: Delete an employee.</summary>
    public const string EmployeesDelete = "employees:delete";
    /// <summary>Payroll · Employees: Add a shift.</summary>
    public const string ShiftsCreate = "shifts:create";
    /// <summary>Payroll · Employees: Change a shift.</summary>
    public const string ShiftsEdit = "shifts:edit";
    /// <summary>Payroll · Employees: Payroll rules.</summary>
    public const string PayrollSettings = "payroll:settings";
    /// <summary>Payroll · Attendance: Record attendance.</summary>
    public const string AttendanceEdit = "attendance:edit";
    /// <summary>Payroll · Attendance: Import attendance.</summary>
    public const string AttendanceImport = "attendance:import";
    /// <summary>Add a bonus or a deduction.</summary>
    public const string PayrollAdjust = "payroll:adjust";
    /// <summary>Payroll · Bonuses and advances: Cancel a bonus or deduction.</summary>
    public const string PayrollAdjustCancel = "payroll:adjust_cancel";
    /// <summary>Payroll · Bonuses and advances: Pay an advance.</summary>
    public const string PayrollAdvance = "payroll:advance";
    /// <summary>Payroll · Bonuses and advances: Cancel an advance.</summary>
    public const string PayrollAdvanceCancel = "payroll:advance_cancel";
    /// <summary>Payroll · Runs: Make and recalculate a run.</summary>
    public const string PayrollRun = "payroll:run";
    /// <summary>Post a month's payroll.</summary>
    public const string PayrollPost = "payroll:post";
    /// <summary>Payroll · Runs: Cancel a run.</summary>
    public const string PayrollRunCancel = "payroll:run_cancel";
    /// <summary>Payroll · Runs: Pay salaries.</summary>
    public const string PayrollPay = "payroll:pay";

    // ──── Reports ────
    /// <summary>Reports · Reports: Profit and loss.</summary>
    public const string ReportsPl = "reports:pl";
    /// <summary>Reports · Reports: Profitability.</summary>
    public const string ReportsProfit = "reports:profit";
    /// <summary>Reports · Reports: Monthly sales.</summary>
    public const string ReportsMonthly = "reports:monthly";
    /// <summary>Reports · Reports: Performance.</summary>
    public const string ReportsPerformance = "reports:performance";
    /// <summary>Reports · Reports: Best customers and suppliers.</summary>
    public const string ReportsParties = "reports:parties";
    /// <summary>Reports · Reports: Debt ageing.</summary>
    public const string ReportsAging = "reports:aging";
    /// <summary>Reports · Reports: Item movement.</summary>
    public const string ReportsItems = "reports:items";
    /// <summary>Reports · Reports: Cancelled and changed invoices.</summary>
    public const string ReportsChanges = "reports:changes";
    /// <summary>Reports · Printing: Print.</summary>
    public const string ReportsPrint = "reports:print";
    /// <summary>Reports · Printing: Excel.</summary>
    public const string ReportsExport = "reports:export";

    // ──── Activity log ────
    /// <summary>See the activity log.</summary>
    public const string AuditView = "audit:view";
    /// <summary>Activity log · Log: Excel.</summary>
    public const string AuditExport = "audit:export";
    /// <summary>See who is signed in now and what they are doing.</summary>
    public const string PresenceView = "presence:view";

    // ──── Chat and assistant ────
    /// <summary>Talk with colleagues in the app's chat.</summary>
    public const string ChatUse = "chat:use";
    /// <summary>Read every conversation, not only one's own.</summary>
    public const string ChatMonitor = "chat:monitor";
    /// <summary>Chat and assistant · Chat: Groups.</summary>
    public const string ChatGroups = "chat:groups";
    /// <summary>Chat and assistant · Chat: Stop someone writing.</summary>
    public const string ChatMute = "chat:mute";
    /// <summary>Ask the company's assistant; it only reads what the person may see.</summary>
    public const string AiChat = "ai:chat";
    /// <summary>Chat and assistant · Assistant: Voice.</summary>
    public const string AiVoice = "ai:voice";
    /// <summary>Chat and assistant · Assistant: Read a supplier invoice photo.</summary>
    public const string AiScanPurchase = "ai:scan_purchase";
    /// <summary>Chat and assistant · Assistant: Read a count sheet photo.</summary>
    public const string AiScanStocktake = "ai:scan_stocktake";
    /// <summary>Chat and assistant · Assistant: Read cheque photos.</summary>
    public const string AiScanCheques = "ai:scan_cheques";

    // ──── Accounts and permissions ────
    /// <summary>See the accounts list.</summary>
    public const string StaffView = "staff:view";
    /// <summary>Accounts and permissions · View: Roles.</summary>
    public const string RolesView = "roles:view";
    /// <summary>Accounts and permissions · Accounts: Add an account.</summary>
    public const string StaffCreate = "staff:create";
    /// <summary>Accounts and permissions · Accounts: Change details.</summary>
    public const string StaffEdit = "staff:edit";
    /// <summary>Accounts and permissions · Accounts: Change the role.</summary>
    public const string StaffRole = "staff:role";
    /// <summary>Accounts and permissions · Accounts: Change the password.</summary>
    public const string StaffPassword = "staff:password";
    /// <summary>Keep a person's password for the owner's reminder and read it back (owner, 2026-10-02).</summary>
    public const string StaffPasswordNote = "staff:password_note";
    /// <summary>Accounts and permissions · Accounts: Stop and restart an account.</summary>
    public const string StaffClose = "staff:close";
    /// <summary>Accounts and permissions · Accounts: Delete an account.</summary>
    public const string StaffDelete = "staff:delete";
    /// <summary>Choose the branches, warehouses and money accounts one person may use.</summary>
    public const string StaffAccess = "staff:access";
    /// <summary>Accounts and permissions · Accounts: A person's permissions.</summary>
    public const string StaffPermissions = "staff:permissions";
    /// <summary>Accounts and permissions · Roles: New role.</summary>
    public const string RolesCreate = "roles:create";
    /// <summary>Accounts and permissions · Roles: Change a role's permissions.</summary>
    public const string RolesEdit = "roles:edit";
    /// <summary>Accounts and permissions · Roles: Delete a role.</summary>
    public const string RolesDelete = "roles:delete";

    // ──── Branches and warehouses ────
    /// <summary>See the branches and their warehouses.</summary>
    public const string BranchesView = "branches:view";
    /// <summary>Branches and warehouses · Branches: Add a branch.</summary>
    public const string BranchesCreate = "branches:create";
    /// <summary>Branches and warehouses · Branches: Change a branch.</summary>
    public const string BranchesEdit = "branches:edit";
    /// <summary>Delete a branch that has nothing recorded in it (owner, 2026-10-10).</summary>
    public const string BranchesDelete = "branches:delete";
    /// <summary>Branches and warehouses · Warehouses: Add a warehouse.</summary>
    public const string WarehousesCreate = "warehouses:create";
    /// <summary>Branches and warehouses · Warehouses: Change a warehouse.</summary>
    public const string WarehousesEdit = "warehouses:edit";
    /// <summary>Delete a warehouse that has nothing recorded in it (owner, 2026-10-10).</summary>
    public const string WarehousesDelete = "warehouses:delete";

    // ──── Settings ────
    /// <summary>Open the settings page; each part is changed with its own permission.</summary>
    public const string SettingsView = "settings:view";
    /// <summary>Settings · Settings: Company details.</summary>
    public const string SettingsCompany = "settings:company";
    /// <summary>Settings · Settings: Company logo.</summary>
    public const string SettingsLogo = "settings:logo";
    /// <summary>Settings · Settings: Prices and tax.</summary>
    public const string SettingsPricing = "settings:pricing";
    /// <summary>Settings · Settings: Stock and invoice rules.</summary>
    public const string SettingsRules = "settings:rules";
    /// <summary>Settings · Settings: Security.</summary>
    public const string SettingsSecurity = "settings:security";
    /// <summary>Settings · Settings: Document numbering.</summary>
    public const string SettingsNumbering = "settings:numbering";
    /// <summary>Settings · Settings: Online store.</summary>
    public const string SettingsStorefront = "settings:storefront";
    /// <summary>Download a backup of everything (the owner's alone by default).</summary>
    public const string BackupCreate = "backup:create";

    // ──── General ────
    /// <summary>
    /// See what goods cost and what sales earned: cost and profit on sales documents, items' average
    /// cost, stock values and the profit reports. The owner's alone unless given (owner decision
    /// 2026-09-30); without it the server leaves these numbers out (see Services/Costs.cs).
    /// </summary>
    public const string CostsView = "costs:view";
    /// <summary>See profit (owner, 2026-10-17: a permission of its own, apart from supply prices).</summary>
    public const string ProfitView = "profit:view";
    /// <summary>
    /// Date an invoice, receipt, payment, expense or transfer on an earlier day than today (owner,
    /// 2026-10-02); when it was really entered is kept on it.
    /// </summary>
    public const string DocumentsBackdate = "documents:backdate";
    /// <summary>
    /// Go past the company's own rules after a warning (owner, 2026-10-22: "like an admin button
    /// you can give anyone"): locked invoices and periods, the hours before a return, credit and
    /// discount limits, the profit floor, closing an account with a balance. See Access.OverridePasses.
    /// </summary>
    public const string RulesOverride = "rules:override";

    // ──── System ────
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

    /// <summary>Every permission, used to register one authorization policy per permission.</summary>
    public static readonly string[] All =
    {
        DashboardKpiSales, DashboardKpiPurchases, DashboardKpiReceivables, DashboardKpiPayables, DashboardKpiCash,
        DashboardKpiLowStock, DashboardTrend, DashboardToday, DashboardMonth, DashboardTopItems,
        DashboardTopCustomers, DashboardBranches, DashboardRecent, DashboardAccounts, DashboardNotesDue,
        DashboardAwaiting, DashboardOverLimit, DashboardLowStock, DashboardStockValue, DashboardProfit, SalesView,
        SalesReturnsView, SalesTogether, SalesPrint, SalesCreate, SalesOrder, SalesQuote, SalesEdit, SalesCancel,
        SalesApprove, SalesReject, SalesLock, SalesInvoiceAlerts, SalesReturn, SalesReturnFree, SalesChangePrice,
        SalesRaisePrice, SalesChoosePriceLevel, SalesPriceBasis, SalesOverrideFloor, SalesDiscount,
        SalesDiscountLine, SalesDiscountCombined, SalesBonus, SalesChangeTax, SalesAdditions, SalesChangeShipping,
        DeliveryView, ShipmentsView, SettlementsView, DeliveryStatus, ShipmentsCreate, ShipmentsProgress,
        ShipmentsReturn, ShipmentsCancel, DeliverySettle, PurchasesView, PurchasesReturnsView, PurchasesPriceSheet,
        PurchasesPrint, PurchasesCreate, PurchasesPhotos, PurchasesReturn, PurchasesReturnFree,
        PurchasesChangePrice, PurchasesChoosePriceLevel, PurchasesDiscount, PurchasesBonus, PurchasesChangeTax,
        PurchasesAdditions, InventoryView, InventoryPrint, InventoryExport, ProductsCreate, ProductsEdit,
        ProductsClose, ProductsBarcodes, ProductsImages, PricesEdit, PriceLevelsManage, InventoryTotalItems,
        InventoryTotalQuantity, InventoryTotalSaleValue, InventoryTotalSupplyValue, InventoryTotalSold,
        InventoryCard, ProductsCardPurchases, ProductsCardSales, ProductsCardReturns, ProductsCardPrices,
        InventoryValuation, ValuationDepartments, ValuationWarehouses, ValuationItems, ValuationPrices,
        ValuationSuppliers, InventoryStocktakeView, InventoryStocktake, TransfersView, TransfersPrint,
        InventoryTransfer, InventoryTransferEdit, InventoryTransferReceive, InventoryTransferCancel, LabelsPrint,
        PriceListsView, PriceListsCreate, PriceListsEdit, PriceListsPrices, PriceListsCustomers, PriceListsDelete,
        QuantityBreaksView, QuantityBreaksEdit, DepartmentsCreate, DepartmentsEdit, DepartmentsClose,
        DepartmentsDelete, GroupsCreate, GroupsEdit, GroupsClose, GroupsDelete, UnitsCreate, UnitsEdit, UnitsClose,
        UnitsDelete, SizesCreate, SizesEdit, SizesClose, SizesDelete, ColorsCreate, ColorsEdit, ColorsClose,
        ColorsDelete, SeasonsCreate, SeasonsEdit, SeasonsDelete, PartiesView, PartiesContact, PartiesIdCardsView,
        PartiesPrint, PartiesCreateCustomer, PartiesCreateSupplier, PartiesCreateCarrier, PartiesEdit,
        PartiesClose, PartiesIdCardsEdit, PartiesSetPriceLevel, PartiesCreditLimit, PartiesCashCustomer,
        StatementCustomers, StatementSuppliers, StatementCarriers, StatementMoney, StatementExpenses,
        StatementWarehouses, StatementLedger, StatementPrint, StatementExport, MoneyAccounts, VouchersView,
        ExpenseCategoriesView, MoneyPrint, MoneyExport, ReceiptsCreate, PaymentsCreate, ExpensesCreate,
        CashTransfer, VouchersCancel, VouchersDiscount, MoneyAccountsCreate, MoneyAccountsEdit,
        MoneyAccountsDelete, MoneyAccountsMain, ExpenseCategoriesCreate, ExpenseCategoriesEdit,
        ExpenseCategoriesClose, ExpenseCategoriesDelete, CashHandoverSend, CashHandoverReceive,
        NotesViewReceivable, NotesViewPayable, NotesPortfolios, NotesPhotos, NotesReceive, NotesIssue,
        NotesDeposit, NotesCollect, NotesPay, NotesBounce, NotesEndorse, NotesCancel, NotesLost, LedgerAccounts,
        LedgerJournal, LedgerTrialBalance, LedgerIncomeStatement, LedgerBalanceSheet, LedgerPrint, LedgerExport,
        LedgerAccountsCreate, LedgerAccountsEdit, LedgerPost, LedgerReverse, LedgerLock, LedgerCloseYear,
        PayrollRuns, PayrollAttendance, PayrollEmployees, PayrollAdvances, PayrollSetup, PayrollPrint,
        EmployeesCreate, EmployeesEdit, EmployeesDelete, ShiftsCreate, ShiftsEdit, PayrollSettings, AttendanceEdit,
        AttendanceImport, PayrollAdjust, PayrollAdjustCancel, PayrollAdvance, PayrollAdvanceCancel, PayrollRun,
        PayrollPost, PayrollRunCancel, PayrollPay, ReportsPl, ReportsProfit, ReportsMonthly, ReportsPerformance,
        ReportsParties, ReportsAging, ReportsItems, ReportsChanges, ReportsPrint, ReportsExport, AuditView,
        AuditExport, PresenceView, ChatUse, ChatMonitor, ChatGroups, ChatMute, AiChat, AiVoice, AiScanPurchase,
        AiScanStocktake, AiScanCheques, StaffView, RolesView, StaffCreate, StaffEdit, StaffRole, StaffPassword,
        StaffPasswordNote, StaffClose, StaffDelete, StaffAccess, StaffPermissions, RolesCreate, RolesEdit,
        RolesDelete, BranchesView, BranchesCreate, BranchesEdit, BranchesDelete, WarehousesCreate, WarehousesEdit,
        WarehousesDelete, SettingsView, SettingsCompany, SettingsLogo, SettingsPricing, SettingsRules,
        SettingsSecurity, SettingsNumbering, SettingsStorefront, BackupCreate, CostsView, ProfitView,
        DocumentsBackdate, RulesOverride, SystemMonitor, SystemUpdate, DataImport, LicenseManage,
    };

    /// <summary>Held by the owner alone: never by the admin, a role or a grant.</summary>
    public static readonly string[] OwnerOnly = { SystemMonitor, SystemUpdate, DataImport, LicenseManage };
}

public static class RolePermissions
{
    private static readonly string[] All = Permissions.All;

    /// <summary>
    /// What each built-in role starts with; the owner changes any of them on the accounts page. Each
    /// is a plain list (owner, 2026-10-23: nothing comes with anything else).
    /// </summary>
    public static readonly IReadOnlyDictionary<Role, string[]> Map = new Dictionary<Role, string[]>
    {
        [Role.OWNER] = All,
        // The admin has every permission, and every one added later (owner decision 2026-10-02),
        // except the owner's own.
        // Going past the rules is given by hand, to whoever the owner chooses (owner, 2026-10-22).
        [Role.ADMIN] = All.Except(Permissions.OwnerOnly).Except(new[] { Permissions.RulesOverride }).ToArray(),
        [Role.ACCOUNTANT] = new[]
        {
            Permissions.DashboardKpiSales, Permissions.DashboardKpiPurchases, Permissions.DashboardKpiReceivables,
            Permissions.DashboardKpiPayables, Permissions.DashboardKpiCash, Permissions.DashboardKpiLowStock,
            Permissions.DashboardTrend, Permissions.DashboardToday, Permissions.DashboardMonth,
            Permissions.DashboardTopItems, Permissions.DashboardTopCustomers, Permissions.DashboardBranches,
            Permissions.DashboardRecent, Permissions.DashboardAccounts, Permissions.DashboardNotesDue,
            Permissions.DashboardAwaiting, Permissions.DashboardOverLimit, Permissions.DashboardLowStock,
            Permissions.SalesView, Permissions.SalesReturnsView, Permissions.SalesTogether, Permissions.SalesPrint,
            Permissions.SalesCreate, Permissions.SalesQuote, Permissions.SalesEdit, Permissions.SalesCancel,
            Permissions.SalesApprove, Permissions.SalesReject, Permissions.SalesLock,
            Permissions.SalesInvoiceAlerts, Permissions.SalesReturn, Permissions.SalesReturnFree,
            Permissions.SalesChangePrice, Permissions.SalesRaisePrice, Permissions.SalesChoosePriceLevel,
            Permissions.SalesPriceBasis, Permissions.SalesOverrideFloor, Permissions.SalesDiscount,
            Permissions.SalesDiscountLine, Permissions.SalesDiscountCombined, Permissions.SalesBonus,
            Permissions.SalesChangeTax, Permissions.SalesAdditions, Permissions.SalesChangeShipping,
            Permissions.DeliveryView, Permissions.ShipmentsView, Permissions.SettlementsView,
            Permissions.DeliveryStatus, Permissions.ShipmentsCreate, Permissions.ShipmentsProgress,
            Permissions.ShipmentsReturn, Permissions.ShipmentsCancel, Permissions.DeliverySettle,
            Permissions.PurchasesView, Permissions.PurchasesReturnsView, Permissions.PurchasesPriceSheet,
            Permissions.PurchasesPrint, Permissions.PurchasesCreate, Permissions.PurchasesPhotos,
            Permissions.PurchasesReturn, Permissions.PurchasesReturnFree, Permissions.PurchasesChangePrice,
            Permissions.PurchasesChoosePriceLevel, Permissions.PurchasesDiscount, Permissions.PurchasesBonus,
            Permissions.PurchasesChangeTax, Permissions.PurchasesAdditions, Permissions.InventoryView,
            Permissions.InventoryPrint, Permissions.InventoryExport, Permissions.ProductsCreate,
            Permissions.ProductsEdit, Permissions.ProductsClose, Permissions.ProductsBarcodes,
            Permissions.ProductsImages, Permissions.PricesEdit, Permissions.InventoryCard,
            Permissions.ProductsCardSales, Permissions.ProductsCardReturns, Permissions.ProductsCardPrices,
            Permissions.InventoryStocktakeView, Permissions.InventoryStocktake, Permissions.TransfersView,
            Permissions.TransfersPrint, Permissions.InventoryTransfer, Permissions.InventoryTransferReceive,
            Permissions.InventoryTransferCancel, Permissions.LabelsPrint, Permissions.PriceListsView,
            Permissions.QuantityBreaksView, Permissions.DepartmentsCreate, Permissions.DepartmentsEdit,
            Permissions.DepartmentsClose, Permissions.GroupsCreate, Permissions.GroupsEdit,
            Permissions.GroupsClose, Permissions.UnitsCreate, Permissions.UnitsEdit, Permissions.UnitsClose,
            Permissions.SizesCreate, Permissions.SizesEdit, Permissions.SizesClose, Permissions.ColorsCreate,
            Permissions.ColorsEdit, Permissions.ColorsClose, Permissions.PartiesView, Permissions.PartiesContact,
            Permissions.PartiesIdCardsView, Permissions.PartiesPrint, Permissions.PartiesCreateCustomer,
            Permissions.PartiesCreateSupplier, Permissions.PartiesCreateCarrier, Permissions.PartiesEdit,
            Permissions.PartiesClose, Permissions.PartiesIdCardsEdit, Permissions.PartiesSetPriceLevel,
            Permissions.PartiesCreditLimit, Permissions.PartiesCashCustomer, Permissions.StatementCustomers,
            Permissions.StatementSuppliers, Permissions.StatementCarriers, Permissions.StatementMoney,
            Permissions.StatementExpenses, Permissions.StatementWarehouses, Permissions.StatementLedger,
            Permissions.StatementPrint, Permissions.StatementExport, Permissions.MoneyAccounts,
            Permissions.VouchersView, Permissions.ExpenseCategoriesView, Permissions.MoneyPrint,
            Permissions.MoneyExport, Permissions.ReceiptsCreate, Permissions.PaymentsCreate,
            Permissions.ExpensesCreate, Permissions.CashTransfer, Permissions.VouchersCancel,
            Permissions.VouchersDiscount, Permissions.MoneyAccountsCreate, Permissions.MoneyAccountsEdit,
            Permissions.MoneyAccountsDelete, Permissions.ExpenseCategoriesCreate,
            Permissions.ExpenseCategoriesEdit, Permissions.ExpenseCategoriesClose,
            Permissions.ExpenseCategoriesDelete, Permissions.CashHandoverSend, Permissions.CashHandoverReceive,
            Permissions.NotesViewReceivable, Permissions.NotesViewPayable, Permissions.NotesPortfolios,
            Permissions.NotesPhotos, Permissions.NotesReceive, Permissions.NotesIssue, Permissions.NotesDeposit,
            Permissions.NotesCollect, Permissions.NotesPay, Permissions.NotesBounce, Permissions.NotesEndorse,
            Permissions.NotesCancel, Permissions.NotesLost, Permissions.LedgerAccounts, Permissions.LedgerJournal,
            Permissions.LedgerPrint, Permissions.LedgerExport, Permissions.LedgerAccountsCreate,
            Permissions.LedgerAccountsEdit, Permissions.LedgerPost, Permissions.LedgerReverse,
            Permissions.PayrollRuns, Permissions.PayrollAttendance, Permissions.PayrollEmployees,
            Permissions.PayrollAdvances, Permissions.PayrollSetup, Permissions.PayrollPrint,
            Permissions.AttendanceEdit, Permissions.AttendanceImport, Permissions.PayrollAdjust,
            Permissions.PayrollAdjustCancel, Permissions.PayrollAdvance, Permissions.PayrollAdvanceCancel,
            Permissions.PayrollRun, Permissions.PayrollPost, Permissions.PayrollRunCancel, Permissions.PayrollPay,
            Permissions.ReportsMonthly, Permissions.ReportsPerformance, Permissions.ReportsParties,
            Permissions.ReportsAging, Permissions.ReportsItems, Permissions.ReportsChanges,
            Permissions.ReportsPrint, Permissions.ReportsExport, Permissions.ChatUse, Permissions.SettingsView,
            Permissions.DocumentsBackdate,
        },
        // Sales staff sell at the customer's price level and may only add to a price; lowering it or
        // changing the level needs a manager (owner decisions 2026-09-29, 2026-09-30). Their
        // invoices post at once; the accountant is told and takes the payment. The seller writes a
        // customer's return; it goes straight back into its warehouse.
        [Role.SALES] = new[]
        {
            Permissions.DashboardKpiSales, Permissions.DashboardKpiPurchases, Permissions.DashboardKpiReceivables,
            Permissions.DashboardKpiPayables, Permissions.DashboardKpiCash, Permissions.DashboardKpiLowStock,
            Permissions.DashboardTrend, Permissions.DashboardToday, Permissions.DashboardMonth,
            Permissions.DashboardTopItems, Permissions.DashboardTopCustomers, Permissions.DashboardBranches,
            Permissions.DashboardRecent, Permissions.DashboardOverLimit, Permissions.DashboardLowStock,
            Permissions.SalesView, Permissions.SalesReturnsView, Permissions.SalesTogether, Permissions.SalesPrint,
            Permissions.SalesCreate, Permissions.SalesQuote, Permissions.SalesReturn, Permissions.SalesReturnFree,
            Permissions.SalesRaisePrice, Permissions.DeliveryView, Permissions.ShipmentsView,
            Permissions.SettlementsView, Permissions.DeliveryStatus, Permissions.ShipmentsCreate,
            Permissions.ShipmentsProgress, Permissions.ShipmentsReturn, Permissions.ShipmentsCancel,
            Permissions.InventoryView, Permissions.InventoryPrint, Permissions.InventoryExport,
            Permissions.InventoryCard, Permissions.TransfersView, Permissions.TransfersPrint,
            Permissions.PriceListsView, Permissions.QuantityBreaksView, Permissions.PartiesView,
            Permissions.PartiesContact, Permissions.PartiesIdCardsView, Permissions.PartiesPrint,
            Permissions.PartiesCreateCustomer, Permissions.PartiesCreateSupplier, Permissions.PartiesCreateCarrier,
            Permissions.PartiesEdit, Permissions.PartiesIdCardsEdit, Permissions.StatementWarehouses,
            Permissions.ChatUse,
        },
        // Store staff add items and enter supplier invoices as printed; they don't set selling prices.
        // A store keeper hands the store's cash up to the branch.
        [Role.INVENTORY] = new[]
        {
            Permissions.DashboardKpiSales, Permissions.DashboardKpiPurchases, Permissions.DashboardKpiReceivables,
            Permissions.DashboardKpiPayables, Permissions.DashboardKpiCash, Permissions.DashboardKpiLowStock,
            Permissions.DashboardTrend, Permissions.DashboardRecent, Permissions.DashboardLowStock,
            Permissions.DeliveryView, Permissions.ShipmentsView, Permissions.SettlementsView,
            Permissions.DeliveryStatus, Permissions.ShipmentsCreate, Permissions.ShipmentsProgress,
            Permissions.ShipmentsReturn, Permissions.ShipmentsCancel, Permissions.PurchasesView,
            Permissions.PurchasesReturnsView, Permissions.PurchasesPriceSheet, Permissions.PurchasesPrint,
            Permissions.PurchasesCreate, Permissions.PurchasesPhotos, Permissions.PurchasesReturn,
            Permissions.PurchasesReturnFree, Permissions.PurchasesChangePrice,
            Permissions.PurchasesChoosePriceLevel, Permissions.PurchasesDiscount, Permissions.PurchasesBonus,
            Permissions.PurchasesChangeTax, Permissions.PurchasesAdditions, Permissions.InventoryView,
            Permissions.InventoryPrint, Permissions.InventoryExport, Permissions.ProductsCreate,
            Permissions.ProductsEdit, Permissions.ProductsClose, Permissions.ProductsBarcodes,
            Permissions.ProductsImages, Permissions.InventoryCard, Permissions.ProductsCardPurchases,
            Permissions.ProductsCardReturns, Permissions.InventoryStocktakeView, Permissions.InventoryStocktake,
            Permissions.TransfersView, Permissions.TransfersPrint, Permissions.InventoryTransfer,
            Permissions.InventoryTransferReceive, Permissions.InventoryTransferCancel, Permissions.LabelsPrint,
            Permissions.PriceListsView, Permissions.QuantityBreaksView, Permissions.DepartmentsCreate,
            Permissions.DepartmentsEdit, Permissions.DepartmentsClose, Permissions.GroupsCreate,
            Permissions.GroupsEdit, Permissions.GroupsClose, Permissions.UnitsCreate, Permissions.UnitsEdit,
            Permissions.UnitsClose, Permissions.SizesCreate, Permissions.SizesEdit, Permissions.SizesClose,
            Permissions.ColorsCreate, Permissions.ColorsEdit, Permissions.ColorsClose,
            Permissions.StatementWarehouses, Permissions.CashHandoverSend, Permissions.ChatUse,
        },
        [Role.VIEWER] = new[]
        {
            Permissions.DashboardKpiSales, Permissions.DashboardKpiPurchases, Permissions.DashboardKpiReceivables,
            Permissions.DashboardKpiPayables, Permissions.DashboardKpiCash, Permissions.DashboardKpiLowStock,
            Permissions.DashboardTrend, Permissions.DashboardToday, Permissions.DashboardMonth,
            Permissions.DashboardTopItems, Permissions.DashboardTopCustomers, Permissions.DashboardBranches,
            Permissions.DashboardRecent, Permissions.DashboardAccounts, Permissions.DashboardOverLimit,
            Permissions.DashboardLowStock, Permissions.SalesView, Permissions.SalesReturnsView,
            Permissions.SalesTogether, Permissions.SalesPrint, Permissions.DeliveryView, Permissions.ShipmentsView,
            Permissions.SettlementsView, Permissions.PurchasesView, Permissions.PurchasesReturnsView,
            Permissions.PurchasesPriceSheet, Permissions.PurchasesPrint, Permissions.InventoryView,
            Permissions.InventoryPrint, Permissions.InventoryExport, Permissions.InventoryCard,
            Permissions.TransfersView, Permissions.TransfersPrint, Permissions.PriceListsView,
            Permissions.QuantityBreaksView, Permissions.PartiesView, Permissions.PartiesPrint,
            Permissions.StatementMoney, Permissions.StatementExpenses, Permissions.StatementWarehouses,
            Permissions.MoneyAccounts, Permissions.VouchersView, Permissions.ExpenseCategoriesView,
            Permissions.MoneyPrint, Permissions.MoneyExport, Permissions.ReportsMonthly,
            Permissions.ReportsPerformance, Permissions.ReportsParties, Permissions.ReportsAging,
            Permissions.ReportsItems, Permissions.ReportsPrint, Permissions.ReportsExport,
        },
        // Starts with nothing; the owner ticks exactly what the person may do (owner, 2026-10-23).
        [Role.NONE] = Array.Empty<string>(),
    };

    public static string[] For(Role role) => Map.TryGetValue(role, out var p) ? p : Array.Empty<string>();
}
