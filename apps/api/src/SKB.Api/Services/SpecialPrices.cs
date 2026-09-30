using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Price lists and quantity discounts (DOMAIN.md §2.2), on top of the price levels, for one invoice.
///
/// A line's price, when nobody changes it by hand:
/// <list type="number">
/// <item><b>LIST</b>: the party's price list, then any list for everyone (newest first) — the first
/// that prices the item: its own price for the unit, its model's, or the base unit's × factor.</item>
/// <item><b>LEVEL</b>: else the invoice's price level (see <see cref="PriceBook"/>).</item>
/// <item><b>COST</b>: else, for an item with no price at all, cost × (1 + default markup) on a sale and
/// the average cost on a purchase.</item>
/// </list>
/// On a sale, a <b>quantity discount</b> then comes off the line: the item's own steps, or, if it has
/// none, its model's (counted over every size and color on the invoice). The highest step reached
/// applies, as a line discount. Free lines have neither.
/// </summary>
public sealed class SpecialPrices
{
    public static class Source
    {
        public const string List = "LIST";
        public const string Level = "LEVEL";
        public const string Cost = "COST";
        public const string Bonus = "BONUS";
    }

    public sealed record LineAsk(Product Product, ItemUnit Unit, int Quantity, int BaseQty, bool IsBonus, long BaseCost);

    /// <param name="BreakBp">The quantity discount applied, in hundredths of a percent (0 = none).</param>
    public sealed record Priced(long UnitPrice, long Discount, string Source, string? ListName, int BreakBp);

    private readonly List<(PriceList List, Dictionary<(Guid Target, Guid Unit), long> Items)> _lists;
    private readonly Dictionary<Guid, List<QuantityBreak>> _breaks;

    private SpecialPrices(List<(PriceList, Dictionary<(Guid, Guid), long>)> lists, Dictionary<Guid, List<QuantityBreak>> breaks)
    {
        _lists = lists;
        _breaks = breaks;
    }

    /// <summary>The lists that apply today to a party (theirs first, then offers for everyone) and the discounts of these items.</summary>
    public static async Task<SpecialPrices> LoadAsync(AppDbContext db, PriceSide side, Guid? partyListId,
        IReadOnlyCollection<Product> products)
    {
        var today = CompanyClock.TodayDate;
        var lists = await db.PriceLists.AsNoTracking()
            .Where(l => l.Side == side && l.IsActive && (l.Id == partyListId || l.ForEveryone)
                        && (l.ValidFrom == null || l.ValidFrom <= today) && (l.ValidTo == null || l.ValidTo >= today))
            .ToListAsync();
        var ordered = lists.OrderBy(l => l.Id == partyListId ? 0 : 1).ThenByDescending(l => l.CreatedAt).ToList();
        var productIds = products.Select(p => p.Id).Distinct().ToList();
        var modelIds = products.Where(p => p.ModelId != null).Select(p => p.ModelId!.Value).Distinct().ToList();
        var listIds = ordered.Select(l => l.Id).ToList();
        var items = listIds.Count == 0
            ? new List<PriceListItem>()
            : await db.PriceListItems.AsNoTracking()
                .Where(i => listIds.Contains(i.ListId)
                            && ((i.ProductId != null && productIds.Contains(i.ProductId.Value))
                                || (i.ModelId != null && modelIds.Contains(i.ModelId.Value))))
                .ToListAsync();
        var breaks = side != PriceSide.SALE
            ? new List<QuantityBreak>()
            : await db.QuantityBreaks.AsNoTracking()
                .Where(q => (q.ProductId != null && productIds.Contains(q.ProductId.Value))
                            || (q.ModelId != null && modelIds.Contains(q.ModelId.Value)))
                .ToListAsync();
        return new SpecialPrices(
            ordered.Select(l => (l, items.Where(i => i.ListId == l.Id)
                .ToDictionary(i => ((i.ProductId ?? i.ModelId)!.Value, i.UnitId), i => i.Price))).ToList(),
            breaks.GroupBy(q => (q.ProductId ?? q.ModelId)!.Value)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(q => q.MinQuantity).ToList()));
    }

    /// <summary>The first list's price for the item's unit, and that list.</summary>
    public (long Price, PriceList List)? ListPrice(Product product, ItemUnit unit, ItemUnit? baseUnit)
    {
        foreach (var (list, items) in _lists)
        {
            long? Find(Guid unitId) =>
                items.TryGetValue((product.Id, unitId), out var own) ? own
                : product.ModelId is Guid m && items.TryGetValue((m, unitId), out var model) ? model
                : null;
            if (Find(unit.UnitId) is long p) return (p, list);
            if (unit.Factor > 1 && baseUnit is not null && Find(baseUnit.UnitId) is long b) return (b * unit.Factor, list);
        }
        return null;
    }

    /// <summary>The quantity discount (hundredths of a percent) for an item, given the invoice's totals in base units.</summary>
    public int BreakBp(Product product, IReadOnlyDictionary<Guid, long> byProduct, IReadOnlyDictionary<Guid, long> byModel)
    {
        if (_breaks.TryGetValue(product.Id, out var own))
            return own.FirstOrDefault(q => byProduct.GetValueOrDefault(product.Id) >= q.MinQuantity)?.PercentBp ?? 0;
        if (product.ModelId is Guid m && _breaks.TryGetValue(m, out var model))
            return model.FirstOrDefault(q => byModel.GetValueOrDefault(m) >= q.MinQuantity)?.PercentBp ?? 0;
        return 0;
    }

    /// <summary>A line's discount for <paramref name="bp"/> hundredths of a percent off its amount.</summary>
    public static long Discount(long gross, int bp) =>
        bp <= 0 ? 0 : (long)decimal.Round((decimal)gross * bp / 10000m, MidpointRounding.AwayFromZero);

    /// <summary>What each line should cost when nobody changes it by hand (see the class notes).</summary>
    public List<Priced> Price(PriceBook book, PriceLevel? level, PriceSide side, IReadOnlyList<LineAsk> lines, int markupPercent)
    {
        var byProduct = new Dictionary<Guid, long>();
        var byModel = new Dictionary<Guid, long>();
        foreach (var l in lines.Where(l => !l.IsBonus))
        {
            byProduct[l.Product.Id] = byProduct.GetValueOrDefault(l.Product.Id) + l.BaseQty;
            if (l.Product.ModelId is Guid m) byModel[m] = byModel.GetValueOrDefault(m) + l.BaseQty;
        }

        return lines.Select(l =>
        {
            if (l.IsBonus) return new Priced(0, 0, Source.Bonus, null, 0);
            long price;
            string source;
            string? listName = null;
            if (ListPrice(l.Product, l.Unit, book.BaseOf(l.Product.Id)) is { } listed)
            {
                (price, source, listName) = (listed.Price, Source.List, Loc.Name(listed.List));
            }
            else if (level is not null && book.Effective(l.Product.Id, l.Unit.UnitId, level.Id).Price is long levelPrice)
            {
                (price, source) = (levelPrice, Source.Level);
            }
            else
            {
                price = side == PriceSide.SALE
                    ? InvoiceLines.MarkupPrice(l.BaseCost, l.Unit.Factor, markupPercent)
                    : l.BaseCost * l.Unit.Factor;
                source = Source.Cost;
            }
            var bp = side == PriceSide.SALE ? BreakBp(l.Product, byProduct, byModel) : 0;
            return new Priced(price, Discount((long)l.Quantity * price, bp), source, listName, bp);
        }).ToList();
    }
}
