using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Hubs;
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
        OrderApproved = "ORDER_APPROVED", OrderRejected = "ORDER_REJECTED",
        LimitWait = "LIMIT_WAIT", InvoiceEdited = "INVOICE_EDITED",
        CashSent = "CASH_SENT", CashReceived = "CASH_RECEIVED", CashCancelled = "CASH_CANCELLED";

    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IHubContext<PresenceHub> _hub;
    private readonly HashSet<Guid> _toTell = new();

    public NotificationService(AppDbContext db, PermissionService permissions, IHubContext<PresenceHub> hub)
    {
        _db = db;
        _permissions = permissions;
        _hub = hub;
        // Once saved, each person told is told at once over the live connection (owner, 2026-10-02:
        // "the notification doesn't come"); the app then reads its bell. Nothing but "look" is sent.
        _db.SavedChanges += (_, _) =>
        {
            if (_toTell.Count == 0) return;
            var groups = _toTell.Select(PresenceHub.StaffGroup).ToList();
            _toTell.Clear();
            _ = _hub.Clients.Groups(groups).SendAsync("notify");
        };
    }

    /// <summary>
    /// A sale that waits over the customer's purchase limit (new or changed): tell whoever may accept
    /// it (not its maker).
    /// </summary>
    public Task LimitWaitAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(Permissions.SalesApprove, LimitWait, invoice, partyName, departmentName, actor);

    /// <summary>A posted invoice was changed: tell whoever takes its payment (not who changed it).</summary>
    public Task InvoiceEditedAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(Permissions.SalesInvoiceAlerts, InvoiceEdited, invoice, partyName, departmentName, actor);

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

    /// <summary>
    /// Cash was sent up to a box: tell whoever may confirm it there (owner, 2026-10-02: "the manager
    /// marks it done when it arrives"), not the sender.
    /// </summary>
    public async Task CashSentAsync(CashHandover h, MoneyAccount from, MoneyAccount to, ClaimsPrincipal actor)
    {
        var sets = await _permissions.RoleSetsAsync();
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        var me = CurrentUser.Id(actor);
        foreach (var s in staff)
        {
            if (s.Id.ToString() == me) continue;
            if (!PermissionService.Effective(s, sets).Contains(Permissions.CashHandoverReceive)) continue;
            if (AccessService.CanUseAccount(s, to)) AddCash(s.Id, CashSent, h, from, to, actor, h.Notes);
        }
    }

    /// <summary>Cash sent up arrived or was called off: tell the sender (unless they did it).</summary>
    public void CashDone(CashHandover h, MoneyAccount from, MoneyAccount to, ClaimsPrincipal actor)
    {
        if (h.SentById.ToString() == CurrentUser.Id(actor)) return;
        AddCash(h.SentById, h.Status == HandoverStatus.RECEIVED ? CashReceived : CashCancelled, h, from, to, actor, h.Reason);
    }

    private void AddCash(Guid staffId, string kind, CashHandover h, MoneyAccount from, MoneyAccount to,
        ClaimsPrincipal actor, string? message)
    {
        _db.Notifications.Add(new Notification
        {
            StaffId = staffId, Kind = kind, DocumentId = h.Id, DocumentNumber = h.Number,
            PartyName = from.Name, DepartmentName = to.Name, Amount = h.Amount,
            ActorName = CurrentUser.Name(actor), Message = message,
        });
        _toTell.Add(staffId);
    }

    private void Add(Guid staffId, string kind, SalesDocument doc, string partyName, string? departmentName,
        ClaimsPrincipal actor, string? message)
    {
        _db.Notifications.Add(new Notification
        {
            StaffId = staffId, Kind = kind, DocumentId = doc.Id, DocumentNumber = doc.Number,
            PartyName = partyName, DepartmentName = departmentName, Amount = doc.GrandTotal,
            ActorName = CurrentUser.Name(actor), Message = message,
        });
        _toTell.Add(staffId);
    }
}
