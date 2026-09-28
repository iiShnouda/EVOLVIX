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

public record SalesSummaryDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, long GrandTotal, long PaidAmount, string Currency);

public record DocumentLineDto(
    string Id, string ProductId, string ProductName, int Quantity, long UnitPrice, long Discount, long LineTotal,
    long UnitCost, long LineProfit);

public record SalesDetailDto(
    string Id, string Number, string Type, string Status, string BranchName, string PartyName,
    string StaffName, string IssueDate, string? DueDate, DocumentLineDto[] Lines,
    long Subtotal, long DiscountTotal, long TaxTotal, long GrandTotal, long PaidAmount,
    long CostTotal, long ProfitTotal, string Currency, string? Notes);

// ---- Create requests (server is the authoritative validator; the client mirrors these zod schemas) ----

public record CreateInvoiceLineRequest(string ProductId, int Quantity, long UnitPrice, long Discount = 0);

public record CreateSalesInvoiceRequest(
    string PartyId, CreateInvoiceLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null,
    long PaidAmount = 0, bool OverrideFloor = false);

public record CreatePurchaseLineRequest(string ProductId, int Quantity, long UnitCost);

public record CreatePurchaseInvoiceRequest(
    string PartyId, CreatePurchaseLineRequest[] Lines,
    int? TaxPercent = null, string? Notes = null, string? DueDate = null, long PaidAmount = 0);

public record CompanySettingsDto(
    string CompanyName, string Currency, int DefaultMarkupPercent, int MinMarkupPercent, int DefaultTaxPercent);

// ---- Profitability report (تقارير الربحية) ----

public record ProfitRowDto(
    string Key, string Label, long Revenue, long Cost, long Profit, int Invoices, int Quantity);

public record ProfitReportDto(
    string From, string To, string By, string Currency,
    long Revenue, long Cost, long Profit, int Invoices, ProfitRowDto[] Rows);

public record DashboardDto(
    KpiDto[] Kpis, TrendPointDto[] Trend, ProductDto[] LowStock,
    SalesSummaryDto[] RecentDocuments, string Currency);

public record PaginatedDto<T>(T[] Items, int Total, int Page, int PageSize);

public record PartyDto(
    string Id, string Name, string[] Types, string? Phone, long Balance, string Currency);

public record PresenceEntryDto(
    string UserId, string FullName, string Role, string BranchId, string? CurrentView,
    string ConnectedAt, string LastSeenAt);
