using System.Text;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Shared rules of the item catalog (DOMAIN.md §2.2): the units an item comes in, variant names and
/// SKUs. Used by the item and model editors.
/// </summary>
public static class Catalog
{
    public const int MaxFactor = 100_000;
    public const int MaxBarcode = 64;
    public const int MaxSku = 40;

    public sealed record CatalogError(string Code, string Message);

    public sealed record UnitSpec(Guid UnitId, int Factor, string? Barcode);

    /// <summary>
    /// Check a set of units for one item (or model): exactly one base unit with factor 1, every factor
    /// 1–100,000 and different, every unit known and listed once, and — when <paramref name="withBarcodes"/>
    /// — barcodes that are unique here and not used by any other item. <paramref name="self"/> is the
    /// item being edited (its current barcodes don't count as taken).
    /// </summary>
    public static async Task<(List<UnitSpec>? Units, CatalogError? Error)> ParseUnitsAsync(
        AppDbContext db, ItemUnitRequest[]? request, bool withBarcodes, Guid? self = null)
    {
        if (request is null || request.Length == 0)
            return (null, new("no_units", "Choose the item's base unit."));
        if (request.Length > 10)
            return (null, new("too_many_units", "At most 10 units per item."));

        var specs = new List<UnitSpec>();
        foreach (var u in request)
        {
            if (!Guid.TryParse(u.UnitId, out var unitId))
                return (null, new("unit_not_found", "A unit was not found."));
            if (u.Factor < 1 || u.Factor > MaxFactor)
                return (null, new("bad_factor", $"A unit holds 1 to {MaxFactor:N0} base units."));
            var barcode = withBarcodes ? CleanBarcode(u.Barcode) : null;
            if (withBarcodes && u.Barcode is not null && u.Barcode.Trim().Length > MaxBarcode)
                return (null, new("bad_barcode", $"A barcode is at most {MaxBarcode} characters."));
            specs.Add(new(unitId, u.Factor, barcode));
        }

        if (specs.Count(s => s.Factor == 1) != 1)
            return (null, new("one_base_unit", "An item has exactly one base unit (holding 1)."));
        if (specs.Select(s => s.UnitId).Distinct().Count() != specs.Count)
            return (null, new("duplicate_unit", "Each unit can be listed once."));
        if (specs.Select(s => s.Factor).Distinct().Count() != specs.Count)
            return (null, new("duplicate_factor", "Two units can't hold the same number of base units."));

        var ids = specs.Select(s => s.UnitId).ToArray();
        var known = await db.Units.AsNoTracking().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        if (known.Count != ids.Length)
            return (null, new("unit_not_found", "A unit was not found."));

        var barcodes = specs.Where(s => s.Barcode is not null).Select(s => s.Barcode!).ToList();
        if (barcodes.Distinct(StringComparer.OrdinalIgnoreCase).Count() != barcodes.Count)
            return (null, new("duplicate_barcode", "The same barcode is used twice."));
        if (barcodes.Count > 0)
        {
            var taken = await db.ItemUnits.AsNoTracking()
                .Where(u => u.Barcode != null && barcodes.Contains(u.Barcode) && (self == null || u.ProductId != self))
                .Select(u => u.Barcode).FirstOrDefaultAsync();
            if (taken is not null)
                return (null, new("duplicate_barcode", $"Barcode {taken} already belongs to another item."));
        }
        return (specs.OrderBy(s => s.Factor).ToList(), null);
    }

    /// <summary>Trimmed barcode, or null when empty.</summary>
    public static string? CleanBarcode(string? s)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(MaxBarcode, t.Length)];
    }

    /// <summary>
    /// Replace an item's units with <paramref name="specs"/>: keep rows whose unit stays (updating
    /// factor and barcode), add new ones, and remove the rest together with their prices. The caller
    /// has already checked the base unit may change.
    /// </summary>
    public static async Task ApplyUnitsAsync(AppDbContext db, Product product, IReadOnlyList<UnitSpec> specs,
        bool keepBarcodes = false)
    {
        var current = await db.ItemUnits.Where(u => u.ProductId == product.Id).ToListAsync();
        foreach (var row in current.Where(r => specs.All(s => s.UnitId != r.UnitId)))
        {
            db.ItemUnits.Remove(row);
            db.ItemPrices.RemoveRange(await db.ItemPrices
                .Where(p => p.ProductId == product.Id && p.UnitId == row.UnitId).ToListAsync());
        }
        foreach (var spec in specs)
        {
            var row = current.FirstOrDefault(r => r.UnitId == spec.UnitId);
            if (row is null)
            {
                db.ItemUnits.Add(new ItemUnit
                {
                    ProductId = product.Id, UnitId = spec.UnitId, Factor = spec.Factor,
                    Barcode = keepBarcodes ? null : spec.Barcode,
                });
            }
            else
            {
                row.Factor = spec.Factor;
                if (!keepBarcodes) row.Barcode = spec.Barcode;
            }
        }
    }

    /// <summary>A variant's name: "model — color / size", made from their names as typed.</summary>
    public static void ComposeVariantName(Product variant, ProductModel model, VariantOption? size, VariantOption? color)
    {
        var options = string.Join(" / ", new[] { color?.Name, size?.Name }.Where(s => !string.IsNullOrWhiteSpace(s)));
        var name = options.Length == 0 ? model.Name : $"{model.Name} — {options}";
        variant.Name = name[..Math.Min(Loc.MaxName, name.Length)];
    }

    /// <summary>
    /// Recompose the names of every variant of <paramref name="modelIds"/> or made in one of
    /// <paramref name="optionIds"/> — after a model, size or color was renamed. Saves.
    /// </summary>
    public static async Task RefreshVariantNamesAsync(AppDbContext db, ICollection<Guid> modelIds,
        ICollection<Guid> optionIds, CancellationToken ct = default)
    {
        if (modelIds.Count == 0 && optionIds.Count == 0) return;
        var variants = await db.Products
            .Include(p => p.Model).Include(p => p.Size).Include(p => p.Color)
            .Where(p => p.ModelId != null && (modelIds.Contains(p.ModelId!.Value)
                        || (p.SizeId != null && optionIds.Contains(p.SizeId!.Value))
                        || (p.ColorId != null && optionIds.Contains(p.ColorId!.Value))))
            .ToListAsync(ct);
        foreach (var v in variants) ComposeVariantName(v, v.Model!, v.Size, v.Color);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// A SKU part from a name: the Latin letters and digits of its first word, upper case, up to 6 — or
    /// <paramref name="fallback"/> when the name has none (e.g. typed in Arabic).
    /// </summary>
    public static string SkuPart(INamed? option, string fallback)
    {
        if (option is null) return "";
        var source = option.Name;
        foreach (var word in source.ToUpperInvariant().Split(' ', '-', '/', '_'))
        {
            var sb = new StringBuilder();
            foreach (var ch in word)
            {
                if (ch is >= 'A' and <= 'Z' or >= '0' and <= '9') sb.Append(ch);
                if (sb.Length == 6) break;
            }
            if (sb.Length > 0) return sb.ToString();
        }
        return fallback;
    }

    /// <summary>
    /// <paramref name="wanted"/> if no item uses it (ignoring case), else wanted-2, wanted-3…
    /// <paramref name="reserved"/> holds SKUs already handed out in this request.
    /// </summary>
    public static async Task<string> UniqueSkuAsync(AppDbContext db, string wanted, ISet<string> reserved)
    {
        wanted = wanted[..Math.Min(MaxSku - 4, wanted.Length)];
        var upper = wanted.ToUpperInvariant();
        var used = (await db.Products.AsNoTracking()
                .Where(p => p.Sku.ToUpper() == upper || p.Sku.ToUpper().StartsWith(upper + "-"))
                .Select(p => p.Sku.ToUpper()).ToListAsync())
            .Concat(reserved.Select(r => r.ToUpperInvariant())).ToHashSet();
        var sku = wanted;
        for (var n = 2; used.Contains(sku.ToUpperInvariant()); n++) sku = $"{wanted}-{n}";
        reserved.Add(sku);
        return sku;
    }

    /// <summary>The next free automatic item SKU: ITEM-00001, ITEM-00002…</summary>
    public static async Task<string> NextItemSkuAsync(AppDbContext db)
    {
        var used = await db.Products.AsNoTracking().Where(p => p.Sku.StartsWith("ITEM-"))
            .Select(p => p.Sku).ToListAsync();
        var max = used.Select(s => int.TryParse(s[5..], out var n) ? n : 0).DefaultIfEmpty(0).Max();
        return $"ITEM-{max + 1:D5}";
    }

    public const int MaxSupplierCode = 64;

    /// <summary>
    /// The group an item of a department goes in (owner decision 2026-10-01: the department is what
    /// people pick; groups are kept behind it): its first one, made with the department's name if none.
    /// </summary>
    public static async Task<(Guid? CategoryId, Department? Department)> CategoryForDepartmentAsync(AppDbContext db, string? raw)
    {
        if (!Guid.TryParse(raw, out var id)) return (null, null);
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id && d.IsActive);
        if (department is null) return (null, null);
        var category = await db.Categories.Where(c => c.DepartmentId == id).OrderBy(c => c.Name).FirstOrDefaultAsync();
        if (category is null)
        {
            category = new Category { Name = department.Name, DepartmentId = id };
            db.Categories.Add(category);
        }
        return (category.Id, department);
    }

    /// <summary>An item's name with its season at the end (none for "no season", or when it's there already).</summary>
    public static string WithSeason(string name, Season? season)
    {
        if (season is null || season.Kind == Seasons.None) return name;
        var suffix = $" - {season.Name}";
        return name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) ? name : (name + suffix)[..Math.Min(Loc.MaxName, (name + suffix).Length)];
    }

    /// <summary>
    /// A code prefix (branch EL, warehouse H or 5, department MEN): letters and digits, at most 10,
    /// upper case. Null = not given; "" = cleared; Error when it isn't one.
    /// </summary>
    public static (bool Given, string? Value, bool Error) Prefix(string? raw)
    {
        if (raw is null) return (false, null, false);
        var t = raw.Trim().ToUpperInvariant();
        if (t.Length == 0) return (true, null, false);
        if (t.Length > 10 || !t.All(char.IsLetterOrDigit)) return (true, null, true);
        return (true, t, false);
    }

    /// <summary>
    /// The next item code from the prefixes of where it is first stored (owner decision 2026-10-01),
    /// e.g. EL-H-MEN-00012; the number counts up within those prefixes. Without any prefix, ITEM-00012.
    /// </summary>
    public static async Task<string> NextItemCodeAsync(AppDbContext db, params string?[] prefixes)
    {
        var parts = prefixes.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim().ToUpperInvariant()).ToArray();
        if (parts.Length == 0) return await NextItemSkuAsync(db);
        var head = string.Join('-', parts) + "-";
        var used = await db.Products.AsNoTracking().Where(p => p.Sku.StartsWith(head)).Select(p => p.Sku).ToListAsync();
        var max = used.Select(s => int.TryParse(s[head.Length..], out var n) ? n : 0).DefaultIfEmpty(0).Max();
        return $"{head}{max + 1:D5}";
    }

    /// <summary>
    /// The main supplier asked for on an item or model: null = not given (leave it); "" = none; else
    /// an open party that is a SUPPLIER (a factory is a supplier).
    /// </summary>
    public static async Task<(bool Given, Guid? Id, CatalogError? Error)> SupplierAsync(AppDbContext db, string? raw)
    {
        if (raw is null) return (false, null, null);
        if (raw.Trim().Length == 0) return (true, null, null);
        if (!Guid.TryParse(raw, out var id) || !await db.Parties.AnyAsync(p =>
                p.Id == id && p.IsActive && p.Types.Contains(nameof(PartyType.SUPPLIER))))
            return (true, null, new CatalogError("supplier_not_found", "Choose one of your suppliers."));
        return (true, id, null);
    }

    /// <summary>A supplier's own code for an item, kept as typed (trimmed); null when empty.</summary>
    public static string? SupplierCode(string? s)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(MaxSupplierCode, t.Length)];
    }

    /// <summary>
    /// A typed amount (e.g. "330", "330.5", "٣٣٠٫٥") in minor units, for searching by price;
    /// null when the text isn't a plain amount.
    /// </summary>
    public static long? ParseAmount(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = new StringBuilder();
        foreach (var ch in s.Trim())
        {
            if (ch is ',' or '٬') continue; // thousands separators
            t.Append(ch switch
            {
                >= '٠' and <= '٩' => (char)('0' + (ch - '٠')),
                >= '۰' and <= '۹' => (char)('0' + (ch - '۰')),
                '٫' => '.',
                _ => ch,
            });
        }
        var clean = t.ToString();
        if (clean.Length == 0 || clean.Length > 15 || !clean.All(c => char.IsAsciiDigit(c) || c == '.')) return null;
        return decimal.TryParse(clean, System.Globalization.NumberStyles.AllowDecimalPoint,
            System.Globalization.CultureInfo.InvariantCulture, out var major) && major >= 0
            ? (long)decimal.Round(major * 100, MidpointRounding.AwayFromZero)
            : null;
    }

    /// <summary>A clean user-typed SKU / code: trimmed, upper case, no spaces; null when empty.</summary>
    public static string? CleanCode(string? s, int max)
    {
        var t = s?.Trim().ToUpperInvariant().Replace(' ', '-');
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }
}
