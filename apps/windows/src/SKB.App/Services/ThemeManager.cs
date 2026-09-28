using System.Windows;
using SKB.App.Infrastructure;

namespace SKB.App.Services;

/// <summary>Swaps the light/dark brush ResourceDictionary at runtime.</summary>
public sealed class ThemeManager : ObservableObject
{
    private string _theme = "light";

    public string Theme
    {
        get => _theme;
        private set
        {
            if (SetProperty(ref _theme, value))
            {
                OnPropertyChanged(nameof(IsDark));
                Apply();
            }
        }
    }

    public bool IsDark => _theme == "dark";

    public void Toggle() => Theme = _theme == "dark" ? "light" : "dark";

    public void Set(string theme) => Theme = theme == "dark" ? "dark" : "light";

    public void Apply()
    {
        var dictionaries = Application.Current.Resources.MergedDictionaries;
        // Remove any previously applied theme dictionary.
        for (int i = dictionaries.Count - 1; i >= 0; i--)
        {
            var src = dictionaries[i].Source?.OriginalString ?? "";
            if (src.Contains("/Themes/Light.xaml") || src.Contains("/Themes/Dark.xaml"))
                dictionaries.RemoveAt(i);
        }

        var themeUri = new Uri(
            _theme == "dark" ? "/Themes/Dark.xaml" : "/Themes/Light.xaml",
            UriKind.Relative);
        dictionaries.Insert(0, new ResourceDictionary { Source = themeUri });
    }
}
