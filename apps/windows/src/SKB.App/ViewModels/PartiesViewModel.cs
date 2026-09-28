using System.Collections.ObjectModel;
using SKB.App.Infrastructure;
using SKB.App.Services;
using SKB.Core;
using SKB.Core.Models;

namespace SKB.App.ViewModels;

public sealed class PartiesViewModel : ObservableObject, ILoadable
{
    public Localizer Loc => App.Loc;

    public ObservableCollection<PartyCardViewModel> Cards { get; } = new();

    private bool _isBusy = true;
    public bool IsBusy { get => _isBusy; set { if (SetProperty(ref _isBusy, value)) OnPropertyChanged(nameof(IsNotBusy)); } }
    public bool IsNotBusy => !_isBusy;

    public async Task LoadAsync()
    {
        IsBusy = true;
        try
        {
            var page = await App.Api.GetPartiesAsync(1).ConfigureAwait(true);
            Cards.Clear();
            foreach (var p in page.Items)
                Cards.Add(new PartyCardViewModel(p, Loc));
        }
        catch
        {
            // empty state
        }
        finally
        {
            IsBusy = false;
        }
    }
}

public sealed class PartyCardViewModel
{
    public string Name { get; }
    public string TypesDisplay { get; }
    public string? Phone { get; }
    public string BalanceLabel { get; }
    public string BalanceDisplay { get; }
    public string Tone { get; }

    public PartyCardViewModel(PartyDto p, Localizer loc)
    {
        Name = p.Name;
        Phone = p.Phone;
        TypesDisplay = string.Join(" · ", p.Types.Select(t => loc.T("parties." + t.ToLowerInvariant())));

        var direction = Formatting.BalanceDirection(p.Balance);
        (BalanceLabel, Tone) = direction switch
        {
            "receivable" => (loc.T("parties.theyOweUs"), "positive"),
            "payable" => (loc.T("parties.weOweThem"), "warning"),
            _ => (loc.T("parties.settled"), "neutral"),
        };
        BalanceDisplay = Formatting.Money(Math.Abs(p.Balance), p.Currency, loc.Locale);
    }
}
