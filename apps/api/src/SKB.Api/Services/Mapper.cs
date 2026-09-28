using SKB.Api.Data;
using SKB.Api.Models;

namespace SKB.Api.Services;

public static class Mapper
{
    public static SalesSummaryDto ToSummary(SalesDocument d) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        d.Branch?.Name ?? "", d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"), d.GrandTotal, d.PaidAmount, d.Currency);

    public static SalesDetailDto ToDetail(SalesDocument d) => new(
        d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
        d.Branch?.Name ?? "", d.Party?.Name ?? "", d.Staff?.FullName ?? "",
        d.IssueDate.ToString("o"), d.DueDate?.ToString("o"),
        d.Lines.Select(l => new DocumentLineDto(
            l.Id.ToString(), l.ProductId.ToString(), l.ProductName, l.Quantity,
            l.UnitPrice, l.Discount, l.LineTotal)).ToArray(),
        d.Subtotal, d.DiscountTotal, d.TaxTotal, d.GrandTotal, d.PaidAmount, d.Currency, d.Notes);

    public static ProductDto ToProduct(Product p) => new(
        p.Id.ToString(), p.Sku, p.Name, p.Unit, p.CostPrice, p.SalePrice, p.Currency,
        p.StockOnHand, p.ReorderLevel, p.IsActive);

    public static PartyDto ToParty(Party p) => new(
        p.Id.ToString(), p.Name, p.Types.ToArray(), p.Phone, p.Balance, p.Currency);
}
