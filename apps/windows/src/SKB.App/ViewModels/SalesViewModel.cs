using System.Collections.ObjectModel;
using SKB.App.Infrastructure;
using SKB.App.Services;
using SKB.Core;
using SKB.Core.Models;

namespace SKB.App.ViewModels;

public sealed class SalesViewModel : ObservableObject, ILoadable
{
    public Localizer Loc => App.Loc;

    public ObservableCollection<SalesRowViewModel> Rows { get; } = new();

    private bool _isBusy = true;
    public bool IsBusy { get => _isBusy; set { if (SetProperty(ref _isBusy, value)) OnPropertyChanged(nameof(IsNotBusy)); } }
    public bool IsNotBusy => !_isBusy;

    private int _total;
    public int Total { get => _total; set => SetProperty(ref _total, value); }

    private SalesRowViewModel? _selectedRow;
    public SalesRowViewModel? SelectedRow
    {
        get => _selectedRow;
        set
        {
            if (SetProperty(ref _selectedRow, value) && value is not null)
                _ = LoadDetailAsync(value.Id);
        }
    }

    private SalesDetailViewModel? _detail;
    public SalesDetailViewModel? Detail { get => _detail; set => SetProperty(ref _detail, value); }

    private bool _detailBusy;
    public bool DetailBusy { get => _detailBusy; set => SetProperty(ref _detailBusy, value); }

    public async Task LoadAsync()
    {
        IsBusy = true;
        try
        {
            var page = await App.Api.GetSalesInvoicesAsync(1).ConfigureAwait(true);
            Total = page.Total;
            Rows.Clear();
            foreach (var d in page.Items)
                Rows.Add(new SalesRowViewModel(d, Loc));
        }
        catch
        {
            // leave list empty; the view shows an empty state
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task LoadDetailAsync(string id)
    {
        DetailBusy = true;
        try
        {
            var doc = await App.Api.GetSalesInvoiceAsync(id).ConfigureAwait(true);
            Detail = new SalesDetailViewModel(doc, Loc);
        }
        catch
        {
            Detail = null;
        }
        finally
        {
            DetailBusy = false;
        }
    }
}

public sealed class SalesRowViewModel
{
    public string Id { get; }
    public string Number { get; }
    public string PartyName { get; }
    public string DateDisplay { get; }
    public string StatusLabel { get; }
    public string Tone { get; }
    public string TotalDisplay { get; }

    public SalesRowViewModel(SalesDocumentSummary d, Localizer loc)
    {
        Id = d.Id;
        Number = d.Number;
        PartyName = d.PartyName;
        DateDisplay = Formatting.Date(d.IssueDate, loc.Locale);
        StatusLabel = loc.T("status." + d.Status);
        Tone = StatusTone.For(d.Status);
        TotalDisplay = Formatting.Money(d.GrandTotal, d.Currency, loc.Locale);
    }
}

public sealed class SalesDetailViewModel
{
    public string Number { get; }
    public string PartyName { get; }
    public string BranchName { get; }
    public string StaffName { get; }
    public string DateDisplay { get; }
    public string StatusLabel { get; }
    public string Tone { get; }
    public ObservableCollection<DetailLineViewModel> Lines { get; } = new();
    public string SubtotalDisplay { get; }
    public string DiscountDisplay { get; }
    public string TaxDisplay { get; }
    public string TotalDisplay { get; }
    public string PaidDisplay { get; }
    public string OutstandingDisplay { get; }

    public SalesDetailViewModel(SalesDocument d, Localizer loc)
    {
        var locale = loc.Locale;
        Number = d.Number;
        PartyName = d.PartyName;
        BranchName = d.BranchName;
        StaffName = d.StaffName;
        DateDisplay = Formatting.Date(d.IssueDate, locale);
        StatusLabel = loc.T("status." + d.Status);
        Tone = StatusTone.For(d.Status);
        foreach (var l in d.Lines)
            Lines.Add(new DetailLineViewModel(l, d.Currency, locale));
        SubtotalDisplay = Formatting.Money(d.Subtotal, d.Currency, locale);
        DiscountDisplay = Formatting.Money(d.DiscountTotal, d.Currency, locale);
        TaxDisplay = Formatting.Money(d.TaxTotal, d.Currency, locale);
        TotalDisplay = Formatting.Money(d.GrandTotal, d.Currency, locale);
        PaidDisplay = Formatting.Money(d.PaidAmount, d.Currency, locale);
        OutstandingDisplay = Formatting.Money(d.GrandTotal - d.PaidAmount, d.Currency, locale);
    }
}

public sealed class DetailLineViewModel
{
    public string ProductName { get; }
    public string QuantityDisplay { get; }
    public string UnitPriceDisplay { get; }
    public string LineTotalDisplay { get; }

    public DetailLineViewModel(DocumentLine l, string currency, string locale)
    {
        ProductName = l.ProductName;
        QuantityDisplay = Formatting.Number(l.Quantity, locale);
        UnitPriceDisplay = Formatting.Money(l.UnitPrice, currency, locale);
        LineTotalDisplay = Formatting.Money(l.LineTotal, currency, locale);
    }
}
