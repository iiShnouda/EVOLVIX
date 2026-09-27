using System.Collections.ObjectModel;
using System.ComponentModel;
using SKB.App.Infrastructure;
using SKB.App.Services;
using SKB.Core.Models;

namespace SKB.App.ViewModels;

public sealed class ShellViewModel : ObservableObject
{
    public Localizer Loc => App.Loc;
    public ThemeManager Theme => App.Theme;
    public ConnectionMonitor Connection => App.Connection;

    public AuthUser User { get; }
    public string Initials { get; }

    public ObservableCollection<NavItemViewModel> NavItems { get; } = new();

    private object? _currentViewModel;
    public object? CurrentViewModel { get => _currentViewModel; private set => SetProperty(ref _currentViewModel, value); }

    private string _currentKey = "dashboard";

    public RelayCommand SignOutCommand { get; }
    public RelayCommand ToggleLanguageCommand { get; }
    public RelayCommand ToggleThemeCommand { get; }

    private static readonly (string Key, string LabelKey, string? Permission)[] NavConfig =
    {
        ("dashboard", "nav.dashboard", "dashboard:view"),
        ("sales", "nav.sales", "sales:view"),
        ("parties", "nav.parties", "parties:view"),
        ("purchases", "nav.purchases", "purchases:view"),
        ("inventory", "nav.inventory", "inventory:view"),
        ("analytics", "nav.analytics", "analytics:view"),
        ("settings", "nav.settings", "settings:view"),
    };

    public ShellViewModel()
    {
        User = App.Session.User ?? new AuthUser();
        Initials = BuildInitials(User.FullName);

        foreach (var (key, labelKey, perm) in NavConfig)
        {
            if (perm is null || User.Can(perm))
                NavItems.Add(new NavItemViewModel(key, labelKey, perm, Navigate));
        }

        SignOutCommand = new RelayCommand(SignOut);
        ToggleLanguageCommand = new RelayCommand(() => Loc.Toggle());
        ToggleThemeCommand = new RelayCommand(() => Theme.Toggle());

        // Re-load the current page when the language flips so formatted numbers/dates refresh.
        Loc.PropertyChanged += OnLocaleChanged;

        Navigate("dashboard");
    }

    private void OnLocaleChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Localizer.FlowDirection))
            Navigate(_currentKey);
    }

    public void Navigate(string key)
    {
        _currentKey = key;
        foreach (var item in NavItems) item.IsActive = item.Key == key;

        CurrentViewModel = key switch
        {
            "dashboard" => Activate(new DashboardViewModel()),
            "sales" => Activate(new SalesViewModel()),
            "parties" => Activate(new PartiesViewModel()),
            _ => new PlaceholderViewModel(NavLabelKey(key)),
        };
    }

    private static object Activate(ILoadable vm)
    {
        _ = vm.LoadAsync();
        return vm;
    }

    private static string NavLabelKey(string key) =>
        NavConfig.FirstOrDefault(n => n.Key == key).LabelKey ?? "nav.settings";

    private async void SignOut()
    {
        Loc.PropertyChanged -= OnLocaleChanged;
        await App.Api.LogoutAsync().ConfigureAwait(true);
        App.ShowLogin();
    }

    private static string BuildInitials(string fullName)
    {
        var parts = fullName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "?";
        return (parts.Length == 1
            ? parts[0][..1]
            : string.Concat(parts[0][..1], parts[1][..1])).ToUpperInvariant();
    }
}

/// <summary>Pages that load data implement this so the shell can kick off their load.</summary>
public interface ILoadable
{
    Task LoadAsync();
}
