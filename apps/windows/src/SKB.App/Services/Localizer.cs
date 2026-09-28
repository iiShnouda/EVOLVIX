using System.Windows;
using SKB.App.Infrastructure;
using SKB.Core.Localization;

namespace SKB.App.Services;

/// <summary>
/// App-wide localization. XAML binds to the indexer: {Binding [nav.dashboard], Source={StaticResource Loc}}.
/// Switching locale raises the indexer + FlowDirection so the whole UI re-renders in AR/EN and RTL/LTR.
/// </summary>
public sealed class Localizer : ObservableObject
{
    private string _locale = "en";

    public string Locale
    {
        get => _locale;
        set
        {
            if (SetProperty(ref _locale, value))
            {
                Raise("Item[]");
                OnPropertyChanged(nameof(FlowDirection));
                OnPropertyChanged(nameof(IsArabic));
            }
        }
    }

    public bool IsArabic => _locale == "ar";

    public FlowDirection FlowDirection => _locale == "ar" ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

    /// <summary>Indexer used by XAML bindings.</summary>
    public string this[string key] => Strings.Get(_locale, key);

    public string T(string key) => Strings.Get(_locale, key);

    public void Toggle() => Locale = _locale == "en" ? "ar" : "en";
}
