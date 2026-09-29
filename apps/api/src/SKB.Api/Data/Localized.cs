using System.Globalization;
using SKB.Api.Domain;

namespace SKB.Api.Data;

/// <summary>
/// Something people name: a branch, warehouse, category, unit, price level, size or color, model or
/// item. Owner decision 2026-09-29: one name, typed in Arabic or English and kept exactly as typed —
/// nothing is translated. Only the app's own texts come in both languages.
/// </summary>
public interface INamed
{
    string Name { get; set; }
}

/// <summary>Names as the app shows them. The request language comes from Accept-Language.</summary>
public static class Loc
{
    public const int MaxName = 200;

    /// <summary>"ar" or "en" for the current request.</summary>
    public static string Lang => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ar" ? "ar" : "en";

    /// <summary>
    /// The name as typed. The system's own "in transit" warehouse is app text, so it follows the
    /// screen language.
    /// </summary>
    public static string Name(INamed? e) => e switch
    {
        null => "",
        Warehouse { Kind: WarehouseKind.TRANSIT } => Lang == "ar" ? "في الطريق" : "In transit",
        _ => e.Name,
    };

    /// <summary>A typed name: trimmed and at most 200 characters; null when empty.</summary>
    public static string? Clean(string? s)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(MaxName, t.Length)];
    }
}
