using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Hubs;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// In-app notifications (the bell), for the whole program (owner, 2026-11-12).
///
/// One place decides who is told of what: every kind is in <see cref="Kinds"/> with the permission
/// that earns it (null = it goes to one named person, e.g. the maker of an invoice). A person is
/// told only when they hold that permission, may see the place it happened in (branch, department,
/// warehouse, money account), did not do it themself, and have not switched the kind off in their
/// own preferences. Nothing is worded here: a row keeps its kind and facts (and <c>Data</c> as
/// JSON), and the app words it in the screen language.
///
/// Rows are added to the caller's unit of work (saved with the change they tell about); once saved,
/// each person told hears "look" over the live connection and the app reads its bell.
/// </summary>
public sealed class NotificationService
{
    public const string InvoiceNew = "INVOICE_NEW", OrderPending = "ORDER_PENDING",
        OrderApproved = "ORDER_APPROVED", OrderRejected = "ORDER_REJECTED",
        LimitWait = "LIMIT_WAIT", InvoiceEdited = "INVOICE_EDITED", ReturnMade = "RETURN_MADE",
        CashSent = "CASH_SENT", CashReceived = "CASH_RECEIVED", CashCancelled = "CASH_CANCELLED",
        TransferSent = "TRANSFER_SENT", TransferReceived = "TRANSFER_RECEIVED", TransferCancelled = "TRANSFER_CANCELLED",
        NoteDue = "NOTE_DUE", NoteOverdue = "NOTE_OVERDUE", NoteBounced = "NOTE_BOUNCED",
        StockOut = "STOCK_OUT", StockLow = "STOCK_LOW",
        PayrollPosted = "PAYROLL_POSTED", PayrollPaid = "PAYROLL_PAID",
        BackupFailed = "BACKUP_FAILED", UpdateAvailable = "UPDATE_AVAILABLE",
        NewSignIn = "NEW_SIGNIN", PeriodLock = "PERIOD_LOCK", YearClosed = "YEAR_CLOSED",
        DailySummary = "DAILY_SUMMARY";

    /// <summary>
    /// Every kind and the permission that earns it; null = sent to one named person (their own
    /// invoice, cash, transfer or account), whatever they hold.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string?> Kinds = new Dictionary<string, string?>
    {
        [InvoiceNew] = Permissions.SalesInvoiceAlerts,
        [InvoiceEdited] = Permissions.NotifyInvoiceEdited,
        [OrderPending] = Permissions.NotifyOrderPending,
        [LimitWait] = Permissions.NotifyLimitWait,
        [OrderApproved] = null,
        [OrderRejected] = null,
        [ReturnMade] = null,
        [CashSent] = Permissions.NotifyCashSent,
        [CashReceived] = null,
        [CashCancelled] = null,
        [TransferSent] = Permissions.NotifyTransferSent,
        [TransferReceived] = null,
        [TransferCancelled] = null,
        [NoteDue] = Permissions.NotifyCheques,
        [NoteOverdue] = Permissions.NotifyCheques,
        [NoteBounced] = Permissions.NotifyCheques,
        [StockOut] = Permissions.NotifyStock,
        [StockLow] = Permissions.NotifyStock,
        [PayrollPosted] = Permissions.NotifyPayroll,
        [PayrollPaid] = Permissions.NotifyPayroll,
        [BackupFailed] = Permissions.NotifyBackup,
        [UpdateAvailable] = Permissions.SystemUpdate,
        [NewSignIn] = null,
        [PeriodLock] = Permissions.NotifyBooks,
        [YearClosed] = Permissions.NotifyBooks,
        [DailySummary] = Permissions.NotifyDailySummary,
    };

    /// <summary>Kinds nobody can switch off: they guard the account itself.</summary>
    public static readonly IReadOnlySet<string> AlwaysOn = new HashSet<string> { NewSignIn };

    /// <summary>The person's own choices, kept with their other preferences.</summary>
    public const string PreferenceKey = "notify";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <param name="Off">Kinds the person does not want.</param>
    /// <param name="Sound">Chime when one arrives.</param>
    /// <param name="Device">Show a system notification while the app is in the background.</param>
    public sealed record Choices(string[] Off, bool Sound = true, bool Device = true)
    {
        public static readonly Choices Default = new(Array.Empty<string>());

        public static Choices Parse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return Default;
            try
            {
                var c = JsonSerializer.Deserialize<Choices>(json, Json);
                return c is null ? Default : c with { Off = c.Off ?? Array.Empty<string>() };
            }
            catch (JsonException) { return Default; }
        }
    }

    /// <summary>An active person with what they hold and what they switched off.</summary>
    public sealed record Person(Staff Staff, HashSet<string> Holds, HashSet<string> Off)
    {
        public Guid Id => Staff.Id;
        public bool InBranch(Guid branchId) =>
            AccessService.SeesAll(Staff) || Staff.BranchId == branchId || Staff.BranchIds.Contains(branchId);
        public bool InDepartment(Guid? departmentId) =>
            Staff.Role == Role.OWNER || Staff.DepartmentIds.Count == 0 || departmentId is null
            || Staff.DepartmentIds.Contains(departmentId.Value);
        public bool Uses(Warehouse w) =>
            InBranch(w.BranchId)
            && (Staff.Role == Role.OWNER || Staff.WarehouseIds.Count == 0 || Staff.WarehouseIds.Contains(w.Id));
        public bool Uses(MoneyAccount a) => AccessService.CanUseAccount(Staff, a);
    }

    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IHubContext<PresenceHub> _hub;
    private readonly HashSet<Guid> _toTell = new();
    private List<Person>? _people;

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

    // ------------------------------------------------------------------ who

    /// <summary>Everyone active, with their permissions and choices (read once per request).</summary>
    public async Task<IReadOnlyList<Person>> PeopleAsync()
    {
        if (_people is not null) return _people;
        var sets = await _permissions.RoleSetsAsync();
        var staff = await _db.Staff.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        var off = (await _db.StaffPreferences.AsNoTracking().Where(p => p.Key == PreferenceKey)
                .Select(p => new { p.StaffId, p.Value }).ToListAsync())
            .ToDictionary(p => p.StaffId, p => Choices.Parse(p.Value).Off.ToHashSet());
        return _people = staff.Select(s => new Person(s, PermissionService.Effective(s, sets).ToHashSet(),
            off.GetValueOrDefault(s.Id) ?? new HashSet<string>())).ToList();
    }

    /// <summary>The kinds a person can be sent at all (what their preferences offer).</summary>
    public static string[] Offered(IEnumerable<string> held)
    {
        var mine = held.ToHashSet();
        return Kinds.Where(k => k.Value is null || mine.Contains(k.Value)).Select(k => k.Key).ToArray();
    }

    private static bool Wants(Person p, string kind) => AlwaysOn.Contains(kind) || !p.Off.Contains(kind);

    /// <summary>Whoever earns <paramref name="kind"/>, wants it and passes <paramref name="where"/>; never the actor.</summary>
    private async Task<List<Person>> ForAsync(string kind, Guid? actor, Func<Person, bool>? where = null)
    {
        var permission = Kinds[kind] ?? throw new InvalidOperationException($"{kind} goes to one person.");
        return (await PeopleAsync())
            .Where(p => p.Id != actor && p.Holds.Contains(permission) && Wants(p, kind) && (where is null || where(p)))
            .ToList();
    }

    /// <summary>One named person (if still active and wanting it), unless they did it themself.</summary>
    private async Task<Person?> OneAsync(string kind, Guid staffId, Guid? actor)
    {
        if (staffId == actor) return null;
        var p = (await PeopleAsync()).FirstOrDefault(x => x.Id == staffId);
        return p is not null && Wants(p, kind) ? p : null;
    }

    private static Guid? IdOf(ClaimsPrincipal? actor) =>
        actor is not null && Guid.TryParse(CurrentUser.Id(actor), out var id) ? id : null;

    private static string? NameOf(ClaimsPrincipal? actor) =>
        actor is null ? null : CurrentUser.Name(actor) is { Length: > 0 } n ? n : null;

    /// <summary>The one writer: a row for <paramref name="staffId"/>, told live once saved.</summary>
    private void Add(Guid staffId, string kind, ClaimsPrincipal? actor, Guid? documentId = null, string? number = null,
        string? party = null, string? place = null, long amount = 0, string? message = null, object? data = null,
        Where? at = null)
    {
        _db.Notifications.Add(new Notification
        {
            StaffId = staffId, Kind = kind, DocumentId = documentId, DocumentNumber = number,
            BranchId = at?.Branch, DepartmentId = at?.Department, WarehouseId = at?.Warehouse,
            PartyName = party, DepartmentName = place, Amount = amount, ActorName = NameOf(actor),
            Message = string.IsNullOrWhiteSpace(message) ? null : message.Length > 300 ? message[..300] : message,
            Data = data is null ? null : JsonSerializer.Serialize(data, Json),
        });
        _toTell.Add(staffId);
    }

    /// <summary>Where it happened (kept on the row so the notifications page can be filtered by place).</summary>
    public sealed record Where(Guid? Branch, Guid? Department = null, Guid? Warehouse = null)
    {
        public static Where Of(SalesDocument d) => new(d.BranchId, d.DepartmentId);
        public static Where Of(Warehouse w) => new(w.BranchId, Warehouse: w.Id);
        public static Where Of(MoneyAccount a) => new(a.BranchId, Warehouse: a.WarehouseId);
    }

    // ------------------------------------------------------------------ sales

    /// <summary>A sale that waits over the customer's purchase limit: tell whoever may accept it (not its maker).</summary>
    public Task LimitWaitAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(LimitWait, invoice, partyName, departmentName, actor);

    /// <summary>A posted invoice was changed: tell whoever takes its payment (not who changed it).</summary>
    public Task InvoiceEditedAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(InvoiceEdited, invoice, partyName, departmentName, actor);

    /// <summary>A sales invoice was posted: tell whoever takes its payment (not its maker).</summary>
    public Task InvoiceNewAsync(SalesDocument invoice, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(InvoiceNew, invoice, partyName, departmentName, actor);

    /// <summary>A pending invoice was saved: tell whoever may approve it (not its maker).</summary>
    public Task OrderPendingAsync(SalesDocument order, string partyName, string? departmentName, ClaimsPrincipal actor) =>
        TellAsync(OrderPending, order, partyName, departmentName, actor);

    private async Task TellAsync(string kind, SalesDocument doc, string partyName, string? departmentName, ClaimsPrincipal actor)
    {
        foreach (var p in await ForAsync(kind, IdOf(actor), p => p.InBranch(doc.BranchId) && p.InDepartment(doc.DepartmentId)))
            Add(p.Id, kind, actor, doc.Id, doc.Number, partyName, departmentName, doc.GrandTotal, at: Where.Of(doc));
    }

    /// <summary>A pending invoice was approved or turned down: tell its maker.</summary>
    public async Task OrderDecidedAsync(SalesDocument order, bool approved, ClaimsPrincipal actor)
    {
        var kind = approved ? OrderApproved : OrderRejected;
        if (await OneAsync(kind, order.StaffId, IdOf(actor)) is null) return;
        var (partyName, departmentName) = await NamesAsync(order);
        Add(order.StaffId, kind, actor, order.Id, order.Number, partyName, departmentName, order.GrandTotal,
            approved ? null : order.RejectReason, at: Where.Of(order));
    }

    /// <summary>
    /// Goods of invoices came back: tell whoever made each invoice they came from (unless they took
    /// them back themself), once per person. Saved here (a return is saved before it is told of).
    /// </summary>
    public async Task ReturnMadeAsync(SalesDocument ret, ClaimsPrincipal actor)
    {
        if (ret.Type != DocumentType.SALES_RETURN) return;
        var lineIds = ret.Lines.Where(l => l.SourceLineId != null).Select(l => l.SourceLineId!.Value).ToList();
        var sourceIds = await _db.DocumentLines.AsNoTracking().Where(l => lineIds.Contains(l.Id))
            .Select(l => l.DocumentId).Distinct().ToListAsync();
        if (ret.SourceDocumentId is Guid s) sourceIds.Add(s);
        var sources = await _db.SalesDocuments.AsNoTracking()
            .Where(d => sourceIds.Contains(d.Id) && d.Type == DocumentType.SALES_INVOICE)
            .Select(d => new { d.Id, d.Number, d.StaffId }).ToListAsync();
        if (sources.Count == 0) return;
        var (partyName, departmentName) = await NamesAsync(ret);
        foreach (var source in sources.GroupBy(x => x.StaffId).Select(g => g.First()))
        {
            if (await OneAsync(ReturnMade, source.StaffId, IdOf(actor)) is null) continue;
            Add(source.StaffId, ReturnMade, actor, ret.Id, ret.Number, partyName, departmentName, ret.GrandTotal,
                data: new { invoiceId = source.Id.ToString(), invoice = source.Number }, at: Where.Of(ret));
        }
        await _db.SaveChangesAsync();
    }

    private async Task<(string Party, string? Department)> NamesAsync(SalesDocument doc)
    {
        var party = await _db.Parties.Where(p => p.Id == doc.PartyId).Select(p => p.Name).FirstOrDefaultAsync() ?? "";
        var department = doc.DepartmentId is Guid d
            ? await _db.Departments.Where(x => x.Id == d).Select(x => x.Name).FirstOrDefaultAsync()
            : null;
        return (party, department);
    }

    // ------------------------------------------------------------------ cash

    /// <summary>Cash was sent up to a box: tell whoever may confirm it there, not the sender.</summary>
    public async Task CashSentAsync(CashHandover h, MoneyAccount from, MoneyAccount to, ClaimsPrincipal actor)
    {
        foreach (var p in await ForAsync(CashSent, IdOf(actor), p => p.Uses(to)))
            Add(p.Id, CashSent, actor, h.Id, h.Number, from.Name, to.Name, h.Amount, h.Notes, at: Where.Of(to));
    }

    /// <summary>Cash sent up arrived or was called off: tell the sender (unless they did it).</summary>
    public async Task CashDoneAsync(CashHandover h, MoneyAccount from, MoneyAccount to, ClaimsPrincipal actor)
    {
        var kind = h.Status == HandoverStatus.RECEIVED ? CashReceived : CashCancelled;
        if (await OneAsync(kind, h.SentById, IdOf(actor)) is null) return;
        Add(h.SentById, kind, actor, h.Id, h.Number, from.Name, to.Name, h.Amount, h.Reason, at: Where.Of(from));
    }

    // ------------------------------------------------------------------ stock

    /// <summary>Goods wait to be received at a warehouse: tell whoever may receive them there.</summary>
    public async Task TransferSentAsync(StockTransfer t, Warehouse from, Warehouse to, ClaimsPrincipal actor)
    {
        foreach (var p in await ForAsync(TransferSent, IdOf(actor), p => p.Uses(to)))
            Add(p.Id, TransferSent, actor, t.Id, t.Number, Loc.Name(from), Loc.Name(to), message: t.Notes, at: Where.Of(to));
    }

    /// <summary>A transfer arrived or was sent back: tell whoever sent it (unless they did it).</summary>
    public async Task TransferDoneAsync(StockTransfer t, Warehouse from, Warehouse to, ClaimsPrincipal actor)
    {
        var kind = t.Status == TransferStatus.RECEIVED ? TransferReceived : TransferCancelled;
        if (await OneAsync(kind, t.CreatedById, IdOf(actor)) is null) return;
        Add(t.CreatedById, kind, actor, t.Id, t.Number, Loc.Name(from), Loc.Name(to), at: Where.Of(from));
    }

    /// <summary>
    /// After a sale or a transfer took goods out: a store that held an item and now holds none, or an
    /// item whose stock came down to its reorder level (from above it), is told to whoever follows
    /// stock and uses that store (not whoever made the sale or transfer: they see it on their screen).
    /// Told once: it can only run down again after it was restocked.
    /// </summary>
    public async Task StockAsync(InventoryService inventory, ClaimsPrincipal actor)
    {
        var changes = inventory.TakeRunDowns();
        if (changes.Count == 0) return;
        var ids = changes.Select(c => c.WarehouseId).Distinct().ToList();
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => ids.Contains(w.Id)).ToDictionaryAsync(w => w.Id);
        foreach (var c in changes)
        {
            if (!warehouses.TryGetValue(c.WarehouseId, out var w)) continue;
            var kind = c.Out ? StockOut : StockLow;
            foreach (var p in await ForAsync(kind, IdOf(actor), p => p.Uses(w)))
                Add(p.Id, kind, actor, c.Product.Id, c.Product.Sku, c.Product.Name, Loc.Name(w),
                    data: new { qty = c.Out ? c.WarehouseQty : c.Product.StockOnHand, level = c.Product.ReorderLevel },
                    at: Where.Of(w));
        }
    }

    // ------------------------------------------------------------------ cheques and notes

    /// <summary>A cheque or note bounced: tell whoever follows cheques in its branch.</summary>
    public async Task NoteBouncedAsync(Note n, ClaimsPrincipal actor)
    {
        var party = await _db.Parties.Where(p => p.Id == n.PartyId).Select(p => p.Name).FirstOrDefaultAsync();
        foreach (var p in await ForAsync(NoteBounced, IdOf(actor), p => p.InBranch(n.BranchId)))
            Add(p.Id, NoteBounced, actor, n.Id, NoteNumber(n), party, n.BankName, n.Amount, data: NoteData(n),
                at: new Where(n.BranchId));
    }

    /// <summary>
    /// Once a day: each open cheque or note due within the company's alert days is told once, and once
    /// more when its day has passed. Returns how many notes were told of.
    /// </summary>
    public async Task<int> NoteAlertsAsync()
    {
        var days = Math.Clamp(await _db.CompanySettings.Select(s => (int?)s.NoteAlertDays).FirstOrDefaultAsync() ?? 3, 0, 60);
        var today = CompanyClock.TodayDate;
        var until = today.AddDays(days);
        var notes = await _db.Notes.Include(n => n.Party)
            .Where(n => (n.Status == NoteStatus.IN_HAND || n.Status == NoteStatus.UNDER_COLLECTION || n.Status == NoteStatus.ISSUED)
                        && ((n.DueDate < today && n.AlertStage < 2) || (n.DueDate >= today && n.DueDate <= until && n.AlertStage < 1)))
            .OrderBy(n => n.DueDate).Take(500).ToListAsync();
        foreach (var n in notes)
        {
            var overdue = n.DueDate < today;
            var kind = overdue ? NoteOverdue : NoteDue;
            n.AlertStage = overdue ? 2 : 1;
            foreach (var p in await ForAsync(kind, null, p => p.InBranch(n.BranchId)))
                Add(p.Id, kind, null, n.Id, NoteNumber(n), n.Party?.Name, n.BankName, n.Amount, data: NoteData(n),
                    at: new Where(n.BranchId));
        }
        if (notes.Count > 0) await _db.SaveChangesAsync();
        return notes.Count;
    }

    private static string NoteNumber(Note n) => string.IsNullOrWhiteSpace(n.SerialNumber) ? n.Ref : n.SerialNumber;

    private static object NoteData(Note n) => new
    {
        due = n.DueDate.ToString("yyyy-MM-dd"), direction = n.Direction.ToString(), noteKind = n.Kind.ToString(), @ref = n.Ref,
    };

    // ------------------------------------------------------------------ payroll, books, server, account

    /// <summary>A month's payroll was posted or paid: tell the others who run payroll in its branch.</summary>
    public async Task PayrollAsync(PayrollRun run, bool paid, ClaimsPrincipal actor)
    {
        var kind = paid ? PayrollPaid : PayrollPosted;
        foreach (var p in await ForAsync(kind, IdOf(actor), p => run.BranchId is not Guid b || p.InBranch(b)))
            Add(p.Id, kind, actor, run.Id, run.Number, amount: paid ? run.Paid : run.Net,
                data: new { year = run.Year, month = run.Month }, at: run.BranchId is Guid rb ? new Where(rb) : null);
    }

    /// <summary>The books were locked up to a day (or opened): tell the others who work in the journal.</summary>
    public async Task PeriodLockAsync(DateTime? lockDate, ClaimsPrincipal actor)
    {
        foreach (var p in await ForAsync(PeriodLock, IdOf(actor)))
            Add(p.Id, PeriodLock, actor, data: new { date = lockDate?.ToString("yyyy-MM-dd") });
    }

    /// <summary>A year was closed: tell the others who work in the journal.</summary>
    public async Task YearClosedAsync(int year, ClaimsPrincipal actor)
    {
        foreach (var p in await ForAsync(YearClosed, IdOf(actor)))
            Add(p.Id, YearClosed, actor, number: year.ToString());
    }

    /// <summary>The automatic backup failed: tell whoever looks after backups (saved here).</summary>
    public async Task BackupFailedAsync(string? error)
    {
        foreach (var p in await ForAsync(BackupFailed, null)) Add(p.Id, BackupFailed, null, message: error);
        await _db.SaveChangesAsync();
    }

    /// <summary>A new version is out: tell whoever updates the server, once a week per count behind (saved here).</summary>
    public async Task UpdateAvailableAsync(int behind)
    {
        var since = DateTime.UtcNow.AddDays(-7);
        var told = (await _db.Notifications.AsNoTracking()
            .Where(n => n.Kind == UpdateAvailable && n.CreatedAt >= since && n.Amount == behind)
            .Select(n => n.StaffId).ToListAsync()).ToHashSet();
        foreach (var p in await ForAsync(UpdateAvailable, null, p => !told.Contains(p.Id)))
            Add(p.Id, UpdateAvailable, null, amount: behind);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// The account was signed in to from a browser or app it was not seen on (in the sign-ins kept, 30
    /// days): tell its owner (on every device of theirs). The first sign-in ever is not news. Call
    /// before the new session is added; saved with it.
    /// </summary>
    public async Task NewSignInAsync(Staff staff, SessionContext ctx)
    {
        // Version numbers change with every browser update; the browser and system stay.
        static string Shape(string? ua) => System.Text.RegularExpressions.Regex.Replace(ua ?? "", @"[\d._]+", "");
        var agent = ctx.UserAgent ?? "";
        var seen = (await _db.Sessions.AsNoTracking().Where(s => s.StaffId == staff.Id)
            .Select(s => s.UserAgent).Distinct().ToListAsync()).Select(Shape).ToHashSet();
        if (seen.Count == 0 || seen.Contains(Shape(agent))) return;
        Add(staff.Id, NewSignIn, null, message: ctx.DeviceLabel,
            data: new { device = PresenceTracker.DeviceOf(agent), ip = ctx.Ip });
    }

    // ------------------------------------------------------------------ the daily summary

    /// <summary>A person as the rest of the server sees them: the claims their token would carry.</summary>
    public static ClaimsPrincipal PrincipalOf(Staff staff, IEnumerable<string> permissions, StaffAccess access)
    {
        var claims = new List<Claim>
        {
            new("sub", staff.Id.ToString()), new("role", staff.Role.ToString()),
            new("branchId", staff.BranchId.ToString()), new("name", staff.FullName),
        };
        claims.AddRange(permissions.Select(p => new Claim("permission", p)));
        claims.AddRange(Access.Claims(access));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "summary"));
    }

    /// <summary>
    /// The day's summary for everyone given it, each within what they may see: sales and returns of
    /// their branches and departments, money taken in and spent through their accounts, what their
    /// cash boxes hold, cheques due within a week in their branches, items out or low in their stores.
    /// A part they have no permission to see is left out. Returns how many people were told.
    /// </summary>
    public async Task<int> DailySummaryAsync(DateOnly day, AccessService access, MoneyService money, WarehouseService warehouses)
    {
        var start = CompanyClock.StartOf(day);
        var end = CompanyClock.StartOf(day.AddDays(1));
        var weekEnd = CompanyClock.AsDate(CompanyClock.Today.AddDays(7));
        var told = 0;
        foreach (var p in await ForAsync(DailySummary, null))
        {
            var user = PrincipalOf(p.Staff, p.Holds, await access.ForAsync(p.Staff));
            bool Can(string permission) => p.Holds.Contains(permission);
            object? sales = null, returns = null, collected = null, expenses = null, boxes = null, cheques = null, stock = null;

            if (Can(Permissions.SalesView) || Can(Permissions.SalesReturnsView))
            {
                var docs = await _db.SalesDocuments.AsNoTracking().InBranches(user, d => d.BranchId).InDepartments(user)
                    .Where(d => d.Status != DocumentStatus.CANCELLED && d.Status != DocumentStatus.PENDING
                                && d.Status != DocumentStatus.DRAFT && d.IssueDate >= start && d.IssueDate < end
                                && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN))
                    .GroupBy(d => d.Type).Select(g => new { g.Key, Count = g.Count(), Total = g.Sum(d => d.GrandTotal) })
                    .ToListAsync();
                var inv = docs.FirstOrDefault(x => x.Key == DocumentType.SALES_INVOICE);
                var ret = docs.FirstOrDefault(x => x.Key == DocumentType.SALES_RETURN);
                if (Can(Permissions.SalesView)) sales = new { count = inv?.Count ?? 0, total = inv?.Total ?? 0 };
                if (Can(Permissions.SalesReturnsView)) returns = new { count = ret?.Count ?? 0, total = ret?.Total ?? 0 };
            }

            var mine = money.Visible(user);
            if (Can(Permissions.VouchersView))
            {
                var from = Access.MoneySince(user) is DateTime since && since > start ? since : start;
                var ids = mine.Select(a => a.Id);
                var v = _db.Vouchers.AsNoTracking()
                    .Where(x => x.Status == VoucherStatus.POSTED && x.CreatedAt >= from && x.CreatedAt < end);
                var taken = await v.Where(x => x.Type == VoucherType.RECEIPT && x.ToAccountId != null && ids.Contains(x.ToAccountId.Value))
                    .GroupBy(x => 1).Select(g => new { Count = g.Count(), Total = g.Sum(x => x.Amount) }).FirstOrDefaultAsync();
                var spent = await v.Where(x => x.Type == VoucherType.EXPENSE && x.FromAccountId != null && ids.Contains(x.FromAccountId.Value))
                    .GroupBy(x => 1).Select(g => new { Count = g.Count(), Total = g.Sum(x => x.Amount) }).FirstOrDefaultAsync();
                collected = new { count = taken?.Count ?? 0, total = taken?.Total ?? 0 };
                expenses = new { count = spent?.Count ?? 0, total = spent?.Total ?? 0 };
            }
            if (Can(Permissions.MoneyAccounts))
                boxes = (await mine.AsNoTracking().Where(a => a.IsActive && a.Kind == MoneyAccountKind.CASH_BOX)
                        .OrderByDescending(a => a.Balance).Take(12).ToListAsync())
                    .Select(a => new { name = Loc.Name(a), balance = a.Balance }).ToArray();

            if (Can(Permissions.NotesViewReceivable) || Can(Permissions.NotesViewPayable))
            {
                var due = await _db.Notes.AsNoTracking().InBranches(user, n => n.BranchId)
                    .Where(n => n.DueDate <= weekEnd
                                && (n.Status == NoteStatus.IN_HAND || n.Status == NoteStatus.UNDER_COLLECTION || n.Status == NoteStatus.ISSUED))
                    .GroupBy(n => n.Direction).Select(g => new { g.Key, Count = g.Count(), Total = g.Sum(n => n.Amount) })
                    .ToListAsync();
                var r = due.FirstOrDefault(x => x.Key == NoteDirection.RECEIVABLE);
                var pay = due.FirstOrDefault(x => x.Key == NoteDirection.PAYABLE);
                cheques = new
                {
                    receivable = Can(Permissions.NotesViewReceivable) ? new { count = r?.Count ?? 0, total = r?.Total ?? 0 } : null,
                    payable = Can(Permissions.NotesViewPayable) ? new { count = pay?.Count ?? 0, total = pay?.Total ?? 0 } : null,
                };
            }

            if (Can(Permissions.InventoryView))
            {
                var limit = await warehouses.LimitAsync(user);
                var items = _db.Products.AsNoTracking().Where(x => x.IsActive);
                int outOf, low;
                if (limit is null)
                {
                    outOf = await items.CountAsync(x => x.StockOnHand <= 0);
                    low = await items.CountAsync(x => x.StockOnHand > 0 && x.ReorderLevel > 0 && x.StockOnHand <= x.ReorderLevel);
                }
                else
                {
                    var stores = limit.ToArray();
                    var held = items.Select(x => new
                    {
                        x.ReorderLevel,
                        Qty = _db.StockBalances.Where(b => b.ProductId == x.Id && stores.Contains(b.WarehouseId)).Sum(b => (int?)b.Quantity) ?? 0,
                    });
                    outOf = await held.CountAsync(x => x.Qty <= 0);
                    low = await held.CountAsync(x => x.Qty > 0 && x.ReorderLevel > 0 && x.Qty <= x.ReorderLevel);
                }
                stock = new { @out = outOf, low };
            }

            Add(p.Id, DailySummary, null, number: day.ToString("yyyy-MM-dd"),
                data: new { day = day.ToString("yyyy-MM-dd"), sales, returns, collected, expenses, boxes, cheques, stock });
            told++;
        }
        await _db.SaveChangesAsync();
        return told;
    }
}
