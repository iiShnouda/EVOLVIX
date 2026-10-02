using System.Text.RegularExpressions;

namespace SKB.Api.Services;

/// <summary>
/// What a phone number and a national ID look like in the company's country (owner, 2026-10-02:
/// "digits only, 11 or 12 digits as the Egyptian carriers have them, the national ID as the
/// Egyptian one — and not only Egypt, every country"). The app checks the same as the person
/// types (@skb/shared idRules); this is the check that counts. Numbers are kept as typed.
/// </summary>
public static class IdRules
{
    private sealed record PhoneRule(string CountryCode, bool Trunk, Regex National);

    private static Regex R(string pattern) => new(pattern, RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Dictionary<string, PhoneRule> Phones = new()
    {
        // Mobiles 010/011/012/015 + 8 digits, landlines 02 + 8 or 0XX + 7, hotlines 19XXX.
        ["EG"] = new("20", true, R(@"^(01[0125]\d{8}|0[2-9]\d{7,8}|1\d{4})$")),
        ["SA"] = new("966", true, R(@"^(05\d{8}|01\d{7}|9200\d{5})$")),
        ["AE"] = new("971", true, R(@"^(05\d{8}|0[2-9]\d{7}|800\d{3,7})$")),
        ["QA"] = new("974", false, R(@"^[3-7]\d{7}$")),
        ["KW"] = new("965", false, R(@"^[2569]\d{7}$")),
        ["BH"] = new("973", false, R(@"^[1-9]\d{7}$")),
        ["OM"] = new("968", false, R(@"^[279]\d{7}$")),
        ["JO"] = new("962", true, R(@"^(07[789]\d{7}|0[2-6]\d{7})$")),
        ["MA"] = new("212", true, R(@"^0[5-7]\d{8}$")),
        ["DZ"] = new("213", true, R(@"^(0[5-7]\d{8}|0[2-4]\d{7})$")),
        ["TR"] = new("90", true, R(@"^0[2-5]\d{9}$")),
        ["US"] = new("1", false, R(@"^[2-9]\d{9}$")),
        ["GB"] = new("44", true, R(@"^0\d{9,10}$")),
    };

    private static readonly Regex Separators = R(@"[\s\-(). ]");
    private static readonly Regex Digits = R(@"^\d+$");

    /// <summary>
    /// Null when the phone number is right for <paramref name="country"/> (or empty), else why not:
    /// <c>phone_letters</c> (not only digits) or <c>bad_phone</c> (not that country's length/start).
    /// A number with another country's code is taken if it has 8–15 digits.
    /// </summary>
    public static string? PhoneProblem(string? country, string? raw)
    {
        var text = Separators.Replace(raw ?? "", "");
        if (text.Length == 0) return null;
        var intl = text.StartsWith('+') || text.StartsWith("00");
        var digits = text.StartsWith('+') ? text[1..] : text.StartsWith("00") ? text[2..] : text;
        if (!Digits.IsMatch(digits)) return "phone_letters";
        if (!Phones.TryGetValue((country ?? "").ToUpperInvariant(), out var rule))
            return digits.Length is >= 6 and <= 15 ? null : "bad_phone";
        if (!intl && rule.National.IsMatch(digits)) return null;
        // With the country's code: typed with + or 00, or plainly (e.g. 201001112222).
        if (digits.StartsWith(rule.CountryCode))
        {
            var rest = digits[rule.CountryCode.Length..];
            if (rule.National.IsMatch(rule.Trunk ? "0" + rest : rest)) return null;
        }
        // Another country's number.
        return intl && !digits.StartsWith(rule.CountryCode) && digits.Length is >= 8 and <= 15 ? null : "bad_phone";
    }

    private static readonly Dictionary<string, Regex> Ids = new()
    {
        ["SA"] = R(@"^[12]\d{9}$"),
        ["AE"] = R(@"^784\d{12}$"),
        ["QA"] = R(@"^[23]\d{10}$"),
        ["KW"] = R(@"^[123]\d{11}$"),
        ["BH"] = R(@"^\d{9}$"),
        ["OM"] = R(@"^\d{6,9}$"),
        ["JO"] = R(@"^\d{10}$"),
        ["MA"] = R(@"^[A-Z]{1,2}\d{5,6}$"),
        ["DZ"] = R(@"^\d{18}$"),
        ["US"] = R(@"^\d{9}$"),
        ["GB"] = R(@"^[A-Z]{2}\d{6}[A-D]$"),
    };

    private static readonly HashSet<int> EgyptGovernorates =
        new([1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 35, 88]);

    /// <summary>Null when the national ID is right for <paramref name="country"/> (or empty), else <c>bad_national_id</c>.</summary>
    public static string? NationalIdProblem(string? country, string? raw)
    {
        var id = Separators.Replace(raw ?? "", "").ToUpperInvariant();
        if (id.Length == 0) return null;
        var ok = (country ?? "").ToUpperInvariant() switch
        {
            "EG" => Egyptian(id),
            "TR" => Turkish(id),
            var c when Ids.TryGetValue(c, out var rx) => rx.IsMatch(id),
            _ => R(@"^[A-Z0-9]{5,20}$").IsMatch(id),
        };
        return ok ? null : "bad_national_id";
    }

    /// <summary>
    /// 14 digits: the century (2 = 1900s, 3 = 2000s), the birth date YYMMDD, the governorate,
    /// a serial and a check digit.
    /// </summary>
    private static bool Egyptian(string id)
    {
        if (id.Length != 14 || !Digits.IsMatch(id) || id[0] is not ('2' or '3')) return false;
        var year = (id[0] == '2' ? 1900 : 2000) + int.Parse(id[1..3]);
        var month = int.Parse(id[3..5]);
        var day = int.Parse(id[5..7]);
        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month)) return false;
        if (new DateOnly(year, month, day) > DateOnly.FromDateTime(DateTime.UtcNow)) return false;
        return EgyptGovernorates.Contains(int.Parse(id[7..9]));
    }

    /// <summary>11 digits, not starting with 0, with its two check digits.</summary>
    private static bool Turkish(string id)
    {
        if (id.Length != 11 || !Digits.IsMatch(id) || id[0] == '0') return false;
        var d = id.Select(c => c - '0').ToArray();
        var tenth = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
        if (tenth < 0) tenth += 10;
        return d[9] == tenth && d[10] == d.Take(10).Sum() % 10;
    }

    /// <summary>
    /// A main phone and more named ones (at most <paramref name="max"/>), checked and cleaned: empty
    /// ones dropped, each number once. Returns the lists, or the problem code.
    /// </summary>
    public static (List<string> Phones, List<string> Labels, string? Problem) PhoneList(string? country,
        string? main, string[]? others, string[]? labels, int max = 5)
    {
        var phones = new List<string>();
        var names = new List<string>();
        var mainText = main?.Trim();
        for (var i = 0; i < (others?.Length ?? 0); i++)
        {
            var p = others![i]?.Trim();
            if (string.IsNullOrEmpty(p) || p == mainText || phones.Contains(p)) continue;
            phones.Add(p);
            var label = labels is { } l && i < l.Length ? l[i]?.Trim() ?? "" : "";
            names.Add(label.Length > 60 ? label[..60] : label);
        }
        if (phones.Count > max) return (phones, names, "too_many_phones");
        foreach (var p in phones)
            if (p.Length > 40) return (phones, names, "bad_phone");
            else if (PhoneProblem(country, p) is { } bad) return (phones, names, bad);
        return (phones, names, null);
    }

    /// <summary>The fingerprint device's number for a person: digits only.</summary>
    public static bool DeviceIdOk(string? raw) => string.IsNullOrWhiteSpace(raw) || R(@"^\d{1,10}$").IsMatch(raw.Trim());

    /// <summary>The message for a problem code (the app shows its own words for the code).</summary>
    public static string Message(string code) => code switch
    {
        "phone_letters" => "A phone number has digits only.",
        "bad_phone" => "That phone number isn't right for the company's country.",
        "bad_national_id" => "That national ID isn't right for the company's country.",
        _ => "Not valid.",
    };
}
