using System.ComponentModel;
using SKB.App.Infrastructure;
using SKB.App.Services;

namespace SKB.App.ViewModels;

public sealed class NavItemViewModel : ObservableObject
{
    public string Key { get; }
    public string LabelKey { get; }
    public string? Permission { get; }
    public RelayCommand NavigateCommand { get; }

    private bool _isActive;
    public bool IsActive { get => _isActive; set => SetProperty(ref _isActive, value); }

    /// <summary>Localized label, kept live so the nav re-labels on a language switch.</summary>
    public string Label => App.Loc.T(LabelKey);

    public NavItemViewModel(string key, string labelKey, string? permission, Action<string> navigate)
    {
        Key = key;
        LabelKey = labelKey;
        Permission = permission;
        NavigateCommand = new RelayCommand(() => navigate(Key));
        App.Loc.PropertyChanged += OnLocaleChanged;
    }

    private void OnLocaleChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Localizer.FlowDirection) || e.PropertyName == "Item[]")
            OnPropertyChanged(nameof(Label));
    }
}
