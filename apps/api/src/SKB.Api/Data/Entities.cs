using SKB.Api.Domain;

namespace SKB.Api.Data;

// Money is stored as integer MINOR UNITS (piastres) in bigint columns — never floats.
// All DateTimes are UTC (timestamptz).

public class Branch : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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
public class Warehouse : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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

    // Access (DOMAIN.md §2.1): the branches, warehouses and money accounts they may use.
    /// <summary>Every branch (true), only theirs and <see cref="BranchIds"/> (false), or as their role says (null).</summary>
    public bool? AllBranches { get; set; }
    /// <summary>Branches they also work in, besides their own.</summary>
    public List<Guid> BranchIds { get; set; } = new();
    /// <summary>Only these warehouses (none = every warehouse in their branches).</summary>
    public List<Guid> WarehouseIds { get; set; } = new();
    /// <summary>Only these cash boxes, banks and wallets (none = every one in their branches).</summary>
    public List<Guid> MoneyAccountIds { get; set; } = new();

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
    public string? Address { get; set; }
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

public class Category : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public List<Product> Products { get; set; } = new();
}

/// <summary>
/// A unit of measure (وحدة): piece, carton, dozen, kg… A company-wide list.
/// Items say which units they come in, and how many base units each holds (<see cref="ItemUnit"/>).
/// </summary>
public class Unit : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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
public class PriceLevel : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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
public class VariantOption : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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
public class ProductModel : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
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

public class Product : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
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

    /// <summary>How the goods reach the customer (a sale). Pickup unless chosen.</summary>
    public DeliveryMethod DeliveryMethod { get; set; } = DeliveryMethod.PICKUP;
    /// <summary>Where the delivery stands; null for pickup.</summary>
    public DeliveryStatus? DeliveryStatus { get; set; }
    public string? DeliveryAddress { get; set; }
    /// <summary>Our driver, for own delivery.</summary>
    public Guid? DriverId { get; set; }
    public Staff? Driver { get; set; }
    /// <summary>The shipping company, for delivery by carrier (a party with the CARRIER role).</summary>
    public Guid? CarrierId { get; set; }
    public Party? Carrier { get; set; }
    /// <summary>The money account the paid-now amount (or a return's refund) went into or out of.</summary>
    public Guid? PaidAccountId { get; set; }
    public MoneyAccount? PaidAccount { get; set; }

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
/// A parcel handed to a shipping company (بوليصة الشحن), carrying one or more sales invoices of one
/// customer. With cash on delivery (<see cref="CodAmount"/> &gt; 0) the carrier collects from the
/// customer: when it is delivered the customer's debt moves to the carrier, and a
/// <see cref="CarrierSettlement"/> later clears it, net of the carrier's fees.
/// </summary>
public class Shipment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>SHP-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    /// <summary>The carrier's own tracking / waybill number.</summary>
    public string? WaybillNo { get; set; }
    public ShipmentStatus Status { get; set; } = ShipmentStatus.CREATED;
    public Guid CarrierId { get; set; }
    public Party? Carrier { get; set; }
    /// <summary>The customer the parcel goes to.</summary>
    public Guid PartyId { get; set; }
    public Party? Party { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    /// <summary>Cash the carrier collects on delivery (minor units); 0 when prepaid.</summary>
    public long CodAmount { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PickedUpAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    /// <summary>The settlement that cleared its cash on delivery.</summary>
    public Guid? SettlementId { get; set; }
    public CarrierSettlement? Settlement { get; set; }
    public List<ShipmentInvoice> Invoices { get; set; } = new();
}

/// <summary>A sales invoice in a shipment, and the part of the cash on delivery that pays it.</summary>
public class ShipmentInvoice
{
    public Guid ShipmentId { get; set; }
    public Shipment? Shipment { get; set; }
    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    /// <summary>Of the shipment's cash on delivery, what goes to this invoice (minor units).</summary>
    public long CodShare { get; set; }
}

/// <summary>
/// A carrier paying us for delivered cash-on-delivery parcels (تسوية شركة الشحن), usually many
/// at once and net of its fees. The carrier owed the parcels' COD; this takes off what it paid and
/// its fees. Anything short stays on the carrier's balance until explained.
/// </summary>
public class CarrierSettlement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>CST-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public Guid CarrierId { get; set; }
    public Party? Carrier { get; set; }
    /// <summary>Cash on delivery of the settled parcels (minor units).</summary>
    public long CodTotal { get; set; }
    /// <summary>The carrier's fees it kept (a shipping expense, not a cut in sales).</summary>
    public long Fees { get; set; }
    /// <summary>What the carrier actually paid us.</summary>
    public long Received { get; set; }
    /// <summary>CodTotal − Fees − Received: still owed by the carrier (negative if it paid more).</summary>
    public long Difference { get; set; }
    public string? Notes { get; set; }
    /// <summary>The account the carrier's payment went into.</summary>
    public Guid? AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Shipment> Shipments { get; set; } = new();
}

/// <summary>
/// A place money sits (DOMAIN.md §2.6): a cash box, a staff member's custody, a bank account, a
/// mobile wallet or the Egypt Post account. It belongs to a branch. <see cref="Balance"/> is the
/// sum of its movements and never goes below zero.
/// </summary>
public class MoneyAccount : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public MoneyAccountKind Kind { get; set; } = MoneyAccountKind.CASH_BOX;
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    /// <summary>For custody: the staff member holding the cash.</summary>
    public Guid? CustodianId { get; set; }
    public Staff? Custodian { get; set; }
    /// <summary>Bank account, wallet or post account number.</summary>
    public string? Number { get; set; }
    /// <summary>For a bank account: the bank.</summary>
    public string? BankName { get; set; }
    /// <summary>Minor units; = Σ movements.</summary>
    public long Balance { get; set; }
    /// <summary>The last movement's number on this account (movements are numbered 1, 2, 3…).</summary>
    public long LastSeq { get; set; }
    public string Currency { get; set; } = "EGP";
    /// <summary>The branch's default cash box: paid-now amounts land here unless another is picked.</summary>
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Money in (+) or out (−) of one account, with the balance it left behind.</summary>
public class MoneyMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    /// <summary>Its number on the account: movements are read in this order.</summary>
    public long Seq { get; set; }
    /// <summary>Signed, minor units: + in, − out.</summary>
    public long Amount { get; set; }
    public long BalanceAfter { get; set; }
    public MoneyMovementKind Kind { get; set; }
    public PaymentMethod? Method { get; set; }
    public Guid? VoucherId { get; set; }
    public Voucher? Voucher { get; set; }
    /// <summary>The invoice or return whose paid-now / refund this is.</summary>
    public Guid? DocumentId { get; set; }
    public Guid? SettlementId { get; set; }
    public Guid? PartyId { get; set; }
    public Party? Party { get; set; }
    /// <summary>Document number, e.g. RCV-2026-000003 or INV-2026-000120.</summary>
    public string? Reference { get; set; }
    /// <summary>The transfer / transaction number typed on a receipt.</summary>
    public string? MethodReference { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A money voucher (سند): a receipt from a party (قبض), a payment to a party (صرف), an expense
/// (مصروف), or a transfer between two accounts. Receipts and payments can be allocated to
/// invoices; what isn't allocated stays on the party's account.
/// </summary>
public class Voucher
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>RCV-, PAY-, EXP- or CTR-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public VoucherType Type { get; set; }
    public VoucherStatus Status { get; set; } = VoucherStatus.POSTED;
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public Guid? PartyId { get; set; }
    public Party? Party { get; set; }
    public Guid? ExpenseCategoryId { get; set; }
    public ExpenseCategory? ExpenseCategory { get; set; }
    /// <summary>Transfer: from this account…</summary>
    public Guid? FromAccountId { get; set; }
    public MoneyAccount? FromAccount { get; set; }
    /// <summary>…to this one.</summary>
    public Guid? ToAccountId { get; set; }
    public MoneyAccount? ToAccount { get; set; }
    /// <summary>Total, minor units (= Σ lines, or the transfer amount).</summary>
    public long Amount { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? CancelledById { get; set; }
    public Staff? CancelledBy { get; set; }
    public DateTime? CancelledAt { get; set; }
    public List<VoucherLine> Lines { get; set; } = new();
    public List<VoucherAllocation> Allocations { get; set; } = new();
}

/// <summary>One way a voucher was paid: part cash, part InstaPay…</summary>
public class VoucherLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VoucherId { get; set; }
    public Voucher? Voucher { get; set; }
    /// <summary>1-based order on the voucher.</summary>
    public int LineNo { get; set; }
    public PaymentMethod Method { get; set; }
    public Guid AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    public long Amount { get; set; }
    /// <summary>Transfer / transaction number.</summary>
    public string? Reference { get; set; }
}

/// <summary>The part of a receipt or payment that settles one invoice.</summary>
public class VoucherAllocation
{
    public Guid VoucherId { get; set; }
    public Voucher? Voucher { get; set; }
    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    public long Amount { get; set; }
}

/// <summary>What an expense was for (old masrof / masrofSub): a category, optionally under another.</summary>
public class ExpenseCategory : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public Guid? ParentId { get; set; }
    public ExpenseCategory? Parent { get; set; }
    public bool IsActive { get; set; } = true;
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
    /// <summary>Payroll: a day's pay is the monthly salary ÷ this (30 by default).</summary>
    public int PayrollDayBasis { get; set; } = 30;
    /// <summary>Payroll: overtime pays this percent of the normal minute rate (150 = time and a half).</summary>
    public int OvertimePercent { get; set; } = 150;
    /// <summary>Payroll: a past working day with no attendance counts as absent (else as present).</summary>
    public bool MissingAttendanceIsAbsent { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CompanyName { get; set; } = "SKB Wholesale";
    /// <summary>ISO country code (e.g. "EG"). Drives suggested currency + VAT.</summary>
    public string Country { get; set; } = "EG";
    /// <summary>Base/reporting currency (ISO 4217, e.g. "EGP").</summary>
    public string Currency { get; set; } = "EGP";
    /// <summary>
    /// The company's time zone (IANA id). Business days — today, report periods, daily cash,
    /// months — follow it (see <c>CompanyClock</c>).
    /// </summary>
    public string TimeZone { get; set; } = "Africa/Cairo";
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
    /// <summary>
    /// Period lock (إقفال الحركات): no manual entry may be dated on or before this day, and no
    /// voucher created on or before it may be cancelled. Null = nothing locked.
    /// </summary>
    public DateTime? LockDate { get; set; }
    // Company profile (بيانات المنشأة): printed on invoices, vouchers and statements.
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    /// <summary>Tax registration number (الرقم الضريبي).</summary>
    public string? TaxNumber { get; set; }
    /// <summary>Commercial register number (السجل التجاري).</summary>
    public string? CommercialRegister { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A cheque or promissory note (DOMAIN.md §2.7): one we hold from a customer (receivable) or one
/// we issued to a supplier (payable). Receiving or issuing it settles the party's account (and
/// may settle invoices); every later step — deposit, collection, bounce, endorsement — is a
/// <see cref="NoteEvent"/> with its journal entry.
/// </summary>
public class Note
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Our reference: NR-YYYY-NNNNNN (receivable) or NP-YYYY-NNNNNN (payable).</summary>
    public string Ref { get; set; } = "";
    public NoteKind Kind { get; set; }
    public NoteDirection Direction { get; set; }
    public NoteStatus Status { get; set; }
    /// <summary>The number printed on the cheque / note.</summary>
    public string SerialNumber { get; set; } = "";
    public string? BankName { get; set; }
    /// <summary>Minor units.</summary>
    public long Amount { get; set; }
    /// <summary>Due date (تاريخ الاستحقاق), a day.</summary>
    public DateTime DueDate { get; set; }
    /// <summary>Who the cheque is drawn on / who signed the note (المسحوب عليه / الساحب).</summary>
    public string? Drawer { get; set; }
    public string? Guarantor { get; set; }
    /// <summary>Received from (receivable) or issued to (payable).</summary>
    public Guid PartyId { get; set; }
    public Party? Party { get; set; }
    /// <summary>The supplier a received note was endorsed to (مظهرة إلى).</summary>
    public Guid? EndorsedToId { get; set; }
    public Party? EndorsedTo { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    /// <summary>The deposit batch it was lodged in.</summary>
    public Guid? PortfolioId { get; set; }
    public Portfolio? Portfolio { get; set; }
    /// <summary>The money account it was deposited at / collected into / paid from.</summary>
    public Guid? AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    public string? Remark { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<NoteAllocation> Allocations { get; set; } = new();
    public List<NoteEvent> Events { get; set; } = new();
}

/// <summary>The part of a note that settles one invoice (undone if the note bounces or is cancelled).</summary>
public class NoteAllocation
{
    public Guid NoteId { get; set; }
    public Note? Note { get; set; }
    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    public long Amount { get; set; }
}

/// <summary>One step in a note's life (old table hfzaHistory).</summary>
public class NoteEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid NoteId { get; set; }
    public Note? Note { get; set; }
    public NoteStatus? FromStatus { get; set; }
    public NoteStatus ToStatus { get; set; }
    public Guid? AccountId { get; set; }
    public Guid? PartyId { get; set; }
    public string? Remark { get; set; }
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A batch of notes lodged together at a bank for collection (حافظة), PF-YYYY-NNNNNN.</summary>
public class Portfolio
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Number { get; set; } = "";
    public Guid AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Note> Notes { get; set; } = new();
}

/// <summary>
/// An account in the chart of accounts (دليل الحسابات — DOMAIN.md §2.8). Groups hold other
/// accounts; only non-group accounts take entries. System accounts (<see cref="SystemKey"/>) are made
/// by setup and can't be removed. Customers, suppliers, carriers, money accounts and expense
/// categories each get their own sub-account under their group, linked back to them.
/// </summary>
public class LedgerAccount : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>E.g. "1103" or "1103-0007" for a sub-account.</summary>
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public LedgerAccountType Type { get; set; }
    public Guid? ParentId { get; set; }
    public LedgerAccount? Parent { get; set; }
    public bool IsGroup { get; set; }
    /// <summary>Set on accounts setup made, e.g. INVENTORY, CUSTOMERS, SALES.</summary>
    public string? SystemKey { get; set; }
    public Guid? PartyId { get; set; }
    public Party? Party { get; set; }
    public Guid? MoneyAccountId { get; set; }
    public MoneyAccount? MoneyAccount { get; set; }
    public Guid? ExpenseCategoryId { get; set; }
    public ExpenseCategory? ExpenseCategory { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A journal entry (قيد): debits = credits, always. Documents post their own entries in the same
/// transaction; a cancellation posts the exact reverse. Manual (compound) entries are numbered JV-.
/// </summary>
public class JournalEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>The source document's number (INV-…, RCV-…) or, for a manual entry, JV-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string Description { get; set; } = "";
    /// <summary>OPENING, SALES_INVOICE, SALES_RETURN, PURCHASE_INVOICE, PURCHASE_RETURN, VOUCHER,
    /// VOUCHER_CANCEL, STOCKTAKE, SHIPMENT, CARRIER_SETTLEMENT, MONEY_OPENING, MANUAL.</summary>
    public string SourceType { get; set; } = "";
    public Guid? SourceId { get; set; }
    public Guid? BranchId { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<JournalLine> Lines { get; set; } = new();
}

public class JournalLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntryId { get; set; }
    public JournalEntry? Entry { get; set; }
    public int LineNo { get; set; }
    public Guid AccountId { get; set; }
    public LedgerAccount? Account { get; set; }
    /// <summary>Minor units, ≥ 0; one of debit / credit is zero.</summary>
    public long Debit { get; set; }
    public long Credit { get; set; }
    public string? Memo { get; set; }
}

// ---- Payroll & attendance (DOMAIN.md §2.9) ----

/// <summary>A work shift (وردية): its hours, how late is still on time, and the weekly days off.</summary>
public class Shift : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>Minutes after midnight (540 = 09:00). An end before the start runs past midnight.</summary>
    public int StartMinute { get; set; } = 540;
    public int EndMinute { get; set; } = 1020;
    /// <summary>Arriving within this many minutes of the start isn't late.</summary>
    public int GraceMinutes { get; set; } = 15;
    /// <summary>Weekly days off, as day-of-week numbers (0 = Sunday … 5 = Friday, 6 = Saturday).</summary>
    public List<int> DaysOff { get; set; } = new() { 5 };
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Someone on the payroll (موظف) — with or without a sign-in to the app. Their salary is monthly;
/// what they still owe of advances is <see cref="AdvanceBalance"/>.
/// </summary>
public class Employee
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>E-0001…</summary>
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string? JobTitle { get; set; }
    public string? Phone { get; set; }
    public string? NationalId { get; set; }
    /// <summary>First day of work (a date; the month they start in is paid from it).</summary>
    public DateTime HireDate { get; set; }
    /// <summary>Monthly salary, minor units.</summary>
    public long MonthlySalary { get; set; }
    public Guid? ShiftId { get; set; }
    public Shift? Shift { get; set; }
    /// <summary>Their user number on the fingerprint device, to match its attendance export.</summary>
    public string? DeviceUserId { get; set; }
    /// <summary>Their sign-in to the app, if they have one.</summary>
    public Guid? StaffId { get; set; }
    public Staff? Staff { get; set; }
    /// <summary>Advances still to recover, minor units (= Σ open advances' remaining).</summary>
    public long AdvanceBalance { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One employee's day: in and out times (minutes after midnight) and what they come to.</summary>
public class AttendanceDay
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    /// <summary>The day (midnight; a calendar date, not a moment).</summary>
    public DateTime Date { get; set; }
    public AttendanceStatus Status { get; set; }
    public int? CheckIn { get; set; }
    public int? CheckOut { get; set; }
    /// <summary>Late arrival beyond the grace, plus leaving early, in minutes.</summary>
    public int LateMinutes { get; set; }
    /// <summary>Worked past the shift's end (a whole day off worked counts too), in minutes.</summary>
    public int OvertimeMinutes { get; set; }
    public AttendanceSource Source { get; set; }
    public string? Notes { get; set; }
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A bonus (مكافأة) or a deduction (خصم / جزاء) for an employee's month.</summary>
public class PayrollAdjustment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public AdjustmentKind Kind { get; set; }
    public long Amount { get; set; }
    public string Reason { get; set; } = "";
    /// <summary>The posted payroll run that included it (then it can't change).</summary>
    public Guid? RunId { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>An advance on salary (سلفة): paid from a money account, recovered from payroll.</summary>
public class EmployeeAdvance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>ADV-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public Guid EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public long Amount { get; set; }
    /// <summary>At most this much is recovered each month.</summary>
    public long Installment { get; set; }
    public long Remaining { get; set; }
    public AdvanceStatus Status { get; set; } = AdvanceStatus.OPEN;
    public Guid AccountId { get; set; }
    public MoneyAccount? Account { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CancelledAt { get; set; }
}

/// <summary>A month's payroll (مسير الرواتب), for the whole company or one branch.</summary>
public class PayrollRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>PR-YYYY-NNNNNN.</summary>
    public string Number { get; set; } = "";
    public int Year { get; set; }
    public int Month { get; set; }
    public Guid? BranchId { get; set; }
    public Branch? Branch { get; set; }
    public PayrollRunStatus Status { get; set; } = PayrollRunStatus.DRAFT;
    /// <summary>What the employees earned (the salaries expense), minor units.</summary>
    public long Earned { get; set; }
    /// <summary>Advances recovered out of it.</summary>
    public long Recovered { get; set; }
    /// <summary>To pay: earned − recovered.</summary>
    public long Net { get; set; }
    public long Paid { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PostedAt { get; set; }
    public Guid? PostedById { get; set; }
    public Staff? PostedBy { get; set; }
    public List<PayrollLine> Lines { get; set; } = new();
}

/// <summary>One employee on a payroll run (their payslip).</summary>
public class PayrollLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RunId { get; set; }
    public PayrollRun? Run { get; set; }
    public Guid EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public string EmployeeName { get; set; } = "";
    public long MonthlySalary { get; set; }
    /// <summary>Calendar days employed in the month (a new starter's month is shorter).</summary>
    public int EmployedDays { get; set; }
    public int WorkDays { get; set; }
    public int AbsentDays { get; set; }
    public int LateMinutes { get; set; }
    public int OvertimeMinutes { get; set; }
    /// <summary>The month's salary for the days employed.</summary>
    public long Basic { get; set; }
    public long OvertimePay { get; set; }
    public long Bonuses { get; set; }
    public long AbsenceDeduction { get; set; }
    public long LateDeduction { get; set; }
    public long Deductions { get; set; }
    /// <summary>Basic + overtime + bonuses − absence − lateness − deductions (never below zero).</summary>
    public long Earned { get; set; }
    public long AdvanceRecovery { get; set; }
    public long Net { get; set; }
    public long PaidAmount { get; set; }
    public DateTime? PaidAt { get; set; }
    public Guid? PaidAccountId { get; set; }
}

