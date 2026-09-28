using SKB.Api.Domain;

namespace SKB.Api.Data;

// Money is stored as integer MINOR UNITS (piastres) in bigint columns — never floats.
// All DateTimes are UTC (timestamptz).

public class Branch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public string? Location { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<Staff> Staff { get; set; } = new();
    public List<SalesDocument> Documents { get; set; } = new();
}

public class Staff
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Role Role { get; set; } = Role.VIEWER;
    public string? Phone { get; set; }
    public bool IsActive { get; set; } = true;

    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }

    public List<Session> Sessions { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Session
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    public string TokenHash { get; set; } = "";
    public byte[] EncryptedToken { get; set; } = Array.Empty<byte>();
    public string? UserAgent { get; set; }
    public string? Ip { get; set; }
    public string? DeviceLabel { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public class AuditEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ActorId { get; set; } = "";
    public string ActorName { get; set; } = "";
    public string Action { get; set; } = "";
    public string Resource { get; set; } = "";
    public string? ResourceId { get; set; }
    public string? BranchId { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Party
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public List<string> Types { get; set; } = new();
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? TaxNumber { get; set; }
    public long Balance { get; set; }
    public string Currency { get; set; } = "EGP";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<SalesDocument> Documents { get; set; } = new();
}

public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public List<Product> Products { get; set; } = new();
}

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "pc";
    public long CostPrice { get; set; }
    public long SalePrice { get; set; }
    public string Currency { get; set; } = "EGP";
    public int StockOnHand { get; set; }
    public int ReorderLevel { get; set; }
    public string? Barcode { get; set; }
    public bool IsActive { get; set; } = true;

    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SalesDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Number { get; set; } = "";
    public DocumentType Type { get; set; }
    public DocumentStatus Status { get; set; } = DocumentStatus.CONFIRMED;
    public DateTime IssueDate { get; set; } = DateTime.UtcNow;
    public DateTime? DueDate { get; set; }
    public long Subtotal { get; set; }
    public long DiscountTotal { get; set; }
    public long TaxTotal { get; set; }
    public long GrandTotal { get; set; }
    public long PaidAmount { get; set; }
    // Cost of goods on this document (sum of line costs) and the profit it earned.
    // ProfitTotal = (Subtotal - DiscountTotal) - CostTotal. Tax is pass-through, not profit.
    public long CostTotal { get; set; }
    public long ProfitTotal { get; set; }
    public string Currency { get; set; } = "EGP";
    public string? Notes { get; set; }

    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public Guid PartyId { get; set; }
    public Party? Party { get; set; }
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }

    /// <summary>
    /// For a return (SALES_RETURN / PURCHASE_RETURN): the invoice it reverses. A return is
    /// always issued against one original invoice so it can never return more than was sold/bought.
    /// </summary>
    public Guid? SourceDocumentId { get; set; }
    public SalesDocument? SourceDocument { get; set; }

    public List<DocumentLine> Lines { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class DocumentLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public long UnitPrice { get; set; }
    public long Discount { get; set; }
    public long LineTotal { get; set; }
    // Cost snapshot at the moment the line was posted (weighted-average cost for a sale;
    // the purchase price for a purchase). Kept on the line so profit reports stay correct
    // for all time even after the product's average cost later moves.
    public long UnitCost { get; set; }
    public long LineCost { get; set; }
    public long LineProfit { get; set; }

    /// <summary>For a return line: the invoice line it reverses (caps the returnable quantity).</summary>
    public Guid? SourceLineId { get; set; }

    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
}

/// <summary>
/// One physical stock change for one product in one store. The item card, valuation and
/// movement reports are all built from these rows. Money is minor units.
/// </summary>
public class StockMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid BranchId { get; set; }
    public StockMovementType Type { get; set; }
    /// <summary>Signed: positive into stock, negative out of stock.</summary>
    public int Quantity { get; set; }
    /// <summary>Weighted-average unit cost applied to this movement (minor units).</summary>
    public long UnitCost { get; set; }
    /// <summary>Product stock-on-hand after this movement (running balance for the item card).</summary>
    public int BalanceAfter { get; set; }
    /// <summary>Product weighted-average cost after this movement (minor units).</summary>
    public long AvgCostAfter { get; set; }
    public Guid? DocumentId { get; set; }
    /// <summary>Human reference (document number) shown on the item card.</summary>
    public string? Reference { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Company-wide settings (single row). Foundation for the Settings / الضبط screen.
/// Costing and the profit-floor rule live here so they are configurable, not hard-coded.
/// </summary>
public class CompanySettings
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CompanyName { get; set; } = "SKB Wholesale";
    /// <summary>ISO country code (e.g. "EG"). Drives suggested currency + VAT.</summary>
    public string Country { get; set; } = "EG";
    /// <summary>Base/reporting currency (ISO 4217, e.g. "EGP").</summary>
    public string Currency { get; set; } = "EGP";
    /// <summary>Suggested markup for a new sales line, e.g. 10 → price = cost + 10%.</summary>
    public int DefaultMarkupPercent { get; set; } = 10;
    /// <summary>
    /// Configurable profit floor. A sale is blocked below cost × (1 + Min/100).
    /// 0 means "never below cost" (the absolute hard floor is always cost regardless).
    /// </summary>
    public int MinMarkupPercent { get; set; } = 0;
    /// <summary>Default sales tax/VAT percent applied to new invoices (0 = none).</summary>
    public int DefaultTaxPercent { get; set; } = 0;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
