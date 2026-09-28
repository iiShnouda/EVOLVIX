using System.Globalization;

namespace SKB.Api.Data;

/// <summary>
/// A name kept in Arabic and English (branches, warehouses, categories, products). People type it
/// in one language; the other is filled by AI translation in the background (see
/// <c>TranslationWorker</c>) and stays editable. Until it is translated — e.g. while the company
/// server has no internet — both languages show the text as it was typed.
/// </summary>
public interface ILocalizedName
{
    /// <summary>The name in the language it was typed in. Used for search and document snapshots.</summary>
    string Name { get; set; }
    string? NameAr { get; set; }
    string? NameEn { get; set; }
    /// <summary>"ar" or "en": the language the name was typed in.</summary>
    string NameSource { get; set; }
    /// <summary>"ar"/"en" when that side was filled by AI translation; null when people typed both.</summary>
    string? NameAuto { get; set; }
    /// <summary>The other side is waiting for (re)translation.</summary>
    bool NamePending { get; set; }
}

/// <summary>Picks and updates localized names. The request language comes from Accept-Language.</summary>
public static class Loc
{
    /// <summary>"ar" or "en" for the current request.</summary>
    public static string Lang => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ar" ? "ar" : "en";

    /// <summary>The name in the request's language, falling back to the other language, then as typed.</summary>
    public static string Name(ILocalizedName? e) => e is null ? "" : Pick(e.NameAr, e.NameEn, e.Name);

    public static string Pick(string? ar, string? en, string? typed) =>
        (Lang == "ar" ? ar ?? en : en ?? ar) ?? typed ?? "";

    /// <summary>
    /// Apply names from a create or edit form. A side that is given and differs from what is stored
    /// becomes a person's text. When exactly one side changes, the other is re-translated only if it
    /// was machine-made or empty — a translation a person corrected is never overwritten.
    /// Returns false when the result would have no name at all.
    /// </summary>
    public static bool Apply(ILocalizedName e, string? ar, string? en)
    {
        ar = Clean(ar);
        en = Clean(en);
        var changedAr = ar is not null && ar != e.NameAr;
        var changedEn = en is not null && en != e.NameEn;

        if (changedAr && changedEn)
        {
            e.NameAr = ar;
            e.NameEn = en;
            e.NameAuto = null;
            e.NamePending = false;
            e.NameSource = Lang;
        }
        else if (changedAr || changedEn)
        {
            var side = changedAr ? "ar" : "en";
            var other = side == "ar" ? "en" : "ar";
            if (side == "ar") e.NameAr = ar; else e.NameEn = en;
            var otherText = other == "ar" ? e.NameAr : e.NameEn;

            if (e.NameAuto == side)
            {
                // A person corrected the machine translation: it is theirs now; the source stays.
                e.NameAuto = null;
            }
            else if (otherText is null || e.NameAuto == other)
            {
                // A person changed the source (or typed the first name): translate the other side.
                e.NameSource = side;
                e.NamePending = true;
            }
            else
            {
                e.NameSource = side;
            }
        }

        e.Name = (e.NameSource == "ar" ? e.NameAr ?? e.NameEn : e.NameEn ?? e.NameAr) ?? "";
        return e.Name.Length > 0;
    }

    /// <summary>
    /// Names from a request: the Arabic/English fields, or — when neither is sent — a plain name
    /// taken as typed in the request's language.
    /// </summary>
    public static (string? Ar, string? En) FromRequest(string? ar, string? en, string? plain) =>
        ar is null && en is null && plain is not null
            ? (Lang == "ar" ? (plain, (string?)null) : (null, plain))
            : (ar, en);

    private static string? Clean(string? s)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(200, t.Length)];
    }
}
