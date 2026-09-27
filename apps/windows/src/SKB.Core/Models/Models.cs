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
    public string Currency { get; set; } = "EGP";
    public string? Notes { get; set; }
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
    public List<string> Types { get; set; } = new();
    public string? Phone { get; set; }
    public long Balance { get; set; }
    public string Currency { get; set; } = "EGP";
}
