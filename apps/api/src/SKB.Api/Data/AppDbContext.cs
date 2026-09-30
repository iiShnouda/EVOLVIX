using Microsoft.EntityFrameworkCore;

namespace SKB.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<AttendanceDay> AttendanceDays => Set<AttendanceDay>();
    public DbSet<PayrollAdjustment> PayrollAdjustments => Set<PayrollAdjustment>();
    public DbSet<EmployeeAdvance> EmployeeAdvances => Set<EmployeeAdvance>();
    public DbSet<PayrollRun> PayrollRuns => Set<PayrollRun>();
    public DbSet<PayrollLine> PayrollLines => Set<PayrollLine>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<SalesDocument> SalesDocuments => Set<SalesDocument>();
    public DbSet<DocumentLine> DocumentLines => Set<DocumentLine>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();
    public DbSet<StockBalance> StockBalances => Set<StockBalance>();
    public DbSet<StockTransfer> StockTransfers => Set<StockTransfer>();
    public DbSet<StockCost> StockCosts => Set<StockCost>();
    public DbSet<StockTransferLine> StockTransferLines => Set<StockTransferLine>();
    public DbSet<CompanySettings> CompanySettings => Set<CompanySettings>();
    public DbSet<Unit> Units => Set<Unit>();
    public DbSet<ItemUnit> ItemUnits => Set<ItemUnit>();
    public DbSet<PriceLevel> PriceLevels => Set<PriceLevel>();
    public DbSet<ItemPrice> ItemPrices => Set<ItemPrice>();
    public DbSet<VariantOption> VariantOptions => Set<VariantOption>();
    public DbSet<ProductModel> ProductModels => Set<ProductModel>();
    public DbSet<ModelUnit> ModelUnits => Set<ModelUnit>();
    public DbSet<ModelPrice> ModelPrices => Set<ModelPrice>();
    public DbSet<RolePermissionSet> RolePermissionSets => Set<RolePermissionSet>();
    public DbSet<DocumentCharge> DocumentCharges => Set<DocumentCharge>();
    public DbSet<Shipment> Shipments => Set<Shipment>();
    public DbSet<ShipmentInvoice> ShipmentInvoices => Set<ShipmentInvoice>();
    public DbSet<CarrierSettlement> CarrierSettlements => Set<CarrierSettlement>();
    public DbSet<MoneyAccount> MoneyAccounts => Set<MoneyAccount>();
    public DbSet<MoneyMovement> MoneyMovements => Set<MoneyMovement>();
    public DbSet<Voucher> Vouchers => Set<Voucher>();
    public DbSet<VoucherLine> VoucherLines => Set<VoucherLine>();
    public DbSet<VoucherAllocation> VoucherAllocations => Set<VoucherAllocation>();
    public DbSet<ExpenseCategory> ExpenseCategories => Set<ExpenseCategory>();
    public DbSet<LedgerAccount> LedgerAccounts => Set<LedgerAccount>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalLine> JournalLines => Set<JournalLine>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<NoteAllocation> NoteAllocations => Set<NoteAllocation>();
    public DbSet<NoteEvent> NoteEvents => Set<NoteEvent>();
    public DbSet<Portfolio> Portfolios => Set<Portfolio>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Store enums as readable strings in Postgres.
        b.Entity<Staff>().Property(s => s.Role).HasConversion<string>();
        b.Entity<RolePermissionSet>().HasKey(r => r.Role);
        b.Entity<DocumentCharge>().Property(c => c.Kind).HasConversion<string>();
        b.Entity<DocumentCharge>()
            .HasOne(c => c.Document).WithMany(d => d.Charges)
            .HasForeignKey(c => c.DocumentId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SalesDocument>()
            .HasOne(d => d.Rep).WithMany()
            .HasForeignKey(d => d.RepId).OnDelete(DeleteBehavior.Restrict);

        // Notes (DOMAIN.md §2.7): cheques and promissory notes, their steps, deposit portfolios.
        b.Entity<Note>().Property(n => n.Kind).HasConversion<string>();
        b.Entity<Note>().Property(n => n.Direction).HasConversion<string>();
        b.Entity<Note>().Property(n => n.Status).HasConversion<string>();
        b.Entity<Note>().HasIndex(n => n.Ref).IsUnique();
        b.Entity<Note>().HasIndex(n => new { n.Direction, n.Status, n.DueDate });
        b.Entity<Note>().HasOne(n => n.Party).WithMany()
            .HasForeignKey(n => n.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Note>().HasOne(n => n.EndorsedTo).WithMany()
            .HasForeignKey(n => n.EndorsedToId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Note>().HasOne(n => n.Branch).WithMany()
            .HasForeignKey(n => n.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Note>().HasOne(n => n.Portfolio).WithMany(p => p.Notes)
            .HasForeignKey(n => n.PortfolioId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Note>().HasOne(n => n.Account).WithMany()
            .HasForeignKey(n => n.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Note>().HasOne(n => n.CreatedBy).WithMany()
            .HasForeignKey(n => n.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<NoteAllocation>().HasKey(x => new { x.NoteId, x.DocumentId });
        b.Entity<NoteAllocation>().HasIndex(x => x.DocumentId);
        b.Entity<NoteAllocation>().HasOne(x => x.Note).WithMany(n => n.Allocations)
            .HasForeignKey(x => x.NoteId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<NoteAllocation>().HasOne(x => x.Document).WithMany()
            .HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<NoteEvent>().Property(e => e.FromStatus).HasConversion<string>();
        b.Entity<NoteEvent>().Property(e => e.ToStatus).HasConversion<string>();
        b.Entity<NoteEvent>().HasOne(e => e.Note).WithMany(n => n.Events)
            .HasForeignKey(e => e.NoteId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<NoteEvent>().HasOne(e => e.Staff).WithMany()
            .HasForeignKey(e => e.StaffId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Portfolio>().HasIndex(p => p.Number).IsUnique();
        b.Entity<Portfolio>().HasOne(p => p.Account).WithMany()
            .HasForeignKey(p => p.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Portfolio>().HasOne(p => p.Branch).WithMany()
            .HasForeignKey(p => p.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Portfolio>().HasOne(p => p.CreatedBy).WithMany()
            .HasForeignKey(p => p.CreatedById).OnDelete(DeleteBehavior.Restrict);

        // Ledger (DOMAIN.md §2.8): chart of accounts, journal entries and their lines.
        b.Entity<LedgerAccount>().Property(a => a.Type).HasConversion<string>();
        b.Entity<LedgerAccount>().HasIndex(a => a.Code).IsUnique();
        b.Entity<LedgerAccount>().HasIndex(a => a.SystemKey).IsUnique().HasFilter("\"SystemKey\" IS NOT NULL");
        b.Entity<LedgerAccount>().HasIndex(a => new { a.ParentId, a.PartyId }).IsUnique().HasFilter("\"PartyId\" IS NOT NULL");
        b.Entity<LedgerAccount>().HasIndex(a => a.MoneyAccountId).IsUnique().HasFilter("\"MoneyAccountId\" IS NOT NULL");
        b.Entity<LedgerAccount>().HasIndex(a => a.ExpenseCategoryId).IsUnique().HasFilter("\"ExpenseCategoryId\" IS NOT NULL");
        b.Entity<LedgerAccount>().HasOne(a => a.Parent).WithMany()
            .HasForeignKey(a => a.ParentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<LedgerAccount>().HasOne(a => a.Party).WithMany()
            .HasForeignKey(a => a.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<LedgerAccount>().HasOne(a => a.MoneyAccount).WithMany()
            .HasForeignKey(a => a.MoneyAccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<LedgerAccount>().HasOne(a => a.ExpenseCategory).WithMany()
            .HasForeignKey(a => a.ExpenseCategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<JournalEntry>().HasIndex(e => new { e.SourceType, e.SourceId });
        b.Entity<JournalEntry>().HasIndex(e => e.Date);
        b.Entity<JournalEntry>().HasOne(e => e.CreatedBy).WithMany()
            .HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<JournalLine>().HasOne(l => l.Entry).WithMany(e => e.Lines)
            .HasForeignKey(l => l.EntryId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<JournalLine>().HasOne(l => l.Account).WithMany()
            .HasForeignKey(l => l.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<JournalLine>().HasIndex(l => l.AccountId);

        // Money (DOMAIN.md §2.6): accounts, their movements, and vouchers with lines and allocations.
        // Restrict everywhere: money history keeps its references.
        b.Entity<MoneyAccount>().Property(a => a.Kind).HasConversion<string>();
        b.Entity<MoneyAccount>().HasOne(a => a.Branch).WithMany()
            .HasForeignKey(a => a.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyAccount>().HasOne(a => a.Custodian).WithMany()
            .HasForeignKey(a => a.CustodianId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyAccount>().HasIndex(a => a.BranchId).HasFilter("\"IsDefault\"").IsUnique();
        b.Entity<MoneyMovement>().Property(m => m.Kind).HasConversion<string>();
        b.Entity<MoneyMovement>().Property(m => m.Method).HasConversion<string>();
        b.Entity<MoneyMovement>().HasOne(m => m.Account).WithMany()
            .HasForeignKey(m => m.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyMovement>().HasOne(m => m.Voucher).WithMany()
            .HasForeignKey(m => m.VoucherId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyMovement>().HasOne(m => m.Party).WithMany()
            .HasForeignKey(m => m.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyMovement>().HasOne(m => m.CreatedBy).WithMany()
            .HasForeignKey(m => m.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MoneyMovement>().HasIndex(m => new { m.AccountId, m.Seq }).IsUnique();
        b.Entity<MoneyMovement>().HasIndex(m => new { m.AccountId, m.CreatedAt });
        b.Entity<MoneyMovement>().HasIndex(m => m.DocumentId);
        b.Entity<Voucher>().Property(v => v.Type).HasConversion<string>();
        b.Entity<Voucher>().Property(v => v.Status).HasConversion<string>();
        b.Entity<Voucher>().HasIndex(v => v.Number).IsUnique();
        b.Entity<Voucher>().HasIndex(v => new { v.Type, v.CreatedAt });
        b.Entity<Voucher>().HasOne(v => v.Branch).WithMany()
            .HasForeignKey(v => v.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.Party).WithMany()
            .HasForeignKey(v => v.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.ExpenseCategory).WithMany()
            .HasForeignKey(v => v.ExpenseCategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.FromAccount).WithMany()
            .HasForeignKey(v => v.FromAccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.ToAccount).WithMany()
            .HasForeignKey(v => v.ToAccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.CreatedBy).WithMany()
            .HasForeignKey(v => v.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Voucher>().HasOne(v => v.CancelledBy).WithMany()
            .HasForeignKey(v => v.CancelledById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<VoucherLine>().Property(l => l.Method).HasConversion<string>();
        b.Entity<VoucherLine>().HasOne(l => l.Voucher).WithMany(v => v.Lines)
            .HasForeignKey(l => l.VoucherId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<VoucherLine>().HasOne(l => l.Account).WithMany()
            .HasForeignKey(l => l.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<VoucherAllocation>().HasKey(x => new { x.VoucherId, x.DocumentId });
        b.Entity<VoucherAllocation>().HasIndex(x => x.DocumentId);
        b.Entity<VoucherAllocation>().HasOne(x => x.Voucher).WithMany(v => v.Allocations)
            .HasForeignKey(x => x.VoucherId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<VoucherAllocation>().HasOne(x => x.Document).WithMany()
            .HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ExpenseCategory>().HasOne(c => c.Parent).WithMany()
            .HasForeignKey(c => c.ParentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>().HasOne(d => d.PaidAccount).WithMany()
            .HasForeignKey(d => d.PaidAccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<CarrierSettlement>().HasOne(x => x.Account).WithMany()
            .HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict);

        // Delivery (DOMAIN.md §2.5): method and status on the sale, shipments with a waybill, and
        // carrier settlements. Restrict everywhere: history keeps its references.
        b.Entity<SalesDocument>().Property(d => d.DeliveryMethod).HasConversion<string>();
        b.Entity<SalesDocument>().Property(d => d.DeliveryStatus).HasConversion<string>();
        b.Entity<SalesDocument>()
            .HasOne(d => d.Driver).WithMany()
            .HasForeignKey(d => d.DriverId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>()
            .HasOne(d => d.Carrier).WithMany()
            .HasForeignKey(d => d.CarrierId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>().HasIndex(d => new { d.DeliveryMethod, d.DeliveryStatus });
        b.Entity<Shipment>().Property(s => s.Status).HasConversion<string>();
        b.Entity<Shipment>().HasIndex(s => s.Number).IsUnique();
        b.Entity<Shipment>().HasIndex(s => new { s.CarrierId, s.Status });
        b.Entity<Shipment>().HasOne(s => s.Carrier).WithMany()
            .HasForeignKey(s => s.CarrierId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shipment>().HasOne(s => s.Party).WithMany()
            .HasForeignKey(s => s.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shipment>().HasOne(s => s.Branch).WithMany()
            .HasForeignKey(s => s.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shipment>().HasOne(s => s.CreatedBy).WithMany()
            .HasForeignKey(s => s.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shipment>().HasOne(s => s.Settlement).WithMany(x => x.Shipments)
            .HasForeignKey(s => s.SettlementId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ShipmentInvoice>().HasKey(x => new { x.ShipmentId, x.DocumentId });
        b.Entity<ShipmentInvoice>().HasIndex(x => x.DocumentId);
        b.Entity<ShipmentInvoice>().HasOne(x => x.Shipment).WithMany(s => s.Invoices)
            .HasForeignKey(x => x.ShipmentId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ShipmentInvoice>().HasOne(x => x.Document).WithMany()
            .HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<CarrierSettlement>().HasIndex(x => x.Number).IsUnique();
        b.Entity<CarrierSettlement>().HasOne(x => x.Carrier).WithMany()
            .HasForeignKey(x => x.CarrierId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<CarrierSettlement>().HasOne(x => x.CreatedBy).WithMany()
            .HasForeignKey(x => x.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<RolePermissionSet>().Property(r => r.Role).HasConversion<string>();
        b.Entity<SalesDocument>().Property(d => d.Type).HasConversion<string>();
        b.Entity<SalesDocument>().Property(d => d.Status).HasConversion<string>();
        b.Entity<StockMovement>().Property(m => m.Type).HasConversion<string>();

        b.Entity<Branch>().HasIndex(x => x.Code).IsUnique();
        b.Entity<Staff>().HasIndex(x => x.Email).IsUnique();
        b.Entity<Staff>().HasIndex(x => x.BranchId);
        b.Entity<Session>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<Session>().HasIndex(x => x.StaffId);
        b.Entity<Session>().HasIndex(x => x.ExpiresAt);
        b.Entity<Product>().HasIndex(x => x.Sku).IsUnique();
        b.Entity<Product>().HasIndex(x => x.CategoryId);
        b.Entity<Party>().HasIndex(x => x.Name);
        b.Entity<AuditEntry>().HasIndex(x => x.CreatedAt);
        b.Entity<AuditEntry>().HasIndex(x => x.Resource);
        b.Entity<SalesDocument>().HasIndex(x => x.Number).IsUnique();
        b.Entity<SalesDocument>().HasIndex(x => new { x.Type, x.Status });
        b.Entity<SalesDocument>().HasIndex(x => x.IssueDate);
        b.Entity<SalesDocument>().HasIndex(x => x.BranchId);

        // An item's / model's main supplier (a party). Restrict: a supplier with items can't vanish.
        b.Entity<Product>().HasIndex(p => p.SupplierId);
        b.Entity<Product>().HasOne(p => p.Supplier).WithMany()
            .HasForeignKey(p => p.SupplierId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ProductModel>().HasOne(m => m.Supplier).WithMany()
            .HasForeignKey(m => m.SupplierId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<Notification>().HasIndex(n => new { n.StaffId, n.CreatedAt });
        b.Entity<Notification>().HasOne(n => n.Staff).WithMany()
            .HasForeignKey(n => n.StaffId).OnDelete(DeleteBehavior.Cascade);

        // Sales departments (أقسام): groups of categories; each sale belongs to one.
        b.Entity<Category>().HasOne(c => c.Department).WithMany()
            .HasForeignKey(c => c.DepartmentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>().HasIndex(d => d.DepartmentId);
        b.Entity<SalesDocument>().HasOne(d => d.Department).WithMany()
            .HasForeignKey(d => d.DepartmentId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<Session>()
            .HasOne(s => s.Staff).WithMany(st => st.Sessions)
            .HasForeignKey(s => s.StaffId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<DocumentLine>()
            .HasOne(l => l.Document).WithMany(d => d.Lines)
            .HasForeignKey(l => l.DocumentId).OnDelete(DeleteBehavior.Cascade);

        // Returns point back at the invoice (and invoice line) they reverse. Restrict: an
        // invoice that has returns against it can never be deleted out from under them.
        b.Entity<SalesDocument>()
            .HasOne(d => d.SourceDocument).WithMany()
            .HasForeignKey(d => d.SourceDocumentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>().HasIndex(d => d.SourceDocumentId);
        b.Entity<DocumentLine>().HasIndex(l => l.SourceLineId);

        // Stock movements: indexed for the item card (per product, over time) and per store.
        b.Entity<StockMovement>().HasIndex(m => new { m.ProductId, m.CreatedAt });
        b.Entity<StockMovement>().HasIndex(m => m.BranchId);
        b.Entity<StockMovement>().HasIndex(m => m.DocumentId);
        b.Entity<StockMovement>()
            .HasOne(m => m.Product).WithMany()
            .HasForeignKey(m => m.ProductId).OnDelete(DeleteBehavior.Cascade);

        // Warehouses (مخازن) and per-warehouse stock. Restrict everywhere: a warehouse with
        // history can be deactivated, never deleted.
        b.Entity<Warehouse>().HasIndex(w => w.Code).IsUnique();
        b.Entity<Warehouse>().Property(w => w.Kind).HasConversion<string>();
        b.Entity<Warehouse>()
            .HasOne(w => w.Branch).WithMany(br => br.Warehouses)
            .HasForeignKey(w => w.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockBalance>().HasKey(x => new { x.ProductId, x.WarehouseId });
        b.Entity<StockBalance>().HasIndex(x => x.WarehouseId);
        b.Entity<StockBalance>()
            .HasOne(x => x.Product).WithMany()
            .HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StockBalance>()
            .HasOne(x => x.Warehouse).WithMany()
            .HasForeignKey(x => x.WarehouseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockMovement>().HasIndex(m => new { m.WarehouseId, m.ProductId, m.CreatedAt });
        b.Entity<StockMovement>()
            .HasOne(m => m.Warehouse).WithMany()
            .HasForeignKey(m => m.WarehouseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<DocumentLine>()
            .HasOne(l => l.Warehouse).WithMany()
            .HasForeignKey(l => l.WarehouseId).OnDelete(DeleteBehavior.Restrict);

        // Per-branch average cost. PoolId is a BranchId or the transit warehouse id, so no FK on it.
        b.Entity<StockCost>().HasKey(c => new { c.ProductId, c.PoolId });
        b.Entity<StockCost>()
            .HasOne(c => c.Product).WithMany()
            .HasForeignKey(c => c.ProductId).OnDelete(DeleteBehavior.Cascade);

        // Transfer permits. Warehouses and staff are Restrict: history keeps its references.
        b.Entity<StockTransfer>().Property(t => t.Status).HasConversion<string>();
        b.Entity<StockTransfer>().HasIndex(t => t.Number).IsUnique();
        b.Entity<StockTransfer>().HasIndex(t => new { t.Status, t.CreatedAt });
        b.Entity<StockTransfer>().HasIndex(t => t.FromWarehouseId);
        b.Entity<StockTransfer>().HasIndex(t => t.ToWarehouseId);
        b.Entity<StockTransfer>()
            .HasOne(t => t.FromWarehouse).WithMany()
            .HasForeignKey(t => t.FromWarehouseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransfer>()
            .HasOne(t => t.ToWarehouse).WithMany()
            .HasForeignKey(t => t.ToWarehouseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransfer>()
            .HasOne(t => t.CreatedBy).WithMany()
            .HasForeignKey(t => t.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransfer>()
            .HasOne(t => t.ReceivedBy).WithMany()
            .HasForeignKey(t => t.ReceivedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransfer>()
            .HasOne(t => t.CancelledBy).WithMany()
            .HasForeignKey(t => t.CancelledById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransferLine>()
            .HasOne(l => l.Transfer).WithMany(t => t.Lines)
            .HasForeignKey(l => l.TransferId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StockTransferLine>()
            .HasOne(l => l.Product).WithMany()
            .HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockTransferLine>().HasIndex(l => l.ProductId);

        // Units (وحدات). A barcode identifies one unit of one item, company-wide.
        b.Entity<ItemUnit>().HasIndex(u => new { u.ProductId, u.UnitId }).IsUnique();
        b.Entity<ItemUnit>().HasIndex(u => u.Barcode).IsUnique();
        b.Entity<ItemUnit>()
            .HasOne(u => u.Product).WithMany(p => p.Units)
            .HasForeignKey(u => u.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ItemUnit>()
            .HasOne(u => u.Unit).WithMany()
            .HasForeignKey(u => u.UnitId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<DocumentLine>()
            .HasOne(l => l.Unit).WithMany()
            .HasForeignKey(l => l.UnitId).OnDelete(DeleteBehavior.Restrict);

        // Price levels (مستويات الأسعار) and prices. UnitId on a price has no FK of its own: the
        // price goes with the item's (or model's) unit and is removed together with it.
        b.Entity<PriceLevel>().Property(l => l.Side).HasConversion<string>();
        b.Entity<ItemPrice>().HasKey(p => new { p.ProductId, p.UnitId, p.PriceLevelId });
        b.Entity<ItemPrice>()
            .HasOne(p => p.Product).WithMany()
            .HasForeignKey(p => p.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ItemPrice>()
            .HasOne(p => p.PriceLevel).WithMany()
            .HasForeignKey(p => p.PriceLevelId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Party>()
            .HasOne(p => p.SalesPriceLevel).WithMany()
            .HasForeignKey(p => p.SalesPriceLevelId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Party>()
            .HasOne(p => p.PurchasePriceLevel).WithMany()
            .HasForeignKey(p => p.PurchasePriceLevelId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SalesDocument>()
            .HasOne(d => d.PriceLevel).WithMany()
            .HasForeignKey(d => d.PriceLevelId).OnDelete(DeleteBehavior.Restrict);

        // Models (موديلات) and their size × color variants. A model has at most one variant per
        // size/color pair; "no size" counts as a value, so NULLs are not distinct.
        b.Entity<VariantOption>().Property(o => o.Kind).HasConversion<string>();
        b.Entity<ProductModel>().HasIndex(m => m.Code).IsUnique();
        b.Entity<ProductModel>()
            .HasOne(m => m.Category).WithMany()
            .HasForeignKey(m => m.CategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ModelUnit>().HasKey(u => new { u.ModelId, u.UnitId });
        b.Entity<ModelUnit>()
            .HasOne(u => u.Model).WithMany(m => m.Units)
            .HasForeignKey(u => u.ModelId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ModelUnit>()
            .HasOne(u => u.Unit).WithMany()
            .HasForeignKey(u => u.UnitId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ModelPrice>().HasKey(p => new { p.ModelId, p.UnitId, p.PriceLevelId });
        b.Entity<ModelPrice>()
            .HasOne(p => p.Model).WithMany()
            .HasForeignKey(p => p.ModelId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ModelPrice>()
            .HasOne<PriceLevel>().WithMany()
            .HasForeignKey(p => p.PriceLevelId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Product>()
            .HasOne(p => p.Model).WithMany(m => m.Variants)
            .HasForeignKey(p => p.ModelId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Product>()
            .HasOne(p => p.Size).WithMany()
            .HasForeignKey(p => p.SizeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Product>()
            .HasOne(p => p.Color).WithMany()
            .HasForeignKey(p => p.ColorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Product>().HasIndex(p => new { p.ModelId, p.SizeId, p.ColorId })
            .IsUnique().AreNullsDistinct(false).HasFilter("\"ModelId\" IS NOT NULL");

        // ---- Payroll & attendance ----
        b.Entity<Employee>().HasIndex(e => e.Code).IsUnique();
        b.Entity<Employee>().HasIndex(e => e.DeviceUserId).IsUnique().HasFilter("\"DeviceUserId\" IS NOT NULL");
        b.Entity<Employee>().HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Employee>().HasOne(e => e.Shift).WithMany().HasForeignKey(e => e.ShiftId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Employee>().HasOne(e => e.Staff).WithMany().HasForeignKey(e => e.StaffId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AttendanceDay>().HasIndex(a => new { a.EmployeeId, a.Date }).IsUnique();
        b.Entity<AttendanceDay>().HasOne(a => a.Employee).WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AttendanceDay>().Property(a => a.Status).HasConversion<string>();
        b.Entity<AttendanceDay>().Property(a => a.Source).HasConversion<string>();
        b.Entity<PayrollAdjustment>().HasIndex(a => new { a.Year, a.Month });
        b.Entity<PayrollAdjustment>().Property(a => a.Kind).HasConversion<string>();
        b.Entity<PayrollAdjustment>().HasOne(a => a.Employee).WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollAdjustment>().HasOne(a => a.CreatedBy).WithMany().HasForeignKey(a => a.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<EmployeeAdvance>().HasIndex(a => a.Number).IsUnique();
        b.Entity<EmployeeAdvance>().Property(a => a.Status).HasConversion<string>();
        b.Entity<EmployeeAdvance>().HasOne(a => a.Employee).WithMany().HasForeignKey(a => a.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<EmployeeAdvance>().HasOne(a => a.Account).WithMany().HasForeignKey(a => a.AccountId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<EmployeeAdvance>().HasOne(a => a.CreatedBy).WithMany().HasForeignKey(a => a.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollRun>().HasIndex(r => r.Number).IsUnique();
        b.Entity<PayrollRun>().HasIndex(r => new { r.Year, r.Month });
        b.Entity<PayrollRun>().Property(r => r.Status).HasConversion<string>();
        b.Entity<PayrollRun>().HasOne(r => r.Branch).WithMany().HasForeignKey(r => r.BranchId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollRun>().HasOne(r => r.CreatedBy).WithMany().HasForeignKey(r => r.CreatedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollRun>().HasOne(r => r.PostedBy).WithMany().HasForeignKey(r => r.PostedById).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollLine>().HasOne(l => l.Run).WithMany(r => r.Lines).HasForeignKey(l => l.RunId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PayrollLine>().HasOne(l => l.Employee).WithMany().HasForeignKey(l => l.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PayrollLine>().HasIndex(l => new { l.RunId, l.EmployeeId }).IsUnique();

        b.HasDbFunction(typeof(AppDbContext).GetMethod(nameof(LocalTime))!).HasName("timezone").IsBuiltIn()
            .HasStoreType("timestamp without time zone");

        base.OnModelCreating(b);
    }

    /// <summary>
    /// In a query only: the wall-clock time of a UTC instant in a time zone (PostgreSQL
    /// <c>timezone(zone, instant)</c>), to group by the company's days and months.
    /// </summary>
    public static DateTime LocalTime(string zone, DateTime instant) => throw new NotSupportedException();
}
