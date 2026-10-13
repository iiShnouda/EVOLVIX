using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Item models made in sizes × colors (موديلات، مقاس × لون — DOMAIN.md §2.2). Creating a model makes
/// one variant item per size/color pair; each variant has its own SKU, barcode and stock. The model
/// holds what they share — category, units and default prices — and a variant charges the model's
/// price until it is given its own. Adding needs <c>products:create</c>, editing <c>products:edit</c>,
/// prices <c>prices:edit</c>.
/// </summary>
[ApiController]
[Route("api/models")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class ModelsController : ControllerBase
{
    private const int MaxVariants = 400;
    private const int MaxCode = 20;

    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly StorefrontPublisher _storefront;

    public ModelsController(AppDbContext db, AuditService audit, StorefrontPublisher storefront)
    {
        _storefront = storefront;
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<ModelSummaryDto[]>> List([FromQuery] string? search = null)
    {
        var q = _db.ProductModels.AsNoTracking().Include(m => m.Category).AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            q = q.Where(m => m.Name.ToLower().Contains(s) || m.Code.ToLower().Contains(s));
        }
        var models = await q.ToListAsync();
        var ids = models.Select(m => m.Id).ToList();
        var stats = await _db.Products.Where(p => p.ModelId != null && ids.Contains(p.ModelId!.Value) && p.IsActive)
            .GroupBy(p => p.ModelId!.Value)
            .Select(g => new { g.Key, Count = g.Count(), Stock = g.Sum(p => p.StockOnHand) })
            .ToDictionaryAsync(x => x.Key);
        return Ok(models.OrderByDescending(m => m.IsActive).ThenBy(m => Loc.Name(m))
            .Select(m => new ModelSummaryDto(m.Id.ToString(), m.Code, Loc.Name(m), Loc.Name(m.Category),
                stats.TryGetValue(m.Id, out var s) ? s.Count : 0, s?.Stock ?? 0, m.IsActive))
            .ToArray());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ModelDetailDto>> Get(Guid id)
    {
        var detail = await DetailAsync(id);
        return detail is null ? NotFound(new { message = "Model not found.", code = "not_found" }) : Ok(detail);
    }

    [HttpPost]
    [Authorize(Policy = Permissions.ProductsCreate)]
    public async Task<ActionResult<ModelDetailDto>> Create([FromBody] CreateModelRequest req)
    {
        var modelName = Loc.Clean(req.Name);
        if (modelName is null) return BadRequest(new { message = "The model needs a name.", code = "bad_name" });
        var model = new ProductModel { Name = modelName };

        if (!Guid.TryParse(req.CategoryId, out var categoryId) || !await _db.Categories.AnyAsync(c => c.Id == categoryId))
            return BadRequest(new { message = "Choose a category.", code = "category_not_found" });
        model.CategoryId = categoryId;
        if (req.ReorderLevel < 0)
            return BadRequest(new { message = "The reorder level can't be negative.", code = "bad_reorder" });
        model.ReorderLevel = req.ReorderLevel;

        if (!string.IsNullOrWhiteSpace(req.Code) && req.Code.Trim().Length > MaxCode)
            return BadRequest(new { message = $"A code is at most {MaxCode} characters.", code = "bad_code" });
        var code = Catalog.CleanCode(req.Code, MaxCode) ?? await NextCodeAsync();
        var upper = code.ToUpperInvariant();
        if (await _db.ProductModels.AnyAsync(m => m.Code.ToUpper() == upper))
            return BadRequest(new { message = $"Code {code} is already used.", code = "duplicate_code" });
        model.Code = code;

        var (_, supplier, supplierError) = await Catalog.SupplierAsync(_db, req.SupplierId);
        if (supplierError is not null) return BadRequest(new { message = supplierError.Message, code = supplierError.Code });
        model.SupplierId = supplier;
        model.SupplierCode = Catalog.SupplierCode(req.SupplierCode);

        var (sizes, sizeError) = await OptionsAsync(req.SizeIds, VariantKind.SIZE);
        if (sizeError is not null) return sizeError;
        var (colors, colorError) = await OptionsAsync(req.ColorIds, VariantKind.COLOR);
        if (colorError is not null) return colorError;
        if (sizes!.Count == 0 && colors!.Count == 0)
            return BadRequest(new { message = "Choose at least one size or color.", code = "no_variants" });
        if (Math.Max(1, sizes.Count) * Math.Max(1, colors!.Count) > MaxVariants)
            return BadRequest(new { message = $"At most {MaxVariants} sizes × colors per model.", code = "too_many_variants" });

        var (units, unitError) = await Catalog.ParseUnitsAsync(_db, req.Units, withBarcodes: false);
        if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });

        var prices = req.Prices?.Where(p => p.Price is not null).ToArray() ?? Array.Empty<PriceRequest>();
        if (prices.Length > 0 && !User.HasClaim("permission", Permissions.PricesEdit))
            return StatusCode(403, new { message = "Setting prices needs permission.", code = "prices_not_allowed" });
        var (checkedPrices, priceError) = await CheckPricesAsync(prices, units!.Select(u => u.UnitId).ToHashSet());
        if (priceError is not null) return priceError;

        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

        await using var tx = await _db.Database.BeginTransactionAsync();
        _db.ProductModels.Add(model);
        foreach (var u in units!)
            _db.ModelUnits.Add(new ModelUnit { ModelId = model.Id, UnitId = u.UnitId, Factor = u.Factor });
        foreach (var (unitId, levelId, price) in checkedPrices)
            _db.ModelPrices.Add(new ModelPrice { ModelId = model.Id, UnitId = unitId, PriceLevelId = levelId, Price = price });

        var variants = await AddVariantsAsync(model, units, currency,
            Combos(sizes, colors, Array.Empty<(Guid?, Guid?)>()), sizes, colors);
        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, variants.Select(v => v.Id).ToList());
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("create", "product_model", model.Id);
        _storefront.MarkDirty();
        return Created($"/api/models/{model.Id}", await DetailAsync(model.Id));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.ProductsEdit)]
    public async Task<ActionResult<ModelDetailDto>> Update(Guid id, [FromBody] UpdateModelRequest req)
    {
        var model = await _db.ProductModels.Include(m => m.Units).FirstOrDefaultAsync(m => m.Id == id);
        if (model is null) return NotFound(new { message = "Model not found.", code = "not_found" });
        var variants = await _db.Products.Include(p => p.Size).Include(p => p.Color)
            .Where(p => p.ModelId == id).ToListAsync();
        var renamed = false;

        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return BadRequest(new { message = "The model needs a name.", code = "bad_name" });
            model.Name = name;
            renamed = true;
        }
        if (req.CategoryId is not null)
        {
            if (!Guid.TryParse(req.CategoryId, out var categoryId) || !await _db.Categories.AnyAsync(c => c.Id == categoryId))
                return BadRequest(new { message = "Choose a category.", code = "category_not_found" });
            model.CategoryId = categoryId;
            foreach (var v in variants) v.CategoryId = categoryId;
        }
        if (req.ReorderLevel is int reorder)
        {
            if (reorder < 0) return BadRequest(new { message = "The reorder level can't be negative.", code = "bad_reorder" });
            model.ReorderLevel = reorder;
            foreach (var v in variants) v.ReorderLevel = reorder;
        }
        if (req.SupplierId is not null)
        {
            var (_, supplier, supplierError) = await Catalog.SupplierAsync(_db, req.SupplierId);
            if (supplierError is not null) return BadRequest(new { message = supplierError.Message, code = supplierError.Code });
            model.SupplierId = supplier;
            foreach (var v in variants) v.SupplierId = supplier;
        }
        if (req.SupplierCode is not null)
        {
            model.SupplierCode = Catalog.SupplierCode(req.SupplierCode);
            foreach (var v in variants) v.SupplierCode = model.SupplierCode;
        }
        if (req.IsActive == false && model.IsActive)
        {
            var stocked = variants.Where(v => v.StockOnHand != 0).ToList();
            if (stocked.Count > 0)
                return BadRequest(new
                {
                    message = $"{stocked.Count} of its sizes/colors still hold stock. Sell, move or count them out first.",
                    code = "has_stock",
                });
            model.IsActive = false;
            foreach (var v in variants) v.IsActive = false;
        }
        else if (req.IsActive == true && !model.IsActive)
        {
            model.IsActive = true;
            foreach (var v in variants) v.IsActive = true;
        }

        await using var tx = await _db.Database.BeginTransactionAsync();

        // Units: the model's list is replaced and every variant follows (keeping its barcodes).
        List<Catalog.UnitSpec> units = model.Units.Select(u => new Catalog.UnitSpec(u.UnitId, u.Factor, null)).ToList();
        if (req.Units is not null)
        {
            var (parsedUnits, unitError) = await Catalog.ParseUnitsAsync(_db, req.Units, withBarcodes: false);
            if (unitError is not null) return BadRequest(new { message = unitError.Message, code = unitError.Code });
            var parsed = parsedUnits!;
            var baseNow = model.Units.FirstOrDefault(u => u.Factor == 1)?.UnitId;
            var baseNext = parsed.First(u => u.Factor == 1).UnitId;
            var ids = variants.Select(v => v.Id).ToArray();
            if (baseNow is not null && baseNow != baseNext
                && (await _db.StockMovements.AnyAsync(m => ids.Contains(m.ProductId))
                    || await _db.DocumentLines.AnyAsync(l => ids.Contains(l.ProductId))))
                return BadRequest(new
                {
                    message = "Stock of this model is already counted in its base unit, so the base unit can't change.",
                    code = "base_unit_locked",
                });

            foreach (var row in model.Units.Where(r => parsed.All(p => p.UnitId != r.UnitId)).ToList())
            {
                _db.ModelUnits.Remove(row);
                _db.ModelPrices.RemoveRange(await _db.ModelPrices
                    .Where(p => p.ModelId == id && p.UnitId == row.UnitId).ToListAsync());
            }
            foreach (var spec in parsed)
            {
                var row = model.Units.FirstOrDefault(r => r.UnitId == spec.UnitId);
                if (row is null) _db.ModelUnits.Add(new ModelUnit { ModelId = id, UnitId = spec.UnitId, Factor = spec.Factor });
                else row.Factor = spec.Factor;
            }
            foreach (var v in variants) await Catalog.ApplyUnitsAsync(_db, v, parsed, keepBarcodes: true);
            units = parsed;
        }

        // New sizes / colors: add every missing pair. A model keeps the dimensions it was made with.
        var newVariants = new List<Product>();
        if ((req.AddSizeIds?.Length ?? 0) > 0 || (req.AddColorIds?.Length ?? 0) > 0)
        {
            var (addSizes, sizeError) = await OptionsAsync(req.AddSizeIds, VariantKind.SIZE);
            if (sizeError is not null) return sizeError;
            var (addColors, colorError) = await OptionsAsync(req.AddColorIds, VariantKind.COLOR);
            if (colorError is not null) return colorError;
            var hasSizes = variants.Any(v => v.SizeId != null);
            var hasColors = variants.Any(v => v.ColorId != null);
            if ((addSizes!.Count > 0 && !hasSizes) || (addColors!.Count > 0 && !hasColors))
                return BadRequest(new
                {
                    message = "A model keeps the sizes/colors it was made with: it can't gain a new dimension.",
                    code = "dimension_fixed",
                });

            var sizes = variants.Where(v => v.Size != null).Select(v => v.Size!)
                .Concat(addSizes).DistinctBy(o => o.Id).ToList();
            var colors = variants.Where(v => v.Color != null).Select(v => v.Color!)
                .Concat(addColors!).DistinctBy(o => o.Id).ToList();
            if (Math.Max(1, sizes.Count) * Math.Max(1, colors.Count) > MaxVariants)
                return BadRequest(new { message = $"At most {MaxVariants} sizes × colors per model.", code = "too_many_variants" });
            var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
            newVariants = await AddVariantsAsync(model, units, currency,
                Combos(sizes, colors, variants.Select(v => (v.SizeId, v.ColorId)).ToList()), sizes, colors);
        }

        if (renamed)
            foreach (var v in variants) Catalog.ComposeVariantName(v, model, v.Size, v.Color);

        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, variants.Concat(newVariants).Select(v => v.Id).ToList());
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("update", "product_model", id);
        _storefront.MarkDirty();
        return Ok(await DetailAsync(id));
    }

    /// <summary>
    /// Set the model's prices — what every variant without its own price charges. A null price
    /// removes it (the variants then fall back to the base unit × factor or the default level).
    /// </summary>
    [HttpPut("{id:guid}/prices")]
    [Authorize(Policy = Permissions.PricesEdit)]
    public async Task<ActionResult<ModelDetailDto>> SetPrices(Guid id, [FromBody] UpdatePricesRequest req)
    {
        if (!await _db.ProductModels.AnyAsync(m => m.Id == id))
            return NotFound(new { message = "Model not found.", code = "not_found" });
        if (req.Prices is null || req.Prices.Length == 0)
            return BadRequest(new { message = "No prices to change.", code = "no_prices" });

        var unitIds = (await _db.ModelUnits.Where(u => u.ModelId == id).Select(u => u.UnitId).ToListAsync()).ToHashSet();
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
        var existing = await _db.ModelPrices.Where(p => p.ModelId == id).ToListAsync();
        foreach (var (unit, level) in clears)
            if (existing.FirstOrDefault(e => e.UnitId == unit && e.PriceLevelId == level) is { } row)
                _db.ModelPrices.Remove(row);
        foreach (var (unit, level, price) in valid)
        {
            var row = existing.FirstOrDefault(e => e.UnitId == unit && e.PriceLevelId == level);
            if (row is null)
                _db.ModelPrices.Add(new ModelPrice { ModelId = id, UnitId = unit, PriceLevelId = level, Price = price });
            else
            {
                row.Price = price;
                row.UpdatedAt = DateTime.UtcNow;
            }
        }
        await _db.SaveChangesAsync();
        await PriceBook.SyncListPricesAsync(_db, await _db.Products.Where(p => p.ModelId == id).Select(p => p.Id).ToListAsync());
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("prices", "product_model", id);
        return Ok(await DetailAsync(id));
    }

    // ------------------------------------------------------------------ helpers

    private async Task<ModelDetailDto?> DetailAsync(Guid id)
    {
        var model = await _db.ProductModels.AsNoTracking()
            .Include(m => m.Category).Include(m => m.Supplier).Include(m => m.Units).ThenInclude(u => u.Unit)
            .FirstOrDefaultAsync(m => m.Id == id);
        if (model is null) return null;
        var variants = await _db.Products.AsNoTracking().Include(p => p.Size).Include(p => p.Color)
            .Where(p => p.ModelId == id).ToListAsync();
        var ids = variants.Select(v => v.Id).ToArray();
        var book = await PriceBook.LoadAsync(_db, ids, new[] { id });
        var levels = book.Levels.Where(l => l.IsActive).ToList();
        var units = model.Units.OrderBy(u => u.Factor).ToList();
        var template = units.Select(u => (u.UnitId, u.Factor)).ToList();
        var withOwnPrices = (await _db.ItemPrices.Where(p => ids.Contains(p.ProductId))
            .Select(p => p.ProductId).Distinct().ToListAsync()).ToHashSet();
        var hasMovements = await _db.StockMovements.AnyAsync(m => ids.Contains(m.ProductId))
            || await _db.DocumentLines.AnyAsync(l => ids.Contains(l.ProductId));
        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

        static IEnumerable<VariantOption> Sorted(IEnumerable<VariantOption?> options) => options
            .Where(o => o is not null).Select(o => o!).DistinctBy(o => o.Id)
            .OrderBy(o => o.SortOrder).ThenBy(o => Loc.Name(o));

        return Costs.Guard(User, new ModelDetailDto(
            model.Id.ToString(), model.Code, Loc.Name(model),
            model.CategoryId.ToString(), Loc.Name(model.Category), model.ReorderLevel, model.IsActive, hasMovements,
            units.Select(u => new ItemUnitDto(u.UnitId.ToString(), Loc.Name(u.Unit), u.Factor, null)).ToArray(),
            units.SelectMany(u => levels.Select(l =>
            {
                var (price, source) = book.ModelEffective(id, template, u.UnitId, l.Id);
                return new PriceCellDto(u.UnitId.ToString(), l.Id.ToString(), book.ModelPrice(id, u.UnitId, l.Id), price, source);
            })).ToArray(),
            Sorted(variants.Select(v => v.Size)).Select(Mapper.ToVariantOption).ToArray(),
            Sorted(variants.Select(v => v.Color)).Select(Mapper.ToVariantOption).ToArray(),
            variants
                .OrderBy(v => v.Color?.SortOrder ?? 0).ThenBy(v => v.Color is null ? "" : Loc.Name(v.Color))
                .ThenBy(v => v.Size?.SortOrder ?? 0).ThenBy(v => v.Size is null ? "" : Loc.Name(v.Size))
                .Select(v => new ModelVariantDto(v.Id.ToString(), v.Sku, Loc.Name(v), v.SizeId?.ToString(),
                    v.ColorId?.ToString(), v.StockOnHand, v.IsActive, book.BaseOf(v.Id)?.Barcode,
                    withOwnPrices.Contains(v.Id), v.SalePrice))
                .ToArray(),
            currency, model.SupplierId?.ToString(), model.Supplier?.Name, model.SupplierCode),
            ProductsController.PurchaseLevelIds(book));
    }

    /// <summary>Every size × color pair (either list may be empty) not in <paramref name="existing"/>.</summary>
    private static List<(VariantOption? Size, VariantOption? Color)> Combos(
        IReadOnlyList<VariantOption> sizes, IReadOnlyList<VariantOption> colors, IReadOnlyCollection<(Guid?, Guid?)> existing)
    {
        var sizeList = sizes.Count == 0 ? new List<VariantOption?> { null } : sizes.Cast<VariantOption?>().ToList();
        var colorList = colors.Count == 0 ? new List<VariantOption?> { null } : colors.Cast<VariantOption?>().ToList();
        return (from c in colorList
                from s in sizeList
                where !existing.Contains((s?.Id, c?.Id))
                select (s, c)).ToList();
    }

    /// <summary>Make one variant item per pair: composed name, SKU "CODE-COLOR-SIZE", the model's units.</summary>
    private async Task<List<Product>> AddVariantsAsync(ProductModel model, IReadOnlyList<Catalog.UnitSpec> units,
        string currency, List<(VariantOption? Size, VariantOption? Color)> combos,
        IReadOnlyList<VariantOption> sizes, IReadOnlyList<VariantOption> colors)
    {
        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var made = new List<Product>();
        foreach (var (size, color) in combos)
        {
            var parts = new[]
            {
                model.Code,
                color is null ? "" : Catalog.SkuPart(color, $"C{colors.ToList().IndexOf(color) + 1}"),
                size is null ? "" : Catalog.SkuPart(size, $"S{sizes.ToList().IndexOf(size) + 1}"),
            }.Where(p => p.Length > 0);
            var variant = new Product
            {
                ModelId = model.Id, Model = model, SizeId = size?.Id, ColorId = color?.Id,
                CategoryId = model.CategoryId, ReorderLevel = model.ReorderLevel, Currency = currency,
                SupplierId = model.SupplierId, SupplierCode = model.SupplierCode,
                IsActive = model.IsActive,
                Sku = await Catalog.UniqueSkuAsync(_db, string.Join("-", parts), reserved),
            };
            Catalog.ComposeVariantName(variant, model, size, color);
            _db.Products.Add(variant);
            foreach (var u in units)
                _db.ItemUnits.Add(new ItemUnit { ProductId = variant.Id, UnitId = u.UnitId, Factor = u.Factor });
            made.Add(variant);
        }
        return made;
    }

    /// <summary>Sizes or colors by id: each must exist, be of that kind and open; listed once.</summary>
    private async Task<(List<VariantOption>? Options, ActionResult? Error)> OptionsAsync(string[]? ids, VariantKind kind)
    {
        var parsed = new List<Guid>();
        foreach (var raw in ids ?? Array.Empty<string>())
        {
            if (!Guid.TryParse(raw, out var id) || parsed.Contains(id))
                return (null, BadRequest(new { message = "A size or color was not found.", code = "variant_option_not_found" }));
            parsed.Add(id);
        }
        var found = await _db.VariantOptions.Where(o => parsed.Contains(o.Id) && o.Kind == kind && o.IsActive).ToListAsync();
        if (found.Count != parsed.Count)
            return (null, BadRequest(new { message = "A size or color was not found.", code = "variant_option_not_found" }));
        return (found.OrderBy(o => o.SortOrder).ThenBy(o => Loc.Name(o)).ToList(), null);
    }

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

    private async Task<string> NextCodeAsync()
    {
        var used = (await _db.ProductModels.Select(m => m.Code.ToUpper()).ToListAsync()).ToHashSet();
        var n = used.Count + 1;
        while (used.Contains($"M{n:D3}")) n++;
        return $"M{n:D3}";
    }

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
}
