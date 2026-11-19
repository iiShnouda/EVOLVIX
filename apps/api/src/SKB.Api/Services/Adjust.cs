using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// A sales line's own increase and discount as typed on the invoice (owner, 2026-11-19): each as a
/// percent, an amount for the line and an amount a piece. Nothing compounds (owner, 2026-11-19): both
/// percents are of the same base, Quantity × UnitPrice, so an increase and a discount net out
/// (+10% +2.00 −5% −1.00 on 200.00 is 211.00). A percent is rounded to the piastre, half away from zero.
/// </summary>
public static class Adjust
{
    /// <summary>Whether the line's discount was typed (a percent or an amount), not sent as one sum.</summary>
    public static bool DiscountTyped(CreateInvoiceLineRequest l) =>
        l.DiscountPercent is not null || l.DiscountAmount is not null || l.DiscountPerPiece is not null;

    /// <summary>Whether anything is typed on the line: an increase or a discount.</summary>
    public static bool Any(CreateInvoiceLineRequest l) =>
        DiscountTyped(l) && (l.DiscountPercent is > 0 || l.DiscountAmount is > 0 || l.DiscountPerPiece is > 0)
        || l.IncreasePercent is > 0 || l.IncreaseAmount is > 0 || l.IncreasePerPiece is > 0;

    /// <summary>A percent as basis points (14.5% = 1450).</summary>
    public static int? Bp(decimal? percent) => percent is decimal p ? (int)(p * 100) : null;

    /// <summary>
    /// What a percent of <paramref name="on"/>, an amount, and an amount a piece over
    /// <paramref name="pieces"/> come to (minor units).
    /// </summary>
    public static long Of(long on, decimal? percent, long? amount, long? perPiece = null, long pieces = 0) =>
        (Bp(percent) is int bp
            ? (long)decimal.Round((decimal)on * bp / Charges.MaxRateBp, MidpointRounding.AwayFromZero)
            : 0) + (amount ?? 0) + (perPiece ?? 0) * pieces;

    /// <summary>Percents between 0 and 100 with at most 2 decimals; amounts not negative nor too big.</summary>
    public static InvoiceLines.LineError? Check(CreateInvoiceLineRequest l)
    {
        foreach (var p in new[] { l.DiscountPercent, l.IncreasePercent })
            if (p is decimal pc && (pc < 0 || pc > 100 || decimal.Round(pc, 2) != pc))
                return new("bad_percent", "A percent is between 0 and 100, with at most 2 decimals.");
        foreach (var a in new[] { l.DiscountAmount, l.IncreaseAmount, l.DiscountPerPiece, l.IncreasePerPiece })
            if (a is long am && (am < 0 || am > InvoiceLines.MaxPrice))
                return new("bad_amount", "Enter an amount between zero and the most a price can be.");
        return null;
    }
}
