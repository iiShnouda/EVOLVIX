namespace SKB.Api.Models;

// Serialized as camelCase (ASP.NET Core web defaults) to match the existing clients.

public record AuthUserDto(
    string Id, string FullName, string Email, string Role, string BranchId, string[] Permissions);

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
    string? ModelId, string? SizeName, string? ColorName, string? MatchedUnitId);

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
    string? UnitId, string UnitName, int UnitFactor, int UnitQuantity, long LineCost, string BaseUnitName);

/// <param name="SourceDocumentId">For a return: the invoice it reverses.</param>
/// <param name="PriceLevelName">The price level the invoice was priced at.</param>
public record SalesDetailDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, DocumentLineDto[] Lines,
    long Subtotal, long DiscountTotal, long TaxTotal, long GrandTotal, long PaidAmount,
    long CostTotal, long ProfitTotal, string Currency, string? Notes,
    string? SourceDocumentId, string? SourceNumber, string? PriceLevelId, string? PriceLevelName);

// ---- Create requests (server is the authoritative validator; the client mirrors these zod schemas) ----

// Warehouse: a line may name its own; otherwise the document's WarehouseId; otherwise the
// default warehouse of the user's branch.
// Unit: a line may name one of the item's units (carton…); Quantity and UnitPrice/UnitCost are then
// per that unit. None = the base unit.
// Price level: none = the party's own level, else the side's default. Without the change-price
// permission a line's price must be the level's price (or, for an unpriced item, the suggested one).

public record CreateInvoiceLineRequest(
    string ProductId, int Quantity, long UnitPrice, long Discount = 0, string? WarehouseId = null,
    string? UnitId = null);

public record CreateSalesInvoiceRequest(
    string PartyId, CreateInvoiceLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null,
    long PaidAmount = 0, bool OverrideFloor = false, string? WarehouseId = null, string? PriceLevelId = null);

public record CreatePurchaseLineRequest(
    string ProductId, int Quantity, long UnitCost, string? WarehouseId = null, string? UnitId = null);

public record CreatePurchaseInvoiceRequest(
    string PartyId, CreatePurchaseLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null, long PaidAmount = 0,
    string? WarehouseId = null, string? PriceLevelId = null);

/// <summary>One invoice line being returned. Price and cost always come from the original line.</summary>
public record CreateReturnLineRequest(string LineId, int Quantity);

/// <param name="RefundAmount">Cash settled now (minor units); the rest goes on the party's account.</param>
public record CreateReturnRequest(CreateReturnLineRequest[] Lines, long RefundAmount = 0, string? Notes = null);

public record CompanySettingsDto(
    string CompanyName, string Country, string Currency,
    int DefaultMarkupPercent, int MinMarkupPercent, int DefaultTaxPercent, bool TransfersRequireReceipt);

public record UpdateSettingsRequest(
    string? CompanyName, string? Country, string? Currency,
    int? DefaultMarkupPercent, int? MinMarkupPercent, int? DefaultTaxPercent,
    bool? TransfersRequireReceipt = null);

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
/// <param name="Names">Both languages of the name, for the edit form.</param>
public record WarehouseDto(
    string Id, string Code, string Name, string BranchId, string BranchName, string Kind,
    bool IsDefault, bool IsActive, int ItemCount, int Quantity, long Value, LocalizedNameDto Names);

/// <summary>
/// A name in both languages. <c>Source</c> is the language it was typed in; <c>Auto</c> the side
/// filled by AI (null when people typed both); <c>Pending</c> while the other side awaits translation.
/// </summary>
public record LocalizedNameDto(string? Ar, string? En, string Source, string? Auto, bool Pending);

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
    string Id, string Code, string Name, string? Location, bool IsActive, WarehouseDto[] Warehouses,
    LocalizedNameDto Names);

// Names: send the language(s) typed. On create, one is enough — the other is translated by AI.
// A plain `Name` (older clients) counts as typed in the request's language.

public record CreateWarehouseRequest(
    string BranchId, string? NameAr = null, string? NameEn = null, string? Code = null, bool IsDefault = false,
    string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateWarehouseRequest(
    string? NameAr = null, string? NameEn = null, bool? IsActive = null, bool? IsDefault = null, string? Name = null);

/// <summary>A new branch also gets its default store.</summary>
public record CreateBranchRequest(
    string? NameAr = null, string? NameEn = null, string? Code = null, string? Location = null, string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateBranchRequest(string? NameAr = null, string? NameEn = null, string? Location = null, string? Name = null);

/// <summary>AI translation of names: whether it is set up, and what is waiting.</summary>
public record TranslationStatusDto(bool Configured, int Pending, string? LastError, string? LastSuccessAt);

public record DashboardDto(
    KpiDto[] Kpis, TrendPointDto[] Trend, ProductDto[] LowStock,
    SalesSummaryDto[] RecentDocuments, string Currency);

public record PaginatedDto<T>(T[] Items, int Total, int Page, int PageSize);

/// <param name="SalesPriceLevelId">The customer's own price level (null = the default sales level).</param>
/// <param name="PurchasePriceLevelId">The supplier's own price level (null = the default purchase level).</param>
public record PartyDto(
    string Id, string Name, string[] Types, string? Phone, long Balance, string Currency,
    string? SalesPriceLevelId, string? PurchasePriceLevelId);

/// <summary>A party's own price levels. Null leaves a side unchanged; "" clears it (back to the default).</summary>
public record SetPartyPriceLevelsRequest(string? SalesPriceLevelId = null, string? PurchasePriceLevelId = null);

// ---- Catalog (الأصناف): units, categories, price levels, sizes & colors, items, models ----

/// <param name="ItemCount">Items that come in this unit / belong to this category.</param>
public record UnitDto(string Id, string Name, bool IsActive, int ItemCount, LocalizedNameDto Names);

public record CategoryDto(string Id, string Name, int ItemCount, LocalizedNameDto Names);

/// <param name="Side">SALE or PURCHASE.</param>
public record PriceLevelDto(
    string Id, string Name, string Side, bool IsDefault, int SortOrder, bool IsActive, LocalizedNameDto Names);

/// <param name="Kind">SIZE or COLOR.</param>
public record VariantOptionDto(
    string Id, string Kind, string Name, int SortOrder, bool IsActive, LocalizedNameDto Names);

/// <summary>A new unit / category / size / color: its name in the language typed (the other is translated).</summary>
public record CreateNamedRequest(string? NameAr = null, string? NameEn = null, string? Name = null);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateNamedRequest(
    string? NameAr = null, string? NameEn = null, string? Name = null, bool? IsActive = null, int? SortOrder = null);

public record CreatePriceLevelRequest(string? Side, string? NameAr = null, string? NameEn = null, string? Name = null);

public record UpdatePriceLevelRequest(
    string? NameAr = null, string? NameEn = null, string? Name = null,
    bool? IsActive = null, bool? IsDefault = null, int? SortOrder = null);

public record CreateVariantOptionRequest(string? Kind, string? NameAr = null, string? NameEn = null, string? Name = null);

/// <summary>One unit of an item: which unit, how many base units it holds (1 = the base unit), its barcode.</summary>
public record ItemUnitRequest(string? UnitId, int Factor, string? Barcode = null);

/// <summary>A price for one unit at one level (minor units). Null clears the item's own price (inherit again).</summary>
public record PriceRequest(string? UnitId, string? PriceLevelId, long? Price);

public record CreateProductRequest(
    string? CategoryId, ItemUnitRequest[]? Units,
    string? NameAr = null, string? NameEn = null, string? Name = null, string? Sku = null,
    int ReorderLevel = 0, PriceRequest[]? Prices = null);

/// <summary>
/// Any field left null is unchanged. For a variant only SKU, reorder level, active and the units'
/// barcodes can change here — names, category and units follow its model.
/// </summary>
public record UpdateProductRequest(
    string? NameAr = null, string? NameEn = null, string? Name = null, string? Sku = null,
    string? CategoryId = null, int? ReorderLevel = null, bool? IsActive = null, ItemUnitRequest[]? Units = null);

public record UpdatePricesRequest(PriceRequest[]? Prices);

/// <param name="Own">The item's (or model's) own price; null when it inherits.</param>
/// <param name="Effective">What it charges at that level, however it was worked out (null = unpriced).</param>
public record PriceCellDto(string UnitId, string PriceLevelId, long? Own, long? Effective, string? Source);

public record ItemUnitDto(string UnitId, string Name, int Factor, string? Barcode);

/// <summary>An item for the item editor, with its units and every unit × level price.</summary>
/// <param name="HasMovements">Stock has moved: the base unit can no longer change.</param>
public record ProductDetailDto(
    string Id, string Sku, string Name, LocalizedNameDto Names, string CategoryId, string CategoryName,
    int ReorderLevel, bool IsActive, int StockOnHand, long CostPrice, bool HasMovements,
    string? ModelId, string? ModelName, string? SizeId, string? SizeName, string? ColorId, string? ColorName,
    ItemUnitDto[] Units, PriceCellDto[] Prices, string Currency);

public record ModelSummaryDto(
    string Id, string Code, string Name, string CategoryName, int Variants, int StockOnHand, bool IsActive);

/// <param name="OwnPrices">The variant has prices of its own (the rest come from the model).</param>
public record ModelVariantDto(
    string ProductId, string Sku, string Name, string? SizeId, string? ColorId, int StockOnHand,
    bool IsActive, string? Barcode, bool OwnPrices, long SalePrice);

public record ModelDetailDto(
    string Id, string Code, string Name, LocalizedNameDto Names, string CategoryId, string CategoryName,
    int ReorderLevel, bool IsActive, bool HasMovements, ItemUnitDto[] Units, PriceCellDto[] Prices,
    VariantOptionDto[] Sizes, VariantOptionDto[] Colors, ModelVariantDto[] Variants, string Currency);

/// <summary>A new model: its variants are made for every size × color given (one list may be empty).</summary>
public record CreateModelRequest(
    string? CategoryId, ItemUnitRequest[]? Units, string[]? SizeIds, string[]? ColorIds,
    string? NameAr = null, string? NameEn = null, string? Name = null, string? Code = null,
    int ReorderLevel = 0, PriceRequest[]? Prices = null);

/// <summary>
/// Any field left null is unchanged. New sizes / colors add the missing variants; units apply to
/// every variant (a variant's barcodes stay).
/// </summary>
public record UpdateModelRequest(
    string? NameAr = null, string? NameEn = null, string? Name = null, string? CategoryId = null,
    int? ReorderLevel = null, bool? IsActive = null, string[]? AddSizeIds = null, string[]? AddColorIds = null,
    ItemUnitRequest[]? Units = null);

public record PresenceEntryDto(
    string UserId, string FullName, string Role, string BranchId, string? CurrentView,
    string ConnectedAt, string LastSeenAt);
