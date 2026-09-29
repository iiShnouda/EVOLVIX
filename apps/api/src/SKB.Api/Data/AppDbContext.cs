using Microsoft.EntityFrameworkCore;

namespace SKB.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Category> Categories => Set<Category>();
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

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Store enums as readable strings in Postgres.
        b.Entity<Staff>().Property(s => s.Role).HasConversion<string>();
        b.Entity<RolePermissionSet>().HasKey(r => r.Role);
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

        base.OnModelCreating(b);
    }
}
