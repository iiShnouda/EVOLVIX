using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

public static class Mapper
{
    public static SalesSummaryDto ToSummary(SalesDocument d) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        d.Branch?.Name ?? "", d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"), d.GrandTotal, d.PaidAmount, d.Currency,
        d.SourceDocument?.Number);

    /// <param name="returned">For an invoice: quantity already returned per line (from ReturnsService).</param>
    public static SalesDetailDto ToDetail(SalesDocument d,
        IReadOnlyDictionary<Guid, (int Quantity, long Discount)>? returned = null) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        d.Branch?.Name ?? "", d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"),
        d.Lines.OrderBy(l => l.LineNo).Select(l => new DocumentLineDto(
            l.Id.ToString(), l.ProductId.ToString(), l.ProductName, l.Quantity,
            l.UnitPrice, l.Discount, l.LineTotal, l.UnitCost, l.LineProfit,
            ReturnedQuantity(returned, l.Id), l.WarehouseId?.ToString(), l.Warehouse?.Name)).ToArray(),
        d.Subtotal, d.DiscountTotal, d.TaxTotal, d.GrandTotal, d.PaidAmount,
        d.CostTotal, d.ProfitTotal, d.Currency, d.Notes,
        d.SourceDocumentId?.ToString(), d.SourceDocument?.Number);

    private static int ReturnedQuantity(
        IReadOnlyDictionary<Guid, (int Quantity, long Discount)>? returned, Guid lineId) =>
        returned is not null && returned.TryGetValue(lineId, out var r) ? r.Quantity : 0;

    public static ProductDto ToProduct(Product p) => new(
        p.Id.ToString(), p.Sku, p.Name, p.Unit, p.CostPrice, p.SalePrice, p.Currency,
        p.StockOnHand, p.ReorderLevel, p.IsActive);

    /// <param name="quantity">Stock in one warehouse; null = the product's total across warehouses.</param>
    public static InventoryItemDto ToInventoryItem(Product p, int? quantity = null)
    {
        var qty = quantity ?? p.StockOnHand;
        return new(
            p.Id.ToString(), p.Sku, p.Name, p.Unit, p.Category?.Name ?? "",
            qty, p.ReorderLevel, p.CostPrice, p.SalePrice, (long)qty * p.CostPrice, qty <= p.ReorderLevel);
    }

    public static CompanySettingsDto ToSettings(CompanySettings s) => new(
        s.CompanyName, s.Country, s.Currency,
        s.DefaultMarkupPercent, s.MinMarkupPercent, s.DefaultTaxPercent, s.TransfersRequireReceipt);

    public static PartyDto ToParty(Party p) => new(
        p.Id.ToString(), p.Name, p.Types.ToArray(), p.Phone, p.Balance, p.Currency);
}
