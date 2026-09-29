using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// What sales and purchase invoices share about their lines: shape limits, the unit a line is in
/// (and so its base quantity), and the price level the invoice is priced at.
/// </summary>
public static class InvoiceLines
{
    public const int MaxLines = 500;
    /// <summary>Most units on one line (1,000,000 cartons is already far beyond real orders).</summary>
    public const int MaxQuantity = 1_000_000;
    /// <summary>Highest price of one unit: 10,000,000,000.00 — keeps every line total inside a long.</summary>
    public const long MaxPrice = 1_000_000_000_000;

    public sealed record LineError(string Code, string Message);

    /// <summary>Ids parse, quantity 1–1,000,000, price 0–MaxPrice, discount between 0 and the line's gross.</summary>
    public static (Guid ProductId, Guid? UnitId, LineError? Error) CheckShape(
        string productId, string? unitId, int quantity, long price, long discount)
    {
        if (!Guid.TryParse(productId, out var pid))
            return (default, null, new("product_not_found", "A product on the invoice was not found."));
        Guid? unit = null;
        if (!string.IsNullOrWhiteSpace(unitId))
        {
            if (!Guid.TryParse(unitId, out var u)) return (default, null, new("unit_not_found", "A unit on the invoice was not found."));
            unit = u;
        }
        if (quantity <= 0 || quantity > MaxQuantity)
            return (default, null, new("bad_qty", $"Quantity must be between 1 and {MaxQuantity:N0}."));
        if (price < 0 || price > MaxPrice || discount < 0)
            return (default, null, new("bad_price", "Price/discount cannot be negative."));
        if (discount > (long)quantity * price)
            return (default, null, new("bad_price", "A discount can't be more than the line's amount."));
        return (pid, unit, null);
    }

    /// <summary>The item's unit for a line (base unit when none is named) and the quantity in base units.</summary>
    public static (ItemUnit? Unit, int BaseQuantity, LineError? Error) ResolveUnit(
        PriceBook book, Product product, Guid? unitId, int quantity)
    {
        var unit = book.UnitOf(product.Id, unitId);
        if (unit is null)
            return (null, 0, new("unit_not_found", $"{Loc.Name(product)} doesn't come in that unit."));
        var baseQty = (long)quantity * unit.Factor;
        if (baseQty > int.MaxValue)
            return (null, 0, new("bad_qty", $"{Loc.Name(product)}: that quantity is too large."));
        return (unit, (int)baseQty, null);
    }

    /// <summary>
    /// The price level an invoice is priced at: the one asked for, else the party's own (if still
    /// open), else the side's default. Asking for another level than the party's needs
    /// <paramref name="canChoose"/>. Null only when no level of that side exists at all.
    /// </summary>
    public static (PriceLevel? Level, LineError? Error) ResolveLevel(
        PriceBook book, string? requested, Guid? partyLevelId, PriceSide side, bool canChoose)
    {
        var own = partyLevelId is Guid pl && book.Level(pl) is { IsActive: true } l && l.Side == side
            ? l
            : book.DefaultLevel(side);
        if (string.IsNullOrWhiteSpace(requested)) return (own, null);

        if (!Guid.TryParse(requested, out var id) || book.Level(id) is not { IsActive: true } level || level.Side != side)
            return (null, new("price_level_not_found", "Price level not found."));
        if (level.Id != own?.Id && !canChoose)
            return (null, new("price_level_not_allowed", "Choosing another price level needs permission."));
        return (level, null);
    }

    /// <summary>The price of an unpriced item: cost of the line unit × (1 + markup%).</summary>
    public static long MarkupPrice(long baseCost, int factor, int markupPercent) =>
        (long)decimal.Round((decimal)baseCost * factor * (100 + Math.Max(0, markupPercent)) / 100m,
            MidpointRounding.AwayFromZero);

    /// <summary>Minor units as "1234.50" for messages.</summary>
    public static string Major(long minor) => (minor / 100m).ToString("0.00", CultureInfo.InvariantCulture);

    /// <summary>An error response: 403 for a missing permission (…_not_allowed), else 400.</summary>
    public static ActionResult Refuse(ControllerBase controller, LineError error) =>
        controller.StatusCode(error.Code.EndsWith("_not_allowed") ? 403 : 400,
            new { message = error.Message, code = error.Code });

    /// <summary>The base unit's name (in the request language) of each item on <paramref name="doc"/>.</summary>
    public static async Task<Dictionary<Guid, string>> BaseUnitNamesAsync(AppDbContext db, SalesDocument doc)
    {
        var ids = doc.Lines.Select(l => l.ProductId).Distinct().ToList();
        var rows = await db.ItemUnits.AsNoTracking().Include(u => u.Unit)
            .Where(u => ids.Contains(u.ProductId) && u.Factor == 1).ToListAsync();
        return rows.ToDictionary(u => u.ProductId, u => Loc.Name(u.Unit));
    }

    /// <summary>Load what <see cref="Mapper.ToDetail"/> shows of a document just posted.</summary>
    public static async Task LoadForDetailAsync(AppDbContext db, SalesDocument doc)
    {
        await db.Entry(doc).Reference(d => d.Branch).LoadAsync();
        await db.Entry(doc).Reference(d => d.Party).LoadAsync();
        await db.Entry(doc).Reference(d => d.Staff).LoadAsync();
        await db.Entry(doc).Reference(d => d.SourceDocument).LoadAsync();
        await db.Entry(doc).Reference(d => d.PriceLevel).LoadAsync();
        await db.Entry(doc).Reference(d => d.Rep).LoadAsync();
        var unitIds = doc.Lines.Where(l => l.UnitId != null).Select(l => l.UnitId!.Value).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        foreach (var line in doc.Lines)
            if (line.UnitId is Guid u && units.TryGetValue(u, out var unit)) line.Unit = unit;
    }
}
