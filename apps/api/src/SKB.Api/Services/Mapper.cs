using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

public static class Mapper
{
    public static SalesSummaryDto ToSummary(SalesDocument d) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        Loc.Name(d.Branch), d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("yyyy-MM-dd"), d.GrandTotal, d.PaidAmount, d.Currency,
        d.SourceDocument?.Number, d.DepartmentId?.ToString(), d.Department is null ? null : Loc.Name(d.Department),
        d.Party?.Code, d.Rep?.FullName, d.Subtotal, d.DiscountTotal, 0, d.Notes);

    /// <param name="returned">For an invoice: quantity already returned per line (from ReturnsService).</param>
    /// <param name="baseUnits">Base unit name per product (<see cref="InvoiceLines.BaseUnitNamesAsync"/>).</param>
    /// <remarks>Load the lines' <c>Unit</c> and <c>Warehouse</c> and the document's <c>PriceLevel</c> first.</remarks>
    public static SalesDetailDto ToDetail(SalesDocument d,
        IReadOnlyDictionary<Guid, ReturnsService.Returned>? returned = null,
        IReadOnlyDictionary<Guid, string>? baseUnits = null) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        Loc.Name(d.Branch), d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("yyyy-MM-dd"),
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
        d.RepId?.ToString(), d.Rep?.FullName,
        d.DeliveryMethod.ToString(), d.DeliveryStatus?.ToString(), d.DeliveryAddress,
        d.DriverId?.ToString(), d.Driver?.FullName, d.CarrierId?.ToString(), d.Carrier?.Name,
        d.PaidAccountId?.ToString(), d.PaidAccount is null ? null : Loc.Name(d.PaidAccount),
        DepartmentId: d.DepartmentId?.ToString(), DepartmentName: d.Department is null ? null : Loc.Name(d.Department),
        StaffId: d.StaffId.ToString(), PartyId: d.PartyId.ToString(), BranchId: d.BranchId.ToString(),
        RejectReason: d.RejectReason, PartyCode: d.Party?.Code, RepCode: d.Rep?.Code,
        CancelReason: d.CancelReason);

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
            matchedUnitId?.ToString(), p.SupplierId?.ToString(), p.Supplier?.Name, p.SupplierCode,
            p.Category?.DepartmentId?.ToString(), p.Category?.Department is { } d ? Loc.Name(d) : null,
            p.SeasonId?.ToString(), p.Season is { } season ? Seasons.NameOf(season) : null, p.Color?.Hex);
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
            p.Id.ToString(), p.Sku, Loc.Name(p), Loc.Name(units.FirstOrDefault()?.Unit), p.Category?.Department is { } dept ? Loc.Name(dept) : Loc.Name(p.Category),
            qty, p.ReorderLevel, cost, p.SalePrice, value ?? (long)qty * cost, qty <= p.ReorderLevel,
            units.Select(u => new UnitOptionDto(u.UnitId.ToString(), Loc.Name(u.Unit), u.Factor)).ToArray(),
            p.ModelId?.ToString());
    }

    public static CompanySettingsDto ToSettings(CompanySettings s) => new(
        s.CompanyName, s.Country, s.Currency,
        s.DefaultMarkupPercent, s.MinMarkupPercent, s.DefaultTaxPercent, s.TransfersRequireReceipt,
        s.Address, s.Phone, s.Email, s.TaxNumber, s.CommercialRegister, s.TimeZone, s.MaxDiscountPercent,
        s.PendingHoldDays, s.LogoVersion, s.RequireDepartment);

    public static PartyDto ToParty(Party p) => new(
        p.Id.ToString(), p.Name, p.Types.ToArray(), p.Phone, p.Balance, p.Currency,
        p.SalesPriceLevelId?.ToString(), p.PurchasePriceLevelId?.ToString(),
        p.Email, p.TaxNumber, p.Address, p.IsActive,
        p.OtherPhones.ToArray(), p.ContactName, p.ShippingAddress, p.Notes, p.CreditLimit, p.Code,
        p.SalesPriceListId?.ToString(), p.PurchasePriceListId?.ToString(),
        p.DefaultCarrierId?.ToString(), p.IsCashCustomer,
        p.OtherPhones.Select((_, i) => i < p.OtherPhoneLabels.Count ? p.OtherPhoneLabels[i] : "").ToArray(),
        p.ExtraAddress, p.ExtraAddressLabel, p.TempCarrierName, p.HasIdFront, p.HasIdBack);

    public static PriceLevelDto ToPriceLevel(PriceLevel l) => new(
        l.Id.ToString(), Loc.Name(l), l.Side.ToString(), l.IsDefault, l.SortOrder, l.IsActive);

    public static VariantOptionDto ToVariantOption(VariantOption o) => new(
        o.Id.ToString(), o.Kind.ToString(), Loc.Name(o), o.SortOrder, o.IsActive, o.Hex);
}
