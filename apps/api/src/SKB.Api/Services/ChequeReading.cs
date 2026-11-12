using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SKB.Api.Services;

/// <summary>
/// Making sense of what the assistant read off a cheque (owner, 2026-11-12: "٣٥٠٠٠ was read as
/// 30000, and the date was wrong"). An Egyptian cheque carries its amount twice, in figures and in
/// words (the words are the legal amount), and its date as the writer wrote it, day first. Figures
/// are read in any digits (Arabic-Indic, Persian, Western); words in Arabic or English; dates day /
/// month / year (never month first) or with the month's name. When the figures and the words
/// disagree the words win and the amount is marked to be checked; an unclear or unlikely date is
/// marked too. Nothing here is saved: the person checks the form before saving.
/// </summary>
public static class ChequeReading
{
    /// <summary>Arabic-Indic and Persian digits as Western ones, Arabic separators as Western ones.</summary>
    public static string Latin(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
            sb.Append(ch switch
            {
                >= '٠' and <= '٩' => (char)('0' + (ch - '٠')),
                >= '۰' and <= '۹' => (char)('0' + (ch - '۰')),
                '٫' => '.',
                '٬' or '،' => ',',
                _ => ch,
            });
        return sb.ToString();
    }

    // ------------------------------------------------------------------ amounts in words

    /// <summary>
    /// The amount written in words, in pounds (piastres as the fraction): "خمسة وثلاثون ألف جنيه
    /// فقط لا غير" → 35000, "Thirty five thousand pounds only" → 35000. Null when any word is not a
    /// number word, so a half-read line never passes for an amount.
    /// </summary>
    public static decimal? Words(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var s = Fold(Latin(text));
        // Pounds before the currency word, piastres after it ("... جنيه و خمسون قرشا").
        var major = s;
        string? minor = null;
        var cur = Regex.Match(s, @"\b(جنيه\w*|pounds?|egp|le)\b");
        if (cur.Success)
        {
            major = s[..cur.Index];
            var rest = s[(cur.Index + cur.Length)..];
            if (Regex.IsMatch(rest, @"(قرش|قروش|piastres?|pt)")) minor = Regex.Replace(rest, @"\b(قرش\w*|قروش|piastres?|pt)\b", " ");
        }
        var pounds = Count(major);
        if (pounds is null) return null;
        decimal fraction = 0;
        if (minor is not null)
        {
            var p = Count(minor);
            if (p is null or >= 100) return null;
            fraction = p.Value / 100m;
        }
        var total = pounds.Value + fraction;
        return total > 0 ? total : null;
    }

    /// <summary>Lower case, no diacritics or tatweel, one spelling of alef / teh marbuta / yeh, Arabic "و" split off.</summary>
    private static string Fold(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.ToLowerInvariant())
        {
            if (ch is >= 'ً' and <= 'ْ' or 'ـ' or 'ٰ') continue; // tashkeel, tatweel
            sb.Append(ch switch
            {
                'أ' or 'إ' or 'آ' or 'ٱ' => 'ا',
                'ة' => 'ه',
                'ى' => 'ي',
                '-' or ',' or '.' or '/' or '(' or ')' or '=' or '*' or '#' => ' ',
                _ => ch,
            });
        }
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }

    private static readonly Dictionary<string, long> ArUnits = new()
    {
        ["صفر"] = 0, ["واحد"] = 1, ["واحده"] = 1, ["احد"] = 1, ["احدي"] = 1,
        ["اثنان"] = 2, ["اثنين"] = 2, ["اثنا"] = 2, ["اثني"] = 2, ["اثنتا"] = 2, ["اثنتان"] = 2, ["اثنتين"] = 2,
        ["اتنين"] = 2, ["ثلاث"] = 3, ["ثلاثه"] = 3, ["تلات"] = 3, ["تلاته"] = 3, ["اربع"] = 4, ["اربعه"] = 4,
        ["خمس"] = 5, ["خمسه"] = 5, ["ست"] = 6, ["سته"] = 6, ["سبع"] = 7, ["سبعه"] = 7, ["ثمان"] = 8,
        ["ثماني"] = 8, ["ثمانيه"] = 8, ["تمان"] = 8, ["تمانيه"] = 8, ["تسع"] = 9, ["تسعه"] = 9,
        ["عشر"] = 10, ["عشره"] = 10, ["عشرون"] = 20, ["عشرين"] = 20, ["ثلاثون"] = 30, ["ثلاثين"] = 30,
        ["تلاتين"] = 30, ["اربعون"] = 40, ["اربعين"] = 40, ["خمسون"] = 50, ["خمسين"] = 50, ["ستون"] = 60,
        ["ستين"] = 60, ["سبعون"] = 70, ["سبعين"] = 70, ["ثمانون"] = 80, ["ثمانين"] = 80, ["تمانين"] = 80,
        ["تسعون"] = 90, ["تسعين"] = 90,
        ["مائه"] = 100, ["مئه"] = 100, ["ميه"] = 100, ["مايه"] = 100, ["مائتان"] = 200, ["مائتين"] = 200,
        ["مئتان"] = 200, ["مئتين"] = 200, ["ميتين"] = 200, ["متين"] = 200,
    };

    private static readonly Dictionary<string, long> EnUnits = new()
    {
        ["zero"] = 0, ["one"] = 1, ["two"] = 2, ["three"] = 3, ["four"] = 4, ["five"] = 5, ["six"] = 6,
        ["seven"] = 7, ["eight"] = 8, ["nine"] = 9, ["ten"] = 10, ["eleven"] = 11, ["twelve"] = 12,
        ["thirteen"] = 13, ["fourteen"] = 14, ["fifteen"] = 15, ["sixteen"] = 16, ["seventeen"] = 17,
        ["eighteen"] = 18, ["nineteen"] = 19, ["twenty"] = 20, ["thirty"] = 30, ["forty"] = 40, ["fourty"] = 40,
        ["fifty"] = 50, ["sixty"] = 60, ["seventy"] = 70, ["eighty"] = 80, ["ninety"] = 90,
    };

    /// <summary>Thousand, million: the dual forms carry their own two.</summary>
    private static (long Scale, bool Dual)? Scale(string w) => w switch
    {
        "الف" or "الاف" or "الفا" or "thousand" or "thousands" => (1_000, false),
        "الفان" or "الفين" => (1_000, true),
        "مليون" or "ملايين" or "مليونا" or "million" or "millions" => (1_000_000, false),
        "مليونان" or "مليونين" => (1_000_000, true),
        "مليار" or "billion" => (1_000_000_000, false),
        _ => null,
    };

    /// <summary>Words that say nothing about the figure ("only", "no more", "Egyptian").</summary>
    private static readonly HashSet<string> Filler = new()
    {
        "فقط", "لا", "غير", "لاغير", "مصري", "مصريه", "مصريا", "المصري", "مبلغ", "وقدره", "قدره", "and", "only",
        "egyptian", "the", "sum", "of", "a", "no", "more", "عن",
    };

    /// <summary>A whole number in words (or figures among them); null when a word is not understood.</summary>
    private static long? Count(string text)
    {
        long total = 0, current = 0;
        var any = false;
        foreach (var raw in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var w = raw;
            // "وثلاثون", "والف": the joining "و" is part of the word.
            if (w.Length > 1 && w[0] == 'و' && !ArUnits.ContainsKey(w) && Scale(w) is null && !Filler.Contains(w)) w = w[1..];
            if (w == "و" || Filler.Contains(w)) continue;
            if (long.TryParse(w, NumberStyles.None, CultureInfo.InvariantCulture, out var figure))
            {
                current += figure;
                any = true;
                continue;
            }
            if (ArUnits.TryGetValue(w, out var v) || EnUnits.TryGetValue(w, out v))
            {
                current += v;
                any = true;
                continue;
            }
            // "ثلاثمائه", "خمسميه": a unit and a hundred in one word.
            var hundred = Regex.Match(w, "^(.+?)(مائه|مئه|ميه|مايه)$");
            if (hundred.Success && ArUnits.TryGetValue(hundred.Groups[1].Value, out var u) && u is >= 1 and <= 9)
            {
                current += u * 100;
                any = true;
                continue;
            }
            if (w == "hundred" || w == "hundreds")
            {
                current = Math.Max(1, current) * 100;
                any = true;
                continue;
            }
            if (Scale(w) is { } sc)
            {
                var times = sc.Dual ? (current == 0 ? 2 : current * 2) : Math.Max(1, current);
                total += times * sc.Scale;
                current = 0;
                any = true;
                continue;
            }
            return null;
        }
        return any ? total + current : null;
    }

    // ------------------------------------------------------------------ dates

    private static readonly Dictionary<string, int> Months = new()
    {
        ["يناير"] = 1, ["فبراير"] = 2, ["مارس"] = 3, ["ابريل"] = 4, ["مايو"] = 5, ["يونيو"] = 6, ["يونيه"] = 6,
        ["يوليو"] = 7, ["يوليه"] = 7, ["اغسطس"] = 8, ["سبتمبر"] = 9, ["اكتوبر"] = 10, ["نوفمبر"] = 11,
        ["ديسمبر"] = 12, ["كانون الثاني"] = 1, ["شباط"] = 2, ["اذار"] = 3, ["نيسان"] = 4, ["ايار"] = 5,
        ["حزيران"] = 6, ["تموز"] = 7, ["ايلول"] = 9, ["تشرين الاول"] = 10, ["تشرين الثاني"] = 11,
        ["كانون الاول"] = 12,
        ["january"] = 1, ["february"] = 2, ["march"] = 3, ["april"] = 4, ["may"] = 5, ["june"] = 6, ["july"] = 7,
        ["august"] = 8, ["september"] = 9, ["october"] = 10, ["november"] = 11, ["december"] = 12, ["jan"] = 1,
        ["feb"] = 2, ["mar"] = 3, ["apr"] = 4, ["jun"] = 6, ["jul"] = 7, ["aug"] = 8, ["sep"] = 9, ["sept"] = 9,
        ["oct"] = 10, ["nov"] = 11, ["dec"] = 12,
    };

    /// <summary>
    /// The date as written on the cheque: "١٥/٣/٢٠٢٧", "15-03-27", "15 مارس 2027", "March 15, 2027"
    /// or "2027-03-15". Figures are always day first (never swapped to month first); a day that is
    /// not a day, or a date far from today, is <c>Sure = false</c>.
    /// </summary>
    public static (DateOnly? Date, bool Sure) Date(string? text, DateOnly today)
    {
        if (string.IsNullOrWhiteSpace(text)) return (null, true);
        var s = Fold(Latin(text)).Replace("\\", " ");
        s = Regex.Replace(s, @"(?<=\d)\s*م\b", " "); // "٢٠٢٧م"
        int day, month, year;
        Match m;
        if ((m = Regex.Match(Latin(text), @"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b")).Success)
        {
            // Year first: the year, then the month, then the day (as ISO dates are written).
            (year, month, day) = (int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        }
        else if ((m = Regex.Match(Latin(text), @"\b(\d{1,2})\s*[-/.\\ ]\s*(\d{1,2})\s*[-/.\\ ]\s*(\d{2}|\d{4})\b")).Success)
        {
            (day, month, year) = (int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), Year(m.Groups[3].Value));
        }
        else
        {
            // A month's name, with the day before it (15 مارس 2027) or after it (March 15, 2027).
            var name = Months.Keys.OrderByDescending(k => k.Length)
                .FirstOrDefault(k => Regex.IsMatch(s, $@"(^|[\s\d]){Regex.Escape(k)}\w*($|[\s\d])"));
            if (name is null) return (null, false);
            month = Months[name];
            var numbers = Regex.Matches(s, @"\d+").Select(x => x.Value).ToList();
            var y = numbers.FirstOrDefault(x => x.Length == 4) ?? numbers.Skip(1).FirstOrDefault();
            var d = numbers.FirstOrDefault(x => x.Length <= 2);
            if (y is null || d is null) return (null, false);
            (day, year) = (int.Parse(d), Year(y));
        }
        if (month is < 1 or > 12 || day < 1 || year < 1900 || day > DateTime.DaysInMonth(year, month)) return (null, false);
        var date = new DateOnly(year, month, day);
        // A cheque's due day is rarely more than a few months past or a couple of years ahead.
        var sure = date >= today.AddMonths(-6) && date <= today.AddYears(2);
        return (date, sure);
    }

    private static int Year(string y) => y.Length == 2 ? 2000 + int.Parse(y) : int.Parse(y);
}
