using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Invoice-level charges (DOMAIN.md §2.5): increases, discounts, taxes and additions, as a list. They
/// apply in kind order — INCREASE, DISCOUNT, EXTRA_DISCOUNT, TAX, OTHER_TAX, ADDITION — and in entry
/// order within a kind:
/// <list type="number">
/// <item>a sale's increase (owner, 2026-11-19) goes on the lines' total: it is sales, shared over the
/// lines like a discount, so each line's net includes its share;</item>
/// <item>the DISCOUNT comes off it. Nothing compounds (owner, 2026-11-19): an INCREASE's and a
/// DISCOUNT's percents are both of the same base, the lines' total, so they net out (+10% +2.00 −5%
/// −1.00 on 200.00 is 211.00); amounts are as typed;</item>
/// <item>the EXTRA_DISCOUNT, a purchase's second discount, is a discount on top: its percent is of what
/// is left after the first. A sale has none (owner, 2026-11-20): it has one invoice discount, which the
/// accountant sees and changes, and a discount over several invoices is spread into each one's;</item>
/// <item>taxes and additions are worked out on the discounted amount.</item>
/// </list>
/// The total discount is shared out over the lines in proportion to their net amounts (bonus lines
/// take none), so every line knows its real net: sales profit per item stays true, and on a purchase
/// the discount comes off the goods' cost. The shares always add up to the discount exactly.
/// A sale's increase or discount may also be an amount a piece (owner, 2026-11-20): it comes to that
/// times the invoice's pieces (each item's smallest unit, free goods aside) and each line takes exactly
/// its own pieces times it, with no rounding; the rest is shared by the nets as above.
/// Taxes and additions are never revenue or cost. Money is minor units; rates are basis points.
/// </summary>
public static class Charges
{
    public const int MaxCharges = 20;
    public const int MaxRateBp = 10_000;

    /// <summary>A sale has one invoice discount (owner, 2026-11-20): no second one is added.</summary>
    public static readonly InvoiceLines.LineError ExtraDiscountRetired = new("extra_discount_retired",
        "An invoice has one discount: change it instead of adding a second one.");

    /// <param name="PerPiece">An amount a piece (a sale's increase or discount), times the pieces.</param>
    public sealed record Spec(ChargeKind Kind, int? RateBp, long? Fixed, string? Label, long? PerPiece = null);

    /// <summary>A stored charge as it was typed (a percent, an amount, or an amount a piece).</summary>
    public static Spec SpecOf(DocumentCharge c) => new(c.Kind, c.RateBp,
        c.RateBp is null && c.PieceFixed is null ? c.FixedAmount : null, c.Label, c.RateBp is null ? c.PieceFixed : null);

    /// <summary>A stored charge asked for again, as typed.</summary>
    public static ChargeRequest RequestOf(DocumentCharge c)
    {
        var s = SpecOf(c);
        return new(c.Kind.ToString(), s.RateBp is int bp ? bp / 100m : null, s.Fixed, c.Label, s.PerPiece);
    }

    /// <param name="Allocation">Each line's share of <paramref name="Discount"/>, in line order.</param>
    /// <param name="IncreaseAllocation">Each line's share of <paramref name="Increase"/>, in line order.</param>
    public sealed record Outcome(List<DocumentCharge> Rows, long Discount, long Tax, long Addition, long[] Allocation,
        long Increase, long[] IncreaseAllocation);

    /// <summary>The order kinds apply in: increases, then discounts, then taxes and additions.</summary>
    private static int Order(ChargeKind k) => k == ChargeKind.INCREASE ? -1 : (int)k;

    /// <summary>
    /// The charges asked for. With no list, the only charge is the tax: <paramref name="taxPercent"/>,
    /// or the company's rate (as before charges existed).
    /// </summary>
    /// <param name="sales">An increase is a sale's only (not a purchase's).</param>
    public static (List<Spec>? Specs, InvoiceLines.LineError? Error) Parse(
        ChargeRequest[]? request, int? taxPercent, int defaultTaxPercent, bool sales = false)
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
            if (!Enum.TryParse<ChargeKind>(c.Kind, true, out var kind) || !Enum.IsDefined(kind)
                || (kind == ChargeKind.INCREASE && !sales))
                return (null, new("bad_charge", "Unknown kind of charge."));
            if (kind == ChargeKind.EXTRA_DISCOUNT && sales)
                return (null, ExtraDiscountRetired);
            if ((c.Percent is null ? 0 : 1) + (c.Amount is null ? 0 : 1) + (c.PerPiece is null ? 0 : 1) != 1)
                return (null, new("bad_charge", "Give a charge either a percent or an amount."));
            // An amount a piece is a sale's increase or discount only.
            if (c.PerPiece is not null && !(sales && kind is ChargeKind.INCREASE or ChargeKind.DISCOUNT))
                return (null, new("bad_charge", "Only an increase or a discount can be an amount a piece."));
            if (c.PerPiece is long pp && (pp < 0 || pp > InvoiceLines.MaxPrice))
                return (null, new("bad_charge", "An amount can't be negative."));
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
            specs.Add(new(kind, rate, c.Amount, string.IsNullOrEmpty(label) ? null : label[..Math.Min(60, label.Length)],
                c.PerPiece));
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
    /// <param name="pieces">Each line's pieces (its item's smallest unit), for an amount a piece.</param>
    public static (Outcome? Outcome, InvoiceLines.LineError? Error) Apply(
        IReadOnlyList<long> nets, IReadOnlyList<bool> shares, IReadOnlyList<Spec> specs,
        IReadOnlyList<long>? pieces = null)
    {
        var rows = new List<DocumentCharge>();
        var running = nets.Sum();
        var lines = running; // the base an increase's and the first discount's percents are of
        // The pieces an amount a piece is times: those of the lines that take a share (not free goods).
        var each = nets.Select((_, i) => shares[i] && pieces is not null ? Math.Max(0, pieces[i]) : 0L).ToArray();
        var allPieces = each.Sum();
        long discount = 0, tax = 0, addition = 0, increase = 0, increasePiece = 0, discountPiece = 0;
        var ordered = specs.Select((s, i) => (Spec: s, Index: i))
            .OrderBy(x => Order(x.Spec.Kind)).ThenBy(x => x.Index).Select(x => x.Spec).ToList();

        // Increases first, on the lines' total; each line takes its share (it is part of what it brings in).
        foreach (var s in ordered.Where(s => s.Kind == ChargeKind.INCREASE))
        {
            var amount = Amount(s, lines, allPieces);
            running += amount;
            increase += amount;
            if (s.PerPiece is not null) increasePiece += s.PerPiece.Value;
            rows.Add(Row(s, amount, rows.Count));
        }
        // An amount a piece goes on each line exactly by its pieces; the rest by the nets.
        var increased = Allocate(increase - increasePiece * allPieces, nets, shares);
        if (increased is null)
            return (null, new("increase_nothing", "There is nothing on the invoice to increase."));
        for (var i = 0; i < increased.Length; i++) increased[i] += increasePiece * each[i];
        var raised = nets.Select((n, i) => n + increased[i]).ToList();

        // Then discounts: the first's percent on the lines' total too, the second's on what is left.
        foreach (var s in ordered.Where(s => s.Kind is ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT))
        {
            var amount = Amount(s, s.Kind == ChargeKind.DISCOUNT ? lines : running, allPieces);
            if (amount > running)
                return (null, new("discount_too_big", "A discount can't be more than what is left of the invoice."));
            running -= amount;
            discount += amount;
            if (s.PerPiece is not null) discountPiece += s.PerPiece.Value;
            rows.Add(Row(s, amount, rows.Count));
        }
        // Then taxes and additions, on the discounted amount.
        foreach (var s in ordered.Where(s => s.Kind is not (ChargeKind.DISCOUNT or ChargeKind.EXTRA_DISCOUNT
                                                 or ChargeKind.INCREASE)))
        {
            var amount = Amount(s, running, allPieces);
            if (s.Kind == ChargeKind.ADDITION) addition += amount; else tax += amount;
            rows.Add(Row(s, amount, rows.Count));
        }

        var allocation = Allocate(discount - discountPiece * allPieces, raised, shares);
        if (allocation is null)
            return (null, new("discount_too_big", "There is nothing on the invoice to discount."));
        for (var i = 0; i < allocation.Length; i++)
        {
            allocation[i] += discountPiece * each[i];
            // A discount a piece can't take more off a line than it comes to.
            if (allocation[i] > raised[i])
                return (null, new("discount_too_big", "A discount can't be more than a line's amount."));
        }
        return (new Outcome(rows, discount, tax, addition, allocation, increase, increased), null);
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

    private static long Amount(Spec s, long onAmount, long pieces) => s.RateBp is int bp
        ? (long)decimal.Round((decimal)onAmount * bp / MaxRateBp, MidpointRounding.AwayFromZero)
        : s.PerPiece is long pp ? pp * pieces : s.Fixed ?? 0;

    private static DocumentCharge Row(Spec s, long amount, int count) => new()
    {
        Seq = count + 1, Kind = s.Kind, RateBp = s.RateBp, FixedAmount = s.Fixed, Amount = amount, Label = s.Label,
        PieceFixed = s.PerPiece,
    };

    public static DocumentChargeDto ToDto(DocumentCharge c) => new(
        c.Kind.ToString(), c.RateBp is int bp ? bp / 100m : null, c.FixedAmount, c.Amount, c.Label, c.PieceFixed);
}
