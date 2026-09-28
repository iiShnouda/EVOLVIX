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
    public DbSet<StockTransferLine> StockTransferLines => Set<StockTransferLine>();
    public DbSet<CompanySettings> CompanySettings => Set<CompanySettings>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Store enums as readable strings in Postgres.
        b.Entity<Staff>().Property(s => s.Role).HasConversion<string>();
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

        base.OnModelCreating(b);
    }
}
