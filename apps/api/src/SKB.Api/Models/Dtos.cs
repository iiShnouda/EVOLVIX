namespace SKB.Api.Models;

// Serialized as camelCase (ASP.NET Core web defaults) to match the existing clients.

/// <param name="BranchId">Their own branch.</param>
/// <param name="Branches">The branches they may work in, their own first (every branch when AllBranches).</param>
/// <param name="WarehouseIds">Only these warehouses; null = any in their branches.</param>
/// <param name="MoneyAccountIds">Only these money accounts; null = any in their branches.</param>
public record AuthUserDto(
    string Id, string FullName, string Email, string Role, string BranchId, string[] Permissions,
    bool AllBranches = false, BranchOptionDto[]? Branches = null, string[]? WarehouseIds = null,
    string[]? MoneyAccountIds = null);

public record BranchOptionDto(string Id, string Name, bool IsActive = true);

public record LoginRequest(string Email, string Password, bool RememberDevice = false);

public record LoginResponseDto(AuthUserDto User, string AccessToken);

public record KpiDto(string Key, long Value, bool IsMoney, string? Currency, string Tone, double? DeltaPct);

public record TrendPointDto(string Date, long Sales, long Purchases);

/// <param name="Unit">Name of the base unit (stock is counted in it).</param>
/// <param name="Barcode">The base unit's barcode.</param>
/// <param name="Units">Every unit the item comes in, base first, with its price at each level.</param>
/// <param name="MatchedUnitId">When the search text was exactly one of the item's barcodes: that unit.</param>
public record ProductDto(
    string Id, string Sku, string Name, string Unit, long CostPrice, long SalePrice,
    string Currency, int StockOnHand, int ReorderLevel, bool IsActive,
    string? Barcode, string CategoryId, ProductUnitDto[] Units,
    string? ModelId, string? SizeName, string? ColorName, string? MatchedUnitId,
    string? SupplierId = null, string? SupplierName = null, string? SupplierCode = null);

/// <param name="Prices">The unit's price at each active level that has one (see PriceBook for the order).</param>
public record ProductUnitDto(string UnitId, string Name, int Factor, string? Barcode, UnitPriceDto[] Prices);

/// <param name="Source">OWN, MODEL (inherited from the model), BASE (base unit × factor) or DEFAULT (default level's).</param>
public record UnitPriceDto(string PriceLevelId, long Price, string Source);

/// <param name="SourceNumber">For a return: the number of the invoice it reverses.</param>
public record SalesSummaryDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, long GrandTotal, long PaidAmount, string Currency,
    string? SourceNumber);

/// <param name="Quantity">In base units (what stock moved by).</param>
/// <param name="UnitQuantity">In the line's unit (<paramref name="UnitName"/>, holding <paramref name="UnitFactor"/> base units).</param>
/// <param name="UnitPrice">Price of one line unit.</param>
/// <param name="UnitCost">Cost of one base unit.</param>
/// <param name="ReturnedQuantity">For an invoice line: base units already returned against it (0 on a return).</param>
/// <param name="WarehouseName">Warehouse the goods left from / arrived into.</param>
/// <param name="BaseUnitName">The item's base unit (what <paramref name="Quantity"/> counts).</param>
public record DocumentLineDto(
    string Id, string ProductId, string ProductName, int Quantity, long UnitPrice, long Discount, long LineTotal,
    long UnitCost, long LineProfit, int ReturnedQuantity, string? WarehouseId, string? WarehouseName,
    string? UnitId, string UnitName, int UnitFactor, int UnitQuantity, long LineCost, string BaseUnitName,
    bool IsBonus, long DocDiscount);

/// <param name="Rate">Percent (14.00 = 14%) when the charge is a rate, else null.</param>
/// <param name="Amount">What it came to, minor units.</param>
public record DocumentChargeDto(string Kind, decimal? Rate, long? FixedAmount, long Amount, string? Label);

/// <param name="SourceDocumentId">For a return: the invoice it reverses.</param>
/// <param name="PriceLevelName">The price level the invoice was priced at.</param>
public record SalesDetailDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, DocumentLineDto[] Lines,
    long Subtotal, long DiscountTotal, long TaxTotal, long GrandTotal, long PaidAmount,
    long CostTotal, long ProfitTotal, string Currency, string? Notes,
    string? SourceDocumentId, string? SourceNumber, string? PriceLevelId, string? PriceLevelName,
    long AdditionTotal, DocumentChargeDto[] Charges, string? RepId, string? RepName,
    string DeliveryMethod, string? DeliveryStatus, string? DeliveryAddress, string? DriverId, string? DriverName,
    string? CarrierId, string? CarrierName, string? PaidAccountId = null, string? PaidAccountName = null,
    string? InvoiceId = null, string? InvoiceNumber = null);

// ---- Create requests (server is the authoritative validator; the client mirrors these zod schemas) ----

// Warehouse: a line may name its own; otherwise the document's WarehouseId; otherwise the
// default warehouse of the user's branch.
// Unit: a line may name one of the item's units (carton…); Quantity and UnitPrice/UnitCost are then
// per that unit. None = the base unit.
// Price level: none = the party's own level, else the side's default. Without the change-price
// permission a line's price must be the level's price (or, for an unpriced item, the suggested one).

// Charges: the invoice's discounts, taxes and additions (DOMAIN.md §2.5). When sent they are the
// whole list (the tax too); when left out, TaxPercent — or the company's rate — is the only charge.
// IsBonus: free goods, sent with price / cost 0.

public record CreateInvoiceLineRequest(
    string ProductId, int Quantity, long UnitPrice, long Discount = 0, string? WarehouseId = null,
    string? UnitId = null, bool IsBonus = false);

/// <param name="Percent">A rate (14 = 14%, up to 2 decimals); give this or Amount.</param>
/// <param name="Amount">A fixed amount in minor units; give this or Percent.</param>
public record ChargeRequest(string? Kind, decimal? Percent = null, long? Amount = null, string? Label = null);

public record CreateSalesInvoiceRequest(
    string PartyId, CreateInvoiceLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null,
    long PaidAmount = 0, bool OverrideFloor = false, string? WarehouseId = null, string? PriceLevelId = null,
    ChargeRequest[]? Charges = null, string? RepId = null,
    string? DeliveryMethod = null, string? DeliveryAddress = null, string? DriverId = null, string? CarrierId = null,
    string? PaidAccountId = null);

/// <summary>
/// Turning a quotation into an invoice: its lines, prices and charges come from the quotation; this
/// says what's decided now — where the goods leave from (else each line's warehouse), payment and delivery.
/// </summary>
public record ConvertQuotationRequest(
    string? WarehouseId = null, long PaidAmount = 0, string? PaidAccountId = null, string? DeliveryMethod = null,
    string? DeliveryAddress = null, string? DriverId = null, string? CarrierId = null, bool OverrideFloor = false,
    string? DueDate = null, string? Notes = null);

public record CreatePurchaseLineRequest(
    string ProductId, int Quantity, long UnitCost, string? WarehouseId = null, string? UnitId = null,
    bool IsBonus = false);

public record CreatePurchaseInvoiceRequest(
    string PartyId, CreatePurchaseLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null, long PaidAmount = 0,
    string? WarehouseId = null, string? PriceLevelId = null, ChargeRequest[]? Charges = null,
    string? PaidAccountId = null);

/// <summary>Someone who can be credited with a sale (active staff).</summary>
public record RepOptionDto(string Id, string Name, string BranchId);

/// <summary>One invoice line being returned. Price and cost always come from the original line.</summary>
public record CreateReturnLineRequest(string LineId, int Quantity);

/// <param name="RefundAmount">Cash settled now (minor units); the rest goes on the party's account.</param>
/// <param name="RefundAccountId">The money account the refund goes through (none = the branch's cash box).</param>
public record CreateReturnRequest(
    CreateReturnLineRequest[] Lines, long RefundAmount = 0, string? Notes = null, string? RefundAccountId = null);

public record CompanySettingsDto(
    string CompanyName, string Country, string Currency,
    int DefaultMarkupPercent, int MinMarkupPercent, int DefaultTaxPercent, bool TransfersRequireReceipt,
    string? Address = null, string? Phone = null, string? Email = null, string? TaxNumber = null,
    string? CommercialRegister = null, string TimeZone = "Africa/Cairo");

/// <summary>A field left null is unchanged; "" clears a company-profile field.</summary>
public record UpdateSettingsRequest(
    string? CompanyName, string? Country, string? Currency,
    int? DefaultMarkupPercent, int? MinMarkupPercent, int? DefaultTaxPercent,
    bool? TransfersRequireReceipt = null, string? Address = null, string? Phone = null, string? Email = null,
    string? TaxNumber = null, string? CommercialRegister = null, string? TimeZone = null);

// ---- Profitability report (تقارير الربحية) ----

public record ProfitRowDto(
    string Key, string Label, long Revenue, long Cost, long Profit, int Invoices, int Quantity);

/// <param name="Revenue">Net sales: invoices minus returns, after discount, before tax.</param>
/// <param name="Returns">Value of sales returns in the period (already subtracted from Revenue).</param>
public record ProfitReportDto(
    string From, string To, string By, string Currency,
    long Revenue, long Cost, long Profit, int Invoices, long Returns, ProfitRowDto[] Rows);

// ---- Inventory (Phase 2): stock list, item card, valuation, stocktake ----

/// <param name="Unit">Name of the base unit; quantities are in it.</param>
/// <param name="AvgCost">Current weighted-average cost of one base unit (minor units).</param>
/// <param name="StockValue">StockOnHand × AvgCost (minor units).</param>
/// <param name="IsLow">On hand has reached the reorder level (الأصناف التي وصلت لحد الطلب).</param>
/// <param name="Units">Every unit the item comes in (base first), for entering quantities in cartons etc.</param>
public record InventoryItemDto(
    string Id, string Sku, string Name, string Unit, string CategoryName,
    int StockOnHand, int ReorderLevel, long AvgCost, long SalePrice, long StockValue, bool IsLow,
    UnitOptionDto[] Units, string? ModelId);

/// <summary>A unit an item comes in: its name and how many base units it holds.</summary>
public record UnitOptionDto(string UnitId, string Name, int Factor);

/// <param name="TotalValue">Value of all active stock, regardless of the list filter.</param>
public record InventoryListDto(
    InventoryItemDto[] Items, long TotalValue, int TotalItems, int LowStockCount, string Currency);

/// <param name="DocumentType">Type of the source document (for linking), if the movement came from one.</param>
/// <param name="Balance">Running balance after the movement: in its warehouse when the card is
/// filtered to one warehouse, otherwise across all warehouses.</param>
public record StockMovementDto(
    string Id, string Date, string Type, string BranchName, string WarehouseId, string WarehouseName,
    string? Reference, string? DocumentId, string? DocumentType, int QuantityIn, int QuantityOut, int Balance,
    long UnitCost, long AvgCostAfter, string? Note);

/// <summary>Stock of one item (or of everything) held in one warehouse.</summary>
public record WarehouseStockDto(string WarehouseId, string Name, string BranchName, int Quantity, long Value);

/// <summary>Item card (كارت الصنف): every movement of one item in a period with its running balance.</summary>
/// <remarks><c>WarehouseId</c> is set when the card is limited to one warehouse; <c>Stock</c> is
/// today's quantity per warehouse.</remarks>
public record ItemCardDto(
    InventoryItemDto Item, string From, string To, string? WarehouseId,
    int OpeningBalance, long OpeningValue, int TotalIn, int TotalOut, int ClosingBalance, long ClosingValue,
    StockMovementDto[] Movements, WarehouseStockDto[] Stock, string Currency);

public record ValuationRowDto(string Key, string Label, int Quantity, long Value);

/// <summary>Stock valuation (تقييم المخزن) at the end of <c>AsOf</c>: quantity × weighted-average cost.</summary>
/// <remarks>By category, item, warehouse and model (size/color variants rolled up). <c>WarehouseId</c> is
/// set when limited to one warehouse. Quantities are in base units.</remarks>
public record ValuationDto(
    string AsOf, string Currency, string? WarehouseId, int Quantity, long Value,
    ValuationRowDto[] Categories, ValuationRowDto[] Items, ValuationRowDto[] Warehouses, ValuationRowDto[] Models);

public record StocktakeLineRequest(string ProductId, int CountedQuantity);

/// <summary>Stocktake (الجرد): the counted quantity per item; only lines that differ are posted.</summary>
/// <remarks>Counts one warehouse; none given means the default warehouse of the user's branch.</remarks>
public record StocktakeRequest(StocktakeLineRequest[] Lines, string? Reason = null, string? WarehouseId = null);

/// <param name="ValueChange">Signed total value change (gains − shrinkage), minor units.</param>
public record StocktakeResultDto(
    string Reference, string WarehouseName, int ItemsChanged, long ValueChange, StockMovementDto[] Movements);

// ---- Branches & warehouses ----

/// <param name="Kind">STORE, or TRANSIT for the system warehouse holding goods on the way.</param>
/// <param name="ItemCount">Items with stock in this warehouse.</param>
/// <param name="Value">Quantity × current average cost, minor units.</param>
public record WarehouseDto(
    string Id, string Code, string Name, string BranchId, string BranchName, string Kind,
    bool IsDefault, bool IsActive, int ItemCount, int Quantity, long Value);

/// <summary>A warehouse goods can be sent to (any branch), for the transfer form.</summary>
public record WarehouseOptionDto(string Id, string Name, string BranchName);

// ---- Transfer permits (إذن تحويل) ----

/// <param name="UnitCost">Average cost when sent, minor units.</param>
public record StockTransferLineDto(
    string Id, string ProductId, string ProductName, int Quantity, long UnitCost, long Value);

/// <param name="CanReceive">The caller may confirm receipt now.</param>
/// <param name="CanCancel">The caller may cancel it now (goods go back to the source).</param>
public record StockTransferDto(
    string Id, string Number, string Status,
    string FromWarehouseId, string FromWarehouseName, string FromBranchName,
    string ToWarehouseId, string ToWarehouseName, string ToBranchName,
    string CreatedAt, string CreatedByName,
    string? ReceivedAt, string? ReceivedByName, string? CancelledAt, string? CancelledByName,
    string? Notes, int Quantity, long Value, StockTransferLineDto[] Lines,
    bool CanReceive, bool CanCancel);

public record CreateTransferLineRequest(string ProductId, int Quantity);

public record CreateTransferRequest(
    string FromWarehouseId, string ToWarehouseId, CreateTransferLineRequest[] Lines, string? Notes = null);

public record BranchDto(
    string Id, string Code, string Name, string? Location, bool IsActive, WarehouseDto[] Warehouses);

// Names: one name, as typed (Arabic or English); it is never translated (owner decision 2026-09-29).

public record CreateWarehouseRequest(
    string BranchId, string? Code = null, bool IsDefault = false,
    string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateWarehouseRequest(
    bool? IsActive = null, bool? IsDefault = null, string? Name = null);

/// <summary>A new branch also gets its default store.</summary>
public record CreateBranchRequest(
    string? Code = null, string? Location = null, string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateBranchRequest(string? Location = null, string? Name = null);

public record DashboardDto(
    KpiDto[] Kpis, TrendPointDto[] Trend, ProductDto[] LowStock,
    SalesSummaryDto[] RecentDocuments, string Currency);

public record PaginatedDto<T>(T[] Items, int Total, int Page, int PageSize);

// ---- Delivery (DOMAIN.md §2.5): deliveries, shipments / waybills, carrier settlements ----

/// <summary>A sale that is delivered (own driver or a carrier), and where it stands.</summary>
/// <param name="Outstanding">Grand total − paid: what the customer still owes on it.</param>
public record DeliveryDto(
    string DocumentId, string Number, string IssueDate, string PartyId, string PartyName, string BranchName,
    string Method, string? Status, string? Address, string? DriverName, string? CarrierId, string? CarrierName,
    long GrandTotal, long Outstanding, string Currency,
    string? ShipmentId, string? ShipmentNumber, string? ShipmentStatus);

/// <param name="Status">OUT_FOR_DELIVERY, DELIVERED or RETURNED.</param>
/// <param name="CreateReturn">When RETURNED: also post a full sales return of what is left on it.</param>
public record SetDeliveryStatusRequest(string? Status, string? DriverId = null, bool CreateReturn = false);

public record ShipmentInvoiceDto(string DocumentId, string Number, long GrandTotal, long CodShare);

public record ShipmentDto(
    string Id, string Number, string? WaybillNo, string Status, string CarrierId, string CarrierName,
    string PartyId, string PartyName, string BranchName, long CodAmount, string? Notes,
    string CreatedAt, string CreatedByName, string? PickedUpAt, string? DeliveredAt, string? ReturnedAt,
    string? CancelledAt, string? SettlementId, string? SettlementNumber, ShipmentInvoiceDto[] Invoices,
    string Currency);

/// <param name="CodAmount">Cash the carrier collects; null = everything still owed on the invoices, 0 = prepaid.</param>
public record CreateShipmentRequest(
    string? CarrierId, string[]? InvoiceIds, string? WaybillNo = null, long? CodAmount = null, string? Notes = null);

/// <param name="CreateReturns">Also post full sales returns of the refused goods (needs sales:return).</param>
public record ShipmentReturnRequest(bool CreateReturns = true);

/// <param name="Returns">Numbers of the sales returns posted for refused goods.</param>
/// <param name="Problems">Returns that couldn't be posted, with the reason.</param>
public record ShipmentActionDto(ShipmentDto Shipment, string[] Returns, string[] Problems);

public record DeliveryActionDto(DeliveryDto Delivery, string[] Returns, string[] Problems);

public record CarrierSettlementDto(
    string Id, string Number, string CarrierId, string CarrierName, long CodTotal, long Fees, long Received,
    long Difference, string? Notes, string CreatedAt, string CreatedByName, string[] Shipments, string Currency,
    string? AccountName = null);

/// <param name="Fees">What the carrier kept as its fees (minor units).</param>
/// <param name="Received">What the carrier paid us (minor units).</param>
/// <param name="AccountId">Where the carrier's payment went (none = the branch's cash box).</param>
public record CreateSettlementRequest(
    string? CarrierId, string[]? ShipmentIds, long Fees = 0, long Received = 0, string? Notes = null,
    string? AccountId = null);

/// <param name="SalesPriceLevelId">The customer's own price level (null = the default sales level).</param>
/// <param name="PurchasePriceLevelId">The supplier's own price level (null = the default purchase level).</param>
public record PartyDto(
    string Id, string Name, string[] Types, string? Phone, long Balance, string Currency,
    string? SalesPriceLevelId, string? PurchasePriceLevelId,
    string? Email, string? TaxNumber, string? Address, bool IsActive,
    string[] OtherPhones, string? ContactName, string? ShippingAddress, string? Notes);

/// <param name="Types">CUSTOMER, SUPPLIER and/or CARRIER (a shipping company). "FACTORY" is read as SUPPLIER.</param>
/// <param name="Address">The main address; for a supplier, the factory's address.</param>
/// <param name="ContactName">The factory owner (supplier) or the person in charge (customer).</param>
public record CreatePartyRequest(
    string? Name, string[]? Types, string? Phone = null, string? Email = null, string? TaxNumber = null,
    string? Address = null, string[]? OtherPhones = null, string? ContactName = null,
    string? ShippingAddress = null, string? Notes = null);

/// <summary>Any field left null is unchanged; "" (or an empty phone list) clears it.</summary>
public record UpdatePartyRequest(
    string? Name = null, string[]? Types = null, string? Phone = null, string? Email = null,
    string? TaxNumber = null, string? Address = null, bool? IsActive = null,
    string[]? OtherPhones = null, string? ContactName = null, string? ShippingAddress = null,
    string? Notes = null);

/// <summary>A party's own price levels. Null leaves a side unchanged; "" clears it (back to the default).</summary>
public record SetPartyPriceLevelsRequest(string? SalesPriceLevelId = null, string? PurchasePriceLevelId = null);

// ---- Catalog (الأصناف): units, categories, price levels, sizes & colors, items, models ----

/// <param name="ItemCount">Items that come in this unit / belong to this category.</param>
public record UnitDto(string Id, string Name, bool IsActive, int ItemCount);

public record CategoryDto(string Id, string Name, int ItemCount);

/// <param name="Side">SALE or PURCHASE.</param>
public record PriceLevelDto(
    string Id, string Name, string Side, bool IsDefault, int SortOrder, bool IsActive);

/// <param name="Kind">SIZE or COLOR.</param>
public record VariantOptionDto(
    string Id, string Kind, string Name, int SortOrder, bool IsActive);

/// <summary>A new unit / category / size / color: its name, as typed.</summary>
public record CreateNamedRequest(string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateNamedRequest(
    string? Name = null, bool? IsActive = null, int? SortOrder = null);

public record CreatePriceLevelRequest(string? Side, string? Name = null);

public record UpdatePriceLevelRequest(
    string? Name = null,
    bool? IsActive = null, bool? IsDefault = null, int? SortOrder = null);

public record CreateVariantOptionRequest(string? Kind, string? Name = null);

/// <summary>One unit of an item: which unit, how many base units it holds (1 = the base unit), its barcode.</summary>
public record ItemUnitRequest(string? UnitId, int Factor, string? Barcode = null);

/// <summary>A price for one unit at one level (minor units). Null clears the item's own price (inherit again).</summary>
public record PriceRequest(string? UnitId, string? PriceLevelId, long? Price);

/// <param name="SupplierId">The item's main supplier (a factory is a supplier); "" or null = none.</param>
/// <param name="SupplierCode">That supplier's own code for the item.</param>
public record CreateProductRequest(
    string? CategoryId, ItemUnitRequest[]? Units,
    string? Name = null, string? Sku = null,
    int ReorderLevel = 0, PriceRequest[]? Prices = null,
    string? SupplierId = null, string? SupplierCode = null);

/// <summary>
/// Any field left null is unchanged. For a variant only SKU, reorder level, active and the units'
/// barcodes can change here — names, category and units follow its model.
/// </summary>
public record UpdateProductRequest(
    string? Name = null, string? Sku = null,
    string? CategoryId = null, int? ReorderLevel = null, bool? IsActive = null, ItemUnitRequest[]? Units = null,
    string? SupplierId = null, string? SupplierCode = null);

public record UpdatePricesRequest(PriceRequest[]? Prices);

/// <param name="Own">The item's (or model's) own price; null when it inherits.</param>
/// <param name="Effective">What it charges at that level, however it was worked out (null = unpriced).</param>
public record PriceCellDto(string UnitId, string PriceLevelId, long? Own, long? Effective, string? Source);

public record ItemUnitDto(string UnitId, string Name, int Factor, string? Barcode);

/// <summary>An item for the item editor, with its units and every unit × level price.</summary>
/// <param name="HasMovements">Stock has moved: the base unit can no longer change.</param>
public record ProductDetailDto(
    string Id, string Sku, string Name, string CategoryId, string CategoryName,
    int ReorderLevel, bool IsActive, int StockOnHand, long CostPrice, bool HasMovements,
    string? ModelId, string? ModelName, string? SizeId, string? SizeName, string? ColorId, string? ColorName,
    ItemUnitDto[] Units, PriceCellDto[] Prices, string Currency,
    string? SupplierId = null, string? SupplierName = null, string? SupplierCode = null);

public record ModelSummaryDto(
    string Id, string Code, string Name, string CategoryName, int Variants, int StockOnHand, bool IsActive);

/// <param name="OwnPrices">The variant has prices of its own (the rest come from the model).</param>
public record ModelVariantDto(
    string ProductId, string Sku, string Name, string? SizeId, string? ColorId, int StockOnHand,
    bool IsActive, string? Barcode, bool OwnPrices, long SalePrice);

public record ModelDetailDto(
    string Id, string Code, string Name, string CategoryId, string CategoryName,
    int ReorderLevel, bool IsActive, bool HasMovements, ItemUnitDto[] Units, PriceCellDto[] Prices,
    VariantOptionDto[] Sizes, VariantOptionDto[] Colors, ModelVariantDto[] Variants, string Currency,
    string? SupplierId = null, string? SupplierName = null, string? SupplierCode = null);

/// <summary>A new model: its variants are made for every size × color given (one list may be empty).</summary>
public record CreateModelRequest(
    string? CategoryId, ItemUnitRequest[]? Units, string[]? SizeIds, string[]? ColorIds,
    string? Name = null, string? Code = null,
    int ReorderLevel = 0, PriceRequest[]? Prices = null,
    string? SupplierId = null, string? SupplierCode = null);

/// <summary>
/// Any field left null is unchanged. New sizes / colors add the missing variants; units apply to
/// every variant (a variant's barcodes stay).
/// </summary>
public record UpdateModelRequest(
    string? Name = null, string? CategoryId = null,
    int? ReorderLevel = null, bool? IsActive = null, string[]? AddSizeIds = null, string[]? AddColorIds = null,
    ItemUnitRequest[]? Units = null, string? SupplierId = null, string? SupplierCode = null);

// ---- Staff & permissions (owner decision 2026-09-29: every action has its own permission) ----

/// <param name="Permissions">What the person may do now: their role's, plus granted, minus revoked.</param>
/// <param name="AllBranches">The owner's choice: every branch, only the listed ones, or null = as their role says.</param>
/// <param name="SeesAllBranches">What that comes to.</param>
/// <param name="BranchIds">Branches they also work in, besides their own.</param>
/// <param name="WarehouseIds">Only these warehouses (empty = every one in their branches).</param>
/// <param name="MoneyAccountIds">Only these money accounts (empty = every one in their branches).</param>
public record StaffDto(
    string Id, string FullName, string Email, string Role, string BranchId, string BranchName, string? Phone,
    bool IsActive, string CreatedAt, string[] Granted, string[] Revoked, string[] Permissions,
    bool? AllBranches = null, bool SeesAllBranches = false, string[]? BranchIds = null, string[]? WarehouseIds = null,
    string[]? MoneyAccountIds = null);

/// <summary>What one person may work with; every field replaces what was there.</summary>
public record StaffAccessRequest(
    bool? AllBranches, string[]? BranchIds, string[]? WarehouseIds, string[]? MoneyAccountIds);

public record CreateStaffRequest(
    string? FullName, string? Email, string? Password, string? Role, string? BranchId, string? Phone = null);

/// <summary>Any field left null is unchanged. A password here replaces the person's password.</summary>
public record UpdateStaffRequest(
    string? FullName = null, string? Email = null, string? Role = null, string? BranchId = null,
    string? Phone = null, bool? IsActive = null, string? Password = null);

/// <summary>A person's own changes to their role's permissions.</summary>
public record StaffPermissionsRequest(string[]? Granted, string[]? Revoked);

/// <param name="Custom">The owner changed this role from the default.</param>
/// <param name="Editable">False for OWNER, which always has every permission.</param>
public record RoleDto(string Role, string[] Permissions, bool Custom, bool Editable, int Staff);

public record UpdateRoleRequest(string[]? Permissions);

/// <param name="Group">The module it belongs to (the part before the colon).</param>
public record PermissionInfoDto(string Key, string Group);

/// <summary>One open app window of a person who is online.</summary>
/// <param name="Device">ANDROID_APP, WINDOWS_APP, IPHONE, ANDROID_BROWSER, WINDOWS_BROWSER, MAC_BROWSER or BROWSER.</param>
public record PresenceWindowDto(string Device, string? Ip, string? CurrentView, string ConnectedAt, string LastActiveAt);

/// <summary>A person online now: their most recently used window's screen, and all their windows.</summary>
public record PresenceEntryDto(
    string UserId, string FullName, string Role, string BranchId, string? BranchName, string? CurrentView,
    string ConnectedAt, string LastActiveAt, PresenceWindowDto[] Windows);

// ---- Money (DOMAIN.md §2.6): accounts, vouchers, allocations, expense categories ----

public record MoneyAccountDto(
    string Id, string Name, string Kind, string BranchId, string BranchName, string? CustodianId,
    string? CustodianName, string? Number, string? BankName, long Balance, string Currency, bool IsDefault,
    bool IsActive, bool HasMovements);

/// <param name="OpeningBalance">Money already in it (minor units), posted as its first movement.</param>
public record CreateMoneyAccountRequest(
    string? Name, string? Kind, string? BranchId, string? CustodianId = null, string? Number = null,
    string? BankName = null, long OpeningBalance = 0, bool IsDefault = false);

/// <summary>A field left null is unchanged. Closing needs a zero balance.</summary>
/// <param name="OpeningBalance">What is in it, for an account that has no movements yet (e.g. a new
/// branch's cash box).</param>
public record UpdateMoneyAccountRequest(
    string? Name = null, string? Number = null, string? BankName = null, string? CustodianId = null,
    bool? IsDefault = null, bool? IsActive = null, long? OpeningBalance = null);

public record MoneyMovementDto(
    string Id, long Seq, string CreatedAt, string Kind, long Amount, long BalanceAfter, string? Method,
    string? Reference, string? MethodReference, string? PartyName, string? Notes, string CreatedByName,
    string? VoucherId);

/// <summary>An account's movements over a period (a day = the daily cash report, حركة اليوم).</summary>
public record AccountStatementDto(
    MoneyAccountDto Account, string From, string To, long Opening, long TotalIn, long TotalOut, long Closing,
    MoneyMovementDto[] Movements);

public record VoucherLineRequest(string? Method, string? AccountId, long Amount, string? Reference = null);

public record AllocationRequest(string? DocumentId, long Amount);

/// <summary>A receipt, payment or expense. Allocations are for receipts and payments only.</summary>
public record CreateVoucherRequest(
    string? PartyId, VoucherLineRequest[]? Lines, AllocationRequest[]? Allocations = null, string? Notes = null,
    string? CategoryId = null);

public record CreateCashTransferRequest(string? FromAccountId, string? ToAccountId, long Amount, string? Notes = null);

public record VoucherLineDto(string Method, string AccountId, string AccountName, long Amount, string? Reference);

public record VoucherAllocationDto(string DocumentId, string Number, long Amount);

/// <param name="Unallocated">Of a receipt or payment, what is on the party's account, not on an invoice.</param>
public record VoucherDto(
    string Id, string Number, string Type, string Status, string BranchName, string? PartyId, string? PartyName,
    string? CategoryId, string? CategoryName, string? FromAccountName, string? ToAccountName, long Amount,
    long Unallocated, string? Notes, string CreatedAt, string CreatedByName, string? CancelledAt,
    string? CancelledByName, VoucherLineDto[] Lines, VoucherAllocationDto[] Allocations, string Currency);

/// <summary>An invoice a receipt or payment can settle.</summary>
/// <param name="OnCodParcel">In a cash-on-delivery parcel not delivered yet: the carrier collects it.</param>
public record OpenInvoiceDto(
    string DocumentId, string Number, string Type, string IssueDate, string? DueDate, string BranchName,
    long GrandTotal, long PaidAmount, long Outstanding, bool OnCodParcel);

public record ExpenseCategoryDto(string Id, string Name, string? ParentId, string? ParentName, bool IsActive);

public record CreateExpenseCategoryRequest(string? Name, string? ParentId = null);

public record UpdateExpenseCategoryRequest(string? Name = null, string? ParentId = null, bool? IsActive = null);

// ---- Ledger (DOMAIN.md §2.8): chart of accounts, statements, trial balance, journal ----

/// <param name="Balance">Debits − credits (a group: of everything under it).</param>
public record LedgerAccountDto(
    string Id, string Code, string Name, string Type, string? ParentId, bool IsGroup, string? SystemKey,
    string? PartyId, string? MoneyAccountId, string? ExpenseCategoryId, bool IsActive, long Debit, long Credit,
    long Balance);

public record CreateLedgerAccountRequest(string? Name, string? ParentId, bool IsGroup = false);

public record UpdateLedgerAccountRequest(string? Name = null, bool? IsActive = null);

/// <param name="Balance">Running balance (debits − credits) after this line.</param>
public record LedgerLineDto(
    string EntryId, string Date, string Number, string Description, string SourceType, string? SourceId,
    string AccountCode, string AccountName, long Debit, long Credit, string? Memo, long Balance);

public record LedgerStatementDto(
    string Title, string From, string To, long Opening, long TotalDebit, long TotalCredit, long Closing,
    LedgerLineDto[] Lines, string Currency);

public record TrialBalanceRowDto(
    string AccountId, string Code, string Name, string Type, string? ParentId, long OpeningDebit,
    long OpeningCredit, long PeriodDebit, long PeriodCredit, long ClosingDebit, long ClosingCredit);

public record TrialBalanceDto(string From, string To, TrialBalanceRowDto[] Rows, string Currency);

public record JournalLineDto(string AccountId, string AccountCode, string AccountName, long Debit, long Credit, string? Memo);

/// <param name="Reversible">A manual entry not reversed yet.</param>
public record JournalEntryDto(
    string Id, string Number, string Date, string Description, string SourceType, string? SourceId,
    string CreatedByName, string CreatedAt, JournalLineDto[] Lines, bool Reversible, string Currency);

public record JournalLineRequest(string? AccountId, long Debit = 0, long Credit = 0, string? Memo = null);

public record CreateJournalEntryRequest(string? Date, string? Description, JournalLineRequest[]? Lines);

public record LockDateDto(string? LockDate);

// ---- Cheques & promissory notes (DOMAIN.md §2.7) ----

public record NoteEventDto(
    string? FromStatus, string ToStatus, string? AccountName, string? PartyName, string? Remark, string StaffName,
    string CreatedAt);

public record NoteAllocationDto(string DocumentId, string Number, long Amount);

/// <param name="Overdue">Past its due date and still open (in hand, under collection or issued).</param>
public record NoteDto(
    string Id, string Ref, string Kind, string Direction, string Status, string SerialNumber, string? BankName,
    long Amount, string DueDate, bool Overdue, string? Drawer, string? Guarantor, string PartyId, string PartyName,
    string? EndorsedToName, string BranchName, string? PortfolioNumber, string? AccountId, string? AccountName,
    string? Remark, string CreatedAt, string CreatedByName, NoteAllocationDto[] Allocations, NoteEventDto[] Events,
    string Currency);

/// <param name="DueDate">yyyy-mm-dd.</param>
public record CreateNoteRequest(
    string? PartyId, string? Kind, string? SerialNumber, long Amount, string? DueDate, string? BankName = null,
    string? Drawer = null, string? Guarantor = null, string? Remark = null, AllocationRequest[]? Allocations = null);

public record DepositNotesRequest(string[]? NoteIds, string? AccountId);

/// <param name="AccountId">Collect: where the money went (under collection: the deposit bank by default).
/// Pay: the account it was paid from.</param>
/// <param name="PartyId">Endorse: the supplier it goes to.</param>
public record NoteStepRequest(string? AccountId = null, string? PartyId = null, string? Remark = null);

public record PortfolioDto(
    string Id, string Number, string AccountName, string BranchName, string CreatedAt, string CreatedByName,
    int Count, long Total, string[] Refs, string Currency);

/// <summary>What is due: open notes by when they fall due.</summary>
public record NotesSummaryDto(
    long ReceivableOpen, long ReceivableOverdue, long ReceivableDueWeek, long PayableOpen, long PayableOverdue,
    long PayableDueWeek, string Currency);

// ---- Financial statements (DOMAIN.md §7 step 8) ----

/// <param name="Section">REVENUE, COGS, EXPENSE (income statement) or ASSET, LIABILITY, EQUITY (balance sheet).</param>
/// <param name="GroupName">The account's group under its section (e.g. current assets), if any.</param>
/// <param name="Amount">In the section's natural direction: revenue / liabilities / equity as credits, the rest as debits.</param>
public record FinancialRowDto(string AccountId, string Code, string Name, string Section, string? GroupName, long Amount);

public record IncomeStatementDto(
    string From, string To, FinancialRowDto[] Rows, long Revenue, long Cogs, long GrossProfit, long Expenses,
    long NetProfit, string Currency);

/// <param name="ProfitToDate">Revenue − expenses so far, not yet closed into retained earnings.</param>
public record BalanceSheetDto(
    string AsOf, FinancialRowDto[] Rows, long Assets, long Liabilities, long Equity, long ProfitToDate, string Currency);

// ---- Analytics (DOMAIN.md §7 step 8, ROADMAP §2.6) ----

/// <param name="Month">yyyy-MM.</param>
/// <param name="NetSales">Sales − sales returns, after discounts, before tax.</param>
public record MonthlySalesDto(string Month, long Sales, long Returns, long NetSales, long NetPurchases, int Invoices);

public record TopPartyDto(string PartyId, string Name, long Net, int Documents, double Share);

/// <param name="Collected">Paid on the spot with the invoices (later receipts aren't counted).</param>
/// <param name="QuotesWon">Quotations of the period that became invoices.</param>
public record PerformanceRowDto(
    string Id, string Name, long NetSales, long Profit, int Invoices, int Customers, long AverageInvoice,
    long Returns, long Collected, int Quotes, int QuotesWon, double Share);

public record PerformanceDto(
    string By, string From, string To, PerformanceRowDto[] Rows, long NetSales, long Profit, int Invoices,
    string Currency);

public record ItemMoveDto(string ProductId, string Sku, string Name, int QuantityOut, int QuantityIn, long SalesValue);

/// <param name="LastSale">When it last sold (any time), or null if never.</param>
public record DeadItemDto(string ProductId, string Sku, string Name, int Stock, long StockValue, string? LastSale);

public record ItemMovementDto(string From, string To, ItemMoveDto[] TopMovers, DeadItemDto[] DeadStock, string Currency);

// ---- Admin & close: activity log, aging, year-end close ----

public record AuditEntryDto(
    string Id, string ActorId, string ActorName, string Action, string Resource, string? ResourceId,
    string? BranchName, string? Ip, string CreatedAt);

/// <summary>What a party owes (customers) or is owed (suppliers), by how old the open invoices are.</summary>
/// <param name="OnAccount">The party's balance not tied to an open invoice (opening balances, payments on account…).</param>
public record AgingRowDto(
    string PartyId, string Name, long Current, long Days31To60, long Days61To90, long Over90, long Total,
    long Balance, long OnAccount);

public record AgingDto(
    string Side, AgingRowDto[] Rows, long Current, long Days31To60, long Days61To90, long Over90, long Total,
    string Currency);

public record CloseYearRequest(int Year);

/// <param name="NetProfit">The year's revenue − expenses moved into retained earnings.</param>
public record ClosedYearDto(int Year, string EntryId, long NetProfit, string ClosedAt, string ClosedByName);

// ---- Backups ----

public record DownloadBackupRequest(string? Passphrase);

public record BackupFileDto(string Name, long Size, string CreatedAt);

/// <param name="Automatic">Daily backups to a folder on the server are on.</param>
/// <param name="Encrypted">The automatic backups are encrypted (a passphrase is set on the server).</param>
public record BackupStatusDto(
    bool Automatic, string? Folder, int Hour, int Keep, bool Encrypted, string? LastRunAt, string? LastFile,
    string? LastError, string? NextRunAt, BackupFileDto[] Files);


// ---- Payroll & attendance (DOMAIN.md §2.9) ----

/// <param name="Start">"HH:mm"; an End before it runs past midnight.</param>
/// <param name="DaysOff">Weekly days off (0 = Sunday … 6 = Saturday).</param>
public record ShiftDto(string Id, string Name, string Start, string End, int GraceMinutes, int[] DaysOff, bool IsActive,
    int Minutes);

public record SaveShiftRequest(string? Name, string? Start, string? End, int? GraceMinutes, int[]? DaysOff, bool? IsActive);

public record EmployeeDto(
    string Id, string Code, string Name, string BranchId, string BranchName, string? JobTitle, string? Phone,
    string? NationalId, string HireDate, long MonthlySalary, string? ShiftId, string? ShiftName, string? DeviceUserId,
    string? StaffId, string? StaffName, long AdvanceBalance, bool IsActive);

/// <summary>Any field left null is unchanged (on create: the defaults). "" clears an optional text.</summary>
public record SaveEmployeeRequest(
    string? Name = null, string? BranchId = null, string? JobTitle = null, string? Phone = null,
    string? NationalId = null, string? HireDate = null, long? MonthlySalary = null, string? ShiftId = null,
    string? DeviceUserId = null, string? StaffId = null, bool? IsActive = null);

public record PayrollSettingsDto(int DayBasis, int OvertimePercent, bool MissingAttendanceIsAbsent);

public record AttendanceRowDto(
    string EmployeeId, string Code, string Name, string BranchName, string? ShiftName, bool DayOff, string? Status,
    string? CheckIn, string? CheckOut, int LateMinutes, int OvertimeMinutes, string? Source, string? Notes, bool Locked);

public record AttendanceSheetDto(string Date, AttendanceRowDto[] Rows);

/// <param name="Status">PRESENT, ABSENT, LEAVE, UNPAID_LEAVE or HOLIDAY; null removes the day's record.</param>
public record SaveAttendanceRow(string EmployeeId, string? Status, string? CheckIn = null, string? CheckOut = null,
    string? Notes = null);

public record SaveAttendanceRequest(string Date, SaveAttendanceRow[] Rows);

public record ImportAttendanceRequest(string Text);

/// <param name="Locked">Days skipped because their month's payroll is already posted.</param>
public record ImportAttendanceResultDto(int Punches, int Days, int Skipped, int Locked, string[] UnknownIds);

public record AdjustmentDto(
    string Id, string EmployeeId, string EmployeeName, int Year, int Month, string Kind, long Amount, string Reason,
    bool Posted, string CreatedByName, string CreatedAt);

public record CreateAdjustmentRequest(string EmployeeId, int Year, int Month, string Kind, long Amount, string? Reason = null);

public record AdvanceDto(
    string Id, string Number, string EmployeeId, string EmployeeName, long Amount, long Installment, long Remaining,
    string Status, string AccountName, string? Notes, string CreatedByName, string CreatedAt);

/// <param name="Installment">Recovered at most this much a month; none = all of it next payroll.</param>
/// <param name="AccountId">Paid from this money account; none = the branch's cash box.</param>
public record CreateAdvanceRequest(string EmployeeId, long Amount, long? Installment = null, string? AccountId = null,
    string? Notes = null);

public record PayrollLineDto(
    string Id, string EmployeeId, string EmployeeCode, string EmployeeName, long MonthlySalary, int EmployedDays,
    int WorkDays, int AbsentDays, int LateMinutes, int OvertimeMinutes, long Basic, long OvertimePay, long Bonuses,
    long AbsenceDeduction, long LateDeduction, long Deductions, long Earned, long AdvanceRecovery, long Net,
    long PaidAmount, string? PaidAt);

public record PayrollRunDto(
    string Id, string Number, int Year, int Month, string? BranchId, string? BranchName, string Status, long Earned,
    long Recovered, long Net, long Paid, int Employees, string CreatedByName, string CreatedAt, string? PostedAt,
    string? PostedByName, PayrollLineDto[] Lines, string Currency);

/// <param name="BranchId">One branch's employees; none = the whole company.</param>
public record CreatePayrollRunRequest(int Year, int Month, string? BranchId = null);

/// <param name="EmployeeIds">Pay only these; none = everyone still unpaid.</param>
public record PayPayrollRequest(string? AccountId = null, string[]? EmployeeIds = null);
