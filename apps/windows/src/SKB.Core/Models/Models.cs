namespace SKB.Core.Models;

// These mirror the server's JSON (camelCase). The API client deserializes with
// PropertyNameCaseInsensitive = true, so PascalCase properties bind to camelCase JSON.
// Money values are integers in MINOR UNITS (piastres) — never floats.

public sealed class AuthUser
{
    public string Id { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "VIEWER";
    public string BranchId { get; set; } = "";
    public List<string> Permissions { get; set; } = new();

    public bool Can(string permission) => Permissions.Contains(permission);
}

public sealed class LoginResponse
{
    public AuthUser User { get; set; } = new();
    public string AccessToken { get; set; } = "";
}

public sealed class KpiValue
{
    public string Key { get; set; } = "";
    public long Value { get; set; }
    public bool IsMoney { get; set; }
    public string? Currency { get; set; }
    public double? DeltaPct { get; set; }
    public string Tone { get; set; } = "neutral";
}

public sealed class TrendPoint
{
    public string Date { get; set; } = "";
    public long Sales { get; set; }
    public long Purchases { get; set; }
}

public sealed class Product
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "pc";
    public long CostPrice { get; set; }
    public long SalePrice { get; set; }
    public string Currency { get; set; } = "EGP";
    public int StockOnHand { get; set; }
    public int ReorderLevel { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class SalesDocumentSummary
{
    public string Id { get; set; } = "";
    public string Number { get; set; } = "";
    public string Type { get; set; } = "SALES_INVOICE";
    public string Status { get; set; } = "CONFIRMED";
    public string BranchName { get; set; } = "";
    public string PartyName { get; set; } = "";
    public string StaffName { get; set; } = "";
    public string IssueDate { get; set; } = "";
    public string? DueDate { get; set; }
    public long GrandTotal { get; set; }
    public long PaidAmount { get; set; }
    public string Currency { get; set; } = "EGP";
    // For a return (SALES_RETURN / PURCHASE_RETURN): the invoice number it reverses.
    public string? SourceNumber { get; set; }
}

public sealed class DocumentLine
{
    public string Id { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public long UnitPrice { get; set; }
    public long Discount { get; set; }
    public long LineTotal { get; set; }
    // Cost/profit snapshot (weighted-average COGS), mirrors the API contract.
    public long UnitCost { get; set; }
    public long LineProfit { get; set; }
    // On an invoice line: units already returned against it.
    public int ReturnedQuantity { get; set; }
    // Warehouse the goods left from (sale) or arrived into (purchase).
    public string? WarehouseId { get; set; }
    public string? WarehouseName { get; set; }
}

public sealed class SalesDocument
{
    public string Id { get; set; } = "";
    public string Number { get; set; } = "";
    public string Type { get; set; } = "SALES_INVOICE";
    public string Status { get; set; } = "CONFIRMED";
    public string BranchName { get; set; } = "";
    public string PartyName { get; set; } = "";
    public string StaffName { get; set; } = "";
    public string IssueDate { get; set; } = "";
    public string? DueDate { get; set; }
    public List<DocumentLine> Lines { get; set; } = new();
    public long Subtotal { get; set; }
    public long DiscountTotal { get; set; }
    public long TaxTotal { get; set; }
    public long GrandTotal { get; set; }
    public long PaidAmount { get; set; }
    // Cost of goods and profit on the document, mirrors the API contract.
    public long CostTotal { get; set; }
    public long ProfitTotal { get; set; }
    public string Currency { get; set; } = "EGP";
    public string? Notes { get; set; }
    // For a return: the invoice it reverses.
    public string? SourceDocumentId { get; set; }
    public string? SourceNumber { get; set; }
}

public sealed class DashboardData
{
    public List<KpiValue> Kpis { get; set; } = new();
    public List<TrendPoint> Trend { get; set; } = new();
    public List<Product> LowStock { get; set; } = new();
    public List<SalesDocumentSummary> RecentDocuments { get; set; } = new();
    public string Currency { get; set; } = "EGP";
}

public sealed class Paginated<T>
{
    public List<T> Items { get; set; } = new();
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
}

public sealed class PartyDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>CUSTOMER, SUPPLIER and/or CARRIER (a factory is a supplier).</summary>
    public List<string> Types { get; set; } = new();
    public string? Phone { get; set; }
    public List<string> OtherPhones { get; set; } = new();
    /// <summary>Factory owner (supplier) or person in charge (customer).</summary>
    public string? ContactName { get; set; }
    /// <summary>Main address; for a supplier, the factory's address.</summary>
    public string? Address { get; set; }
    public string? ShippingAddress { get; set; }
    public string? Notes { get; set; }
    public long Balance { get; set; }
    public string Currency { get; set; } = "EGP";
}

// ---------------------------------------------------------------------------
// Inventory depth (Phase 2): stock list, item card, valuation, stocktake.
// ---------------------------------------------------------------------------

public sealed class InventoryItem
{
    public string Id { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";
    public string CategoryName { get; set; } = "";
    public int StockOnHand { get; set; }
    public int ReorderLevel { get; set; }
    public long AvgCost { get; set; }
    public long SalePrice { get; set; }
    public long StockValue { get; set; }
    public bool IsLow { get; set; }
}

public sealed class InventoryList
{
    public List<InventoryItem> Items { get; set; } = new();
    // Value of all active stock, regardless of the list filter.
    public long TotalValue { get; set; }
    public int TotalItems { get; set; }
    public int LowStockCount { get; set; }
    public string Currency { get; set; } = "EGP";
}

public sealed class StockMovement
{
    public string Id { get; set; } = "";
    public string Date { get; set; } = "";
    public string Type { get; set; } = "";
    public string BranchName { get; set; } = "";
    public string WarehouseId { get; set; } = "";
    public string WarehouseName { get; set; } = "";
    public string? Reference { get; set; }
    public string? DocumentId { get; set; }
    public string? DocumentType { get; set; }
    public int QuantityIn { get; set; }
    public int QuantityOut { get; set; }
    public int Balance { get; set; }
    public long UnitCost { get; set; }
    public long AvgCostAfter { get; set; }
    public string? Note { get; set; }
}

// Item card (كارت الصنف): opening, movements with running balance, closing.
public sealed class ItemCard
{
    public InventoryItem Item { get; set; } = new();
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    // Set when the card is limited to one warehouse.
    public string? WarehouseId { get; set; }
    public int OpeningBalance { get; set; }
    public long OpeningValue { get; set; }
    public int TotalIn { get; set; }
    public int TotalOut { get; set; }
    public int ClosingBalance { get; set; }
    public long ClosingValue { get; set; }
    public List<StockMovement> Movements { get; set; } = new();
    // Today's quantity of the item in each warehouse that holds it.
    public List<WarehouseStock> Stock { get; set; } = new();
    public string Currency { get; set; } = "EGP";
}

public sealed class WarehouseStock
{
    public string WarehouseId { get; set; } = "";
    public string Name { get; set; } = "";
    public string BranchName { get; set; } = "";
    public int Quantity { get; set; }
    public long Value { get; set; }
}

public sealed class ValuationRow
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public int Quantity { get; set; }
    public long Value { get; set; }
}

// Stock valuation (تقييم المخزن) at the end of AsOf.
public sealed class Valuation
{
    public string AsOf { get; set; } = "";
    public string Currency { get; set; } = "EGP";
    // Set when the valuation is limited to one warehouse.
    public string? WarehouseId { get; set; }
    public int Quantity { get; set; }
    public long Value { get; set; }
    public List<ValuationRow> Categories { get; set; } = new();
    public List<ValuationRow> Items { get; set; } = new();
    public List<ValuationRow> Warehouses { get; set; } = new();
}

public sealed class StocktakeResult
{
    public string Reference { get; set; } = "";
    public string WarehouseName { get; set; } = "";
    public int ItemsChanged { get; set; }
    // Signed total value change (gains − shrinkage), minor units.
    public long ValueChange { get; set; }
    public List<StockMovement> Movements { get; set; } = new();
}

// ---------------------------------------------------------------------------
// Branches & warehouses (الفروع والمخازن)
// ---------------------------------------------------------------------------

public sealed class Warehouse
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string BranchId { get; set; } = "";
    public string BranchName { get; set; } = "";
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public int ItemCount { get; set; }
    public int Quantity { get; set; }
    public long Value { get; set; }
}

public sealed class BranchWithWarehouses
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Location { get; set; }
    public bool IsActive { get; set; } = true;
    public List<Warehouse> Warehouses { get; set; } = new();
}
