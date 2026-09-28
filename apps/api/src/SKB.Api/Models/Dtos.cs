namespace SKB.Api.Models;

// Serialized as camelCase (ASP.NET Core web defaults) to match the existing clients.

public record AuthUserDto(
    string Id, string FullName, string Email, string Role, string BranchId, string[] Permissions);

public record LoginRequest(string Email, string Password, bool RememberDevice = false);

public record LoginResponseDto(AuthUserDto User, string AccessToken);

public record KpiDto(string Key, long Value, bool IsMoney, string? Currency, string Tone, double? DeltaPct);

public record TrendPointDto(string Date, long Sales, long Purchases);

public record ProductDto(
    string Id, string Sku, string Name, string Unit, long CostPrice, long SalePrice,
    string Currency, int StockOnHand, int ReorderLevel, bool IsActive);

/// <param name="SourceNumber">For a return: the number of the invoice it reverses.</param>
public record SalesSummaryDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, long GrandTotal, long PaidAmount, string Currency,
    string? SourceNumber);

/// <param name="ReturnedQuantity">For an invoice line: units already returned against it (0 on a return).</param>
/// <param name="WarehouseName">Warehouse the goods left from / arrived into.</param>
public record DocumentLineDto(
    string Id, string ProductId, string ProductName, int Quantity, long UnitPrice, long Discount, long LineTotal,
    long UnitCost, long LineProfit, int ReturnedQuantity, string? WarehouseId, string? WarehouseName);

/// <param name="SourceDocumentId">For a return: the invoice it reverses.</param>
public record SalesDetailDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, DocumentLineDto[] Lines,
    long Subtotal, long DiscountTotal, long TaxTotal, long GrandTotal, long PaidAmount,
    long CostTotal, long ProfitTotal, string Currency, string? Notes,
    string? SourceDocumentId, string? SourceNumber);

// ---- Create requests (server is the authoritative validator; the client mirrors these zod schemas) ----

// Warehouse: a line may name its own; otherwise the document's WarehouseId; otherwise the
// default warehouse of the user's branch.

public record CreateInvoiceLineRequest(
    string ProductId, int Quantity, long UnitPrice, long Discount = 0, string? WarehouseId = null);

public record CreateSalesInvoiceRequest(
    string PartyId, CreateInvoiceLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null,
    long PaidAmount = 0, bool OverrideFloor = false, string? WarehouseId = null);

public record CreatePurchaseLineRequest(string ProductId, int Quantity, long UnitCost, string? WarehouseId = null);

public record CreatePurchaseInvoiceRequest(
    string PartyId, CreatePurchaseLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null, long PaidAmount = 0,
    string? WarehouseId = null);

/// <summary>One invoice line being returned. Price and cost always come from the original line.</summary>
public record CreateReturnLineRequest(string LineId, int Quantity);

/// <param name="RefundAmount">Cash settled now (minor units); the rest goes on the party's account.</param>
public record CreateReturnRequest(CreateReturnLineRequest[] Lines, long RefundAmount = 0, string? Notes = null);

public record CompanySettingsDto(
    string CompanyName, string Country, string Currency,
    int DefaultMarkupPercent, int MinMarkupPercent, int DefaultTaxPercent);

public record UpdateSettingsRequest(
    string? CompanyName, string? Country, string? Currency,
    int? DefaultMarkupPercent, int? MinMarkupPercent, int? DefaultTaxPercent);

// ---- Profitability report (تقارير الربحية) ----

public record ProfitRowDto(
    string Key, string Label, long Revenue, long Cost, long Profit, int Invoices, int Quantity);

/// <param name="Revenue">Net sales: invoices minus returns, after discount, before tax.</param>
/// <param name="Returns">Value of sales returns in the period (already subtracted from Revenue).</param>
public record ProfitReportDto(
    string From, string To, string By, string Currency,
    long Revenue, long Cost, long Profit, int Invoices, long Returns, ProfitRowDto[] Rows);

// ---- Inventory (Phase 2): stock list, item card, valuation, stocktake ----

/// <param name="AvgCost">Current weighted-average unit cost (minor units).</param>
/// <param name="StockValue">StockOnHand × AvgCost (minor units).</param>
/// <param name="IsLow">On hand has reached the reorder level (الأصناف التي وصلت لحد الطلب).</param>
public record InventoryItemDto(
    string Id, string Sku, string Name, string Unit, string CategoryName,
    int StockOnHand, int ReorderLevel, long AvgCost, long SalePrice, long StockValue, bool IsLow);

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
/// <remarks>By category, item and warehouse. <c>WarehouseId</c> is set when limited to one warehouse.</remarks>
public record ValuationDto(
    string AsOf, string Currency, string? WarehouseId, int Quantity, long Value,
    ValuationRowDto[] Categories, ValuationRowDto[] Items, ValuationRowDto[] Warehouses);

public record StocktakeLineRequest(string ProductId, int CountedQuantity);

/// <summary>Stocktake (الجرد): the counted quantity per item; only lines that differ are posted.</summary>
/// <remarks>Counts one warehouse; none given means the default warehouse of the user's branch.</remarks>
public record StocktakeRequest(StocktakeLineRequest[] Lines, string? Reason = null, string? WarehouseId = null);

/// <param name="ValueChange">Signed total value change (gains − shrinkage), minor units.</param>
public record StocktakeResultDto(
    string Reference, string WarehouseName, int ItemsChanged, long ValueChange, StockMovementDto[] Movements);

// ---- Branches & warehouses ----

/// <param name="ItemCount">Items with stock in this warehouse.</param>
/// <param name="Value">Quantity × current average cost, minor units.</param>
public record WarehouseDto(
    string Id, string Code, string Name, string BranchId, string BranchName,
    bool IsDefault, bool IsActive, int ItemCount, int Quantity, long Value);

public record BranchDto(
    string Id, string Code, string Name, string? Location, bool IsActive, WarehouseDto[] Warehouses);

public record CreateWarehouseRequest(string BranchId, string Name, string? Code = null, bool IsDefault = false);

/// <summary>Any field left null is unchanged.</summary>
public record UpdateWarehouseRequest(string? Name = null, bool? IsActive = null, bool? IsDefault = null);

public record DashboardDto(
    KpiDto[] Kpis, TrendPointDto[] Trend, ProductDto[] LowStock,
    SalesSummaryDto[] RecentDocuments, string Currency);

public record PaginatedDto<T>(T[] Items, int Total, int Page, int PageSize);

public record PartyDto(
    string Id, string Name, string[] Types, string? Phone, long Balance, string Currency);

public record PresenceEntryDto(
    string UserId, string FullName, string Role, string BranchId, string? CurrentView,
    string ConnectedAt, string LastSeenAt);
