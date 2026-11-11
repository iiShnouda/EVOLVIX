using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Seasons (مواسم) goods are bought for (owner decision 2026-10-01). Summer runs April to September and
/// winter October to March, by the company's calendar; winter is named for the year it ends in (owner,
/// 2026-10-19: October 2026 is already "winter 2027"). The owner can also set the season by hand
/// (Settings, <see cref="CompanySettings.CurrentSeasonId"/>). The
/// system adds this year's and next year's summer and winter, and one "no season" for goods that have
/// none. The system's own seasons are named in the screen language; hand-made ones as typed.
/// </summary>
public static class Seasons
{
    public const string Summer = "SUMMER", Winter = "WINTER", None = "NONE", Custom = "CUSTOM";

    /// <summary>Which season a company day falls in.</summary>
    public static (string Kind, int Year) Of(DateOnly day) =>
        day.Month is >= 4 and <= 9 ? (Summer, day.Year) : (Winter, day.Month >= 10 ? day.Year + 1 : day.Year);

    /// <summary>The kinds an invoice names (owner, 2026-11-10): a purchase is summer or winter, a sale may be of none.</summary>
    public static bool IsInvoiceKind(string? kind, bool sale) => kind is Summer or Winter || (sale && kind == None);

    /// <summary>
    /// The season of <paramref name="kind"/> goods bought on <paramref name="day"/> are for (owner,
    /// 2026-11-10: "the year matters only for the item"): the one running then, else the next one.
    /// </summary>
    public static int YearOf(string kind, DateOnly day) =>
        kind == Winter ? (day.Month <= 3 ? day.Year : day.Year + 1) : (day.Month >= 10 ? day.Year + 1 : day.Year);

    /// <summary>That season (summer or winter of its year), added if it isn't there yet.</summary>
    public static async Task<Season> ForAsync(AppDbContext db, string kind, DateOnly day)
    {
        var year = YearOf(kind, day);
        var season = await db.Seasons.FirstOrDefaultAsync(s => s.Kind == kind && s.Year == year);
        if (season is not null) return season;
        season = new Season { Kind = kind, Year = year };
        season.Name = NameOf(season, "ar");
        db.Seasons.Add(season);
        await db.SaveChangesAsync();
        return season;
    }

    /// <summary>The name a system season is shown with; a hand-made one keeps its own.</summary>
    public static string NameOf(Season s, string? lang = null)
    {
        var ar = (lang ?? Loc.Lang) == "ar";
        return s.Kind switch
        {
            Summer => ar ? $"صيفي {s.Year}" : $"Summer {s.Year}",
            Winter => ar ? $"شتوي {s.Year}" : $"Winter {s.Year}",
            None => ar ? "بدون موسم" : "No season",
            _ => s.Name,
        };
    }

    /// <summary>Add the seasons of this year and the next, and "no season", if they aren't there yet.</summary>
    public static async Task EnsureAsync(AppDbContext db)
    {
        var (_, year) = Of(CompanyClock.Today);
        var have = await db.Seasons.Where(s => s.Kind != Custom).Select(s => new { s.Kind, s.Year }).ToListAsync();
        var wanted = new List<(string Kind, int? Year)> { (None, null) };
        foreach (var y in new[] { year, year + 1 }) { wanted.Add((Summer, y)); wanted.Add((Winter, y)); }
        var added = false;
        foreach (var (kind, y) in wanted)
        {
            if (have.Any(h => h.Kind == kind && h.Year == y)) continue;
            var season = new Season { Kind = kind, Year = y };
            // Kept in Arabic (the company's language) for the name added to an item's name.
            season.Name = NameOf(season, "ar");
            db.Seasons.Add(season);
            added = true;
        }
        if (added) await db.SaveChangesAsync();
    }

    /// <summary>The season it is now: the one set by hand in Settings, else the one the date falls in.</summary>
    public static async Task<Season?> CurrentAsync(AppDbContext db)
    {
        var set = await db.CompanySettings.Select(x => x.CurrentSeasonId).FirstOrDefaultAsync();
        if (set is { } id && await db.Seasons.FirstOrDefaultAsync(s => s.Id == id && s.IsActive) is { } chosen)
            return chosen;
        var (kind, year) = Of(CompanyClock.Today);
        return await db.Seasons.FirstOrDefaultAsync(s => s.Kind == kind && s.Year == year);
    }

    public static SeasonDto ToDto(Season s, Guid? currentId) =>
        new(s.Id.ToString(), NameOf(s), s.Kind, s.Year, s.IsActive, s.Id == currentId);
}
