using System.Globalization;

namespace SKB.Core;

/// <summary>Money is stored as integer minor units (piastres). Format only at the edge.</summary>
public static class Formatting
{
    public const int MinorUnits = 100;

    private static CultureInfo Culture(string locale) =>
        CultureInfo.GetCultureInfo(locale == "ar" ? "ar-EG" : "en-US");

    public static string Money(long minor, string currency, string locale)
    {
        var value = minor / (decimal)MinorUnits;
        return value.ToString("N2", Culture(locale)) + " " + currency;
    }

    public static string Number(long value, string locale) =>
        value.ToString("N0", Culture(locale));

    public static string Date(string iso, string locale)
    {
        if (DateTime.TryParse(iso, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var dt))
        {
            return dt.ToString("dd MMM yyyy", Culture(locale));
        }
        return iso;
    }

    /// <summary>Direction of a signed party balance for unambiguous display.</summary>
    public static string BalanceDirection(long balanceMinor) =>
        balanceMinor > 0 ? "receivable" : balanceMinor < 0 ? "payable" : "settled";
}
