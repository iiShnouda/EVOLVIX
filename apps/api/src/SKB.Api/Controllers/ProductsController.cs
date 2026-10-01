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
[Authorize(Policy = Permissions.InventoryView)]
public sealed class ProductsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public ProductsController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    /// <summary>
    /// Product search for invoice lines: name, SKU, barcode, the supplier's code, or a price (typing
    /// "330" finds items priced 330 at any unit and level). <paramref name="supplierId"/> keeps only
    /// that supplier's items. An exact barcode comes first with <c>matchedUnitId</c> set, so scanning
    /// a carton adds a carton. Supplier-side prices only match for people who work with purchases,
    /// since they sit close to cost.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ProductDto[]>> List(
        [FromQuery] string? search = null, [FromQuery] bool inStockOnly = false, [FromQuery] int limit = 50,
        [FromQuery] string? supplierId = null, [FromQuery] string? departmentId = null,
        [FromQuery] string? categoryId = null,
        // The detailed search (البحث المفصل), as in the old program (owner, 2026-10-01): the code and the
        // name each "contain" what's typed, a list-price range, and stock: in, out, or at/below the reorder level.
        [FromQuery] string? code = null, [FromQuery] string? name = null,
        [FromQuery] long? minPrice = null, [FromQuery] long? maxPrice = null, [FromQuery] string? stock = null)
    {
        limit = Math.Clamp(limit, 1, 200);
        var q = _db.Products.AsNoTracking().Where(p => p.IsActive);
        if (inStockOnly || stock == "in") q = q.Where(p => p.StockOnHand > 0);
        else if (stock == "out") q = q.Where(p => p.StockOnHand <= 0);
        else if (stock == "low") q = q.Where(p => p.ReorderLevel > 0 && p.StockOnHand <= p.ReorderLevel);
        if (!string.IsNullOrWhiteSpace(code))
        {
            var c = code.Trim().ToLower();
            q = q.Where(p => p.Sku.ToLower().Contains(c) || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(c))
                             || p.Units.Any(u => u.Barcode != null && u.Barcode.ToLower().Contains(c)));
        }
        if (!string.IsNullOrWhiteSpace(name))
        {
            var n = name.Trim().ToLower();
            q = q.Where(p => p.Name.ToLower().Contains(n));
        }
        if (minPrice is long min) q = q.Where(p => p.SalePrice >= min);
        if (maxPrice is long max) q = q.Where(p => p.SalePrice <= max);
        if (Guid.TryParse(categoryId, out var category)) q = q.Where(p => p.CategoryId == category);
        // A department's items (and items of no department); people limited to departments see only theirs.
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var dept))
                return BadRequest(new { message = "Department not found.", code = "department_not_found" });
            q = q.Where(p => p.Category!.DepartmentId == null || p.Category.DepartmentId == dept);
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
                var seePurchase = User.HasClaim("permission", Permissions.PurchasesView);
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
                q = q.Where(p => p.Name.ToLower().Contains(s) || p.Sku.ToLower().Contains(s)
                    || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(s))
                    || p.Units.Any(u => u.Barcode != null && u.Barcode.ToLower().Contains(s)));
            }
        }
        var rows = await q.Include(p => p.Size).Include(p => p.Color).Include(p => p.Supplier)
            .OrderBy(p => p.Name).Take(limit).ToListAsync();
        if (exact is not null)
            rows = rows.OrderByDescending(p => p.Id == exact.ProductId).ToList();

        var book = await PriceBook.LoadAsync(_db, rows.Select(p => p.Id));
        var purchaseLevels = PurchaseLevelIds(book);
        return Ok(rows.Select(p => Costs.Guard(User,
            Mapper.ToProduct(p, book, p.Id == exact?.ProductId ? exact.UnitId : null), purchaseLevels)).ToArray());
    }

    /// <summary>One item for the item editor: both names, units with barcodes, every unit × level price.</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProductDetailDto>> Get(Guid id)
    {
        var detail = await DetailAsync(id);
        return detail is null ? NotFound(new { message = "Item not found.", code = "not_found" }) : Ok(detail);
    }

    [HttpPost]
    [Authorize(Policy = Permissions.ProductsCreate)]
    public async Task<ActionResult<ProductDetailDto>> Create([FromBody] CreateProductRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null) return BadRequest(new { message = "The item needs a name.", code = "bad_name" });
        var product = new Product { Name = name };

        if (!Guid.TryParse(req.CategoryId, out var categoryId) || !await _db.Categories.AnyAsync(c => c.Id == categoryId))
            return BadRequest(new { message = "Choose a category.", code = "category_not_found" });
        product.CategoryId = categoryId;

        if (req.ReorderLevel < 0)
            return BadRequest(new { message = "The reorder level can't be negative.", code = "bad_reorder" });
        product.ReorderLevel = req.ReorderLevel;

        var (_, supplier, supplierError) = await Catalog.SupplierAsync(_db, req.SupplierId);
        if (supplierError is not null) return BadRequest(new { message = supplierError.Message, code = supplierError.Code });
        product.SupplierId = supplier;
        product.SupplierCode = Catalog.SupplierCode(req.SupplierCode);

        var (sku, skuError) = await SkuAsync(req.Sku, null);
        if (skuError is not null) return skuError;
        product.Sku = sku ?? await Catalog.NextItemSkuAsync(_db);

        var (units, unitError) = await Catalog.ParseUnitsAsync(_db, req.Units, withBarcodes: true);
        if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });

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
        return Created($"/api/products/{product.Id}", await DetailAsync(product.Id));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.ProductsEdit)]
    public async Task<ActionResult<ProductDetailDto>> Update(Guid id, [FromBody] UpdateProductRequest req)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found.", code = "not_found" });
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
            .Include(x => x.Category).Include(x => x.Model).Include(x => x.Size).Include(x => x.Color)
            .Include(x => x.Supplier)
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
            currency, p.SupplierId?.ToString(), p.Supplier?.Name, p.SupplierCode), PurchaseLevelIds(book));
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

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
