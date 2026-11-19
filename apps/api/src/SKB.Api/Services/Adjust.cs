using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// A sales line's own increase and discount as typed on the invoice (owner, 2026-11-19): each as a
/// percent and/or an amount for the line. The increase goes on Quantity × UnitPrice first; the
/// discount comes off what that comes to. A percent is rounded like an invoice charge.
/// </summary>
public static class Adjust
{
    /// <summary>Whether the line's discount was typed (a percent or an amount), not sent as one sum.</summary>
    public static bool DiscountTyped(CreateInvoiceLineRequest l) => l.DiscountPercent is not null || l.DiscountAmount is not null;

    /// <summary>Whether anything is typed on the line: an increase or a discount.</summary>
    public static bool Any(CreateInvoiceLineRequest l) =>
        DiscountTyped(l) && (l.DiscountPercent is > 0 || l.DiscountAmount is > 0)
        || l.IncreasePercent is > 0 || l.IncreaseAmount is > 0;

    /// <summary>A percent as basis points (14.5% = 1450).</summary>
    public static int? Bp(decimal? percent) => percent is decimal p ? (int)(p * 100) : null;

    /// <summary>What a percent and an amount come to on <paramref name="on"/> (minor units).</summary>
    public static long Of(long on, decimal? percent, long? amount) =>
        (Bp(percent) is int bp
            ? (long)decimal.Round((decimal)on * bp / Charges.MaxRateBp, MidpointRounding.AwayFromZero)
            : 0) + (amount ?? 0);

    /// <summary>Percents between 0 and 100 with at most 2 decimals; amounts not negative nor too big.</summary>
    public static InvoiceLines.LineError? Check(CreateInvoiceLineRequest l)
    {
        foreach (var p in new[] { l.DiscountPercent, l.IncreasePercent })
            if (p is decimal pc && (pc < 0 || pc > 100 || decimal.Round(pc, 2) != pc))
                return new("bad_percent", "A percent is between 0 and 100, with at most 2 decimals.");
        foreach (var a in new[] { l.DiscountAmount, l.IncreaseAmount })
            if (a is long am && (am < 0 || am > InvoiceLines.MaxPrice))
                return new("bad_amount", "Enter an amount between zero and the most a price can be.");
        return null;
    }
}
