using Microsoft.EntityFrameworkCore;
using SKB.Api.Domain;
using SKB.Api.Services;

namespace SKB.Api.Data;

/// <summary>
/// Seeds a coherent wholesale-office dataset whose totals tie back to the dashboard.
/// Runs only when the database has no staff yet (idempotent on a fresh DB).
/// </summary>
public static class DbSeeder
{
    private const string Currency = "EGP";
    private const double Vat = 0.14;

    private static long Money(double major) => (long)Math.Round(major * 100);

    public static async Task SeedAsync(AppDbContext db, AuthService auth, IConfiguration config)
    {
        await db.Database.MigrateAsync();
        if (await db.Staff.AnyAsync()) return;

        var main = new Branch { Name = "Main Branch", Code = "MAIN", Location = "Cairo — Downtown" };
        var wh = new Branch { Name = "Warehouse Branch", Code = "WH2", Location = "6th of October — Industrial" };
        db.Branches.AddRange(main, wh);

        var ownerEmail = (config["Seed:OwnerEmail"] ?? "owner@skb.local").ToLowerInvariant();
        var ownerPassword = config["Seed:OwnerPassword"] ?? "ChangeMe!Owner123";
        const string staffPassword = "ChangeMe!Staff123";

        var owner = new Staff { FullName = "Founder Owner", Email = ownerEmail, Role = Role.OWNER, Branch = main, PasswordHash = auth.HashPassword(ownerPassword), Phone = "+20 100 000 0001" };
        var accountant = new Staff { FullName = "Mona Accountant", Email = "mona@skb.local", Role = Role.ACCOUNTANT, Branch = main, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0002" };
        var sales = new Staff { FullName = "Karim Sales", Email = "karim@skb.local", Role = Role.SALES, Branch = main, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0003" };
        var stock = new Staff { FullName = "Sara Stock", Email = "sara@skb.local", Role = Role.INVENTORY, Branch = wh, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0004" };
        db.Staff.AddRange(owner, accountant, sales, stock);

        var beverages = new Category { Name = "Beverages" };
        var snacks = new Category { Name = "Snacks" };
        var cleaning = new Category { Name = "Cleaning" };
        var packaging = new Category { Name = "Packaging" };
        db.Categories.AddRange(beverages, snacks, cleaning, packaging);

        var products = new List<Product>
        {
            new() { Sku = "BEV-001", Name = "Mineral Water 1.5L (Pack of 6)", Category = beverages, Unit = "pack", CostPrice = Money(24), SalePrice = Money(33), Currency = Currency, StockOnHand = 480, ReorderLevel = 100 },
            new() { Sku = "BEV-002", Name = "Cola 330ml (Case of 24)", Category = beverages, Unit = "case", CostPrice = Money(96), SalePrice = Money(126), Currency = Currency, StockOnHand = 60, ReorderLevel = 80 },
            new() { Sku = "SNK-001", Name = "Salted Chips 25g (Box of 40)", Category = snacks, Unit = "box", CostPrice = Money(80), SalePrice = Money(112), Currency = Currency, StockOnHand = 140, ReorderLevel = 50 },
            new() { Sku = "SNK-002", Name = "Biscuits Assorted (Box of 24)", Category = snacks, Unit = "box", CostPrice = Money(120), SalePrice = Money(168), Currency = Currency, StockOnHand = 18, ReorderLevel = 40 },
            new() { Sku = "CLN-001", Name = "Dish Soap 1L (Pack of 12)", Category = cleaning, Unit = "pack", CostPrice = Money(144), SalePrice = Money(198), Currency = Currency, StockOnHand = 96, ReorderLevel = 30 },
            new() { Sku = "CLN-002", Name = "Bleach 2L (Pack of 8)", Category = cleaning, Unit = "pack", CostPrice = Money(96), SalePrice = Money(140), Currency = Currency, StockOnHand = 12, ReorderLevel = 25 },
            new() { Sku = "PKG-001", Name = "Carton Box Large (Bundle of 25)", Category = packaging, Unit = "bundle", CostPrice = Money(75), SalePrice = Money(110), Currency = Currency, StockOnHand = 300, ReorderLevel = 60 },
            new() { Sku = "PKG-002", Name = "Stretch Wrap Roll", Category = packaging, Unit = "roll", CostPrice = Money(60), SalePrice = Money(92), Currency = Currency, StockOnHand = 8, ReorderLevel = 20 },
        };
        db.Products.AddRange(products);

        // Company settings (single row): costing + profit-floor defaults, editable later in Settings.
        db.CompanySettings.Add(new CompanySettings
        {
            CompanyName = "SKB Wholesale", Country = "EG", Currency = Currency,
            DefaultMarkupPercent = 10, MinMarkupPercent = 0, DefaultTaxPercent = 0,
        });

        // Opening stock movement per product, so the item card (كارت الصنف) has a starting point
        // and stock valuation ties out from day one.
        foreach (var p in products)
        {
            db.StockMovements.Add(new StockMovement
            {
                ProductId = p.Id, BranchId = main.Id, Type = StockMovementType.OPENING,
                Quantity = p.StockOnHand, UnitCost = p.CostPrice,
                BalanceAfter = p.StockOnHand, AvgCostAfter = p.CostPrice, Reference = "Opening balance",
            });
        }

        var c1 = new Party { Name = "Al-Nour Supermarket", Types = { "CUSTOMER" }, Phone = "+20 122 111 2222", Balance = Money(18450), Currency = Currency };
        var c2 = new Party { Name = "City Mart Chain", Types = { "CUSTOMER" }, Phone = "+20 122 333 4444", Balance = Money(7320), Currency = Currency };
        var c3 = new Party { Name = "Green Valley Grocery", Types = { "CUSTOMER" }, Phone = "+20 122 555 6666", Balance = 0, Currency = Currency };
        var s1 = new Party { Name = "Delta Distribution Co.", Types = { "SUPPLIER" }, Phone = "+20 155 777 8888", Balance = Money(-9600), Currency = Currency };
        var s2 = new Party { Name = "Nile Beverages Factory", Types = { "SUPPLIER", "FACTORY" }, Phone = "+20 155 999 0000", Balance = Money(-14250), Currency = Currency };
        var s3 = new Party { Name = "Pyramid Packaging Factory", Types = { "FACTORY", "SUPPLIER" }, Phone = "+20 155 121 3141", Balance = Money(-3200), Currency = Currency };
        db.Parties.AddRange(c1, c2, c3, s1, s2, s3);

        var salesSeq = 0;
        var purchaseSeq = 0;

        SalesDocument Doc(DocumentType type, DocumentStatus status, Party party, Staff staff, Branch branch,
            int issuedAgo, int? dueInDays, double paidRatio, (int idx, int qty, double disc)[] lines)
        {
            var isPurchase = type == DocumentType.PURCHASE_INVOICE;
            var number = isPurchase
                ? $"PUR-2026-{(++purchaseSeq):D6}"
                : $"INV-2026-{(++salesSeq):D6}";

            var lineList = lines.Select(l =>
            {
                var product = products[l.idx];
                var unit = isPurchase ? product.CostPrice : product.SalePrice;
                var disc = Money(l.disc);
                var lineTotal = (long)l.qty * unit - disc;
                var unitCost = product.CostPrice;             // weighted-average cost snapshot
                var lineCost = (long)l.qty * unitCost;
                var lineProfit = isPurchase ? 0 : lineTotal - lineCost;
                return new DocumentLine
                {
                    Product = product, ProductName = product.Name, Quantity = l.qty,
                    UnitPrice = unit, Discount = disc, LineTotal = lineTotal,
                    UnitCost = unitCost, LineCost = lineCost, LineProfit = lineProfit,
                };
            }).ToList();

            var subtotal = lineList.Sum(l => (long)l.Quantity * l.UnitPrice);
            var discountTotal = lineList.Sum(l => l.Discount);
            var taxable = subtotal - discountTotal;
            var tax = (long)Math.Round(taxable * Vat);
            var grand = taxable + tax;
            var costTotal = lineList.Sum(l => l.LineCost);
            var profitTotal = isPurchase ? 0 : taxable - costTotal;
            var issue = DateTime.UtcNow.Date.AddDays(-issuedAgo).AddHours(10);

            return new SalesDocument
            {
                Number = number, Type = type, Status = status, Branch = branch, Party = party, Staff = staff,
                IssueDate = issue, DueDate = dueInDays is null ? null : issue.AddDays(dueInDays.Value),
                Subtotal = subtotal, DiscountTotal = discountTotal, TaxTotal = tax, GrandTotal = grand,
                CostTotal = costTotal, ProfitTotal = profitTotal,
                PaidAmount = (long)Math.Round(grand * paidRatio), Currency = Currency, Lines = lineList,
            };
        }

        db.SalesDocuments.AddRange(
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.PAID, c1, sales, main, 6, 30, 1, new[] { (0, 40, 0.0), (2, 10, 50.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.PARTIALLY_PAID, c2, sales, main, 5, 30, 0.5, new[] { (4, 12, 0.0), (6, 20, 0.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.CONFIRMED, c3, sales, main, 4, 15, 0, new[] { (1, 8, 0.0), (3, 6, 0.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.OVERDUE, c1, accountant, main, 20, 7, 0, new[] { (0, 24, 0.0), (5, 5, 0.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.PAID, c2, sales, main, 3, 30, 1, new[] { (2, 15, 0.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.CONFIRMED, c3, sales, main, 1, 30, 0, new[] { (6, 30, 0.0), (4, 6, 0.0) }),
            Doc(DocumentType.SALES_INVOICE, DocumentStatus.PAID, c1, sales, main, 0, 30, 1, new[] { (0, 12, 0.0), (2, 8, 0.0) }),
            Doc(DocumentType.PURCHASE_INVOICE, DocumentStatus.CONFIRMED, s1, accountant, wh, 5, 45, 0, new[] { (4, 30, 0.0), (6, 40, 0.0) }),
            Doc(DocumentType.PURCHASE_INVOICE, DocumentStatus.PARTIALLY_PAID, s2, accountant, wh, 2, 45, 0.4, new[] { (0, 100, 0.0), (1, 20, 0.0) }));

        await db.SaveChangesAsync();
    }
}
