using System.Reflection;
using System.Text.Json;

namespace SKB.Api.Services;

/// <summary>
/// What each version of the app brings (owner, 2026-10-11: "see if there's a new version, its new
/// features and fixes"): <c>release-notes.json</c>, built into the app. Its first release is the
/// version this server runs. The same file in the newest code tells what an update would bring
/// (see <see cref="UpdateService"/>). Every change people will notice adds its lines there, in
/// Arabic and English.
/// </summary>
public static class Releases
{
    public sealed record Note(string Ar, string En);

    /// <param name="Apps">The Windows and Android apps' versions that go with it, when they changed.</param>
    public sealed record Release(string Version, string Date, Note[] Features, Note[] Fixes, Dictionary<string, string>? Apps);

    private sealed record File(Release[] Releases);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static IReadOnlyList<Release> All { get; } = LoadBuiltIn();

    /// <summary>The version this server runs.</summary>
    public static Release Current => All[0];

    private static IReadOnlyList<Release> LoadBuiltIn()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("release-notes.json");
        var list = stream is null ? null : Parse(new StreamReader(stream).ReadToEnd());
        return list is { Count: > 0 } ? list : new[] { new Release("0.0.0", "", [], [], null) };
    }

    /// <summary>
    /// A release-notes file, read carefully (the newest one comes from the server's copy of the code):
    /// only well-formed versions, at most 100 releases and 50 lines each, lines cut at 400 characters.
    /// Null when it can't be read.
    /// </summary>
    public static IReadOnlyList<Release>? Parse(string json)
    {
        try
        {
            var file = JsonSerializer.Deserialize<File>(json, Json);
            if (file?.Releases is null) return null;
            static Note[] Clean(Note[]? notes) => (notes ?? [])
                .Where(n => n is not null && !string.IsNullOrWhiteSpace(n.Ar) && !string.IsNullOrWhiteSpace(n.En))
                .Take(50).Select(n => new Note(Cut(n.Ar), Cut(n.En))).ToArray();
            return file.Releases
                .Where(r => r is not null && VersionOf(r.Version) is not null)
                .Take(100)
                .Select(r => new Release(r.Version.Trim(), Cut(r.Date ?? "", 10), Clean(r.Features), Clean(r.Fixes),
                    r.Apps?.Where(a => a.Key is "windows" or "android" && VersionOf(a.Value) is not null)
                        .ToDictionary(a => a.Key, a => a.Value)))
                .OrderByDescending(r => VersionOf(r.Version))
                .ToList();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Cut(string s, int max = 400) => s.Trim() is var t && t.Length > max ? t[..max] : s.Trim();

    /// <summary>A version as numbers ("1.8.0" → 1.8.0), or null when it isn't one.</summary>
    public static Version? VersionOf(string? version) =>
        System.Version.TryParse(version?.Trim(), out var v) && v.Major >= 0 ? v : null;

    /// <summary>
    /// What an update would bring: the releases in <paramref name="newest"/> (the newest code's notes)
    /// that this server doesn't have yet. A release with a higher version number is new in full. The
    /// release that matches this server's version may have gained lines since this server was built —
    /// the rules allow adding a line to the top release — so for it only the new lines are shown.
    /// </summary>
    public static IReadOnlyList<Release> NewerThanCurrent(IReadOnlyList<Release> newest)
    {
        var current = VersionOf(Current.Version);
        var result = new List<Release>();
        foreach (var r in newest)
        {
            var v = VersionOf(r.Version);
            if (v is null) continue;
            if (current is null || v > current)
            {
                result.Add(r);
            }
            else if (v == current)
            {
                // Same version, but more may have been added to it since this server was built.
                var features = AddedSince(r.Features, Current.Features);
                var fixes = AddedSince(r.Fixes, Current.Fixes);
                if (features.Length > 0 || fixes.Length > 0)
                    result.Add(r with { Features = features, Fixes = fixes });
            }
        }
        return result;
    }

    /// <summary>The lines in <paramref name="newest"/> that aren't already in <paramref name="have"/>.</summary>
    private static Note[] AddedSince(Note[] newest, Note[] have)
    {
        var known = have.Select(n => n.Ar + "\u0001" + n.En).ToHashSet();
        return newest.Where(n => !known.Contains(n.Ar + "\u0001" + n.En)).ToArray();
    }
}
