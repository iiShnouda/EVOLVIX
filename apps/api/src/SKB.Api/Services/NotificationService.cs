using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// In-app notifications (the bell). Owner decision 2026-09-30: a new pending invoice reaches every
/// active person who may approve it (sales:approve, and who works in its branch and department);
/// its maker hears when it is approved or turned down. Written in the same transaction as the
/// change they tell about; the app polls for them.
/// </summary>
public sealed class NotificationService
{
    public const string OrderPending = "ORDER_PENDING", OrderApproved = "ORDER_APPROVED", OrderRejected = "ORDER_REJECTED";

    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;

    public NotificationService(AppDbContext db, PermissionService permissions)
    {
        _db = db;
        _permissions = permissions;
    }

    /// <summary>A pending invoice was saved: tell whoever may approve it (not its maker).</summary>
    public async Task OrderPendingAsync(SalesDocument order, string partyName, ClaimsPrincipal actor)
    {
        var sets = await _permissions.RoleSetsAsync();
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        var me = CurrentUser.Id(actor);
        foreach (var s in staff)
        {
            if (s.Id.ToString() == me) continue;
            if (!PermissionService.Effective(s, sets).Contains(Permissions.SalesApprove)) continue;
            var inBranch = AccessService.SeesAll(s) || s.BranchId == order.BranchId || s.BranchIds.Contains(order.BranchId);
            var inDepartment = s.Role == Role.OWNER || s.DepartmentIds.Count == 0 || order.DepartmentId is null
                               || s.DepartmentIds.Contains(order.DepartmentId.Value);
            if (inBranch && inDepartment) Add(s.Id, OrderPending, order, partyName, actor, null);
        }
    }

    /// <summary>A pending invoice was approved or turned down: tell its maker.</summary>
    public async Task OrderDecidedAsync(SalesDocument order, bool approved, ClaimsPrincipal actor)
    {
        if (order.StaffId.ToString() == CurrentUser.Id(actor)) return;
        var partyName = await _db.Parties.Where(p => p.Id == order.PartyId).Select(p => p.Name).FirstOrDefaultAsync() ?? "";
        Add(order.StaffId, approved ? OrderApproved : OrderRejected, order, partyName, actor,
            approved ? null : order.RejectReason);
    }

    private void Add(Guid staffId, string kind, SalesDocument order, string partyName, ClaimsPrincipal actor, string? message) =>
        _db.Notifications.Add(new Notification
        {
            StaffId = staffId, Kind = kind, DocumentId = order.Id, DocumentNumber = order.Number,
            PartyName = partyName, Amount = order.GrandTotal, ActorName = CurrentUser.Name(actor), Message = message,
        });
}
