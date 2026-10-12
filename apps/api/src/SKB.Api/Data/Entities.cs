using SKB.Api.Domain;

namespace SKB.Api.Data;

// Money is stored as integer MINOR UNITS (piastres) in bigint columns — never floats.
// All DateTimes are UTC (timestamptz).

public class Branch : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    /// <summary>Short prefix for item codes, e.g. "EL" (owner decision 2026-10-01).</summary>
    public string? Prefix { get; set; }
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
    /// <summary>Short prefix for item codes, e.g. "H" or "5" (owner decision 2026-10-01).</summary>
    public string? Prefix { get; set; }
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
    /// <summary>The person's number (كود): 1, 2, 3… in the order they were added; shown beside their name.</summary>
    public int Code { get; set; }
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Role Role { get; set; } = Role.VIEWER;
    /// <summary>A role the company made; its permissions replace <see cref="Role"/>'s (which it is based on).</summary>
    public Guid? CustomRoleId { get; set; }
    public CustomRole? CustomRole { get; set; }
    public string? Phone { get; set; }
    /// <summary>More phone numbers, each with what it is (WhatsApp, home…), by position (owner, 2026-10-02).</summary>
    public List<string> OtherPhones { get; set; } = new();
    public List<string> OtherPhoneLabels { get; set; } = new();
    /// <summary>
    /// The person's password, kept encrypted only when the owner asks to be reminded of it (owner,
    /// 2026-10-02); read back only with staff:password_note, and every read is in the activity log.
    /// </summary>
    public byte[]? PasswordNote { get; set; }
    public bool IsActive { get; set; } = true;

    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }

    /// <summary>Permissions this person has on top of their role's.</summary>
    /// <summary>
    /// The one device this account works on (owner, 2026-10-01): a new sign-in takes it over and
    /// ends the others. Null = not yet signed in since the rule came in.
    /// </summary>
    public Guid? CurrentDeviceId { get; set; }
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
    /// <summary>Only these sales departments (none = every department).</summary>
    public List<Guid> DepartmentIds { get; set; } = new();
    /// <summary>
    /// The most discount this person may give, as a % of what a line is worth (their own line
    /// discount plus its share of the invoice discount); null = the company's limit.
    /// </summary>
    public int? MaxDiscountPercent { get; set; }

    public List<Session> Sessions { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The permissions a role gives, as the owner set them (owner decision 2026-09-29: roles bundle
/// permissions, and every action has its own). A role without a row uses the default in
/// <c>RolePermissions</c>. The OWNER role always has every permission and has no row.
/// </summary>
/// <summary>
/// A role the company makes itself (owner decision 2026-10-01), e.g. "cashier": a name, the built-in
/// role it works like (which branches it sees by default), and exactly what it may do.
/// </summary>
public class CustomRole
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public Role BaseRole { get; set; } = Role.SALES;
    public List<string> Permissions { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

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
    /// <summary>One sign-in on one device: every refresh of it keeps this id (the access token's "sid").</summary>
    public Guid DeviceId { get; set; } = Guid.NewGuid();
    /// <summary>"Remember this device": the cookie outlives the browser; else it ends with it.</summary>
    public bool Remember { get; set; }
    /// <summary>Why it ended early: "logout", or "other_device" (the account signed in elsewhere).</summary>
    public string? RevokedReason { get; set; }
}

public class AuditEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ActorId { get; set; } = "";
    public string ActorName { get; set; } = "";
    public string Action { get; set; } = "";
    public string Resource { get; set; } = "";
    public string? ResourceId { get; set; }
    /// <summary>
    /// A short human-readable note on what was done (owner, 2026-10-12: a more detailed log), e.g. the
    /// invoice number and total, the customer, what changed. Kept in the screen-neutral form the
    /// caller wrote; the app shows it as is.
    /// </summary>
    public string? Details { get; set; }
    public string? BranchId { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Party
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>
    /// The customer's / supplier's number (كود): 1, 2, 3… in the order they were added, shown beside
    /// the name; an invoice can be started by typing it.
    /// </summary>
    public int Code { get; set; }
    public string Name { get; set; } = "";
    public List<string> Types { get; set; } = new();
    public string? Phone { get; set; }
    /// <summary>The national ID, checked against the company's country (owner, 2026-10-02).</summary>
    public string? NationalId { get; set; }
    public string? Email { get; set; }
    public string? TaxNumber { get; set; }
    /// <summary>The main address. For a supplier this is the factory's address (عنوان المصنع).</summary>
    public string? Address { get; set; }
    /// <summary>Phone numbers besides <see cref="Phone"/> (up to 5).</summary>
    public List<string> OtherPhones { get; set; } = new();
    /// <summary>
    /// Whose each of <see cref="OtherPhones"/> is, by position (owner, 2026-10-01: e.g. a relative's);
    /// "" = no name.
    /// </summary>
    public List<string> OtherPhoneLabels { get; set; } = new();
    /// <summary>A second address and what it is called (e.g. "the shop"), both optional.</summary>
    public string? ExtraAddress { get; set; }
    public string? ExtraAddressLabel { get; set; }
    /// <summary>
    /// A shipping company the customer uses that has no file of its own (owner, 2026-10-01): just its
    /// name, until it is added as a shipping company.
    /// </summary>
    public string? TempCarrierName { get; set; }
    /// <summary>Whether a photo of the ID card's front / back is kept (<see cref="PartyIdCard"/>).</summary>
    public bool HasIdFront { get; set; }
    public bool HasIdBack { get; set; }
    /// <summary>Who to deal with: the factory owner (صاحب المصنع) for a supplier, the person in charge for a customer.</summary>
    public string? ContactName { get; set; }
    /// <summary>Where goods are shipped (عنوان الشحن); delivered sales start at it, else at <see cref="Address"/>.</summary>
    public string? ShippingAddress { get; set; }
    /// <summary>
    /// The shipping company this customer's parcels go with (owner, 2026-10-01): a sale shipped by a
    /// company takes it, and the shipping address, from here; changing them on a sale needs
    /// <c>sales:change_shipping</c>.
    /// </summary>
    public Guid? DefaultCarrierId { get; set; }
    /// <summary>A cash customer (عميل نقدي): pays every invoice in full when it is made, never on account.</summary>
    public bool IsCashCustomer { get; set; }
    /// <summary>
    /// The company's own walk-in cash customer (العميل النقدي, code 0; owner 2026-10-02): every
    /// one-time customer is sold to on it. It is always there: it can't be closed, stop being a
    /// customer or stop paying in full.
    /// </summary>
    public bool IsSystem { get; set; }
    public string? Notes { get; set; }
    /// <summary>
    /// The most a customer may owe (حد الائتمان, minor units); null = no limit. A sale that would take
    /// their balance over it waits for the accountant (owner, 2026-10-02).
    /// </summary>
    public long? CreditLimit { get; set; }
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
    /// <summary>Price list a sales invoice to this customer uses (on top of their level).</summary>
    public Guid? SalesPriceListId { get; set; }
    public PriceList? SalesPriceList { get; set; }
    /// <summary>Price list a purchase invoice from this supplier uses.</summary>
    public Guid? PurchasePriceListId { get; set; }
    public PriceList? PurchasePriceList { get; set; }

    public List<SalesDocument> Documents { get; set; } = new();
}

/// <summary>
/// A photo of a customer's or shipping company's ID card, one side. Kept in the database, never as
/// a file on the server's disk, and only served to people with <c>parties:id_cards</c>.
/// </summary>
public class PartyIdCard
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PartyId { get; set; }
    /// <summary>FRONT or BACK.</summary>
    public string Side { get; set; } = "FRONT";
    public string ContentType { get; set; } = "image/jpeg";
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public Guid? UploadedBy { get; set; }
}

/// <summary>
/// An item's photo (owner, 2026-10-12: "a picture for every item"). One per item, stored in the
/// database (never a file on disk), only a real JPEG/PNG/WebP (checked against its own bytes by
/// <see cref="Services.Pictures"/>), served with no-sniff and never cached.
/// </summary>
public class ProductImage
{
    public Guid ProductId { get; set; }
    public string ContentType { get; set; } = "image/jpeg";
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public Guid? UploadedBy { get; set; }
}

public class Category : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>The sales department the category's items belong to (none = sold by every department).</summary>
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public List<Product> Products { get; set; } = new();

    // ---- Department tree (owner, 2026-10-06): underwear → men's → vests → half sleeve ----
    /// <summary>The department's own node: items put straight in the department point here.</summary>
    public bool IsRoot { get; set; }
    /// <summary>The group this one sits under; null = straight under its department.</summary>
    public Guid? ParentId { get; set; }
    public Category? Parent { get; set; }
    /// <summary>Its part of an item code, after the department's (e.g. M for men's, V for vests).</summary>
    public string? Prefix { get; set; }
    /// <summary>
    /// Words that point to this group when they appear in an item's name, one per line (its own name
    /// counts too), e.g. "فنيله" for vests. A deeper group implies the groups above it.
    /// </summary>
    public string? Keywords { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

/// <summary>
/// A sales department (قسم), e.g. men's or underwear: a group of categories (owner decision
/// 2026-09-30). A department's sales people sell only its items, even from a warehouse other
/// departments share, and each invoice belongs to one department so the accountant can see what a
/// customer took from each. A company-wide list; closed, never deleted.
/// </summary>
public class Department : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>Short prefix for item codes, e.g. "MEN" (owner decision 2026-10-01).</summary>
    public string? Prefix { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A department a warehouse has (owner decision 2026-10-01): departments are one list, each
/// warehouse picks its own; the same department and the same items may be in two warehouses, each
/// with its own stock. A warehouse with none picked offers every department.
/// </summary>
public class WarehouseDepartment
{
    public Guid WarehouseId { get; set; }
    public Warehouse? Warehouse { get; set; }
    public Guid DepartmentId { get; set; }
    public Department? Department { get; set; }
}

/// <summary>
/// A season (موسم) goods are bought for (owner decision 2026-10-01): the system adds summer and
/// winter every year (summer April–September, winter October–March), and "no season" for goods that
/// have none; more can be added by hand. An item bought for a season carries it, at the end of its
/// name too, and can be searched by it.
/// </summary>
public class Season
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>SUMMER, WINTER, NONE (no season) or CUSTOM.</summary>
    public string Kind { get; set; } = "CUSTOM";
    public int? Year { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A unit of measure (وحدة): piece, carton, dozen, kg… A company-wide list.
/// Items say which units they come in, and how many base units each holds (<see cref="ItemUnit"/>).
/// </summary>
public class Unit : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>How many pieces it usually holds (a dozen = 12); an item's own count can differ.</summary>
    public int Pieces { get; set; } = 1;
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

/// <summary>
/// A price list (قائمة أسعار, DOMAIN.md §2.2): special prices for chosen items on one side (sales or
/// purchases). It applies to the parties given it — or, when <see cref="ForEveryone"/>, to every
/// party of that side (an offer) — between its dates. Its prices replace the price level's for
/// those items; items not on it keep the level's.
/// </summary>
public class PriceList : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public PriceSide Side { get; set; } = PriceSide.SALE;
    /// <summary>Every party of its side gets it, not only those given it.</summary>
    public bool ForEveryone { get; set; }
    /// <summary>First and last day it applies (calendar days; null = open-ended).</summary>
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }
    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public List<PriceListItem> Items { get; set; } = new();
}

/// <summary>
/// One price on a list: an item's (or a whole model's, every size and color) price for one unit.
/// A missing unit is the base unit's price × its factor, as with levels.
/// </summary>
public class PriceListItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ListId { get; set; }
    public PriceList? List { get; set; }
    public Guid? ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid? ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public Guid UnitId { get; set; }
    public Unit? Unit { get; set; }
    public long Price { get; set; }
}

/// <summary>
/// A quantity discount (خصم الكمية, old table priceLevels): from <see cref="MinQuantity"/> base units
/// of an item on one sales invoice — or of a model's sizes and colors together — its lines get
/// <see cref="PercentBp"/> off. The highest step reached applies.
/// </summary>
public class QuantityBreak
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid? ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public int MinQuantity { get; set; }
    /// <summary>The discount in hundredths of a percent (250 = 2.5%).</summary>
    public int PercentBp { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A size or a color (مقاس / لون) that item models are made in. Company-wide lists.</summary>
public class VariantOption : INamed
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public VariantKind Kind { get; set; }
    /// <summary>A color's swatch, e.g. "#1d4ed8" (owner decision 2026-10-01).</summary>
    public string? Hex { get; set; }
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
    /// <summary>Main supplier and its code for the model; every variant follows them.</summary>
    public Guid? SupplierId { get; set; }
    public Party? Supplier { get; set; }
    public string? SupplierCode { get; set; }
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

    /// <summary>True when the item has a photo (<see cref="ProductImage"/>); kept for list screens.</summary>
    public bool HasImage { get; set; }

    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }

    /// <summary>
    /// The item's main supplier (the factory it comes from), and that supplier's own code for it
    /// (owner decision 2026-09-30). A variant follows its model's.
    /// </summary>
    public Guid? SupplierId { get; set; }
    public Party? Supplier { get; set; }
    public string? SupplierCode { get; set; }

    /// <summary>Set on a variant: its model, and its size and/or color. Its name is composed from them.</summary>
    public Guid? ModelId { get; set; }
    public ProductModel? Model { get; set; }
    public Guid? SizeId { get; set; }
    public VariantOption? Size { get; set; }
    public Guid? ColorId { get; set; }
    public VariantOption? Color { get; set; }
    /// <summary>The season it was bought for (owner decision 2026-10-01).</summary>
    public Guid? SeasonId { get; set; }
    public Season? Season { get; set; }

    public List<ItemUnit> Units { get; set; } = new();

    /// <summary>
    /// The name, code and supplier code folded for searching (<see cref="Services.TextKey"/>): Arabic
    /// letter forms made one, and each word's consonant outline, so a slip of a letter still finds it.
    /// Kept in step on every save.
    /// </summary>
    public string SearchKey { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SalesDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Number { get; set; } = "";
    public DocumentType Type { get; set; }
    public DocumentStatus Status { get; set; } = DocumentStatus.CONFIRMED;
    public DateTime IssueDate { get; set; } = DateTime.UtcNow;
    /// <summary>When it was really typed, if it is dated on another day (<see cref="Services.Backdate"/>).</summary>
    public DateTime? EnteredAt { get; set; }
    public DateTime? DueDate { get; set; }
    public long Subtotal { get; set; }
    public long DiscountTotal { get; set; }
    public long TaxTotal { get; set; }
    public long GrandTotal { get; set; }
    public long PaidAmount { get; set; }
    /// <summary>
    /// Paid outside the party's account: on the spot when the invoice was written (paid now), or to
    /// the shipping company on delivery (cash on delivery). The rest went on the account, and its
    /// payment state follows the account oldest-first (owner, 2026-10-02).
    /// </summary>
    public long PaidDirect { get; set; }
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

    /// <summary>Why a pending invoice was turned down (REJECTED).</summary>
    public string? RejectReason { get; set; }

    /// <summary>Why a posted invoice was cancelled (optional, owner 2026-10-01).</summary>
    public string? CancelReason { get; set; }

    /// <summary>
    /// Waiting for the accountant because of the customer's purchase limit (owner, 2026-10-02): a
    /// pending invoice (SALES_ORDER) saved because the sale went over the limit, or a posted invoice
    /// whose change took the customer over it. The accountant accepts or turns it down; a payment
    /// that brings the customer back within the limit accepts it by itself.
    /// </summary>
    public bool OverLimit { get; set; }
    /// <summary>How the limit was settled: who accepted it, or that the system did after a payment.</summary>
    public string? ApprovalNote { get; set; }

    /// <summary>The sales department (قسم) a sale, quotation or return belongs to; null = none.</summary>
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }

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
    /// <summary>
    /// The company's main cash box (owner, 2026-10-02): named by the owner, in the main branch; each
    /// branch's box hands its cash up to it. At most one.
    /// </summary>
    public bool IsMain { get; set; }
    /// <summary>A warehouse's own cash box: its cash goes up to the branch's box.</summary>
    public Guid? WarehouseId { get; set; }
    public Warehouse? Warehouse { get; set; }
    /// <summary>
    /// Sent up and not yet confirmed (minor units): still counted in <see cref="Balance"/> but can't
    /// be spent until the receiver confirms or the handover is called off.
    /// </summary>
    public long Held { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Cash sent up from one box to the next (owner, 2026-10-02): a warehouse's box to its branch's box,
/// a branch's box to the main box. Sent by whoever holds it; the money moves only when the receiver
/// confirms it arrived (as a transfer voucher). Until then it is held in the sending box.
/// </summary>
public class CashHandover
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>e.g. HND-2026-000004.</summary>
    public string Number { get; set; } = "";
    public Guid FromAccountId { get; set; }
    public MoneyAccount? FromAccount { get; set; }
    public Guid ToAccountId { get; set; }
    public MoneyAccount? ToAccount { get; set; }
    /// <summary>Minor units.</summary>
    public long Amount { get; set; }
    public HandoverStatus Status { get; set; } = HandoverStatus.SENT;
    public string? Notes { get; set; }
    public Guid SentById { get; set; }
    public Staff? SentBy { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    /// <summary>Who confirmed it arrived or called it off, and when.</summary>
    public Guid? DoneById { get; set; }
    public Staff? DoneBy { get; set; }
    public DateTime? DoneAt { get; set; }
    /// <summary>Why it was called off.</summary>
    public string? Reason { get; set; }
    /// <summary>The transfer voucher that moved the money on arrival.</summary>
    public Guid? VoucherId { get; set; }
    public Voucher? Voucher { get; set; }
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
    /// <summary>When it was really typed, if it is dated on another day (<see cref="Services.Backdate"/>).</summary>
    public DateTime? EnteredAt { get; set; }
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
    /// The most discount staff may give, as a % of a line's worth, unless their own limit says
    /// otherwise (100 = no limit). The owner has no limit.
    /// </summary>
    public int MaxDiscountPercent { get; set; } = 100;
    /// <summary>A pending invoice holds its goods this many days (0 = until approved or cancelled).</summary>
    public int PendingHoldDays { get; set; }
    /// <summary>
    /// The receiving warehouse confirms a transfer before the goods count there (old
    /// chkBoxIsConfermTahwel). Off: a transfer arrives the moment it is sent.
    /// </summary>
    public bool TransfersRequireReceipt { get; set; }
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
    /// <summary>
    /// Bumped whenever the company's own logo (<see cref="CompanyLogo"/>) changes; 0 = no logo.
    /// The app shows it beside the Evolvix mark (owner, 2026-10-01: a buyer brands the app with
    /// their office's name and logo, while the program's own name and mark stay).
    /// </summary>
    public int LogoVersion { get; set; }
    /// <summary>
    /// Every sale names its department (owner, 2026-10-01: the store holds departments and each has
    /// its own goods). Only enforced while the company has departments.
    /// </summary>
    public bool RequireDepartment { get; set; } = true;
    /// <summary>
    /// Goods on a sales invoice can be returned only this many hours after it was made (owner,
    /// 2026-10-02: until then the invoice itself is changed); 0 = at once.
    /// </summary>
    public int ReturnAfterHours { get; set; } = 12;
    /// <summary>
    /// A new branch, warehouse, money account or department is hidden from everyone (owners and
    /// admins aside) until they are given it (owner decision 2026-10-02).
    /// </summary>
    public bool HideNewPlaces { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// How one kind of document is numbered (الرقم المسلسل, owner 2026-10-01): its own prefix (e.g.
/// "KM-", with {YYYY} for the year) and the number it starts at. A kind with no row keeps the
/// built-in INV-2026-000001 style.
/// </summary>
public class DocumentNumbering
{
    /// <summary>The document type (SALES_INVOICE, SALES_RETURN, …).</summary>
    public string Type { get; set; } = "";
    public string Prefix { get; set; } = "";
    public int StartAt { get; set; } = 1;
    /// <summary>At least this many digits, zero-padded.</summary>
    public int Digits { get; set; } = 6;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>The company's uploaded logo (one row at most), kept apart so settings reads stay small.</summary>
public class CompanyLogo
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>image/png, image/jpeg or image/webp, checked against the file's own bytes.</summary>
    public string ContentType { get; set; } = "";
    public byte[] Data { get; set; } = [];
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
    /// <summary>The day it came to us (receivable) or was handed over (payable), as typed (owner, 2026-10-02).</summary>
    public DateTime? ReceivedOn { get; set; }
    /// <summary>Who brought it (receivable) or took it (payable).</summary>
    public string? BroughtBy { get; set; }
    /// <summary>A photo of the paper is kept (<see cref="NotePhoto"/>).</summary>
    public bool HasPhoto { get; set; }
    public Guid CreatedById { get; set; }
    public Staff? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<NoteAllocation> Allocations { get; set; } = new();
    public List<NoteEvent> Events { get; set; } = new();
}

/// <summary>The photo of a cheque or note, kept in the database (never on disk), one per paper.</summary>
public class NotePhoto
{
    public Guid NoteId { get; set; }
    public string ContentType { get; set; } = "image/jpeg";
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public Guid? UploadedBy { get; set; }
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
    /// <summary>
    /// The entry's own running number (رقم القيد): 1, 2, 3… in the order entries are made, as in the
    /// old program's statement (owner, 2026-10-01). Given by the database.
    /// </summary>
    public int Serial { get; set; }
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
    /// <summary>More phone numbers, each with what it is (WhatsApp, home…), by position (owner, 2026-10-02).</summary>
    public List<string> OtherPhones { get; set; } = new();
    public List<string> OtherPhoneLabels { get; set; } = new();
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


/// <summary>An in-app notification for one person (the bell), e.g. a pending invoice to approve.</summary>
public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    /// <summary>INVOICE_NEW, ORDER_PENDING, ORDER_APPROVED, ORDER_REJECTED (the app words it in the screen language).</summary>
    public string Kind { get; set; } = "";
    public Guid? DocumentId { get; set; }
    public string? DocumentNumber { get; set; }
    public string? PartyName { get; set; }
    /// <summary>The invoice's sales department (قسم), as it was named then.</summary>
    public string? DepartmentName { get; set; }
    public long Amount { get; set; }
    public string? ActorName { get; set; }
    public string? Message { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }
}

/// <summary>
/// Work in progress one person had open when the app updated itself (owner decision 2026-09-30):
/// the screen saves what was typed here, the new version reloads at the same place and takes it
/// back. Kept on the server, never on the device (CLAUDE.md rule 1), and only for a short while.
/// </summary>
public class WorkDraft
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    /// <summary>Which screen it belongs to (its address), e.g. "/sales/new".</summary>
    public string Key { get; set; } = "";
    /// <summary>The screen's own JSON; each screen reads back only what it still has.</summary>
    public string Data { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One of a person's screen preferences, e.g. which columns a table hides (owner, 2026-10-01: "saved
/// for the next time I use the page", on any device). Not company data: a UI choice, kept per person.
/// </summary>
public class StaffPreference
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    /// <summary>e.g. "columns:sales.invoices".</summary>
    public string Key { get; set; } = "";
    /// <summary>The screen's own JSON.</summary>
    public string Value { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A posted sales invoice changed or cancelled (owner, 2026-10-01): who, when, why, and its total
/// before and after — the "cancelled and changed invoices" report reads these.
/// </summary>
public class InvoiceRevision
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DocumentId { get; set; }
    public SalesDocument? Document { get; set; }
    /// <summary>EDIT or CANCEL.</summary>
    public string Kind { get; set; } = "";
    public DateTime At { get; set; } = DateTime.UtcNow;
    public Guid StaffId { get; set; }
    public string StaffName { get; set; } = "";
    public string? Reason { get; set; }
    public long TotalBefore { get; set; }
    public long TotalAfter { get; set; }
}


// ---------------------------------------------------------------- staff chat (owner, 2026-10-06)

public enum ChatKind { DIRECT, GROUP }

/// <summary>
/// A conversation between staff: two people, or a group someone with <c>chat:manage</c> made. People
/// with <c>chat:monitor</c> can read every conversation; nothing is ever deleted.
/// </summary>
public class ChatConversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public ChatKind Kind { get; set; }
    public string? Title { get; set; }
    /// <summary>
    /// A one-to-one conversation's pair, the two people's ids in order ("a:b"), unique: there is one
    /// conversation per two people (owner, 2026-10-10). Null for a group.
    /// </summary>
    public string? DirectKey { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;
    public List<ChatMember> Members { get; set; } = new();

    public static string PairKey(Guid a, Guid b)
    {
        string x = a.ToString(), y = b.ToString();
        return string.CompareOrdinal(x, y) < 0 ? $"{x}:{y}" : $"{y}:{x}";
    }
}

public class ChatMember
{
    public Guid ConversationId { get; set; }
    public ChatConversation? Conversation { get; set; }
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    /// <summary>Up to when they have read (for the unread count).</summary>
    public DateTime LastReadAt { get; set; } = DateTime.UtcNow;
}

public class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public ChatConversation? Conversation { get; set; }
    public Guid SenderId { get; set; }
    public Staff? Sender { get; set; }
    public string Text { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Someone a supervisor stopped from writing in the chat (they still read). Removing the row lets them write again.</summary>
public class ChatMute
{
    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }
    public Guid ById { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

// ---------------------------------------------------------------- assistant (owner, 2026-10-06)

/// <summary>One turn of a person's conversation with the company's offline assistant, kept on the server.</summary>
/// <summary>One of a person's conversations with the assistant (owner, 2026-10-10: several, each deletable).</summary>
public class AssistantConversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    /// <summary>The first question, shortened.</summary>
    public string Title { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public List<AssistantTurn> Turns { get; set; } = new();
}

public class AssistantTurn
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StaffId { get; set; }
    public Guid ConversationId { get; set; }
    public AssistantConversation? Conversation { get; set; }
    /// <summary>"user" or "assistant".</summary>
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
