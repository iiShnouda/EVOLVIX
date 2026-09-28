using System.Collections.ObjectModel;
using SKB.App.Infrastructure;
using SKB.App.Services;
using SKB.Core;
using SKB.Core.Models;

namespace SKB.App.ViewModels;

public sealed class DashboardViewModel : ObservableObject, ILoadable
{
    public Localizer Loc => App.Loc;

    public ObservableCollection<KpiCardViewModel> Kpis { get; } = new();
    public ObservableCollection<RecentDocViewModel> Recent { get; } = new();
    public ObservableCollection<LowStockViewModel> LowStock { get; } = new();

    private bool _isBusy = true;
    public bool IsBusy { get => _isBusy; set { if (SetProperty(ref _isBusy, value)) OnPropertyChanged(nameof(IsNotBusy)); } }
    public bool IsNotBusy => !_isBusy;

    private bool _hasError;
    public bool HasError { get => _hasError; set => SetProperty(ref _hasError, value); }

    public async Task LoadAsync()
    {
        IsBusy = true;
        HasError = false;
        try
        {
            var data = await App.Api.GetDashboardAsync().ConfigureAwait(true);
            var locale = Loc.Locale;

            Kpis.Clear();
            foreach (var k in data.Kpis)
            {
                var display = k.IsMoney
                    ? Formatting.Money(k.Value, k.Currency ?? data.Currency, locale)
                    : Formatting.Number(k.Value, locale);
                Kpis.Add(new KpiCardViewModel(Loc.T(k.Key), display, k.Tone));
            }

            Recent.Clear();
            foreach (var d in data.RecentDocuments)
                Recent.Add(new RecentDocViewModel(d, Loc));

            LowStock.Clear();
            foreach (var p in data.LowStock)
                LowStock.Add(new LowStockViewModel(p, locale));
        }
        catch
        {
            HasError = true;
        }
        finally
        {
            IsBusy = false;
        }
    }
}

public sealed class KpiCardViewModel
{
    public string Label { get; }
    public string Display { get; }
    public string Tone { get; }

    public KpiCardViewModel(string label, string display, string tone)
    {
        Label = label;
        Display = display;
        Tone = tone;
    }
}

public sealed class RecentDocViewModel
{
    public string PartyName { get; }
    public string Number { get; }
    public string StatusLabel { get; }
    public string Tone { get; }
    public string TotalDisplay { get; }

    public RecentDocViewModel(SalesDocumentSummary d, Localizer loc)
    {
        PartyName = d.PartyName;
        Number = d.Number;
        StatusLabel = loc.T("status." + d.Status);
        Tone = StatusTone.For(d.Status);
        TotalDisplay = Formatting.Money(d.GrandTotal, d.Currency, loc.Locale);
    }
}

public sealed class LowStockViewModel
{
    public string Name { get; }
    public string Sku { get; }
    public string StockDisplay { get; }

    public LowStockViewModel(Product p, string locale)
    {
        Name = p.Name;
        Sku = p.Sku;
        StockDisplay = $"{Formatting.Number(p.StockOnHand, locale)} / {Formatting.Number(p.ReorderLevel, locale)}";
    }
}
