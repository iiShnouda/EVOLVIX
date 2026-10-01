using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// What a sale is priced at (owner, 2026-10-01): the selling price (the price list / level, as
/// before), the last price this customer paid for the item in that unit, or its supply cost. The
/// last price and the cost need <c>sales:price_basis</c>; the profit floor still applies to all.
/// </summary>
public static class PriceBasis
{
    public const string List = "LIST";
    public const string Last = "LAST";
    public const string Cost = "COST";

    /// <summary>The basis asked for (LIST when none), or null when it is not one of the three.</summary>
    public static string? Parse(string? raw)
    {
        var b = string.IsNullOrWhiteSpace(raw) ? List : raw.Trim().ToUpperInvariant();
        return b is List or Last or Cost ? b : null;
    }

    /// <summary>
    /// The last price per unit <paramref name="partyId"/> paid for each item in each unit, on an
    /// invoice still standing (not cancelled), free goods aside.
    /// </summary>
    public static async Task<Dictionary<(Guid Product, Guid? Unit), long>> LastPricesAsync(
        AppDbContext db, Guid partyId, IReadOnlyCollection<Guid> productIds,
        DocumentType invoiceType = DocumentType.SALES_INVOICE)
    {
        var rows = await db.DocumentLines.AsNoTracking()
            .Where(l => productIds.Contains(l.ProductId) && !l.IsBonus
                        && l.Document!.PartyId == partyId && l.Document.Type == invoiceType
                        && l.Document.Status != DocumentStatus.CANCELLED)
            .OrderByDescending(l => l.Document!.IssueDate).ThenByDescending(l => l.LineNo)
            .Select(l => new { l.ProductId, l.UnitId, l.UnitPrice })
            .ToListAsync();
        var last = new Dictionary<(Guid, Guid?), long>();
        foreach (var r in rows) last.TryAdd((r.ProductId, r.UnitId), r.UnitPrice);
        return last;
    }

    /// <summary>
    /// The price of each line on its own basis (owner, 2026-10-01: chosen per item): the list price as priced, the last price
    /// (else the list price), or the cost of one line unit. Last and cost carry no automatic discount.
    /// </summary>
    public static List<SpecialPrices.Priced> Apply(IReadOnlyList<string> bases, IReadOnlyList<SpecialPrices.Priced> priced,
        IReadOnlyList<SpecialPrices.LineAsk> lines, IReadOnlyDictionary<(Guid Product, Guid? Unit), long> lastPrices)
    {
        var result = new List<SpecialPrices.Priced>(priced.Count);
        for (var i = 0; i < priced.Count; i++)
        {
            var p = priced[i];
            var l = lines[i];
            var basis = bases[i];
            if (l.IsBonus || basis == List) { result.Add(p); continue; }
            if (basis == Last)
            {
                result.Add(lastPrices.TryGetValue((l.Product.Id, l.Unit.UnitId), out var lastPrice)
                    ? p with { UnitPrice = lastPrice, Discount = 0, Source = Last, BreakBp = 0 }
                    : p);
                continue;
            }
            result.Add(p with { UnitPrice = l.BaseCost * l.Unit.Factor, Discount = 0, Source = Cost, BreakBp = 0 });
        }
        return result;
    }
}
