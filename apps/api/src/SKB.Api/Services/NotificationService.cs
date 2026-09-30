using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// In-app notifications (the bell). Owner decision 2026-09-30: a sales invoice posts at once and
/// everyone who takes payments for it (sales:invoice_alerts, working in its branch and department)
/// is told the customer and department. A pending invoice, where someone is still asked to save
/// one, reaches whoever may approve it, and its maker hears the outcome. Written in the same
/// transaction as the change they tell about; the app polls for them.
/// </summary>
public sealed class NotificationService
{
    public const string InvoiceNew = "INVOICE_NEW", OrderPending = "ORDER_PENDING",
        OrderApproved = "ORDER_APPROVED", OrderRejected = "ORDER_REJECTED";

    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;

    public NotificationService(AppDbContext db, PermissionService permissions)
    {
        _db = db;
        _permissions = permissions;
    }

    /// <summary>A sales invoice was posted: tell whoever takes its payment (not its maker).</summary>
    public Task InvoiceNewAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(Permissions.SalesInvoiceAlerts, InvoiceNew, invoice, partyName, departmentName, actor);

    /// <summary>A pending invoice was saved: tell whoever may approve it (not its maker).</summary>
    public Task OrderPendingAsync(SalesDocument order, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(Permissions.SalesApprove, OrderPending, order, partyName, departmentName, actor);

    /// <summary>Everyone active with <paramref name="permission"/> in the document's branch and department.</summary>
    private async Task TellAsync(string permission, string kind, SalesDocument doc, string partyName,
        string? departmentName, ClaimsPrincipal actor)
    {
        var sets = await _permissions.RoleSetsAsync();
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        var me = CurrentUser.Id(actor);
        foreach (var s in staff)
        {
            if (s.Id.ToString() == me) continue;
            if (!PermissionService.Effective(s, sets).Contains(permission)) continue;
            var inBranch = AccessService.SeesAll(s) || s.BranchId == doc.BranchId || s.BranchIds.Contains(doc.BranchId);
            var inDepartment = s.Role == Role.OWNER || s.DepartmentIds.Count == 0 || doc.DepartmentId is null
                               || s.DepartmentIds.Contains(doc.DepartmentId.Value);
            if (inBranch && inDepartment) Add(s.Id, kind, doc, partyName, departmentName, actor, null);
        }
    }

    /// <summary>A pending invoice was approved or turned down: tell its maker.</summary>
    public async Task OrderDecidedAsync(SalesDocument order, bool approved, ClaimsPrincipal actor)
    {
        if (order.StaffId.ToString() == CurrentUser.Id(actor)) return;
        var partyName = await _db.Parties.Where(p => p.Id == order.PartyId).Select(p => p.Name).FirstOrDefaultAsync() ?? "";
        var departmentName = order.DepartmentId is Guid d
            ? await _db.Departments.Where(x => x.Id == d).Select(x => x.Name).FirstOrDefaultAsync()
            : null;
        Add(order.StaffId, approved ? OrderApproved : OrderRejected, order, partyName, departmentName, actor,
            approved ? null : order.RejectReason);
    }

    private void Add(Guid staffId, string kind, SalesDocument doc, string partyName, string? departmentName,
        ClaimsPrincipal actor, string? message) =>
        _db.Notifications.Add(new Notification
        {
            StaffId = staffId, Kind = kind, DocumentId = doc.Id, DocumentNumber = doc.Number,
            PartyName = partyName, DepartmentName = departmentName, Amount = doc.GrandTotal,
            ActorName = CurrentUser.Name(actor), Message = message,
        });
}
