using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Units and prices of a set of items (DOMAIN.md §2.2), loaded once and read many times.
///
/// The price of an item's unit at a price level is worked out in this order:
/// <list type="number">
/// <item><b>OWN</b>: the item's own price for that unit and level.</item>
/// <item><b>MODEL</b>: for a variant, its model's price for that unit and level.</item>
/// <item><b>BASE</b>: the base unit's price (own or model) × the unit's factor — a carton of 24
/// costs 24 pieces unless it has a price of its own.</item>
/// <item><b>DEFAULT</b>: the same steps at the default level of that side (sales / purchases).</item>
/// </list>
/// No price anywhere means the item isn't priced at that level; invoices then suggest one from cost.
/// Money is minor units.
/// </summary>
public sealed class PriceBook
{
    public static class Source
    {
        public const string Own = "OWN";
        public const string Model = "MODEL";
        public const string Base = "BASE";
        public const string DefaultLevel = "DEFAULT";
    }

    private readonly Dictionary<Guid, List<ItemUnit>> _units;
    private readonly Dictionary<Guid, Guid?> _modelOf;
    private readonly Dictionary<(Guid Owner, Guid Unit, Guid Level), long> _own;
    private readonly Dictionary<(Guid Model, Guid Unit, Guid Level), long> _model;
    private readonly Dictionary<Guid, PriceLevel> _levels;

    /// <summary>Every price level (active and closed), sales first, in display order.</summary>
    public IReadOnlyList<PriceLevel> Levels { get; }

    private PriceBook(Dictionary<Guid, List<ItemUnit>> units, Dictionary<Guid, Guid?> modelOf,
        Dictionary<(Guid, Guid, Guid), long> own, Dictionary<(Guid, Guid, Guid), long> model, List<PriceLevel> levels)
    {
        _units = units;
        _modelOf = modelOf;
        _own = own;
        _model = model;
        Levels = levels;
        _levels = levels.ToDictionary(l => l.Id);
    }

    /// <summary>Load the units and prices of <paramref name="productIds"/> (and their models' prices).</summary>
    public static async Task<PriceBook> LoadAsync(AppDbContext db, IEnumerable<Guid> productIds,
        IEnumerable<Guid>? extraModelIds = null)
    {
        var ids = productIds.Distinct().ToArray();
        var models = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.ModelId }).ToListAsync();
        var units = await db.ItemUnits.AsNoTracking().Include(u => u.Unit)
            .Where(u => ids.Contains(u.ProductId)).ToListAsync();
        var own = await db.ItemPrices.AsNoTracking().Where(p => ids.Contains(p.ProductId)).ToListAsync();
        var modelIds = models.Where(m => m.ModelId != null).Select(m => m.ModelId!.Value)
            .Concat(extraModelIds ?? Array.Empty<Guid>()).Distinct().ToArray();
        var modelPrices = modelIds.Length == 0
            ? new List<ModelPrice>()
            : await db.ModelPrices.AsNoTracking().Where(p => modelIds.Contains(p.ModelId)).ToListAsync();
        var levels = await LevelsAsync(db);

        return new PriceBook(
            units.GroupBy(u => u.ProductId).ToDictionary(g => g.Key, g => g.OrderBy(u => u.Factor).ToList()),
            models.ToDictionary(m => m.Id, m => m.ModelId),
            own.ToDictionary(p => (p.ProductId, p.UnitId, p.PriceLevelId), p => p.Price),
            modelPrices.ToDictionary(p => (p.ModelId, p.UnitId, p.PriceLevelId), p => p.Price),
            levels);
    }

    public static Task<List<PriceLevel>> LevelsAsync(AppDbContext db) =>
        db.PriceLevels.AsNoTracking()
            .OrderBy(l => l.Side != PriceSide.SALE).ThenBy(l => l.SortOrder).ThenBy(l => l.CreatedAt)
            .ToListAsync();

    // ------------------------------------------------------------------ units

    /// <summary>The item's units, smallest (the base unit) first.</summary>
    public IReadOnlyList<ItemUnit> UnitsOf(Guid productId) =>
        _units.TryGetValue(productId, out var list) ? list : (IReadOnlyList<ItemUnit>)Array.Empty<ItemUnit>();

    public ItemUnit? BaseOf(Guid productId) => UnitsOf(productId).FirstOrDefault(u => u.Factor == 1);

    /// <summary>The item's unit <paramref name="unitId"/>, or its base unit when none is named.</summary>
    public ItemUnit? UnitOf(Guid productId, Guid? unitId) =>
        unitId is Guid id ? UnitsOf(productId).FirstOrDefault(u => u.UnitId == id) : BaseOf(productId);

    // ------------------------------------------------------------------ levels

    public PriceLevel? Level(Guid id) => _levels.GetValueOrDefault(id);

    /// <summary>The default active level of a side; the first active one if none is marked.</summary>
    public PriceLevel? DefaultLevel(PriceSide side) =>
        Levels.Where(l => l.Side == side && l.IsActive).OrderByDescending(l => l.IsDefault).FirstOrDefault();

    // ------------------------------------------------------------------ prices

    /// <summary>The item's price for <paramref name="unitId"/> at <paramref name="levelId"/>, and where it came from.</summary>
    public (long? Price, string? Source) Effective(Guid productId, Guid unitId, Guid levelId)
    {
        var unit = UnitOf(productId, unitId);
        if (unit is null) return (null, null);
        var found = AtLevel(productId, unit, levelId);
        if (found.Price is not null) return found;
        var level = Level(levelId);
        var fallback = level is null ? null : DefaultLevel(level.Side);
        if (fallback is not null && fallback.Id != levelId)
        {
            var viaDefault = AtLevel(productId, unit, fallback.Id);
            if (viaDefault.Price is long p) return (p, Source.DefaultLevel);
        }
        return (null, null);
    }

    public long? OwnPrice(Guid productId, Guid unitId, Guid levelId) =>
        _own.TryGetValue((productId, unitId, levelId), out var p) ? p : null;

    public long? ModelPrice(Guid modelId, Guid unitId, Guid levelId) =>
        _model.TryGetValue((modelId, unitId, levelId), out var p) ? p : null;

    /// <summary>
    /// What a sales line should cost the customer: the level price, or — for an item with no price
    /// at all — cost × (1 + default markup), where cost is the unit's share of the branch average.
    /// </summary>
    public long SuggestedSale(Guid productId, ItemUnit unit, Guid levelId, long baseCost, int markupPercent) =>
        Effective(productId, unit.UnitId, levelId).Price
        ?? (long)decimal.Round((decimal)baseCost * unit.Factor * (100 + Math.Max(0, markupPercent)) / 100m,
            MidpointRounding.AwayFromZero);

    /// <summary>What a purchase line should cost: the supplier level's price, or the current average cost.</summary>
    public long SuggestedPurchase(Guid productId, ItemUnit unit, Guid levelId, long baseCost) =>
        Effective(productId, unit.UnitId, levelId).Price ?? baseCost * unit.Factor;

    /// <summary>The base unit's price at the default sales level (what <c>Product.SalePrice</c> mirrors).</summary>
    public long ListPrice(Guid productId)
    {
        var baseUnit = BaseOf(productId);
        var level = DefaultLevel(PriceSide.SALE);
        return baseUnit is null || level is null ? 0 : Effective(productId, baseUnit.UnitId, level.Id).Price ?? 0;
    }

    /// <summary>
    /// A model's price for one of its units at a level, the way its variants inherit it: the model's
    /// own price, else its base unit's × factor, else the default level.
    /// </summary>
    public (long? Price, string? Source) ModelEffective(Guid modelId, IReadOnlyList<(Guid UnitId, int Factor)> units,
        Guid unitId, Guid levelId)
    {
        (long?, string?) At(Guid level)
        {
            if (ModelPrice(modelId, unitId, level) is long own) return (own, Source.Own);
            var factor = units.FirstOrDefault(u => u.UnitId == unitId).Factor;
            var baseUnit = units.FirstOrDefault(u => u.Factor == 1);
            if (factor > 1 && baseUnit.UnitId != Guid.Empty && ModelPrice(modelId, baseUnit.UnitId, level) is long b)
                return (b * factor, Source.Base);
            return (null, null);
        }

        var found = At(levelId);
        if (found.Item1 is not null) return found;
        var fallback = Level(levelId) is { } l ? DefaultLevel(l.Side) : null;
        if (fallback is not null && fallback.Id != levelId && At(fallback.Id).Item1 is long p)
            return (p, Source.DefaultLevel);
        return (null, null);
    }

    private (long? Price, string? Source) AtLevel(Guid productId, ItemUnit unit, Guid levelId)
    {
        var direct = Direct(productId, unit.UnitId, levelId);
        if (direct.Price is not null) return direct;
        if (unit.Factor > 1 && BaseOf(productId) is { } baseUnit
            && Direct(productId, baseUnit.UnitId, levelId).Price is long basePrice)
            return (basePrice * unit.Factor, Source.Base);
        return (null, null);
    }

    private (long? Price, string? Source) Direct(Guid productId, Guid unitId, Guid levelId)
    {
        if (OwnPrice(productId, unitId, levelId) is long own) return (own, Source.Own);
        if (_modelOf.TryGetValue(productId, out var model) && model is Guid m && ModelPrice(m, unitId, levelId) is long mp)
            return (mp, Source.Model);
        return (null, null);
    }

    /// <summary>
    /// Refresh <c>Product.SalePrice</c> (the list price shown on stock screens) for the given items
    /// from the saved prices. Call after prices or units were saved; the caller saves again.
    /// </summary>
    public static async Task SyncListPricesAsync(AppDbContext db, ICollection<Guid> productIds)
    {
        if (productIds.Count == 0) return;
        var book = await LoadAsync(db, productIds);
        var products = await db.Products.Where(p => productIds.Contains(p.Id)).ToListAsync();
        foreach (var p in products) p.SalePrice = book.ListPrice(p.Id);
    }
}
