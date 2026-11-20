using System.Security.Claims;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// An increase never shows to the customer (owner, 2026-11-20): on paper, and on the screen of whoever
/// may not see increases (<see cref="Permissions.SalesSeeIncreases"/>), it is folded into the prices.
/// A line's increase and its share of the invoice's go into the price shown — its total exactly as it
/// is (so the lines and the totals still add up to the invoice's total to the piastre), the price a
/// line unit that total over its quantity, rounded — and the invoice's increase rows go. Discounts stay.
/// The web app folds a paper the same way (<c>foldIncreases</c> in @skb/shared).
/// </summary>
public static class Increases
{
    public static bool CanSee(ClaimsPrincipal user) => user.HasClaim("permission", Permissions.SalesSeeIncreases);

    /// <summary>The price a line unit shows: what the line comes to before its own discount, over its quantity.</summary>
    public static long Shown(long unitPrice, long lineTotal, long discount, long added, int quantity, bool bonus) =>
        added != 0 && quantity > 0 && !bonus
            ? (long)decimal.Round((decimal)(lineTotal + discount) / quantity, MidpointRounding.AwayFromZero)
            : unitPrice;

    public static SalesDetailDto Fold(SalesDetailDto d) => d with
    {
        Lines = d.Lines.Select(l => l with
        {
            UnitPrice = Shown(l.UnitPrice, l.LineTotal, l.Discount, l.Increase + l.DocIncrease,
                l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.IsBonus),
            Increase = 0, DocIncrease = 0, IncreaseRate = null, IncreaseFixed = null, IncreasePiece = null,
            IncreaseBy = null,
        }).ToArray(),
        Charges = d.Charges.Where(c => c.Kind != nameof(ChargeKind.INCREASE)).ToArray(),
    };

    /// <summary>The invoice as this person may see it: folded unless they may see increases.</summary>
    public static SalesDetailDto Guard(ClaimsPrincipal user, SalesDetailDto d) => CanSee(user) ? d : Fold(d);
}
