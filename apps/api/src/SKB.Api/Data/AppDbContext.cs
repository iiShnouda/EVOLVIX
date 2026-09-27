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

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Store enums as readable strings in Postgres.
        b.Entity<Staff>().Property(s => s.Role).HasConversion<string>();
        b.Entity<SalesDocument>().Property(d => d.Type).HasConversion<string>();
        b.Entity<SalesDocument>().Property(d => d.Status).HasConversion<string>();

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

        base.OnModelCreating(b);
    }
}
