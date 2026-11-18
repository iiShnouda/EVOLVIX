using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Purchase orders to a factory (owner, 2026-11-18): who sees which, how one maps for the app, and how
/// a purchase invoice made from one records what it received. An order itself moves no stock, money
/// or ledger: only the purchase invoice does, as any other.
/// </summary>
public static class PurchaseOrders
{
    public sealed record OrderError(string Code, string Message, int Status = 400);

    /// <summary>Orders of the person's branches, warehouses and departments.</summary>
    public static IQueryable<PurchaseOrder> Visible(this IQueryable<PurchaseOrder> q, ClaimsPrincipal u)
    {
        q = q.InBranches(u, o => o.BranchId);
        if (Access.Warehouses(u) is { } only) q = q.Where(o => only.Contains(o.WarehouseId));
        if (Access.Departments(u) is { } mine)
            q = q.Where(o => o.DepartmentId == null || mine.Contains(o.DepartmentId.Value));
        return q;
    }

    /// <summary>Changed only before anything of it was received.</summary>
    public static bool Editable(PurchaseOrder o) =>
        o.Status is PurchaseOrderStatus.DRAFT or PurchaseOrderStatus.SENT && o.Lines.All(l => l.ReceivedPieces == 0);

    public static bool Open(PurchaseOrder o) =>
        o.Status is PurchaseOrderStatus.DRAFT or PurchaseOrderStatus.SENT or PurchaseOrderStatus.PARTLY_RECEIVED;

    /// <summary>
    /// A purchase invoice receives goods of an order: each of its lines that names an order line adds
    /// its pieces to what that line received (a new item's line takes the item made for it), the order
    /// becomes partly or fully received, and the invoice is kept among its receipts. Called inside the
    /// invoice's transaction; the order row is locked so two receipts at once add up.
    /// </summary>
    public static async Task<(PurchaseOrder? Order, OrderError? Error)> ReceiveAsync(AppDbContext db, ClaimsPrincipal user,
        string? orderId, Guid partyId, Guid branchId, SalesDocument doc,
        IReadOnlyList<(string? OrderLineId, Guid ProductId, int Pieces)> lines)
    {
        if (string.IsNullOrWhiteSpace(orderId))
            return lines.Any(l => !string.IsNullOrWhiteSpace(l.OrderLineId))
                ? (null, new("order_not_found", "Purchase order not found.", 404))
                : (null, null);
        if (!user.Has(Permissions.PurchaseOrdersReceive))
            return (null, new("forbidden", "Receiving a purchase order needs permission.", 403));
        if (!Guid.TryParse(orderId, out var id))
            return (null, new("order_not_found", "Purchase order not found.", 404));
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"PurchaseOrders\" WHERE \"Id\" = {id} FOR UPDATE");
        var order = await db.PurchaseOrders.Visible(user).Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return (null, new("order_not_found", "Purchase order not found.", 404));
        if (!Open(order))
            return (null, new("order_closed", $"Order {order.Number} is already received or cancelled.", 409));
        if (order.PartyId != partyId)
            return (null, new("order_other_supplier", $"Order {order.Number} is to another supplier."));
        if (order.BranchId != branchId)
            return (null, new("order_other_branch", $"Order {order.Number} is of another branch: work in its branch to receive it."));

        var received = 0;
        foreach (var (lineId, productId, pieces) in lines)
        {
            if (string.IsNullOrWhiteSpace(lineId)) continue;
            var line = Guid.TryParse(lineId, out var lid) ? order.Lines.FirstOrDefault(l => l.Id == lid) : null;
            if (line is null) return (null, new("order_line_not_found", "A line is not on the order."));
            if (line.ProductId is Guid ordered && ordered != productId)
                return (null, new("order_line_other_item", $"{line.Name}: another item was ordered on this line."));
            line.ProductId ??= productId;
            line.ReceivedPieces += pieces;
            received += pieces;
        }
        if (received == 0) return (null, new("order_nothing_received", "Nothing on the invoice is from the order."));
        order.Status = order.Lines.All(l => l.ReceivedPieces >= l.Quantity * l.UnitFactor)
            ? PurchaseOrderStatus.RECEIVED
            : PurchaseOrderStatus.PARTLY_RECEIVED;
        order.UpdatedAt = DateTime.UtcNow;
        db.PurchaseOrderReceipts.Add(new PurchaseOrderReceipt { OrderId = order.Id, DocumentId = doc.Id, Pieces = received });
        return (order, null);
    }

    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    /// <summary>An order with its lines, receipts and who did what, as the app shows it.</summary>
    public static async Task<PurchaseOrderDto> DetailAsync(AppDbContext db, ClaimsPrincipal user, Guid id)
    {
        var o = await db.PurchaseOrders.AsNoTracking()
            .Include(x => x.Party).Include(x => x.Branch).Include(x => x.Warehouse).Include(x => x.Department)
            .Include(x => x.CreatedBy).Include(x => x.CancelledBy)
            .Include(x => x.Lines).ThenInclude(l => l.Product)
            .Include(x => x.Receipts).ThenInclude(r => r.Document)
            .AsSplitQuery().FirstAsync(x => x.Id == id);
        var lines = o.Lines.OrderBy(l => l.LineNo).ToList();
        var depIds = lines.Where(l => l.DepartmentId != null).Select(l => l.DepartmentId!.Value).ToList();
        var departments = await db.Departments.AsNoTracking().Where(d => depIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => Loc.Name(d));
        var groupIds = lines.Where(l => l.GroupId != null).Select(l => l.GroupId!.Value).ToList();
        var groups = await db.Categories.AsNoTracking().Where(c => groupIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => Loc.Name(c));
        var optionIds = lines.SelectMany(l => new[] { l.SizeId, l.ColorId }).OfType<Guid>().ToList();
        var options = await db.VariantOptions.AsNoTracking().Where(v => optionIds.Contains(v.Id))
            .ToDictionaryAsync(v => v.Id, v => Loc.Name(v));
        var unitIds = lines.Where(l => l.UnitId != null).Select(l => l.UnitId!.Value).ToList();
        var units = await db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => Loc.Name(u));
        var currency = await db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        string? Of(Dictionary<Guid, string> d, Guid? k) => k is Guid g ? d.GetValueOrDefault(g) : null;

        var dtoLines = lines.Select(l => new PurchaseOrderLineDto(l.Id.ToString(), l.LineNo, l.ProductId?.ToString(),
            l.Product?.Sku, l.IsNew || l.Product is null ? l.Name : Loc.Name(l.Product), l.IsNew, l.SupplierCode,
            l.DepartmentId?.ToString(), Of(departments, l.DepartmentId), l.GroupId?.ToString(), Of(groups, l.GroupId),
            l.SizeId?.ToString(), Of(options, l.SizeId), l.ColorId?.ToString(), Of(options, l.ColorId),
            l.UnitId?.ToString(), Of(units, l.UnitId), l.UnitFactor, l.Quantity, l.UnitPrice,
            (long)l.Quantity * l.UnitPrice, l.Quantity * l.UnitFactor, l.ReceivedPieces)).ToArray();
        var receipts = o.Receipts.OrderBy(r => r.CreatedAt).Select(r => new PurchaseOrderReceiptDto(
            r.DocumentId.ToString(), r.Document?.Number ?? "", Day(CompanyClock.DayOf(r.CreatedAt)), r.Pieces)).ToArray();
        var open = Open(o);
        return new PurchaseOrderDto(o.Id.ToString(), o.Number, o.Status.ToString(), o.PartyId.ToString(),
            o.Party?.Name ?? "", o.Party?.Code ?? 0, o.Party?.Phone, o.BranchId.ToString(), Loc.Name(o.Branch),
            o.WarehouseId.ToString(), Loc.Name(o.Warehouse), o.DepartmentId?.ToString(),
            o.Department is null ? null : Loc.Name(o.Department), Day(o.OrderDate),
            o.ExpectedDate is DateOnly e ? Day(e) : null, o.Notes, o.CreatedBy?.FullName ?? "",
            o.CreatedAt.ToString("O"), o.SentAt?.ToString("O"), o.CancelledAt?.ToString("O"), o.CancelledBy?.FullName,
            dtoLines, receipts, dtoLines.Sum(l => l.Pieces), dtoLines.Sum(l => l.ReceivedPieces),
            dtoLines.Sum(l => l.LineTotal), currency,
            Editable(o) && user.Has(Permissions.PurchaseOrdersEdit),
            open && user.Has(Permissions.PurchaseOrdersReceive) && user.Has(Permissions.PurchasesCreate),
            open && user.Has(Permissions.PurchaseOrdersCancel));
    }
}
