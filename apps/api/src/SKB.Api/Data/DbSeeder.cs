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

    /// <summary>
    /// The starter units of measure. Names are kept as typed (owner decision 2026-09-29); the
    /// company's starter lists (units, price levels) are in Arabic, its working language.
    /// </summary>
    private static readonly (string Key, string Name)[] DemoUnits =
    {
        ("pc", "قطعة"), ("pack", "عبوة"), ("case", "صندوق"), ("box", "علبة"),
        ("bundle", "ربطة"), ("roll", "رول"), ("carton", "كرتونة"), ("dozen", "دستة"),
    };

    /// <summary>Items saved before search keys existed get theirs (a save keeps them in step after that).</summary>
    private static async Task FillSearchKeysAsync(AppDbContext db)
    {
        while (true)
        {
            var batch = await db.Products.Where(p => p.SearchKey == "").Take(500).ToListAsync();
            if (batch.Count == 0) return;
            foreach (var p in batch) db.Entry(p).Property(x => x.SearchKey).IsModified = true;
            await db.SaveChangesAsync();
        }
    }

    public static async Task SeedAsync(AppDbContext db, AuthService auth, IConfiguration config)
    {
        await db.Database.MigrateAsync();
        await Seasons.EnsureAsync(db);
        await FillSearchKeysAsync(db);
        if (await db.Staff.AnyAsync()) return;

        var main = new Branch { Name = "Main Branch", Code = "MAIN", Location = "Cairo — Downtown" };
        var wh = new Branch { Name = "Warehouse Branch", Code = "WH2", Location = "6th of October — Industrial" };
        db.Branches.AddRange(main, wh);

        // One store room per branch; each is its branch's default warehouse.
        var mainStore = new Warehouse { Name = "Downtown store", Code = "MAIN-1", Branch = main, IsDefault = true };
        var octoberStore = new Warehouse { Name = "October warehouse", Code = "WH2-1", Branch = wh, IsDefault = true };
        db.Warehouses.AddRange(mainStore, octoberStore);
        // System warehouse holding goods between sending and receiving a transfer.
        db.Warehouses.Add(new Warehouse
        {
            Name = "In transit",
            Code = "TRANSIT", Branch = main, Kind = WarehouseKind.TRANSIT,
        });

        var ownerEmail = (config["Seed:OwnerEmail"] ?? "owner@skb.local").ToLowerInvariant();
        var ownerPassword = config["Seed:OwnerPassword"] ?? "ChangeMe!Owner123";
        const string staffPassword = "ChangeMe!Staff123";

        var owner = new Staff { FullName = "Founder Owner", Email = ownerEmail, Role = Role.OWNER, Branch = main, PasswordHash = auth.HashPassword(ownerPassword), Phone = "+20 100 000 0001" };
        var accountant = new Staff { FullName = "Mona Accountant", Email = "mona@skb.local", Role = Role.ACCOUNTANT, Branch = main, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0002" };
        var sales = new Staff { FullName = "Karim Sales", Email = "karim@skb.local", Role = Role.SALES, Branch = main, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0003" };
        var stock = new Staff { FullName = "Sara Stock", Email = "sara@skb.local", Role = Role.INVENTORY, Branch = wh, PasswordHash = auth.HashPassword(staffPassword), Phone = "+20 100 000 0004" };
        db.Staff.AddRange(owner, accountant, sales, stock);

        // Money accounts (DOMAIN.md §2.6): each branch's cash box, a bank account and a wallet, with
        // what was in them when the company started using SKB.
        MoneyAccount Opening(MoneyAccount account, double amount)
        {
            account.Currency = Currency;
            account.Balance = Money(amount);
            account.LastSeq = 1;
            db.MoneyMovements.Add(new MoneyMovement
            {
                Account = account, Seq = 1, Amount = account.Balance, BalanceAfter = account.Balance,
                Kind = MoneyMovementKind.OPENING, Notes = "Opening balance", CreatedBy = owner,
            });
            return account;
        }
        db.MoneyAccounts.AddRange(
            Opening(new MoneyAccount { Name = "Main cash box", Kind = MoneyAccountKind.CASH_BOX, Branch = main, IsDefault = true, IsMain = true }, 25000),
            Opening(new MoneyAccount { Name = "October cash box", Kind = MoneyAccountKind.CASH_BOX, Branch = wh, IsDefault = true }, 8000),
            Opening(new MoneyAccount { Name = "Company bank account", Kind = MoneyAccountKind.BANK, Branch = main, BankName = "National Bank", Number = "1234-5678-90" }, 120000),
            Opening(new MoneyAccount { Name = "Vodafone Cash", Kind = MoneyAccountKind.WALLET, Branch = main, Number = "010 0000 0009" }, 3500),
            // Each store's own box, handed up to its branch's (owner, 2026-10-02).
            new MoneyAccount { Name = "Downtown store", Kind = MoneyAccountKind.CASH_BOX, Branch = main, Warehouse = mainStore },
            new MoneyAccount { Name = "October warehouse", Kind = MoneyAccountKind.CASH_BOX, Branch = wh, Warehouse = octoberStore });

        var beverages = new Category { Name = "Beverages" };
        var snacks = new Category { Name = "Snacks" };
        var cleaning = new Category { Name = "Cleaning" };
        var packaging = new Category { Name = "Packaging" };
        db.Categories.AddRange(beverages, snacks, cleaning, packaging);

        var products = new List<Product>
        {
            new() { Sku = "BEV-001", Name = "Mineral Water 1.5L (Pack of 6)", Category = beverages, CostPrice = Money(24), SalePrice = Money(33), Currency = Currency, StockOnHand = 480, ReorderLevel = 100 },
            new() { Sku = "BEV-002", Name = "Cola 330ml (Case of 24)", Category = beverages, CostPrice = Money(96), SalePrice = Money(126), Currency = Currency, StockOnHand = 60, ReorderLevel = 80 },
            new() { Sku = "SNK-001", Name = "Salted Chips 25g (Box of 40)", Category = snacks, CostPrice = Money(80), SalePrice = Money(112), Currency = Currency, StockOnHand = 140, ReorderLevel = 50 },
            new() { Sku = "SNK-002", Name = "Biscuits Assorted (Box of 24)", Category = snacks, CostPrice = Money(120), SalePrice = Money(168), Currency = Currency, StockOnHand = 18, ReorderLevel = 40 },
            new() { Sku = "CLN-001", Name = "Dish Soap 1L (Pack of 12)", Category = cleaning, CostPrice = Money(144), SalePrice = Money(198), Currency = Currency, StockOnHand = 96, ReorderLevel = 30 },
            new() { Sku = "CLN-002", Name = "Bleach 2L (Pack of 8)", Category = cleaning, CostPrice = Money(96), SalePrice = Money(140), Currency = Currency, StockOnHand = 12, ReorderLevel = 25 },
            new() { Sku = "PKG-001", Name = "Carton Box Large (Bundle of 25)", Category = packaging, CostPrice = Money(75), SalePrice = Money(110), Currency = Currency, StockOnHand = 300, ReorderLevel = 60 },
            new() { Sku = "PKG-002", Name = "Stretch Wrap Roll", Category = packaging, CostPrice = Money(60), SalePrice = Money(92), Currency = Currency, StockOnHand = 8, ReorderLevel = 20 },
        };
        db.Products.AddRange(products);
        var apparel = new Category { Name = "Apparel" };
        db.Categories.Add(apparel);

        // ---- Units (base unit + larger ones, a barcode each) and the two price levels ----
        var units = DemoUnits.ToDictionary(u => u.Key, u => new Unit { Name = u.Name });
        db.Units.AddRange(units.Values);
        var customerPrice = new PriceLevel
        {
            Name = "سعر العملاء",
            Side = PriceSide.SALE, IsDefault = true, SortOrder = 1,
        };
        var supplierPrice = new PriceLevel
        {
            Name = "سعر الموردين",
            Side = PriceSide.PURCHASE, IsDefault = true, SortOrder = 1,
        };
        db.PriceLevels.AddRange(customerPrice, supplierPrice);

        // Base unit of each item, plus a carton for a few (with its own, slightly better, price).
        var baseUnitOf = new[] { "pack", "case", "box", "box", "pack", "pack", "bundle", "roll" };
        var cartons = new Dictionary<int, (int Factor, double Price)> { [0] = (4, 128), [2] = (10, 1080), [7] = (6, 540) };
        for (var i = 0; i < products.Count; i++)
        {
            var p = products[i];
            db.ItemUnits.Add(new ItemUnit { Product = p, Unit = units[baseUnitOf[i]], Factor = 1, Barcode = $"62210000{i + 1:D5}" });
            db.ItemPrices.Add(new ItemPrice { Product = p, UnitId = units[baseUnitOf[i]].Id, PriceLevel = customerPrice, Price = p.SalePrice });
            db.ItemPrices.Add(new ItemPrice { Product = p, UnitId = units[baseUnitOf[i]].Id, PriceLevel = supplierPrice, Price = p.CostPrice });
            if (cartons.TryGetValue(i, out var carton))
            {
                db.ItemUnits.Add(new ItemUnit { Product = p, Unit = units["carton"], Factor = carton.Factor, Barcode = $"62219000{i + 1:D5}" });
                db.ItemPrices.Add(new ItemPrice { Product = p, UnitId = units["carton"].Id, PriceLevel = customerPrice, Price = Money(carton.Price) });
            }
        }

        // ---- A model made in sizes x colors: every variant is its own item with its own stock ----
        var sizes = new[] { "M", "L", "XL" }.Select((n, i) => new VariantOption
            { Kind = VariantKind.SIZE, Name = n, SortOrder = i + 1 }).ToList();
        var colors = new[] { "Black", "White" }.Select((c, i) => new VariantOption
            { Kind = VariantKind.COLOR, Name = c, SortOrder = i + 1 }).ToList();
        db.VariantOptions.AddRange(sizes.Concat(colors));
        var tshirt = new ProductModel
        {
            Name = "Basic T-shirt",
            Code = "TSH", Category = apparel, ReorderLevel = 12,
        };
        db.ProductModels.Add(tshirt);
        db.ModelUnits.Add(new ModelUnit { Model = tshirt, Unit = units["pc"], Factor = 1 });
        db.ModelUnits.Add(new ModelUnit { Model = tshirt, Unit = units["dozen"], Factor = 12 });
        db.ModelPrices.Add(new ModelPrice { Model = tshirt, UnitId = units["pc"].Id, PriceLevelId = customerPrice.Id, Price = Money(120) });
        db.ModelPrices.Add(new ModelPrice { Model = tshirt, UnitId = units["dozen"].Id, PriceLevelId = customerPrice.Id, Price = Money(1300) });
        db.ModelPrices.Add(new ModelPrice { Model = tshirt, UnitId = units["pc"].Id, PriceLevelId = supplierPrice.Id, Price = Money(80) });
        var variantNo = 0;
        foreach (var color in colors)
            foreach (var size in sizes)
            {
                variantNo++;
                var v = new Product
                {
                    Sku = $"TSH-{color.Name.ToUpperInvariant()}-{size.Name}", Model = tshirt, ModelId = tshirt.Id,
                    Size = size, SizeId = size.Id, Color = color, ColorId = color.Id, Category = apparel,
                    CostPrice = Money(80), SalePrice = Money(120), Currency = Currency, StockOnHand = 24, ReorderLevel = 12,
                };
                Catalog.ComposeVariantName(v, tshirt, size, color);
                db.Products.Add(v);
                db.ItemUnits.Add(new ItemUnit { Product = v, Unit = units["pc"], Factor = 1, Barcode = $"62230000{variantNo:D5}" });
                db.ItemUnits.Add(new ItemUnit { Product = v, Unit = units["dozen"], Factor = 12 });
                products.Add(v);
            }

        // Company settings (single row): costing + profit-floor defaults, editable later in Settings.
        db.CompanySettings.Add(new CompanySettings
        {
            CompanyName = "SKB Wholesale", Country = "EG", Currency = Currency,
            DefaultMarkupPercent = 10, MinMarkupPercent = 0, DefaultTaxPercent = 0,
        });

        // Opening stock per product and warehouse, so the item card (كارت الصنف) has a starting
        // point and stock valuation ties out from day one. Fast movers keep ~30% in the October
        // warehouse; everything else sits in the downtown store.
        foreach (var p in products)
        {
            var october = p.StockOnHand >= 100 ? p.StockOnHand * 3 / 10 : 0;
            var running = 0;
            foreach (var (store, qty) in new[] { (mainStore, p.StockOnHand - october), (octoberStore, october) })
            {
                if (qty == 0) continue;
                running += qty;
                db.StockBalances.Add(new StockBalance { Product = p, Warehouse = store, Quantity = qty });
                // Cost is per branch; each branch starts at the item's opening cost.
                db.StockCosts.Add(new StockCost { Product = p, PoolId = store.Branch!.Id, AvgCost = p.CostPrice });
                db.StockMovements.Add(new StockMovement
                {
                    ProductId = p.Id, BranchId = store.Branch!.Id, WarehouseId = store.Id,
                    Type = StockMovementType.OPENING, Quantity = qty, UnitCost = p.CostPrice,
                    BalanceAfter = running, WarehouseBalanceAfter = qty, AvgCostAfter = p.CostPrice,
                    Reference = "Opening balance",
                });
            }
        }

        var c1 = new Party { Name = "Al-Nour Supermarket", Types = { "CUSTOMER" }, Phone = "+20 122 111 2222", Address = "12 Tahrir St., Dokki, Giza", Balance = Money(18450), Currency = Currency };
        var c2 = new Party { Name = "City Mart Chain", Types = { "CUSTOMER" }, Phone = "+20 122 333 4444", Balance = Money(7320), Currency = Currency };
        var c3 = new Party { Name = "Green Valley Grocery", Types = { "CUSTOMER" }, Phone = "+20 122 555 6666", Balance = 0, Currency = Currency };
        var s1 = new Party { Name = "Delta Distribution Co.", Types = { "SUPPLIER" }, Phone = "+20 155 777 8888", Balance = Money(-9600), Currency = Currency };
        var s2 = new Party { Name = "Nile Beverages Factory", Types = { "SUPPLIER" }, ContactName = "Hassan Nile", Phone = "+20 155 999 0000", OtherPhones = { "+20 2 2345 6789" }, Address = "10th of Ramadan — Industrial Zone A", Balance = Money(-14250), Currency = Currency };
        var s3 = new Party { Name = "Pyramid Packaging Factory", Types = { "SUPPLIER" }, ContactName = "Adel Pyramid", Phone = "+20 155 121 3141", Address = "Giza — Abu Rawash Industrial Area", Balance = Money(-3200), Currency = Currency };
        // A shipping company (DOMAIN.md §2.5): parcels it delivers with cash on delivery go on its account.
        var k1 = new Party { Name = "Swift Courier", Types = { "CARRIER" }, Phone = "+20 100 222 3333", Balance = 0, Currency = Currency };
        db.Parties.AddRange(c1, c2, c3, s1, s2, s3, k1);

        var salesSeq = 0;
        var purchaseSeq = 0;

        SalesDocument Doc(DocumentType type, DocumentStatus status, Party party, Staff staff, Branch branch,
            int issuedAgo, int? dueInDays, double paidRatio, (int idx, int qty, double disc)[] lines)
        {
            var isPurchase = type == DocumentType.PURCHASE_INVOICE;
            var number = isPurchase
                ? $"PUR-2026-{(++purchaseSeq):D6}"
                : $"INV-2026-{(++salesSeq):D6}";

            var lineList = lines.Select((l, index) =>
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
                    LineNo = index + 1, Warehouse = branch == main ? mainStore : octoberStore,
                    Product = product, ProductName = product.Name, Quantity = l.qty,
                    UnitId = units[baseUnitOf[l.idx]].Id, UnitFactor = 1, UnitQuantity = l.qty,
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
                PriceLevel = isPurchase ? supplierPrice : customerPrice,
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
