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
/// A list covers the items it prices, and — when it gives a percent off — every item of its department
/// or sub-group (all items without one). With a minimum amount it applies only once the covered items
/// come to that much at the selling price (owner, 2026-10-21).
/// On a sale, a <b>quantity discount</b> then comes off the line: the item's own steps, or, if it has
/// none, its model's (counted over every size and color on the invoice), by quantity or by money. The
/// highest step reached applies, as a line discount. Free lines have neither.
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
    /// <summary>Each list's sub-group and those under it (lists limited to one).</summary>
    private readonly Dictionary<Guid, HashSet<Guid>> _groups;
    /// <summary>Each item group's department.</summary>
    private readonly Dictionary<Guid, Guid?> _departmentOf;

    private SpecialPrices(List<(PriceList, Dictionary<(Guid, Guid), long>)> lists, Dictionary<Guid, List<QuantityBreak>> breaks,
        Dictionary<Guid, HashSet<Guid>> groups, Dictionary<Guid, Guid?> departmentOf)
    {
        _lists = lists;
        _breaks = breaks;
        _groups = groups;
        _departmentOf = departmentOf;
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
        var groups = new Dictionary<Guid, HashSet<Guid>>();
        var departmentOf = new Dictionary<Guid, Guid?>();
        if (ordered.Any(l => l.DepartmentId != null))
        {
            var all = await db.Categories.AsNoTracking().ToListAsync();
            departmentOf = all.ToDictionary(c => c.Id, c => c.DepartmentId);
            foreach (var l in ordered.Where(l => l.GroupId != null))
                groups[l.Id] = Catalog.Subtree(l.GroupId!.Value, all).ToHashSet();
        }
        return new SpecialPrices(
            ordered.Select(l => (l, items.Where(i => i.ListId == l.Id)
                .ToDictionary(i => ((i.ProductId ?? i.ModelId)!.Value, i.UnitId), i => i.Price))).ToList(),
            breaks.GroupBy(q => (q.ProductId ?? q.ModelId)!.Value)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(q => q.MinQuantity).ThenByDescending(q => q.MinAmount).ToList()),
            groups, departmentOf);
    }

    /// <summary>A list's own price for the item's unit (its model's, or the base unit's × factor).</summary>
    private static long? OwnPrice(Dictionary<(Guid Target, Guid Unit), long> items, Product product, ItemUnit unit, ItemUnit? baseUnit)
    {
        long? Find(Guid unitId) =>
            items.TryGetValue((product.Id, unitId), out var own) ? own
            : product.ModelId is Guid m && items.TryGetValue((m, unitId), out var model) ? model
            : null;
        if (Find(unit.UnitId) is long p) return p;
        if (unit.Factor > 1 && baseUnit is not null && Find(baseUnit.UnitId) is long b) return b * unit.Factor;
        return null;
    }

    /// <summary>The list's percent reaches the item: it gives one, and the item is in its department / sub-group.</summary>
    private bool InScope(PriceList list, Product product)
    {
        if (list.PercentBp <= 0) return false;
        if (list.DepartmentId is Guid d && _departmentOf.GetValueOrDefault(product.CategoryId) != d) return false;
        return list.GroupId is null || (_groups.TryGetValue(list.Id, out var under) && under.Contains(product.CategoryId));
    }

    /// <summary>The quantity discount (hundredths of a percent) for an item, given the invoice's totals.</summary>
    private int BreakBp(Product product, IReadOnlyDictionary<Guid, (long Qty, long Amount)> byProduct,
        IReadOnlyDictionary<Guid, (long Qty, long Amount)> byModel)
    {
        static bool Reached(QuantityBreak q, (long Qty, long Amount) t) =>
            q.MinAmount > 0 ? t.Amount >= q.MinAmount : t.Qty >= q.MinQuantity;
        if (_breaks.TryGetValue(product.Id, out var own))
            return own.FirstOrDefault(q => Reached(q, byProduct.GetValueOrDefault(product.Id)))?.PercentBp ?? 0;
        if (product.ModelId is Guid m && _breaks.TryGetValue(m, out var model))
            return model.FirstOrDefault(q => Reached(q, byModel.GetValueOrDefault(m)))?.PercentBp ?? 0;
        return 0;
    }

    /// <summary>A line's discount for <paramref name="bp"/> hundredths of a percent off its amount.</summary>
    public static long Discount(long gross, int bp) =>
        bp <= 0 ? 0 : (long)decimal.Round((decimal)gross * bp / 10000m, MidpointRounding.AwayFromZero);

    /// <summary>What each line should cost when nobody changes it by hand (see the class notes).</summary>
    public List<Priced> Price(PriceBook book, PriceLevel? level, PriceSide side, IReadOnlyList<LineAsk> lines, int markupPercent)
    {
        // The selling price without any list: the level's, else cost plus the default markup.
        var plain = lines.Select<LineAsk, (long Price, string Source)>(l =>
        {
            if (l.IsBonus) return (0L, Source.Bonus);
            if (level is not null && book.Effective(l.Product.Id, l.Unit.UnitId, level.Id).Price is long levelPrice)
                return (levelPrice, Source.Level);
            return (side == PriceSide.SALE
                ? InvoiceLines.MarkupPrice(l.BaseCost, l.Unit.Factor, markupPercent)
                : l.BaseCost * l.Unit.Factor, Source.Cost);
        }).ToList();

        // Each list's price for each line (null = it doesn't cover it), and whether the list applies:
        // the lines it covers reach its minimum at the selling price.
        var offers = _lists.Select(x =>
        {
            var prices = lines.Select((l, i) =>
            {
                if (l.IsBonus) return (long?)null;
                if (OwnPrice(x.Items, l.Product, l.Unit, book.BaseOf(l.Product.Id)) is long own) return own;
                if (InScope(x.List, l.Product))
                    return plain[i].Price - Discount(plain[i].Price, x.List.PercentBp);
                return null;
            }).ToList();
            var covered = lines.Select((l, i) => prices[i] is null ? 0 : (long)l.Quantity * plain[i].Price).Sum();
            return (x.List, Prices: prices, Applies: covered >= x.List.MinAmount);
        }).Where(o => o.Applies).ToList();

        var chosen = lines.Select<LineAsk, (long Price, string Source, string? ListName)>((l, i) =>
        {
            if (l.IsBonus) return (0L, Source.Bonus, null);
            foreach (var o in offers)
                if (o.Prices[i] is long p) return (p, Source.List, Loc.Name(o.List));
            return (plain[i].Price, plain[i].Source, null);
        }).ToList();

        var byProduct = new Dictionary<Guid, (long Qty, long Amount)>();
        var byModel = new Dictionary<Guid, (long Qty, long Amount)>();
        for (var i = 0; i < lines.Count; i++)
        {
            var l = lines[i];
            if (l.IsBonus) continue;
            var amount = (long)l.Quantity * chosen[i].Price;
            var p = byProduct.GetValueOrDefault(l.Product.Id);
            byProduct[l.Product.Id] = (p.Qty + l.BaseQty, p.Amount + amount);
            if (l.Product.ModelId is Guid m)
            {
                var t = byModel.GetValueOrDefault(m);
                byModel[m] = (t.Qty + l.BaseQty, t.Amount + amount);
            }
        }

        return lines.Select((l, i) =>
        {
            if (l.IsBonus) return new Priced(0, 0, Source.Bonus, null, 0);
            var (price, source, listName) = chosen[i];
            var bp = side == PriceSide.SALE ? BreakBp(l.Product, byProduct, byModel) : 0;
            return new Priced(price, Discount((long)l.Quantity * price, bp), source, listName, bp);
        }).ToList();
    }
}
