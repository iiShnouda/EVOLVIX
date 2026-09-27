using SKB.App.Infrastructure;
using SKB.App.Services;

namespace SKB.App.ViewModels;

/// <summary>Coming-soon surface for modules delivered in a later phase (no fake data).</summary>
public sealed class PlaceholderViewModel : ObservableObject
{
    public Localizer Loc => App.Loc;
    public string TitleKey { get; }
    public string Title => App.Loc.T(TitleKey);

    public PlaceholderViewModel(string titleKey) => TitleKey = titleKey;
}
