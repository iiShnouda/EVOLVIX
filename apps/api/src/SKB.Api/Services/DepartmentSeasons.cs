using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// A department's season, read from its name (owner, 2026-11-16: «رجالي صيفي», «رجالي شتوي», and
/// «داخلي» with no season word, which goes with both). Nothing is stored: a department named with a
/// summer word is summer's, with a winter word winter's, with neither (or both) every season's.
/// <para>The words, whole words of the folded name (<see cref="TextKey.Fold"/>), with or without «ال»
/// or «و» before them: صيف, صيفي, صيفى, صيفية, الصيفي, summer; شتا, شتاء, شتوي, شتوى, شتوية, الشتوي,
/// winter.</para>
/// The web app mirrors this in <c>@skb/shared</c> (<c>departmentSeasons.ts</c>); keep the two in step.
/// </summary>
public static class DepartmentSeasons
{
    public const string Summer = "SUMMER";
    public const string Winter = "WINTER";

    private static readonly HashSet<string> SummerWords = new() { "صيف", "صيفي", "صيفيه", "summer" };
    private static readonly HashSet<string> WinterWords = new() { "شتا", "شتاء", "شتوي", "شتويه", "winter" };

    /// <summary>SUMMER, WINTER, or null for a name with no season word (or with both).</summary>
    public static string? SeasonOf(string? name)
    {
        bool summer = false, winter = false;
        foreach (var raw in TextKey.Fold(name).Split(new[] { ' ', '-', '_' }, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var w in Forms(raw))
            {
                if (SummerWords.Contains(w)) summer = true;
                if (WinterWords.Contains(w)) winter = true;
            }
        }
        return summer == winter ? null : summer ? Summer : Winter;
    }

    /// <summary>The word itself, and without a leading «و» and/or «ال».</summary>
    private static IEnumerable<string> Forms(string w)
    {
        yield return w;
        var x = w.StartsWith('و') && w.Length > 3 ? w[1..] : w;
        if (x != w) yield return x;
        if (x.StartsWith("ال") && x.Length > 4) yield return x[2..];
    }

    /// <summary>SUMMER or WINTER from the address (any case); anything else is no season.</summary>
    public static string? Parse(string? season) => season?.Trim().ToUpperInvariant() switch
    {
        Summer => Summer,
        Winter => Winter,
        _ => null,
    };

    /// <summary>Whether a department of this name is shown for the season (null = every season).</summary>
    public static bool Fits(string? name, string? season) =>
        season is null || SeasonOf(name) is not { } own || own == season;

    /// <summary>The departments of a season (and those of no season); null when no season is asked.</summary>
    public static async Task<Guid[]?> IdsAsync(AppDbContext db, string? season)
    {
        if (Parse(season) is not { } s) return null;
        var all = await db.Departments.AsNoTracking().Select(d => new { d.Id, d.Name }).ToListAsync();
        return all.Where(d => Fits(d.Name, s)).Select(d => d.Id).ToArray();
    }

    /// <summary>
    /// The person's departments (null = all) narrowed to a season's (null = no season): what both allow.
    /// Documents and items of no department stay in, as with a person's own departments.
    /// </summary>
    public static Guid[]? Within(Guid[]? mine, Guid[]? season) =>
        season is null ? mine : mine is null ? season : mine.Intersect(season).ToArray();
}
