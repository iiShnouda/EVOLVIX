using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Items (الأصناف): search for invoice lines (name / SKU / any unit's barcode), and the item editor —
/// name, category, units with their barcodes, and prices per unit and level.
/// Adding needs <c>products:create</c>, editing <c>products:edit</c>, prices <c>prices:edit</c>.
/// A variant (size × color of a model) takes its name, category and units from its model; here it
/// can change its SKU, barcodes, reorder level, active state and prices.
/// </summary>
[ApiController]
[Route("api/products")]
[Authorize]
public sealed class ProductsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    private readonly WarehouseService _warehouses;
    private readonly StorefrontPublisher _storefront;

    public ProductsController(AppDbContext db, AuditService audit, WarehouseService warehouses, StorefrontPublisher storefront)
    {
        _db = db;
        _audit = audit;
        _warehouses = warehouses;
        _storefront = storefront;
    }

    /// <summary>
    /// Product search for invoice lines: name, SKU, barcode, the supplier's code, or a price (typing
    /// "330" finds items priced 330 at any unit and level). <paramref name="supplierId"/> keeps only
    /// that supplier's items. An exact barcode comes first with <c>matchedUnitId</c> set, so scanning
    /// a carton adds a carton. Supplier-side prices only match for people who work with purchases,
    /// since they sit close to cost.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = Lookups.Products)]
    public async Task<ActionResult<ProductDto[]>> List(
        [FromQuery] string? search = null, [FromQuery] bool inStockOnly = false, [FromQuery] int limit = 50,
        [FromQuery] string? supplierId = null, [FromQuery] string? departmentId = null,
        [FromQuery] string? categoryId = null,
        // The detailed search (البحث المفصل), as in the old program (owner, 2026-10-01): the code and the
        // name each "contain" what's typed, a list-price range, and stock: in, out, or at/below the reorder level.
        [FromQuery] string? code = null, [FromQuery] string? name = null,
        [FromQuery] long? minPrice = null, [FromQuery] long? maxPrice = null, [FromQuery] string? stock = null,
        [FromQuery] string? seasonId = null,
        // Ranges for the finder (owner, 2026-10-01): =, > and < come as from/to bounds. Cost only for
        // people who may see it.
        [FromQuery] long? costMin = null, [FromQuery] long? costMax = null,
        [FromQuery] int? reorderMin = null, [FromQuery] int? reorderMax = null,
        [FromQuery] int? stockMin = null, [FromQuery] int? stockMax = null,
        [FromQuery] string? warehouseId = null, [FromQuery] int offset = 0,
        // A branch's warehouses (owner, 2026-10-02: branch, warehouse and department in the finder),
        // and only the department's own items, not those of no department.
        [FromQuery] string? branchId = null, [FromQuery] bool onlyDepartment = false,
        // A group of a department's tree and everything under it (owner, 2026-10-06).
        [FromQuery] string? groupId = null)
    {
        limit = Math.Clamp(limit, 1, 200);
        offset = Math.Max(0, offset);
        var q = _db.Products.AsNoTracking().Where(p => p.IsActive);

        // A warehouse or a branch: the stock counted is what is there (and only what the person may see).
        IQueryable<Guid>? stores = null;
        if (Guid.TryParse(warehouseId, out var wh))
            stores = _warehouses.Visible(User).Where(w => w.Id == wh).Select(w => w.Id);
        else if (Guid.TryParse(branchId, out var br))
            stores = _warehouses.Visible(User).Where(w => w.BranchId == br && w.Kind != WarehouseKind.TRANSIT)
                .Select(w => w.Id);
        if (stores is not null)
        {
            var held = _db.StockBalances.Where(b => stores.Contains(b.WarehouseId));
            q = q.Where(p => held.Any(b => b.ProductId == p.Id));
            if (inStockOnly || stock == "in") q = q.Where(p => held.Where(b => b.ProductId == p.Id).Sum(b => b.Quantity) > 0);
            else if (stock == "out") q = q.Where(p => held.Where(b => b.ProductId == p.Id).Sum(b => b.Quantity) <= 0);
            else if (stock == "low")
                q = q.Where(p => p.ReorderLevel > 0 && held.Where(b => b.ProductId == p.Id).Sum(b => b.Quantity) <= p.ReorderLevel);
            if (stockMin is int wMin) q = q.Where(p => held.Where(b => b.ProductId == p.Id).Sum(b => b.Quantity) >= wMin);
            if (stockMax is int wMax) q = q.Where(p => held.Where(b => b.ProductId == p.Id).Sum(b => b.Quantity) <= wMax);
        }
        else
        {
            if (inStockOnly || stock == "in") q = q.Where(p => p.StockOnHand > 0);
            else if (stock == "out") q = q.Where(p => p.StockOnHand <= 0);
            else if (stock == "low") q = q.Where(p => p.ReorderLevel > 0 && p.StockOnHand <= p.ReorderLevel);
            if (stockMin is int sMin) q = q.Where(p => p.StockOnHand >= sMin);
            if (stockMax is int sMax) q = q.Where(p => p.StockOnHand <= sMax);
        }
        if (!string.IsNullOrWhiteSpace(code))
        {
            var c = code.Trim().ToLower();
            q = q.Where(p => p.Sku.ToLower().Contains(c) || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(c))
                             || p.Units.Any(u => u.Barcode != null && u.Barcode.ToLower().Contains(c)));
        }
        List<Category>? tree = null;
        async Task<List<Category>> Tree() => tree ??= await _db.Categories.AsNoTracking().ToListAsync();
        if (!string.IsNullOrWhiteSpace(groupId))
        {
            if (!Guid.TryParse(groupId, out var gid))
                return BadRequest(new { message = "Group not found.", code = "group_not_found" });
            var under = Catalog.Subtree(gid, await Tree()).ToList();
            q = q.Where(p => under.Contains(p.CategoryId));
        }
        if (Costs.CanSee(User))
        {
            if (costMin is long cMin) q = q.Where(p => p.CostPrice >= cMin);
            if (costMax is long cMax) q = q.Where(p => p.CostPrice <= cMax);
        }
        if (reorderMin is int rMin) q = q.Where(p => p.ReorderLevel >= rMin);
        if (reorderMax is int rMax) q = q.Where(p => p.ReorderLevel <= rMax);
        if (minPrice is long min) q = q.Where(p => p.SalePrice >= min);
        if (maxPrice is long max) q = q.Where(p => p.SalePrice <= max);
        if (Guid.TryParse(categoryId, out var category)) q = q.Where(p => p.CategoryId == category);
        if (Guid.TryParse(seasonId, out var season)) q = q.Where(p => p.SeasonId == season);
        // A department's items (and items of no department); people limited to departments see only theirs.
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var dept))
                return BadRequest(new { message = "Department not found.", code = "department_not_found" });
            q = onlyDepartment
                ? q.Where(p => p.Category!.DepartmentId == dept)
                : q.Where(p => p.Category!.DepartmentId == null || p.Category.DepartmentId == dept);
        }
        if (Access.Departments(User) is { } mine)
            q = q.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
        // "none" = items with no supplier (بدون).
        if (supplierId == "none") q = q.Where(p => p.SupplierId == null);
        else if (!string.IsNullOrWhiteSpace(supplierId))
        {
            if (!Guid.TryParse(supplierId, out var sup))
                return BadRequest(new { message = "Unknown supplier.", code = "supplier_not_found" });
            q = q.Where(p => p.SupplierId == sup);
        }

        // What a slipped letter is tried against: every filter but the typed words.
        var fuzzyBase = q;
        string[] searchWords = Array.Empty<string>();
        // The name: every typed word, folded (letter forms made one) and by its outline (owner,
        // 2026-10-06), so "فنيله" finds "فانلة"; a word naming a group finds that group's items.
        string[] nameWords = Array.Empty<string>();
        if (!string.IsNullOrWhiteSpace(name))
        {
            nameWords = TextKey.Words(name);
            q = await ByWordsAsync(q, nameWords, await Tree());
        }

        ItemUnit? exact = null;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var s = term.ToLower();
            exact = await _db.ItemUnits.AsNoTracking()
                .Where(u => u.Barcode != null && u.Barcode.ToLower() == s && u.Product!.IsActive)
                .FirstOrDefaultAsync();
            if (Catalog.ParseAmount(term) is long price)
            {
                var seePurchase = Costs.CanSeePurchasePrices(User);
                var levels = await _db.PriceLevels.AsNoTracking()
                    .Where(l => l.Side == PriceSide.SALE || seePurchase).Select(l => l.Id).ToListAsync();
                q = q.Where(p => p.Name.ToLower().Contains(s) || p.Sku.ToLower().Contains(s)
                    || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(s))
                    || p.Units.Any(u => u.Barcode != null && u.Barcode.ToLower().Contains(s))
                    || p.SalePrice == price
                    || _db.ItemPrices.Any(ip => ip.ProductId == p.Id && ip.Price == price && levels.Contains(ip.PriceLevelId))
                    || (p.ModelId != null && _db.ModelPrices.Any(mp =>
                        mp.ModelId == p.ModelId && mp.Price == price && levels.Contains(mp.PriceLevelId))));
            }
            else
            {
                searchWords = TextKey.Words(term);
                var byBarcode = await _db.ItemUnits.AsNoTracking()
                    .Where(u => u.Barcode != null && u.Barcode.ToLower().Contains(s))
                    .Select(u => u.ProductId).Distinct().Take(500).ToListAsync();
                q = await ByWordsAsync(q, searchWords, await Tree(), byBarcode);
            }
        }
        var filtered = q;
        var rows = await q.Include(p => p.Size).Include(p => p.Color).Include(p => p.Supplier)
            .Include(p => p.Category).ThenInclude(c => c!.Department).Include(p => p.Season)
            .OrderBy(p => p.Name).ThenBy(p => p.Id).Skip(offset).Take(limit).ToListAsync();
        // Nothing (or too little) found word for word: try again allowing a slipped letter or two.
        var typed = searchWords.Length > 0 ? searchWords : nameWords;
        if (typed.Length > 0 && offset == 0 && rows.Count < limit)
        {
            var near = await NearAsync(fuzzyBase, typed, limit - rows.Count, rows.Select(r => r.Id).ToHashSet());
            if (near.Count > 0)
                rows.AddRange(await fuzzyBase.Where(p => near.Contains(p.Id))
                    .Include(p => p.Size).Include(p => p.Color).Include(p => p.Supplier)
                    .Include(p => p.Category).ThenInclude(c => c!.Department).Include(p => p.Season)
                    .ToListAsync().ContinueWith(t => t.Result.OrderBy(p => near.IndexOf(p.Id)).ToList()));
        }
        if (exact is not null)
            rows = rows.OrderByDescending(p => p.Id == exact.ProductId).ToList();

        var book = await PriceBook.LoadAsync(_db, rows.Select(p => p.Id));
        var purchaseLevels = PurchaseLevelIds(book);
        Dictionary<Guid, int>? there = null;
        if (stores is not null)
        {
            var ids = rows.Select(p => p.Id).ToList();
            there = await _db.StockBalances.AsNoTracking()
                .Where(b => ids.Contains(b.ProductId) && stores.Contains(b.WarehouseId))
                .GroupBy(b => b.ProductId).Select(g => new { g.Key, Qty = g.Sum(b => b.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);
        }
        return Ok(rows.Select(p =>
        {
            var dto = Costs.Guard(User,
                Mapper.ToProduct(p, book, p.Id == exact?.ProductId ? exact.UnitId : null), purchaseLevels);
            return there is null ? dto : dto with { StockOnHand = there.GetValueOrDefault(p.Id) };
        }).ToArray());
    }

    /// <summary>One item for the item editor: both names, units with barcodes, every unit × level price.</summary>
    [HttpGet("{id:guid}")]
    [Authorize(Policy = Lookups.Products)]
    public async Task<ActionResult<ProductDetailDto>> Get(Guid id)
    {
        var detail = await DetailAsync(id);
        return detail is null ? NotFound(new { message = "Item not found.", code = "not_found" }) : Ok(detail);
    }

    /// <summary>The code a new item of this department and group would get, shown while it is typed.</summary>
    [HttpGet("next-code")]
    [Authorize(Policy = Permissions.ProductsCreate)]
    public async Task<ActionResult<NextCodeDto>> NextCode([FromQuery] string? departmentId = null,
        [FromQuery] string? groupId = null, [FromQuery] string? supplierId = null)
    {
        Department? department = null;
        var path = new List<Category>();
        if (!string.IsNullOrEmpty(departmentId))
        {
            var (_, dept, groups, error) = await Catalog.PlaceAsync(_db, departmentId, groupId);
            if (error is not null) return BadRequest(new { message = error.Message, code = error.Code });
            department = dept;
            path = groups;
        }
        return Ok(new NextCodeDto(await Catalog.NextCodeForAsync(_db, department, path,
            Guid.TryParse(supplierId, out var sid) ? sid : null)));
    }

    /// <summary>
    /// The labels to print (owner, 2026-10-06): for the items asked, or for every item of a purchase
    /// invoice with one label per piece bought.
    /// </summary>
    [HttpGet("labels")]
    [Authorize(Policy = Permissions.LabelsPrint)]
    public async Task<ActionResult<LabelItemDto[]>> Labels([FromQuery] string? ids = null, [FromQuery] string? documentId = null)
    {
        var counts = new Dictionary<Guid, int>();
        if (Guid.TryParse(documentId, out var did))
        {
            var doc = await _db.SalesDocuments.AsNoTracking().InBranches(User, d => d.BranchId)
                .Where(d => d.Id == did && d.Type == DocumentType.PURCHASE_INVOICE)
                .Select(d => new { Lines = d.Lines.Select(l => new { l.ProductId, l.Quantity }).ToList() })
                .FirstOrDefaultAsync();
            if (doc is null) return NotFound(new { message = "Invoice not found.", code = "not_found" });
            foreach (var l in doc.Lines) counts[l.ProductId] = counts.GetValueOrDefault(l.ProductId) + Math.Max(0, l.Quantity);
        }
        foreach (var raw in (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Take(500))
            if (Guid.TryParse(raw, out var pid)) counts.TryAdd(pid, 1);
        var keys = counts.Keys.ToList();
        var items = await _db.Products.AsNoTracking().Where(p => keys.Contains(p.Id))
            .Include(p => p.Size).Include(p => p.Color).Include(p => p.Units).ToListAsync();
        var order = keys.Select((k, i) => (k, i)).ToDictionary(x => x.k, x => x.i);
        return Ok(items.OrderBy(p => order[p.Id]).Select(p => new LabelItemDto(
            p.Id.ToString(), Loc.Name(p), p.Sku, p.Units.Where(u => u.Factor == 1).Select(u => u.Barcode).FirstOrDefault(),
            p.SalePrice, p.Currency, p.Size is null ? null : Loc.Name(p.Size), p.Color is null ? null : Loc.Name(p.Color),
            Math.Min(1000, counts[p.Id]))).ToArray());
    }

    /// <summary>
    /// Give the base unit of these items an in-store barcode where they have none (before printing
    /// their labels). Returns the items' barcodes.
    /// </summary>
    [HttpPost("barcodes")]
    [Authorize(Policy = Permissions.ProductsBarcodes)]
    public async Task<ActionResult<Dictionary<string, string>>> AssignBarcodes([FromBody] string[] ids)
    {
        var wanted = (ids ?? Array.Empty<string>()).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty).Distinct().Take(500).ToList();
        var bases = await _db.ItemUnits.Where(u => wanted.Contains(u.ProductId) && u.Factor == 1).ToListAsync();
        var reserved = new HashSet<string>();
        var changed = new List<Guid>();
        foreach (var u in bases.Where(u => string.IsNullOrEmpty(u.Barcode)))
        {
            u.Barcode = await Catalog.NextBarcodeAsync(_db, reserved);
            changed.Add(u.ProductId);
        }
        await _db.SaveChangesAsync();
        foreach (var id in changed) await AuditAsync("barcode", "product", id);
        return Ok(bases.ToDictionary(u => u.ProductId.ToString(), u => u.Barcode!));
    }

    [HttpPost]
    [Authorize(Policy = Permissions.ProductsCreate)]
    public async Task<ActionResult<ProductDetailDto>> Create([FromBody] CreateProductRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null) return BadRequest(new { message = "The item needs a name.", code = "bad_name" });
        var product = new Product { Name = name };

        // The department (owner decision 2026-10-01) and the group of its tree (2026-10-06), or, as
        // before, a category.
        Department? department = null;
        var path = new List<Category>();
        if (req.DepartmentId is not null)
        {
            var (placed, dept, groups, placeError) = await Catalog.PlaceAsync(_db, req.DepartmentId, req.GroupId);
            if (placeError is not null) return BadRequest(new { message = placeError.Message, code = placeError.Code });
            product.CategoryId = placed!.Value;
            department = dept;
            path = groups;
        }
        else if (!Guid.TryParse(req.CategoryId, out var categoryId) || !await _db.Categories.AnyAsync(c => c.Id == categoryId))
            return BadRequest(new { message = "Choose a department.", code = "category_not_found" });
        else product.CategoryId = categoryId;

        // The season it is bought for, also at the end of its name.
        if (req.SeasonId is not null)
        {
            var season = Guid.TryParse(req.SeasonId, out var sid)
                ? await _db.Seasons.FirstOrDefaultAsync(x => x.Id == sid && x.IsActive) : null;
            if (season is null) return BadRequest(new { message = "Choose a season.", code = "season_not_found" });
            product.SeasonId = season.Id;
            product.Name = Catalog.WithSeason(product.Name, season);
        }
        // Its size and color, picked from the company's lists.
        foreach (var (raw, kind) in new[] { (req.SizeId, VariantKind.SIZE), (req.ColorId, VariantKind.COLOR) })
        {
            if (string.IsNullOrEmpty(raw)) continue;
            var option = Guid.TryParse(raw, out var oid)
                ? await _db.VariantOptions.FirstOrDefaultAsync(o => o.Id == oid && o.Kind == kind && o.IsActive) : null;
            if (option is null) return BadRequest(new { message = "Size or color not found.", code = "variant_option_not_found" });
            if (kind == VariantKind.SIZE) product.SizeId = option.Id; else product.ColorId = option.Id;
        }

        if (req.ReorderLevel < 0)
            return BadRequest(new { message = "The reorder level can't be negative.", code = "bad_reorder" });
        product.ReorderLevel = req.ReorderLevel;

        var (_, supplier, supplierError) = await Catalog.SupplierAsync(_db, req.SupplierId);
        if (supplierError is not null) return BadRequest(new { message = supplierError.Message, code = supplierError.Code });
        product.SupplierId = supplier;
        product.SupplierCode = Catalog.SupplierCode(req.SupplierCode);

        var (sku, skuError) = await SkuAsync(req.Sku, null);
        if (skuError is not null) return skuError;
        // Without a code of its own: department and groups, supplier, number (owner, 2026-10-23).
        if (req.WarehouseId is not null && (!Guid.TryParse(req.WarehouseId, out var wid)
                || !await _warehouses.Visible(User).AnyAsync(w => w.Id == wid && w.IsActive)))
            return BadRequest(new { message = "Warehouse not found.", code = "warehouse_not_found" });
        sku ??= await Catalog.NextCodeForAsync(_db, department, path, product.SupplierId);
        product.Sku = sku;

        var (units, unitError) = await Catalog.ParseUnitsAsync(_db, req.Units, withBarcodes: true);
        if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });
        // A barcode of its own for the base unit when none was typed (owner, 2026-10-06).
        if (req.AutoBarcode && units!.FirstOrDefault(u => u.Factor == 1) is { Barcode: null } baseUnit)
            units[units.IndexOf(baseUnit)] = baseUnit with { Barcode = await Catalog.NextBarcodeAsync(_db) };

        var prices = req.Prices?.Where(p => p.Price is not null).ToArray() ?? Array.Empty<PriceRequest>();
        if (prices.Length > 0 && !User.HasClaim("permission", Permissions.PricesEdit))
            return StatusCode(403, new { message = "Setting prices needs permission.", code = "prices_not_allowed" });
        var (checkedPrices, priceError) = await CheckPricesAsync(prices, units!.Select(u => u.UnitId).ToHashSet());
        if (priceError is not null) return priceError;

        product.Currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

        await using var tx = await _db.Database.BeginTransactionAsync();
        _db.Products.Add(product);
        foreach (var u in units!)
            _db.ItemUnits.Add(new ItemUnit { ProductId = product.Id, UnitId = u.UnitId, Factor = u.Factor, Barcode = u.Barcode });
        foreach (var (unitId, levelId, price) in checkedPrices)
            _db.ItemPrices.Add(new ItemPrice { ProductId = product.Id, UnitId = unitId, PriceLevelId = levelId, Price = price });
        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, new[] { product.Id });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("create", "product", product.Id);
        _storefront.MarkDirty();
        return Created($"/api/products/{product.Id}", await DetailAsync(product.Id));
    }

    [HttpPut("{id:guid}")]
    [AnyPermission(Permissions.ProductsEdit, Permissions.ProductsClose)]
    public async Task<ActionResult<ProductDetailDto>> Update(Guid id, [FromBody] UpdateProductRequest req)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found.", code = "not_found" });
        // Changing an item and stopping it are permissions of their own (owner, 2026-10-23).
        if (req with { IsActive = null } != new UpdateProductRequest() && !User.Has(Permissions.ProductsEdit))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var isVariant = product.ModelId is not null;
        var variantRule = BadRequest(new
        {
            message = "This item is a size/color of a model: change its name, category, units and supplier on the model.",
            code = "variant_managed_by_model",
        });

        if (req.Name is not null)
        {
            if (isVariant) return variantRule;
            var name = Loc.Clean(req.Name);
            if (name is null) return BadRequest(new { message = "The item needs a name.", code = "bad_name" });
            product.Name = name;
        }
        if (req.DepartmentId is not null)
        {
            if (isVariant) return variantRule;
            var (placed, _, _, placeError) = await Catalog.PlaceAsync(_db, req.DepartmentId, req.GroupId);
            if (placeError is not null) return BadRequest(new { message = placeError.Message, code = placeError.Code });
            product.CategoryId = placed!.Value;
        }
        if (req.SeasonId is not null)
        {
            if (req.SeasonId.Length == 0) product.SeasonId = null;
            else
            {
                var season = Guid.TryParse(req.SeasonId, out var sid)
                    ? await _db.Seasons.FirstOrDefaultAsync(x => x.Id == sid) : null;
                if (season is null) return BadRequest(new { message = "Choose a season.", code = "season_not_found" });
                product.SeasonId = season.Id;
            }
        }
        if (req.CategoryId is not null)
        {
            if (isVariant) return variantRule;
            if (!Guid.TryParse(req.CategoryId, out var categoryId) || !await _db.Categories.AnyAsync(c => c.Id == categoryId))
                return BadRequest(new { message = "Choose a category.", code = "category_not_found" });
            product.CategoryId = categoryId;
        }
        if (req.Sku is not null)
        {
            var (sku, skuError) = await SkuAsync(req.Sku, id);
            if (skuError is not null) return skuError;
            if (sku is not null) product.Sku = sku;
        }
        if (req.ReorderLevel is int reorder)
        {
            if (reorder < 0) return BadRequest(new { message = "The reorder level can't be negative.", code = "bad_reorder" });
            product.ReorderLevel = reorder;
        }
        if (req.SupplierId is not null || req.SupplierCode is not null)
        {
            if (isVariant) return variantRule; // a variant follows its model's supplier
            var (given, supplier, supplierError) = await Catalog.SupplierAsync(_db, req.SupplierId);
            if (supplierError is not null) return BadRequest(new { message = supplierError.Message, code = supplierError.Code });
            if (given) product.SupplierId = supplier;
            if (req.SupplierCode is not null) product.SupplierCode = Catalog.SupplierCode(req.SupplierCode);
        }
        if (req.IsActive is bool active && active != product.IsActive && !User.HasClaim("permission", Permissions.ProductsClose))
            return StatusCode(403, new { message = "Stopping or reopening an item needs permission.", code = "close_not_allowed" });
        if (req.IsActive == false && product.IsActive)
        {
            if (product.StockOnHand != 0)
                return BadRequest(new
                {
                    message = $"{Loc.Name(product)} still has {product.StockOnHand} in stock. Sell, move or count it out first.",
                    code = "has_stock",
                });
            product.IsActive = false;
        }
        else if (req.IsActive == true && !product.IsActive)
        {
            if (isVariant && await _db.ProductModels.AnyAsync(m => m.Id == product.ModelId && !m.IsActive))
                return BadRequest(new { message = "Reopen the model first.", code = "model_inactive" });
            product.IsActive = true;
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        if (req.Units is not null)
        {
            var (units, unitError) = await Catalog.ParseUnitsAsync(_db, req.Units, withBarcodes: true, self: id);
            if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });
            var current = await _db.ItemUnits.Where(u => u.ProductId == id).ToListAsync();

            if (isVariant)
            {
                // Same units and sizes as the model; only the barcodes are the variant's own.
                var same = current.Count == units!.Count && units.All(s =>
                    current.Any(c => c.UnitId == s.UnitId && c.Factor == s.Factor));
                if (!same) return variantRule;
                foreach (var row in current) row.Barcode = units.First(s => s.UnitId == row.UnitId).Barcode;
            }
            else
            {
                var baseNow = current.FirstOrDefault(c => c.Factor == 1)?.UnitId;
                var baseNext = units!.First(u => u.Factor == 1).UnitId;
                if (baseNow is not null && baseNow != baseNext && await HasMovementsAsync(new[] { id }))
                    return BadRequest(new
                    {
                        message = "Stock of this item is already counted in its base unit, so the base unit can't change.",
                        code = "base_unit_locked",
                    });
                // Clear barcodes that move between this item's units before re-assigning them.
                foreach (var row in current) row.Barcode = null;
                await _db.SaveChangesAsync();
                await Catalog.ApplyUnitsAsync(_db, product, units!);
            }
        }
        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, new[] { id });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("update", "product", id);
        _storefront.MarkDirty();
        return Ok(await DetailAsync(id));
    }

    /// <summary>
    /// Set the item's own prices. A null price removes the item's own price, so it follows its model
    /// (for a variant), its base unit or the default level again.
    /// </summary>
    [HttpPut("{id:guid}/prices")]
    [Authorize(Policy = Permissions.PricesEdit)]
    public async Task<ActionResult<ProductDetailDto>> SetPrices(Guid id, [FromBody] UpdatePricesRequest req)
    {
        if (!await _db.Products.AnyAsync(p => p.Id == id))
            return NotFound(new { message = "Item not found.", code = "not_found" });
        if (req.Prices is null || req.Prices.Length == 0)
            return BadRequest(new { message = "No prices to change.", code = "no_prices" });

        var unitIds = (await _db.ItemUnits.Where(u => u.ProductId == id).Select(u => u.UnitId).ToListAsync()).ToHashSet();
        var (valid, error) = await CheckPricesAsync(req.Prices.Where(p => p.Price is not null).ToArray(), unitIds);
        if (error is not null) return error;
        var clears = new List<(Guid Unit, Guid Level)>();
        foreach (var p in req.Prices.Where(p => p.Price is null))
        {
            if (!Guid.TryParse(p.UnitId, out var u) || !Guid.TryParse(p.PriceLevelId, out var l))
                return BadRequest(new { message = "A price is for an unknown unit or level.", code = "bad_price_cell" });
            clears.Add((u, l));
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        var existing = await _db.ItemPrices.Where(p => p.ProductId == id).ToListAsync();
        foreach (var (unit, level) in clears)
            if (existing.FirstOrDefault(e => e.UnitId == unit && e.PriceLevelId == level) is { } row)
                _db.ItemPrices.Remove(row);
        foreach (var (unit, level, price) in valid)
        {
            var row = existing.FirstOrDefault(e => e.UnitId == unit && e.PriceLevelId == level);
            if (row is null)
                _db.ItemPrices.Add(new ItemPrice { ProductId = id, UnitId = unit, PriceLevelId = level, Price = price });
            else
            {
                row.Price = price;
                row.UpdatedAt = DateTime.UtcNow;
            }
        }
        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, new[] { id });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("prices", "product", id);
        return Ok(await DetailAsync(id));
    }

    // ------------------------------------------------------------------ helpers

    private async Task<ProductDetailDto?> DetailAsync(Guid id)
    {
        var p = await _db.Products.AsNoTracking()
            .Include(x => x.Category).ThenInclude(c => c!.Department)
            .Include(x => x.Model).Include(x => x.Size).Include(x => x.Color)
            .Include(x => x.Supplier).Include(x => x.Season)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (p is null) return null;
        var book = await PriceBook.LoadAsync(_db, new[] { id });
        var levels = book.Levels.Where(l => l.IsActive).ToList();
        var units = book.UnitsOf(id);
        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

        return Costs.Guard(User, new ProductDetailDto(
            p.Id.ToString(), p.Sku, Loc.Name(p), p.CategoryId.ToString(), Loc.Name(p.Category),
            p.ReorderLevel, p.IsActive, p.StockOnHand, p.CostPrice, await HasMovementsAsync(new[] { id }),
            p.ModelId?.ToString(), p.Model is null ? null : Loc.Name(p.Model),
            p.SizeId?.ToString(), p.Size is null ? null : Loc.Name(p.Size),
            p.ColorId?.ToString(), p.Color is null ? null : Loc.Name(p.Color),
            units.Select(u => new ItemUnitDto(u.UnitId.ToString(), Loc.Name(u.Unit), u.Factor, u.Barcode)).ToArray(),
            units.SelectMany(u => levels.Select(l =>
            {
                var (price, source) = book.Effective(id, u.UnitId, l.Id);
                return new PriceCellDto(u.UnitId.ToString(), l.Id.ToString(), book.OwnPrice(id, u.UnitId, l.Id), price, source);
            })).ToArray(),
            currency, p.SupplierId?.ToString(), p.Supplier?.Name, p.SupplierCode,
            p.Category?.DepartmentId?.ToString(), p.Category?.Department is { } d ? Loc.Name(d) : null,
            p.SeasonId?.ToString(), p.Season is { } season ? Seasons.NameOf(season) : null), PurchaseLevelIds(book));
    }

    /// <summary>Ids of the supplier-side price levels, which only purchasing staff see.</summary>
    internal static HashSet<string> PurchaseLevelIds(PriceBook book) =>
        book.Levels.Where(l => l.Side == PriceSide.PURCHASE).Select(l => l.Id.ToString()).ToHashSet();

    private async Task<bool> HasMovementsAsync(Guid[] ids) =>
        await _db.StockMovements.AnyAsync(m => ids.Contains(m.ProductId))
        || await _db.DocumentLines.AnyAsync(l => ids.Contains(l.ProductId));

    /// <summary>A typed SKU, cleaned and unique (ignoring case); null when none was typed.</summary>
    private async Task<(string? Sku, ActionResult? Error)> SkuAsync(string? requested, Guid? self)
    {
        if (string.IsNullOrWhiteSpace(requested)) return (null, null);
        if (requested.Trim().Length > Catalog.MaxSku)
            return (null, BadRequest(new { message = $"A SKU is at most {Catalog.MaxSku} characters.", code = "bad_sku" }));
        var sku = Catalog.CleanCode(requested, Catalog.MaxSku)!;
        var upper = sku.ToUpperInvariant();
        if (await _db.Products.AnyAsync(p => p.Sku.ToUpper() == upper && (self == null || p.Id != self)))
            return (null, BadRequest(new { message = $"SKU {sku} is already used.", code = "duplicate_sku" }));
        return (sku, null);
    }

    /// <summary>Prices must be for one of <paramref name="unitIds"/> at an open level, between 0 and the maximum.</summary>
    private async Task<(List<(Guid Unit, Guid Level, long Price)> Prices, ActionResult? Error)> CheckPricesAsync(
        PriceRequest[] prices, HashSet<Guid> unitIds)
    {
        var levels = (await _db.PriceLevels.AsNoTracking().Where(l => l.IsActive).Select(l => l.Id).ToListAsync()).ToHashSet();
        var result = new List<(Guid, Guid, long)>();
        foreach (var p in prices)
        {
            if (!Guid.TryParse(p.UnitId, out var unit) || !unitIds.Contains(unit)
                || !Guid.TryParse(p.PriceLevelId, out var level) || !levels.Contains(level))
                return (result, BadRequest(new { message = "A price is for an unknown unit or level.", code = "bad_price_cell" }));
            if (p.Price is not long price || price < 0 || price > InvoiceLines.MaxPrice)
                return (result, BadRequest(new { message = "A price can't be negative.", code = "bad_price" }));
            if (result.Any(r => r.Item1 == unit && r.Item2 == level))
                return (result, BadRequest(new { message = "The same price is given twice.", code = "bad_price_cell" }));
            result.Add((unit, level, price));
        }
        return (result, null);
    }

    /// <summary>
    /// Items whose search key has every typed word (folded, or by its outline), or that sit in a group
    /// whose name or keywords the word is.
    /// </summary>
    private static Task<IQueryable<Product>> ByWordsAsync(IQueryable<Product> q, string[] words, List<Category> tree,
        List<Guid>? also = null)
    {
        also ??= new List<Guid>();
        foreach (var word in words)
        {
            var w = word;
            var outline = TextKey.Outline(w);
            var groups = tree.Where(c => GroupWords(c).Any(k => k == w || (outline.Length > 2 && TextKey.Outline(k) == outline)))
                .SelectMany(c => Catalog.Subtree(c.Id, tree)).Distinct().ToList();
            q = outline.Length > 2 && outline != w
                ? q.Where(p => p.SearchKey.Contains(w) || p.SearchKey.Contains(outline) || groups.Contains(p.CategoryId) || also.Contains(p.Id))
                : q.Where(p => p.SearchKey.Contains(w) || groups.Contains(p.CategoryId) || also.Contains(p.Id));
        }
        return Task.FromResult(q);
    }

    /// <summary>A group's own name and keywords, folded word by word.</summary>
    private static IEnumerable<string> GroupWords(Category c) =>
        TextKey.Words(c.Name).Concat(TextKey.Words((c.Keywords ?? "").Replace('\n', ' ')));

    /// <summary>
    /// Items close to the typed words (each word within a slipped letter or two of one of the item's),
    /// best first. Reads only the keys of the filtered items.
    /// </summary>
    private static async Task<List<Guid>> NearAsync(IQueryable<Product> q, string[] words, int take, HashSet<Guid> skip)
    {
        if (words.All(w => TextKey.Slack(w) == 0)) return new();
        var keys = await q.Select(p => new { p.Id, p.SearchKey }).Take(20000).ToListAsync();
        return keys.Where(k => !skip.Contains(k.Id))
            .Select(k =>
            {
                var have = k.SearchKey.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var total = 0;
                foreach (var w in words)
                {
                    var m = TextKey.Match(w, have);
                    if (m < 0) return (k.Id, Score: -1);
                    total += m;
                }
                return (k.Id, Score: total);
            })
            .Where(x => x.Score >= 0).OrderBy(x => x.Score).Take(take).Select(x => x.Id).ToList();
    }

    private const long MaxImageBytes = 3 * 1024 * 1024;

    /// <summary>
    /// Keep the item's photo, replacing the one before (owner, 2026-10-12: "a picture for every item").
    /// Only a real JPEG, PNG or WebP up to 3 MB — the first bytes are checked, so a script renamed to
    /// .jpg is refused; stored in the database, never on the server's disk.
    /// </summary>
    [HttpPut("{id:guid}/image")]
    [Authorize(Policy = Permissions.ProductsImages)]
    [RequestSizeLimit(MaxImageBytes + 64 * 1024)]
    public async Task<ActionResult> PutImage(Guid id, IFormFile? file)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found.", code = "not_found" });
        if (file is null || file.Length == 0 || file.Length > MaxImageBytes)
            return BadRequest(new { message = "Choose a photo of up to 3 MB.", code = "bad_photo" });
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var data = buffer.ToArray();
        var type = Pictures.TypeOf(data);
        if (type is null) return BadRequest(new { message = "Only JPEG, PNG or WebP photos.", code = "bad_photo" });

        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var image = await _db.ProductImages.FirstOrDefaultAsync(x => x.ProductId == id);
        if (image is null) _db.ProductImages.Add(image = new ProductImage { ProductId = id });
        image.ContentType = type;
        image.Data = data;
        image.UploadedAt = DateTime.UtcNow;
        image.UploadedBy = staffId == Guid.Empty ? null : staffId;
        product.HasImage = true;
        await _db.SaveChangesAsync();
        await AuditAsync("image", "product", id);
        _storefront.MarkDirty();
        return Ok(new { hasImage = true });
    }

    /// <summary>The item's photo, never cached. Anyone who may see inventory may see it.</summary>
    [HttpGet("{id:guid}/image")]
    [Authorize(Policy = Lookups.Products)]
    public async Task<IActionResult> GetImage(Guid id)
    {
        var image = await _db.ProductImages.AsNoTracking().FirstOrDefaultAsync(x => x.ProductId == id);
        if (image is null) return NotFound(new { message = "Not found.", code = "not_found" });
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(image.Data, image.ContentType);
    }

    [HttpDelete("{id:guid}/image")]
    [Authorize(Policy = Permissions.ProductsImages)]
    public async Task<ActionResult> DeleteImage(Guid id)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found.", code = "not_found" });
        var image = await _db.ProductImages.FirstOrDefaultAsync(x => x.ProductId == id);
        if (image is not null) _db.ProductImages.Remove(image);
        product.HasImage = false;
        await _db.SaveChangesAsync();
        await AuditAsync("image_remove", "product", id);
        _storefront.MarkDirty();
        return NoContent();
    }

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
