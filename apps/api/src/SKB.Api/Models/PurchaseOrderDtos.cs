namespace SKB.Api.Models;

// ---- Purchase orders to a factory (أوامر الشراء, owner 2026-11-18) ----

/// <summary>
/// One line to order: an item in the catalog (<paramref name="ProductId"/>), or a new one named here
/// (<paramref name="Name"/>, with its department, group, size and colour if wanted).
/// </summary>
/// <param name="UnitId">The unit ordered in (an item's own unit; any unit for a new item); none = pieces.</param>
/// <param name="UnitPrice">The price expected for one unit (minor units); 0 = not known yet.</param>
public record PurchaseOrderLineRequest(
    string? ProductId, string? Name, int Quantity, long UnitPrice = 0, string? UnitId = null,
    string? DepartmentId = null, string? GroupId = null, string? SizeId = null, string? ColorId = null,
    string? SupplierCode = null);

/// <param name="WarehouseId">The store to receive into; none = the working branch's default one.</param>
/// <param name="OrderDate">yyyy-MM-dd; none = today (the company's day).</param>
public record SavePurchaseOrderRequest(
    string PartyId, PurchaseOrderLineRequest[] Lines, string? WarehouseId = null, string? DepartmentId = null,
    string? OrderDate = null, string? ExpectedDate = null, string? Notes = null);

public record PurchaseOrderLineDto(
    string Id, int LineNo, string? ProductId, string? Sku, string Name, bool IsNew, string? SupplierCode,
    string? DepartmentId, string? DepartmentName, string? GroupId, string? GroupName,
    string? SizeId, string? SizeName, string? ColorId, string? ColorName,
    string? UnitId, string? UnitName, int UnitFactor, int Quantity, long UnitPrice, long LineTotal,
    int Pieces, int ReceivedPieces);

/// <summary>A purchase invoice that received goods of the order.</summary>
public record PurchaseOrderReceiptDto(string DocumentId, string Number, string Date, int Pieces);

/// <param name="CanEdit">Whether it can still be changed (draft or sent, nothing received).</param>
public record PurchaseOrderDto(
    string Id, string Number, string Status, string PartyId, string PartyName, int PartyCode, string? PartyPhone,
    string BranchId, string BranchName, string WarehouseId, string WarehouseName,
    string? DepartmentId, string? DepartmentName, string OrderDate, string? ExpectedDate, string? Notes,
    string CreatedByName, string CreatedAt, string? SentAt, string? CancelledAt, string? CancelledByName,
    PurchaseOrderLineDto[] Lines, PurchaseOrderReceiptDto[] Receipts,
    int Pieces, int ReceivedPieces, long Total, string Currency, bool CanEdit, bool CanReceive, bool CanCancel);

public record PurchaseOrderSummaryDto(
    string Id, string Number, string Status, string PartyId, string PartyName, int PartyCode,
    string BranchName, string WarehouseName, string? DepartmentName, string OrderDate, string? ExpectedDate,
    int Lines, int NewItems, int Pieces, int ReceivedPieces, long Total, string CreatedByName, string? Notes);

public record PurchaseOrderListDto(
    PurchaseOrderSummaryDto[] Items, int Total, int Page, int PageSize, long Amount, int Pieces, string Currency);

/// <summary>An item the supplier's suggestions offer for an order, with the quantity to buy.</summary>
public record PurchaseOrderSuggestionDto(
    string ProductId, string Sku, string Name, string? Department, long Stock, long SoldQty, decimal? DaysLeft,
    int ReorderLevel, long Suggested, long Cost);
