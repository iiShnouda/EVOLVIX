using System.Globalization;

namespace SKB.Api.Services;

/// <summary>
/// The company's calendar: its time zone (Africa/Cairo by default, a company setting). Business
/// days follow it, not UTC: "today", report periods, daily cash, months, aging, document years.
///
/// Two kinds of stored dates:
/// - <b>Instants</b> (an invoice's issue date, a voucher's time, most journal entries) are UTC.
///   A day of them runs from <see cref="StartOf"/> that day to <see cref="StartOf"/> the next.
/// - <b>Calendar days</b> (due dates, attendance days, hire dates, the period lock) are stored as
///   that day at 00:00 UTC. <see cref="TodayDate"/> is today in the same form. Manual, payroll and
///   year-end entries are dated at 12:00 UTC of their day, which falls on that day in every zone
///   offered here.
/// </summary>
public static class CompanyClock
{
    public const string DefaultZone = "Africa/Cairo";

    /// <summary>The zones offered in Settings (mirrors <c>TIME_ZONES</c> in @skb/shared settings.ts).</summary>
    public static readonly IReadOnlyList<string> Zones = new[]
    {
        "Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain", "Asia/Muscat",
        "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Africa/Khartoum", "Africa/Tripoli", "Africa/Tunis",
        "Africa/Algiers", "Africa/Casablanca", "Europe/Istanbul", "Europe/London", "Europe/Berlin",
        "America/New_York", "UTC",
    };

    private static volatile TimeZoneInfo _zone = Find(DefaultZone) ?? TimeZoneInfo.Utc;
    private static volatile string _zoneId = DefaultZone;

    /// <summary>The company's IANA time zone id (what PostgreSQL's <c>timezone()</c> takes).</summary>
    public static string ZoneId => _zoneId;

    public static bool IsKnown(string? id) => id is not null && Zones.Contains(id) && Find(id) is not null;

    /// <summary>Switch the company's zone (at start-up and when Settings change it). Unknown ids are ignored.</summary>
    public static bool Use(string? id)
    {
        if (!IsKnown(id)) return false;
        _zone = Find(id!)!;
        _zoneId = id!;
        return true;
    }

    /// <summary>The wall-clock time at the company now.</summary>
    public static DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, _zone);

    public static DateOnly Today => DateOnly.FromDateTime(Now);

    /// <summary>Today as a calendar day (00:00 UTC), to compare with due dates and attendance days.</summary>
    public static DateTime TodayDate => AsDate(Today);

    public static int Year => Today.Year;

    /// <summary>The company day an instant falls on.</summary>
    public static DateOnly DayOf(DateTime instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(instant, DateTimeKind.Utc), _zone));

    /// <summary>The company's wall-clock time of an instant.</summary>
    public static DateTime LocalOf(DateTime instant) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(instant, DateTimeKind.Utc), _zone);

    /// <summary>The instant (UTC) a company day starts.</summary>
    public static DateTime StartOf(DateOnly day) => ToUtc(day.ToDateTime(TimeOnly.MinValue));

    /// <summary>The instant (UTC) of a wall-clock time at the company.</summary>
    public static DateTime ToUtc(DateTime local)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        var zone = _zone;
        // A time the clocks jump over (spring forward) becomes the first real minute after it.
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(15);
        // A time that happens twice (fall back) is its first occurrence.
        if (zone.IsAmbiguousTime(local))
            return DateTime.SpecifyKind(local - zone.GetAmbiguousTimeOffsets(local).Max(), DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    /// <summary>The instants [start, end) covering company days <paramref name="from"/> to <paramref name="to"/>.</summary>
    public static (DateTime Start, DateTime End) Days(DateOnly from, DateOnly to) => (StartOf(from), StartOf(to.AddDays(1)));

    /// <summary>A calendar day in its stored form (00:00 UTC).</summary>
    public static DateTime AsDate(DateOnly day) => day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

    private static readonly DateOnly FirstDay = new(1900, 1, 1), LastDay = new(2200, 12, 31);

    /// <summary>A yyyy-MM-dd day from a request (held within 1900–2200), or null.</summary>
    public static DateOnly? ParseDay(string? s)
    {
        if (!DateOnly.TryParse(s, CultureInfo.InvariantCulture, out var d)) return null;
        return d < FirstDay ? FirstDay : d > LastDay ? LastDay : d;
    }

    private static TimeZoneInfo? Find(string id)
    {
        if (id == "UTC") return TimeZoneInfo.Utc;
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { return null; }
    }
}
