using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

public static class Mapper
{
    public static SalesSummaryDto ToSummary(SalesDocument d) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        Loc.Name(d.Branch), d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"), d.GrandTotal, d.PaidAmount, d.Currency,
        d.SourceDocument?.Number);

    /// <param name="returned">For an invoice: quantity already returned per line (from ReturnsService).</param>
    /// <param name="baseUnits">Base unit name per product (<see cref="InvoiceLines.BaseUnitNamesAsync"/>).</param>
    /// <remarks>Load the lines' <c>Unit</c> and <c>Warehouse</c> and the document's <c>PriceLevel</c> first.</remarks>
    public static SalesDetailDto ToDetail(SalesDocument d,
        IReadOnlyDictionary<Guid, ReturnsService.Returned>? returned = null,
        IReadOnlyDictionary<Guid, string>? baseUnits = null) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        Loc.Name(d.Branch), d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"),
        d.Lines.OrderBy(l => l.LineNo).Select(l => new DocumentLineDto(
            l.Id.ToString(), l.ProductId.ToString(), l.ProductName, l.Quantity,
            l.UnitPrice, l.Discount, l.LineTotal, l.UnitCost, l.LineProfit,
            returned is not null && returned.TryGetValue(l.Id, out var r) ? r.Quantity : 0,
            l.WarehouseId?.ToString(), l.Warehouse is null ? null : Loc.Name(l.Warehouse),
            l.UnitId?.ToString(), Loc.Name(l.Unit), l.UnitFactor, l.UnitQuantity, l.LineCost,
            baseUnits?.GetValueOrDefault(l.ProductId) ?? (l.UnitFactor == 1 ? Loc.Name(l.Unit) : ""),
            l.IsBonus, l.DocDiscount)).ToArray(),
        d.Subtotal, d.DiscountTotal, d.TaxTotal, d.GrandTotal, d.PaidAmount,
        d.CostTotal, d.ProfitTotal, d.Currency, d.Notes,
        d.SourceDocumentId?.ToString(), d.SourceDocument?.Number,
        d.PriceLevelId?.ToString(), d.PriceLevel is null ? null : Loc.Name(d.PriceLevel),
        d.AdditionTotal, d.Charges.OrderBy(c => c.Seq).Select(Charges.ToDto).ToArray(),
        d.RepId?.ToString(), d.Rep?.FullName);

    /// <summary>An item with its units and their prices at every active level (from <paramref name="book"/>).</summary>
    public static ProductDto ToProduct(Product p, PriceBook book, Guid? matchedUnitId = null)
    {
        var units = book.UnitsOf(p.Id);
        var levels = book.Levels.Where(l => l.IsActive).ToList();
        var baseUnit = book.BaseOf(p.Id);
        return new ProductDto(
            p.Id.ToString(), p.Sku, Loc.Name(p), Loc.Name(baseUnit?.Unit), p.CostPrice, p.SalePrice, p.Currency,
            p.StockOnHand, p.ReorderLevel, p.IsActive, baseUnit?.Barcode, p.CategoryId.ToString(),
            units.Select(u => new ProductUnitDto(
                u.UnitId.ToString(), Loc.Name(u.Unit), u.Factor, u.Barcode,
                levels.Select(l => (Level: l, Price: book.Effective(p.Id, u.UnitId, l.Id)))
                    .Where(x => x.Price.Price is not null)
                    .Select(x => new UnitPriceDto(x.Level.Id.ToString(), x.Price.Price!.Value, x.Price.Source!))
                    .ToArray())).ToArray(),
            p.ModelId?.ToString(), p.Size is null ? null : Loc.Name(p.Size), p.Color is null ? null : Loc.Name(p.Color),
            matchedUnitId?.ToString());
    }

    /// <summary>
    /// An inventory row. Defaults to the company view (total stock at the company average); pass the
    /// quantity, cost and value of one warehouse for a warehouse view (cost is that branch's).
    /// Load <c>Units.Unit</c> and <c>Category</c> first.
    /// </summary>
    public static InventoryItemDto ToInventoryItem(Product p, int? quantity = null, long? avgCost = null, long? value = null)
    {
        var qty = quantity ?? p.StockOnHand;
        var cost = avgCost ?? p.CostPrice;
        var units = p.Units.OrderBy(u => u.Factor).ToList();
        return new(
            p.Id.ToString(), p.Sku, Loc.Name(p), Loc.Name(units.FirstOrDefault()?.Unit), Loc.Name(p.Category),
            qty, p.ReorderLevel, cost, p.SalePrice, value ?? (long)qty * cost, qty <= p.ReorderLevel,
            units.Select(u => new UnitOptionDto(u.UnitId.ToString(), Loc.Name(u.Unit), u.Factor)).ToArray(),
            p.ModelId?.ToString());
    }

    public static CompanySettingsDto ToSettings(CompanySettings s) => new(
        s.CompanyName, s.Country, s.Currency,
        s.DefaultMarkupPercent, s.MinMarkupPercent, s.DefaultTaxPercent, s.TransfersRequireReceipt);

    public static PartyDto ToParty(Party p) => new(
        p.Id.ToString(), p.Name, p.Types.ToArray(), p.Phone, p.Balance, p.Currency,
        p.SalesPriceLevelId?.ToString(), p.PurchasePriceLevelId?.ToString());

    /// <summary>Both languages of a name, for edit forms.</summary>
    public static LocalizedNameDto ToNames(ILocalizedName e) =>
        new(e.NameAr, e.NameEn, e.NameSource, e.NameAuto, e.NamePending);

    public static PriceLevelDto ToPriceLevel(PriceLevel l) => new(
        l.Id.ToString(), Loc.Name(l), l.Side.ToString(), l.IsDefault, l.SortOrder, l.IsActive, ToNames(l));

    public static VariantOptionDto ToVariantOption(VariantOption o) => new(
        o.Id.ToString(), o.Kind.ToString(), Loc.Name(o), o.SortOrder, o.IsActive, ToNames(o));
}
