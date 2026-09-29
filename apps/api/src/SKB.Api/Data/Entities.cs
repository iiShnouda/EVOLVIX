using SKB.Api.Domain;

namespace SKB.Api.Data;

// Money is stored as integer MINOR UNITS (piastres) in bigint columns — never floats.
// All DateTimes are UTC (timestamptz).

public class Branch : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    public string Code { get; set; } = "";
    public string? Location { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<Staff> Staff { get; set; } = new();
    public List<SalesDocument> Documents { get; set; } = new();
    public List<Warehouse> Warehouses { get; set; } = new();
}

/// <summary>
/// A store room (مخزن) that physically holds stock. Belongs to one branch; a branch may have
/// several. Exactly one active warehouse per branch is the branch's default, used when a document
/// doesn't name one. A warehouse can only be deactivated once it holds no stock.
/// </summary>
public class Warehouse : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    /// <summary>Short unique code, e.g. "MAIN-1".</summary>
    public string Code { get; set; } = "";
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    /// <summary>STORE, or the single system TRANSIT warehouse that holds goods on the way.</summary>
    public WarehouseKind Kind { get; set; } = WarehouseKind.STORE;
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Weighted-average cost of one product in one **cost pool** (DOMAIN.md §2.4, owner decision
/// 2026-09-29: cost is per branch). Every store warehouse of a branch shares the branch's pool
/// (<c>PoolId</c> = the BranchId); the system transit warehouse is its own pool (<c>PoolId</c> =
/// that warehouse's Id), so goods on the way keep exactly the cost they left with. A pool's
/// quantity is the sum of its warehouses' balances.
/// </summary>
public class StockCost
{
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    /// <summary>A BranchId, or the transit warehouse's Id.</summary>
    public Guid PoolId { get; set; }
    /// <summary>Weighted-average unit cost in this pool (minor units).</summary>
    public long AvgCost { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Transfer permit (إذن تحويل): goods moving from one warehouse to another, possibly across
/// branches. Sending moves them from the source into the system TRANSIT warehouse; receiving moves
/// them on into the destination. They stay company stock the whole time, at the same average cost.
/// </summary>
public class StockTransfer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>TRF-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public TransferStatus Status { get; set; } = TransferStatus.SENT;
    public Guid FromWarehouseId { get; set; }
    public Warehouse? FromWarehouse { get; set; }
    public Guid ToWarehouseId { get; set; }
    public Warehouse? ToWarehouse { get; set; }
    public string? Notes { get; set; }

    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? ReceivedById { get; set; }
    public Staff? ReceivedBy { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public Guid? CancelledById { get; set; }
    public Staff? CancelledBy { get; set; }
    public DateTime? CancelledAt { get; set; }

    public List<StockTransferLine> Lines { get; set; } = new();
}

public class StockTransferLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int LineNo { get; set; }
    public Guid TransferId { get; set; }
    public StockTransfer? Transfer { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    /// <summary>Average cost when sent (minor units): the value of the goods on the way.</summary>
    public long UnitCost { get; set; }
}

/// <summary>
/// Quantity of one product held in one warehouse. Always changed together with a
/// <see cref="StockMovement"/> in the same transaction, under the product's row lock, so
/// <c>Product.StockOnHand = Σ StockBalance.Quantity = Σ StockMovement.Quantity</c> for every product.
/// </summary>
public class StockBalance
{
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid WarehouseId { get; set; }
    public Warehouse? Warehouse { get; set; }
    public int Quantity { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
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

    /// <summary>Permissions this person has on top of their role's.</summary>
    public List<string> GrantedPermissions { get; set; } = new();
    /// <summary>Permissions of their role this person does not get.</summary>
    public List<string> RevokedPermissions { get; set; } = new();

    public List<Session> Sessions { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The permissions a role gives, as the owner set them (owner decision 2026-09-29: roles bundle
/// permissions, and every action has its own). A role without a row uses the default in
/// <c>RolePermissions</c>. The OWNER role always has every permission and has no row.
/// </summary>
public class RolePermissionSet
{
    public Role Role { get; set; }
    public List<string> Permissions { get; set; } = new();
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
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

    /// <summary>Price level a sales invoice to this customer starts with (null = the default SALE level).</summary>
    public Guid? SalesPriceLevelId { get; set; }
    public PriceLevel? SalesPriceLevel { get; set; }
    /// <summary>Price level a purchase invoice from this supplier starts with (null = the default PURCHASE level).</summary>
    public Guid? PurchasePriceLevelId { get; set; }
    public PriceLevel? PurchasePriceLevel { get; set; }

    public List<SalesDocument> Documents { get; set; } = new();
}

public class Category : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    public List<Product> Products { get; set; } = new();
}

/// <summary>
/// A unit of measure (وحدة): piece, carton, dozen, kg… A company-wide list, named in both languages.
/// Items say which units they come in, and how many base units each holds (<see cref="ItemUnit"/>).
/// </summary>
public class Unit : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One unit an item is bought and sold in (old <c>itemWehda</c>). Every item has exactly one
/// <b>base unit</b> with <c>Factor</c> 1 — the smallest unit, in which stock and every movement are
/// counted. A larger unit holds <c>Factor</c> base units (carton = 24). Each unit may carry its own
/// barcode (unique across all items) and its own prices.
/// </summary>
public class ItemUnit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid UnitId { get; set; }
    public Unit? Unit { get; set; }
    /// <summary>Base units in one of this unit; 1 for the base unit.</summary>
    public int Factor { get; set; } = 1;
    public string? Barcode { get; set; }
}

/// <summary>
/// A named price column (مستوى سعر), e.g. the customer price or the supplier price. Rows, so more
/// can be added without a schema change. Each side (sales / purchases) has one default level.
/// </summary>
public class PriceLevel : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    public PriceSide Side { get; set; } = PriceSide.SALE;
    public bool IsDefault { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// An item's own price for one unit at one price level (minor units). Missing prices are worked out
/// by <c>PriceBook</c>: the model's price, then the base unit's price × factor, then the default level.
/// </summary>
public class ItemPrice
{
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid UnitId { get; set; }
    public Guid PriceLevelId { get; set; }
    public PriceLevel? PriceLevel { get; set; }
    public long Price { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A size or a color (مقاس / لون) that item models are made in. Company-wide lists.</summary>
public class VariantOption : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    public VariantKind Kind { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// An item model (موديل), e.g. "Shirt X", made in sizes × colors. Each variant is a normal
/// <see cref="Product"/> with its own SKU, barcode and stock, so every stock rule applies to it
/// unchanged. The model holds what variants share: the category, the units (<see cref="ModelUnit"/>)
/// and default prices (<see cref="ModelPrice"/>) that a variant uses until it is given its own.
/// </summary>
public class ProductModel : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    /// <summary>Short unique code; variant SKUs start with it.</summary>
    public string Code { get; set; } = "";
    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }
    public int ReorderLevel { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ModelUnit> Units { get; set; } = new();
    public List<Product> Variants { get; set; } = new();
}

/// <summary>A unit every variant of a model comes in (the variants' <see cref="ItemUnit"/>s follow it).</summary>
public class ModelUnit
{
    public Guid ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public Guid UnitId { get; set; }
    public Unit? Unit { get; set; }
    public int Factor { get; set; } = 1;
}

/// <summary>The model's price for one unit at one level: what its variants charge unless they have their own.</summary>
public class ModelPrice
{
    public Guid ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public Guid UnitId { get; set; }
    public Guid PriceLevelId { get; set; }
    public long Price { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class Product : ILocalizedName
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string? NameAr { get; set; }
    public string? NameEn { get; set; }
    public string NameSource { get; set; } = "en";
    public string? NameAuto { get; set; }
    public bool NamePending { get; set; }
    /// <summary>
    /// Company-wide average cost (minor units) = total stock value ÷ total quantity, kept in step
    /// with the per-branch pools (<see cref="StockCost"/>). For company-level display; every
    /// posting uses the pool of the warehouse involved.
    /// </summary>
    public long CostPrice { get; set; }
    /// <summary>
    /// The base unit's price at the default sales level (minor units), kept in step with the price
    /// book for list screens. Invoices work prices out through <c>PriceBook</c>.
    /// </summary>
    public long SalePrice { get; set; }
    public string Currency { get; set; } = "EGP";
    /// <summary>Stock in base units, all warehouses.</summary>
    public int StockOnHand { get; set; }
    public int ReorderLevel { get; set; }
    public bool IsActive { get; set; } = true;

    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }

    /// <summary>Set on a variant: its model, and its size and/or color. Its name is composed from them.</summary>
    public Guid? ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public Guid? SizeId { get; set; }
    public VariantOption? Size { get; set; }
    public Guid? ColorId { get; set; }
    public VariantOption? Color { get; set; }

    public List<ItemUnit> Units { get; set; } = new();

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

    /// <summary>The price level the invoice was priced at (customer price, supplier price…).</summary>
    public Guid? PriceLevelId { get; set; }
    public PriceLevel? PriceLevel { get; set; }

    /// <summary>Additions such as a delivery fee (minor units): owed by the party, not revenue or cost.</summary>
    public long AdditionTotal { get; set; }

    /// <summary>The sales rep (مندوب) credited with a sale. No commission (owner, 2026-09-29).</summary>
    public Guid? RepId { get; set; }
    public Staff? Rep { get; set; }

    /// <summary>Invoice-level discounts, taxes and additions, in the order they were applied.</summary>
    public List<DocumentCharge> Charges { get; set; } = new();

    public List<DocumentLine> Lines { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class DocumentLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>1-based position on the document, so it always shows and prints in entry order.</summary>
    public int LineNo { get; set; }
    public string ProductName { get; set; } = "";
    /// <summary>Quantity in base units (what stock moved by) = <c>UnitQuantity × UnitFactor</c>.</summary>
    public int Quantity { get; set; }
    /// <summary>The unit the line was entered in (piece, carton…), with its size at the time.</summary>
    public Guid? UnitId { get; set; }
    public Unit? Unit { get; set; }
    public int UnitFactor { get; set; } = 1;
    /// <summary>Quantity in <see cref="UnitId"/> units, as typed.</summary>
    public int UnitQuantity { get; set; }
    /// <summary>Price of one <see cref="UnitId"/> unit (minor units). Gross = UnitQuantity × UnitPrice = LineTotal + Discount.</summary>
    public long UnitPrice { get; set; }
    public long Discount { get; set; }
    public long LineTotal { get; set; }
    // Cost snapshot per BASE unit at the moment the line was posted (weighted-average cost for a
    // sale; the purchase price for a purchase). Kept on the line so profit reports stay correct
    // for all time even after the product's average cost later moves. LineCost is exact.
    public long UnitCost { get; set; }
    public long LineCost { get; set; }
    public long LineProfit { get; set; }

    /// <summary>Free goods (بونص): no price, but their cost still counts against the invoice's profit.</summary>
    public bool IsBonus { get; set; }

    /// <summary>
    /// This line's share of the invoice-level discounts (minor units). Its net amount is
    /// <c>LineTotal − DocDiscount</c>; on a purchase it also comes off the goods' cost.
    /// </summary>
    public long DocDiscount { get; set; }

    /// <summary>For a return line: the invoice line it reverses (caps the returnable quantity).</summary>
    public Guid? SourceLineId { get; set; }

    /// <summary>Warehouse the goods left from (sale) or arrived into (purchase). Returns reuse it.</summary>
    public Guid? WarehouseId { get; set; }
    public Warehouse? Warehouse { get; set; }

    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
}

/// <summary>
/// One invoice-level charge: a discount, a tax or an addition, with its rule (a rate or a fixed
/// amount) and the amount it came to. See <c>Charges</c> for the order they apply in.
/// </summary>
public class DocumentCharge
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    /// <summary>1-based order on the document.</summary>
    public int Seq { get; set; }
    public ChargeKind Kind { get; set; }
    /// <summary>The rate in basis points (1400 = 14.00%), or null for a fixed amount.</summary>
    public int? RateBp { get; set; }
    /// <summary>The fixed amount typed (minor units), or null for a rate.</summary>
    public long? FixedAmount { get; set; }
    /// <summary>What it came to (minor units, always ≥ 0; discounts are subtracted).</summary>
    public long Amount { get; set; }
    public string? Label { get; set; }
}

/// <summary>
/// One physical stock change for one product in one warehouse. The item card, valuation and
/// movement reports are all built from these rows. Money is minor units.
/// </summary>
public class StockMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    /// <summary>Branch that owns the warehouse (kept for branch-level reporting).</summary>
    public Guid BranchId { get; set; }
    public Guid WarehouseId { get; set; }
    public Warehouse? Warehouse { get; set; }
    public StockMovementType Type { get; set; }
    /// <summary>Signed: positive into stock, negative out of stock.</summary>
    public int Quantity { get; set; }
    /// <summary>Weighted-average unit cost applied to this movement (minor units).</summary>
    public long UnitCost { get; set; }
    /// <summary>Product stock-on-hand after this movement, all warehouses (running balance for the item card).</summary>
    public int BalanceAfter { get; set; }
    /// <summary>Stock of this product in this warehouse after the movement.</summary>
    public int WarehouseBalanceAfter { get; set; }
    /// <summary>Average cost of the movement's cost pool (its branch, or transit) after it (minor units).</summary>
    public long AvgCostAfter { get; set; }
    public Guid? DocumentId { get; set; }
    /// <summary>Human reference (document number) shown on the item card.</summary>
    public string? Reference { get; set; }
    /// <summary>Free-text reason, e.g. why a stocktake adjustment was posted.</summary>
    public string? Note { get; set; }
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
    /// <summary>
    /// The receiving warehouse confirms a transfer before the goods count there (old
    /// chkBoxIsConfermTahwel). Off: a transfer arrives the moment it is sent.
    /// </summary>
    public bool TransfersRequireReceipt { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
