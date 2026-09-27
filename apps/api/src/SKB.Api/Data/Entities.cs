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
    public string Currency { get; set; } = "EGP";
    public string? Notes { get; set; }

    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public Guid PartyId { get; set; }
    public Party? Party { get; set; }
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }

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

    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
}
