using System.Text;

namespace SKB.Api.Services;

/// <summary>
/// Text folded for searching (owner, 2026-10-06: "a letter typed wrong should still find it").
/// <list type="bullet">
/// <item><see cref="Fold"/>: lower case, Arabic letter forms made one (أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و,
/// ئ → ي), diacritics and tatweel dropped, Arabic-Indic digits as 0–9, punctuation as spaces.</item>
/// <item><see cref="Outline"/>: a word's consonant outline — its first letter, then the rest without the
/// long vowels ا و ي and without doubled letters — so فانلة, فنيله and فانله all read فنله, and رجالي,
/// ريجالي read رجل.</item>
/// </list>
/// The web app mirrors this in <c>@skb/shared</c> (<c>textKey.ts</c>); keep the two in step.
/// </summary>
public static class TextKey
{
    public static string Fold(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var sb = new StringBuilder(text.Length);
        foreach (var raw in text.ToLowerInvariant())
        {
            var ch = raw;
            switch (ch)
            {
                case 'أ': case 'إ': case 'آ': case 'ٱ': ch = 'ا'; break;
                case 'ة': ch = 'ه'; break;
                case 'ى': ch = 'ي'; break;
                case 'ؤ': ch = 'و'; break;
                case 'ئ': ch = 'ي'; break;
                case 'ـ': continue;
            }
            if (ch is >= 'ً' and <= 'ْ' or 'ٰ') continue;
            if (ch is >= '٠' and <= '٩') ch = (char)('0' + (ch - '٠'));
            else if (ch is >= '۰' and <= '۹') ch = (char)('0' + (ch - '۰'));
            sb.Append(char.IsLetterOrDigit(ch) || ch == '-' ? ch : ' ');
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    public static string[] Words(string? text) => Fold(text).Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>A folded word's consonant outline (see the class notes).</summary>
    public static string Outline(string word)
    {
        if (word.Length <= 2) return word;
        var sb = new StringBuilder(word.Length);
        sb.Append(word[0]);
        for (var i = 1; i < word.Length; i++)
        {
            var ch = word[i];
            if (ch is 'ا' or 'و' or 'ي') continue;
            if (sb[^1] == ch) continue;
            sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>What an item is searched by: its folded name, code and supplier code, then their outlines.</summary>
    public static string ForItem(string? name, string? sku, string? supplierCode)
    {
        var folded = Fold($"{name} {sku} {supplierCode}");
        var outlines = folded.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 2).Select(Outline).Distinct();
        var key = $"{folded} | {string.Join(' ', outlines)}";
        return key.Length > 1200 ? key[..1200] : key;
    }

    /// <summary>Edit distance (insert, delete, change one letter), stopping early past <paramref name="max"/>.</summary>
    public static int Distance(string a, string b, int max = 3)
    {
        if (Math.Abs(a.Length - b.Length) > max) return max + 1;
        var prev = new int[b.Length + 1];
        var cur = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) prev[j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            cur[0] = i;
            var best = cur[0];
            for (var j = 1; j <= b.Length; j++)
            {
                cur[j] = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                best = Math.Min(best, cur[j]);
            }
            if (best > max) return max + 1;
            (prev, cur) = (cur, prev);
        }
        return prev[b.Length];
    }

    /// <summary>How many slips a word of this length may have and still match.</summary>
    public static int Slack(int length) => length >= 7 ? 2 : length >= 4 ? 1 : 0;

    /// <summary>
    /// How many slips this word may have: none when it holds a digit, since codes such as
    /// MWSH-24-1A and MWSH-24-1B differ by one character and name different items.
    /// </summary>
    public static int Slack(string word) => word.Any(char.IsDigit) ? 0 : Slack(word.Length);

    /// <summary>
    /// How well a typed word matches any word of a search key: 0 = contained, 1–2 = slips, -1 = no
    /// match. The outline is compared too, so missing or extra long vowels cost nothing.
    /// </summary>
    public static int Match(string typedWord, string[] keyWords)
    {
        var outline = Outline(typedWord);
        var slack = Slack(typedWord);
        var best = -1;
        foreach (var w in keyWords)
        {
            if (w.Contains(typedWord) || (outline.Length > 2 && w == outline)) return 0;
            if (slack == 0) continue;
            var d = Math.Min(Distance(typedWord, w, slack), w.Length > 2 ? Distance(outline, w, slack) : slack + 1);
            if (d <= slack && (best < 0 || d < best)) best = d;
        }
        return best;
    }
}
