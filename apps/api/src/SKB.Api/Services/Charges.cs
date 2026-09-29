using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Invoice-level charges (DOMAIN.md §2.5): discounts, taxes and additions, as a list. They apply in
/// kind order — DISCOUNT, EXTRA_DISCOUNT, TAX, OTHER_TAX, ADDITION — and in entry order within a kind:
/// <list type="number">
/// <item>each discount comes off what is left after the discounts before it;</item>
/// <item>taxes and additions are worked out on the discounted amount.</item>
/// </list>
/// The total discount is shared out over the lines in proportion to their net amounts (bonus lines
/// take none), so every line knows its real net: sales profit per item stays true, and on a purchase
/// the discount comes off the goods' cost. The shares always add up to the discount exactly.
/// Taxes and additions are never revenue or cost. Money is minor units; rates are basis points.
/// </summary>
public static class Charges
{
    public const int MaxCharges = 20;
    public const int MaxRateBp = 10_000;

    public sealed record Spec(ChargeKind Kind, int? RateBp, long? Fixed, string? Label);

    /// <param name="Allocation">Each line's share of <paramref name="Discount"/>, in line order.</param>
    public sealed record Outcome(List<DocumentCharge> Rows, long Discount, long Tax, long Addition, long[] Allocation);

    /// <summary>
    /// The charges asked for. With no list, the only charge is the tax: <paramref name="taxPercent"/>,
    /// or the company's rate (as before charges existed).
    /// </summary>
    public static (List<Spec>? Specs, InvoiceLines.LineError? Error) Parse(
        ChargeRequest[]? request, int? taxPercent, int defaultTaxPercent)
    {
        if (request is null)
        {
            var tax = Math.Clamp(taxPercent ?? defaultTaxPercent, 0, 100);
            return (tax > 0 ? new List<Spec> { new(ChargeKind.TAX, tax * 100, null, null) } : new List<Spec>(), null);
        }
        if (request.Length > MaxCharges)
            return (null, new("too_many_charges", $"At most {MaxCharges} discounts, taxes and additions."));

        var specs = new List<Spec>();
        foreach (var c in request)
        {
            if (!Enum.TryParse<ChargeKind>(c.Kind, true, out var kind))
                return (null, new("bad_charge", "Unknown kind of charge."));
            if ((c.Percent is null) == (c.Amount is null))
                return (null, new("bad_charge", "Give a charge either a percent or an amount."));
            int? rate = null;
            if (c.Percent is decimal pct)
            {
                if (pct < 0 || pct > 100 || decimal.Round(pct, 2) != pct)
                    return (null, new("bad_charge", "A percent is between 0 and 100, with at most 2 decimals."));
                rate = (int)(pct * 100);
            }
            if (c.Amount is long amount && (amount < 0 || amount > InvoiceLines.MaxPrice))
                return (null, new("bad_charge", "An amount can't be negative."));
            var label = c.Label?.Trim();
            specs.Add(new(kind, rate, c.Amount, string.IsNullOrEmpty(label) ? null : label[..Math.Min(60, label.Length)]));
        }
        return (specs, null);
    }

    /// <summary>
    /// Whether the charges keep to what a user without the change-tax permission may do: exactly the
    /// company's tax rate (or no tax when it is 0), and no other tax.
    /// </summary>
    public static bool IsDefaultTax(IEnumerable<Spec> specs, int defaultTaxPercent)
    {
        var taxes = specs.Where(s => s.Kind is ChargeKind.TAX or ChargeKind.OTHER_TAX).ToList();
        var rate = Math.Clamp(defaultTaxPercent, 0, 100) * 100;
        return rate == 0
            ? taxes.All(s => (s.RateBp ?? s.Fixed ?? 0) == 0)
            : taxes.Count == 1 && taxes[0].Kind == ChargeKind.TAX && taxes[0].RateBp == rate;
    }

    /// <param name="nets">Each line's net amount (after its own discount), in line order.</param>
    /// <param name="shares">Whether a line takes a share of the invoice discount (bonus lines don't).</param>
    public static (Outcome? Outcome, InvoiceLines.LineError? Error) Apply(
        IReadOnlyList<long> nets, IReadOnlyList<bool> shares, IReadOnlyList<Spec> specs)
    {
        var rows = new List<DocumentCharge>();
        var running = nets.Sum();
        long discount = 0, tax = 0, addition = 0;
        var ordered = specs.Select((s, i) => (Spec: s, Index: i))
            .OrderBy(x => (int)x.Spec.Kind).ThenBy(x => x.Index).Select(x => x.Spec).ToList();

        // Discounts first, each on what is left.
        foreach (var s in ordered.Where(s => s.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT))
        {
            var amount = Amount(s, running);
            if (amount > running)
                return (null, new("discount_too_big", "A discount can't be more than what is left of the invoice."));
            running -= amount;
            discount += amount;
            rows.Add(Row(s, amount, rows.Count));
        }
        // Then taxes and additions, on the discounted amount.
        foreach (var s in ordered.Where(s => s.Kind is not (ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT)))
        {
            var amount = Amount(s, running);
            if (s.Kind == ChargeKind.ADDITION) addition += amount; else tax += amount;
            rows.Add(Row(s, amount, rows.Count));
        }

        var allocation = Allocate(discount, nets, shares);
        if (allocation is null)
            return (null, new("discount_too_big", "There is nothing on the invoice to discount."));
        return (new Outcome(rows, discount, tax, addition, allocation), null);
    }

    /// <summary>
    /// Share <paramref name="total"/> over the lines in proportion to their nets (largest remainder,
    /// so the shares add up exactly). Null when there is a total but nothing to share it over.
    /// </summary>
    public static long[]? Allocate(long total, IReadOnlyList<long> nets, IReadOnlyList<bool> shares)
    {
        var result = new long[nets.Count];
        if (total == 0) return result;
        var weights = nets.Select((n, i) => shares[i] && n > 0 ? n : 0L).ToArray();
        var sum = weights.Sum();
        if (sum <= 0) return null;

        var remainders = new decimal[nets.Count];
        long given = 0;
        for (var i = 0; i < nets.Count; i++)
        {
            var exact = (decimal)total * weights[i] / sum;
            result[i] = (long)decimal.Floor(exact);
            remainders[i] = exact - result[i];
            given += result[i];
        }
        foreach (var i in Enumerable.Range(0, nets.Count)
                     .Where(i => weights[i] > 0).OrderByDescending(i => remainders[i]).ThenBy(i => i)
                     .Take((int)(total - given)))
            result[i]++;
        return result;
    }

    private static long Amount(Spec s, long onAmount) => s.RateBp is int bp
        ? (long)decimal.Round((decimal)onAmount * bp / MaxRateBp, MidpointRounding.AwayFromZero)
        : s.Fixed ?? 0;

    private static DocumentCharge Row(Spec s, long amount, int count) => new()
    {
        Seq = count + 1, Kind = s.Kind, RateBp = s.RateBp, FixedAmount = s.Fixed, Amount = amount, Label = s.Label,
    };

    public static DocumentChargeDto ToDto(DocumentCharge c) => new(
        c.Kind.ToString(), c.RateBp is int bp ? bp / 100m : null, c.FixedAmount, c.Amount, c.Label);
}
