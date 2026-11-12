using System.Linq.Expressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
// Opens for whoever holds any of its cards; each card is computed only for its own permission
// (owner, 2026-10-23).
[AnyPermission(Permissions.DashboardKpiSales, Permissions.DashboardKpiPurchases, Permissions.DashboardKpiReceivables,
    Permissions.DashboardKpiPayables, Permissions.DashboardKpiCash, Permissions.DashboardKpiLowStock,
    Permissions.DashboardTrend, Permissions.DashboardToday, Permissions.DashboardMonth, Permissions.DashboardTopItems,
    Permissions.DashboardTopCustomers, Permissions.DashboardBranches, Permissions.DashboardRecent,
    Permissions.DashboardAccounts, Permissions.DashboardNotesDue, Permissions.DashboardAwaiting, Permissions.DashboardOverLimit,
    Permissions.DashboardLowStock, Permissions.DashboardStockValue, Permissions.DashboardProfit)]
public sealed class DashboardController : ControllerBase
{
    private const string Currency = "EGP";
    private const int TrendDays = 7;
    private const int LowStockShown = 12;
    private const int RecentShown = 8;
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly MoneyService _money;
    private readonly StockValuation _valuation;

    public DashboardController(AppDbContext db, WarehouseService warehouses, MoneyService money, StockValuation valuation)
    {
        _db = db;
        _warehouses = warehouses;
        _money = money;
        _valuation = valuation;
    }

    /// <param name="days">How many days the sales / purchases trend covers (7 by default, up to 31).</param>
    /// <param name="from">With <paramref name="to"/>: a period of company days (owner, 2026-10-02: "by
    /// day, week, month, year or the dates I want"). Revenue, purchases, the trend and the latest
    /// documents are for that period; balances, cash and low stock are as they are now.</param>
    /// <param name="branchId">Only one of the person's branches (owner, 2026-11-11: a branch, warehouse
    /// and department for the whole dashboard); with <paramref name="warehouseId"/> and
    /// <paramref name="departmentId"/> every card follows it.</param>
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Get([FromQuery] int days = TrendDays,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? branchId = null,
        [FromQuery] string? warehouseId = null, [FromQuery] string? departmentId = null)
    {
        bool Can(string p) => User.Has(p);
        var period = Period(from, to);
        if (period is { Error: true }) return BadRequest(new { message = "Choose up to ten years, the start before the end.", code = "bad_range" });
        var (scope, refused) = await ScopeAsync(branchId, warehouseId, departmentId);
        if (refused is not null) return refused;
        var s = scope!;
        var (pStart, pEnd) = period is { } pr ? CompanyClock.Days(pr.From, pr.To) : (DateTime.MinValue, DateTime.MaxValue);

        // Net of returns: sales returns reduce revenue, purchase returns reduce purchases.
        var totals = Can(Permissions.DashboardKpiSales) || Can(Permissions.DashboardKpiPurchases)
            ? await Counted(s, Docs(s).Where(d => d.Status != DocumentStatus.CANCELLED && d.IssueDate >= pStart && d.IssueDate < pEnd
                    && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN
                        || d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN)))
                .GroupBy(d => d.Type)
                .Select(g => new { Type = g.Key, Total = g.Sum(d => d.Total) })
                .ToListAsync()
            : new();
        long Total(DocumentType t) => totals.FirstOrDefault(x => x.Type == t)?.Total ?? 0;
        var revenue = Total(DocumentType.SALES_INVOICE) - Total(DocumentType.SALES_RETURN);
        var purchases = Total(DocumentType.PURCHASE_INVOICE) - Total(DocumentType.PURCHASE_RETURN);

        // Cash position: what the person's money accounts hold (cash boxes, custody, banks, wallets).
        // Money isn't kept by department: with one picked, it isn't shown.
        long? cash = Can(Permissions.DashboardKpiCash) && s.Department is null
            ? await Accounts(s).Where(a => a.IsActive).SumAsync(a => (long?)a.Balance) ?? 0
            : null;

        var (receivables, payables) = await OwedAsync(s, Can(Permissions.DashboardKpiReceivables),
            Can(Permissions.DashboardKpiPayables));

        // How many items are low, and only the few the dashboard shows (a big catalogue may have
        // thousands out of stock).
        var low = await LowAsync(s);
        var lowCount = Can(Permissions.DashboardKpiLowStock) ? await low.CountAsync() : 0;
        var lowRows = Can(Permissions.DashboardLowStock)
            ? await low.OrderBy(x => x.Qty).ThenBy(x => x.Id).Take(LowStockShown).ToListAsync()
            : new();
        var lowIds = lowRows.Select(x => x.Id).ToList();
        var lowItems = await _db.Products.AsNoTracking().Include(p => p.Size).Include(p => p.Color)
            .Where(p => lowIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var book = await PriceBook.LoadAsync(_db, lowIds);

        // Posted documents only: quotations and pending invoices move nothing.
        var recent = Array.Empty<DashDocDto>();
        if (Can(Permissions.DashboardRecent))
        {
            var docs = await WithLines(s, Docs(s))
                .Where(d => d.Type != DocumentType.QUOTATION && d.Type != DocumentType.SALES_ORDER
                            && d.IssueDate >= pStart && d.IssueDate < pEnd)
                .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.Rep)
                .Include(d => d.Department)
                .OrderByDescending(d => d.IssueDate).ThenByDescending(d => d.CreatedAt).Take(RecentShown).ToListAsync();
            var ids = docs.Select(d => d.Id).ToList();
            var places = await _db.DocumentLines.AsNoTracking().Where(l => ids.Contains(l.DocumentId) && l.WarehouseId != null)
                .Select(l => new { l.DocumentId, l.Warehouse!.Name }).Distinct().ToListAsync();
            recent = docs.Select(d => new DashDocDto(d.Id.ToString(), d.Number, d.Type.ToString(), d.Status.ToString(),
                Loc.Name(d.Branch), places.Where(p => p.DocumentId == d.Id).Select(p => Loc.Clean(p.Name) ?? p.Name)
                    .OrderBy(n => n).ToArray(),
                d.Department is null ? null : Loc.Name(d.Department), d.Party?.Name ?? "", d.Party?.Code,
                d.Staff?.FullName ?? "", d.Rep?.FullName, d.IssueDate.ToString("o"), d.CreatedAt.ToString("o"),
                d.GrandTotal, d.Currency, d.Party is null ? null : d.PartyId.ToString())).ToArray();
        }

        // Each figure only for its own permission.
        var kpis = new (string Permission, KpiDto? Kpi)[]
        {
            (Permissions.DashboardKpiSales, new KpiDto("kpi.revenue", revenue, true, Currency, "positive", null)),
            (Permissions.DashboardKpiPurchases, new KpiDto("kpi.purchases", purchases, true, Currency, "info", null)),
            (Permissions.DashboardKpiReceivables, new KpiDto("kpi.receivables", receivables, true, Currency, "positive", null)),
            (Permissions.DashboardKpiPayables, new KpiDto("kpi.payables", payables, true, Currency, "warning", null)),
            (Permissions.DashboardKpiLowStock, new KpiDto("kpi.lowStock", lowCount, false, null, lowCount > 0 ? "destructive" : "neutral", null)),
            (Permissions.DashboardKpiCash, cash is long c ? new KpiDto("kpi.cashPosition", c, true, Currency, "neutral", null) : null),
        }.Where(k => Can(k.Permission) && k.Kpi is not null).Select(k => k.Kpi!).ToArray();

        return Ok(new DashboardDto(
            kpis,
            !Can(Permissions.DashboardTrend) ? Array.Empty<TrendPointDto>()
            : period is { } tp
                ? await BuildTrendAsync(s, tp.From, tp.To)
                : await BuildTrendAsync(s, CompanyClock.Today.AddDays(-(Math.Clamp(days, 1, 31) - 1)), CompanyClock.Today),
            lowRows.Where(x => lowItems.ContainsKey(x.Id)).Select(x => Costs.Guard(User,
                Mapper.ToProduct(lowItems[x.Id], book) with { StockOnHand = x.Qty },
                ProductsController.PurchaseLevelIds(book))).ToArray(),
            recent,
            Currency));
    }

    /// <summary>
    /// More of the business at a glance: today, this month against last, the best customers and
    /// items, sales per branch, money, cheques due this week, invoices waiting for approval and
    /// customers over their limit. Each part only for those who may see it, in what they may see
    /// (owner, 2026-11-11): their branches, warehouses, departments and money accounts, and the
    /// branch, warehouse and department picked.
    /// </summary>
    /// <param name="from">With <paramref name="to"/>: a period of company days. "Today" and "this
    /// month" become that period (against the same number of days before it), the rankings are for
    /// it and the cheques are those due by its end. Money, approvals and limits are as they are now.</param>
    [HttpGet("more")]
    public async Task<ActionResult<DashboardMoreDto>> More([FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? branchId = null, [FromQuery] string? warehouseId = null, [FromQuery] string? departmentId = null)
    {
        bool Can(string p) => User.HasClaim("permission", p);
        var period = Period(from, to);
        if (period is { Error: true }) return BadRequest(new { message = "Choose up to ten years, the start before the end.", code = "bad_range" });
        var (scope, refused) = await ScopeAsync(branchId, warehouseId, departmentId);
        if (refused is not null) return refused;
        var s = scope!;
        var today = CompanyClock.Today;
        var dayStart = CompanyClock.StartOf(today);
        var dayEnd = DateTime.MaxValue;
        var monthStart = CompanyClock.StartOf(new DateOnly(today.Year, today.Month, 1));
        var monthEnd = DateTime.MaxValue;
        var lastMonthStart = CompanyClock.StartOf(new DateOnly(today.Year, today.Month, 1).AddMonths(-1));
        var notesUntil = today.AddDays(7);
        if (period is { } pr)
        {
            // The period, and as many days just before it to compare with.
            (monthStart, monthEnd) = CompanyClock.Days(pr.From, pr.To);
            lastMonthStart = CompanyClock.StartOf(pr.From.AddDays(-(pr.To.DayNumber - pr.From.DayNumber + 1)));
            (dayStart, dayEnd) = (monthStart, monthEnd);
            notesUntil = pr.To;
        }
        var salesDocs = Docs(s).Where(d => d.Status != DocumentStatus.CANCELLED
                                           && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN));
        var sales = Counted(s, salesDocs);

        DashTodayDto? todayDto = null;
        DashMonthDto? month = null;
        DashRankDto[]? topCustomers = null, topItems = null, byBranch = null;
        if (Can(Permissions.DashboardToday))
        {
            var t = await sales.Where(d => d.IssueDate >= dayStart && d.IssueDate < dayEnd).GroupBy(d => d.Type)
                .Select(g => new { g.Key, Total = g.Sum(d => d.Total), Count = g.Count() }).ToListAsync();
            var inv = t.FirstOrDefault(x => x.Key == DocumentType.SALES_INVOICE);
            var ret = t.FirstOrDefault(x => x.Key == DocumentType.SALES_RETURN);
            todayDto = new DashTodayDto((inv?.Total ?? 0) - (ret?.Total ?? 0), inv?.Count ?? 0, ret?.Total ?? 0);
        }

        if (Can(Permissions.DashboardMonth))
        {
            var m = await sales.Where(d => d.IssueDate >= lastMonthStart && d.IssueDate < monthEnd)
                .GroupBy(d => new { This = d.IssueDate >= monthStart, d.Type })
                .Select(g => new { g.Key.This, g.Key.Type, Total = g.Sum(d => d.Total), Profit = g.Sum(d => d.Profit) })
                .ToListAsync();
            long Net(bool thisMonth, bool profit = false) =>
                m.Where(x => x.This == thisMonth).Sum(x =>
                    (x.Type == DocumentType.SALES_INVOICE ? 1 : -1) * (profit ? x.Profit : x.Total));
            month = new DashMonthDto(Net(true), Net(false),
                Can(Permissions.ProfitView) ? Net(true, profit: true) : null, await ExpensesAsync(s, monthStart, monthEnd));
        }

        var monthSales = sales.Where(d => d.IssueDate >= monthStart && d.IssueDate < monthEnd);
        if (Can(Permissions.DashboardTopCustomers))
        {
            var customers = await monthSales.GroupBy(d => d.PartyId)
                .Select(g => new
                {
                    g.Key,
                    Net = g.Sum(d => d.Type == DocumentType.SALES_INVOICE ? d.Total : -d.Total),
                    Count = g.Count(d => d.Type == DocumentType.SALES_INVOICE),
                })
                .OrderByDescending(x => x.Net).Take(5).ToListAsync();
            var keys = customers.Select(c => c.Key).ToList();
            var names = await _db.Parties.Where(p => keys.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
            topCustomers = customers.Select(c => new DashRankDto(c.Key.ToString(),
                names.GetValueOrDefault(c.Key, ""), c.Net, c.Count)).ToArray();
        }

        if (Can(Permissions.DashboardTopItems))
        {
            var inPeriod = salesDocs.Where(d => d.IssueDate >= monthStart && d.IssueDate < monthEnd).Select(d => d.Id);
            var lines = _db.DocumentLines.Where(l => inPeriod.Contains(l.DocumentId));
            if (s.SalesLines is { } only) lines = lines.Where(only);
            var items = await lines
                .GroupBy(l => new { l.ProductId, l.ProductName })
                .Select(g => new
                {
                    g.Key.ProductId,
                    g.Key.ProductName,
                    Qty = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.Quantity : -l.Quantity),
                    Value = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.LineTotal : -l.LineTotal),
                })
                .OrderByDescending(x => x.Qty).Take(5).ToListAsync();
            topItems = items.Select(i => new DashRankDto(i.ProductId.ToString(), i.ProductName, i.Value, i.Qty)).ToArray();
        }

        if (Can(Permissions.DashboardBranches))
        {
            var branches = await monthSales.GroupBy(d => d.BranchId)
                .Select(g => new { g.Key, Net = g.Sum(d => d.Type == DocumentType.SALES_INVOICE ? d.Total : -d.Total) })
                .ToListAsync();
            var branchNames = await _db.Branches.ToDictionaryAsync(b => b.Id, b => Loc.Name(b));
            byBranch = branches.OrderByDescending(b => b.Net).Take(8)
                .Select(b => new DashRankDto(b.Key.ToString(), branchNames.GetValueOrDefault(b.Key, ""), b.Net)).ToArray();
        }

        // Money isn't kept by department: with one picked, the money cards aren't shown.
        DashAccountDto[]? accounts = null;
        if (Can(Permissions.DashboardAccounts) && s.Department is null)
        {
            var rows = await Accounts(s).Where(a => a.IsActive).OrderByDescending(a => a.Balance).Take(8).ToListAsync();
            accounts = rows.Select(a => new DashAccountDto(a.Id.ToString(), Loc.Name(a), a.Kind.ToString(), a.Balance)).ToArray();
        }

        // Cheques belong to a branch, not to a warehouse or a department.
        DashNotesDueDto? notes = null;
        if (Can(Permissions.DashboardNotesDue) && s.Department is null && s.Warehouse is null)
        {
            var weekEnd = CompanyClock.StartOf(notesUntil.AddDays(1));
            var q = _db.Notes.AsQueryable();
            if (s.Branches is { } nb) q = q.Where(n => nb.Contains(n.BranchId));
            var due = await q
                .Where(n => n.DueDate < weekEnd
                    && (n.Status == NoteStatus.IN_HAND || n.Status == NoteStatus.UNDER_COLLECTION || n.Status == NoteStatus.ISSUED))
                .GroupBy(n => n.Direction)
                .Select(g => new { g.Key, Count = g.Count(), Amount = g.Sum(n => n.Amount) }).ToListAsync();
            var r = due.FirstOrDefault(x => x.Key == NoteDirection.RECEIVABLE);
            var p = due.FirstOrDefault(x => x.Key == NoteDirection.PAYABLE);
            notes = new DashNotesDueDto(r?.Count ?? 0, r?.Amount ?? 0, p?.Count ?? 0, p?.Amount ?? 0);
        }

        int? awaiting = Can(Permissions.DashboardAwaiting)
            ? await WithLines(s, Docs(s)).CountAsync(d => d.Type == DocumentType.SALES_ORDER && d.Status == DocumentStatus.PENDING)
            : null;

        DashRankDto[]? overLimit = null;
        var overCount = 0;
        if (Can(Permissions.DashboardOverLimit))
        {
            var over = _db.Parties.Where(p => p.IsActive && p.CreditLimit != null && p.Balance >= p.CreditLimit);
            // Only the customers who deal in what the person sees.
            if (!s.Whole)
            {
                var theirs = WithLines(s, Docs(s)).Where(d => d.Status != DocumentStatus.CANCELLED
                    && (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_ORDER)).Select(d => d.PartyId);
                over = over.Where(p => theirs.Contains(p.Id));
            }
            overCount = await over.CountAsync();
            // What they owe and their limit only for whoever may see customers' accounts.
            var balances = Mapper.MaySeeBalance(new[] { nameof(PartyType.CUSTOMER) }, User);
            overLimit = (await over.OrderByDescending(p => p.Balance - p.CreditLimit).Take(5).ToListAsync())
                .Select(p => balances
                    ? new DashRankDto(p.Id.ToString(), p.Name, p.Balance, null, p.CreditLimit)
                    : new DashRankDto(p.Id.ToString(), p.Name, 0)).ToArray();
        }

        long? stockValue = Can(Permissions.DashboardStockValue) ? await StockValueAsync(s) : null;

        return Ok(new DashboardMoreDto(todayDto, month, topCustomers, topItems, byBranch, accounts, notes, awaiting,
            overLimit, overCount, stockValue));
    }

    // ------------------------------------------------------------------ what the dashboard counts

    /// <summary>
    /// What the dashboard counts (owner, 2026-11-11: "a person not given every department still sees
    /// the sales of all of them"): the person's branches, warehouses, departments and money accounts,
    /// narrowed by the branch, warehouse and department picked at the top.
    /// </summary>
    private sealed class Scope
    {
        /// <summary>Only these branches; null = every branch.</summary>
        public Guid[]? Branches;
        /// <summary>Only goods in these stores; null = any store of those branches.</summary>
        public Guid[]? Stores;
        /// <summary>Only these departments; null = every one.</summary>
        public Guid[]? Departments;
        /// <summary>Documents and items of no department count too (a person's own departments, not one picked).</summary>
        public bool NoDepartmentToo = true;
        public Guid? Branch, Warehouse, Department;
        /// <summary>The sales lines counted (null = all): those in the stores.</summary>
        public Expression<Func<DocumentLine, bool>>? SalesLines;
        /// <summary>The purchase lines counted (null = all): in the stores, of the departments' items.</summary>
        public Expression<Func<DocumentLine, bool>>? PurchaseLines;
        /// <summary>Nothing narrowed: the whole company.</summary>
        public bool Whole => Branches is null && Stores is null && Departments is null;
    }

    private async Task<(Scope? Scope, ActionResult? Refused)> ScopeAsync(string? branchId, string? warehouseId, string? departmentId)
    {
        var s = new Scope { Branches = Access.Branches(User), Departments = Access.Departments(User) };
        if (!string.IsNullOrWhiteSpace(branchId))
        {
            if (!Guid.TryParse(branchId, out var b) || !Access.CanUseBranch(User, b) || !await _db.Branches.AnyAsync(x => x.Id == b))
                return (null, NotFound(new { message = "Branch not found.", code = "branch_not_found" }));
            s.Branch = b;
            s.Branches = new[] { b };
        }
        if (!string.IsNullOrWhiteSpace(warehouseId))
        {
            var w = Guid.TryParse(warehouseId, out var wid)
                ? await _warehouses.Visible(User).Where(x => x.Id == wid && x.Kind == WarehouseKind.STORE)
                    .Select(x => new { x.Id, x.BranchId }).FirstOrDefaultAsync()
                : null;
            if (w is null || (s.Branch is Guid picked && w.BranchId != picked))
                return (null, NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" }));
            s.Warehouse = w.Id;
            s.Branches = new[] { w.BranchId };
            s.Stores = new[] { w.Id };
        }
        else if (Access.Warehouses(User) is not null)
        {
            var branches = s.Branches;
            s.Stores = await _warehouses.Visible(User)
                .Where(w => w.Kind == WarehouseKind.STORE && (branches == null || branches.Contains(w.BranchId)))
                .Select(w => w.Id).ToArrayAsync();
        }
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var d) || !Access.CanUseDepartment(User, d)
                || !await _db.Departments.AnyAsync(x => x.Id == d))
                return (null, NotFound(new { message = "Department not found.", code = "department_not_found" }));
            s.Department = d;
            s.Departments = new[] { d };
            s.NoDepartmentToo = false;
        }

        if (s.Stores is { } stores)
            s.SalesLines = l => l.WarehouseId != null && stores.Contains(l.WarehouseId.Value);
        s.PurchaseLines = s.SalesLines;
        if (s.Departments is { } ds)
        {
            Expression<Func<DocumentLine, bool>> ofDepartments = s.NoDepartmentToo
                ? l => l.Product!.Category!.DepartmentId == null || ds.Contains(l.Product.Category.DepartmentId.Value)
                : l => l.Product!.Category!.DepartmentId != null && ds.Contains(l.Product.Category.DepartmentId.Value);
            s.PurchaseLines = s.PurchaseLines is null ? ofDepartments : And(s.PurchaseLines, ofDepartments);
        }
        return (s, null);
    }

    /// <summary>
    /// Documents of the scope's branches; a sale, return or pending invoice of its departments (and of
    /// none, for a person's own departments). Purchases follow their lines (<see cref="WithLines"/>).
    /// </summary>
    private IQueryable<SalesDocument> Docs(Scope s)
    {
        var q = _db.SalesDocuments.AsNoTracking();
        if (s.Branches is { } b) q = q.Where(d => b.Contains(d.BranchId));
        if (s.Departments is { } ds)
            q = s.NoDepartmentToo
                ? q.Where(d => d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN
                               || d.DepartmentId == null || ds.Contains(d.DepartmentId.Value))
                : q.Where(d => d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN
                               || (d.DepartmentId != null && ds.Contains(d.DepartmentId.Value)));
        return q;
    }

    /// <summary>Only documents with goods the scope counts (in its stores; for purchases, of its departments).</summary>
    private static IQueryable<SalesDocument> WithLines(Scope s, IQueryable<SalesDocument> q)
    {
        if (s.SalesLines is null && s.PurchaseLines is null) return q;
        Expression<Func<DocumentLine, bool>> sl = s.SalesLines ?? (l => true), pl = s.PurchaseLines ?? (l => true);
        return q.Where(d => (d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN)
            ? d.Lines.AsQueryable().Any(pl)
            : d.Lines.AsQueryable().Any(sl));
    }

    /// <summary>A document as the dashboard counts it: its total and profit, or their share in the scope.</summary>
    private sealed class Worth
    {
        public Guid Id { get; set; }
        public DocumentType Type { get; set; }
        public DateTime IssueDate { get; set; }
        public Guid BranchId { get; set; }
        public Guid PartyId { get; set; }
        public long Total { get; set; }
        public long Profit { get; set; }
    }

    /// <summary>
    /// Each document's total, or — when only some of its goods are in the scope (another warehouse's,
    /// another department's on a purchase) — its share, by what those lines come to (tax and additions
    /// shared the same way); profit is then the counted lines' own.
    /// </summary>
    private static IQueryable<Worth> Counted(Scope s, IQueryable<SalesDocument> docs)
    {
        if (s.SalesLines is null && s.PurchaseLines is null)
            return docs.Select(d => new Worth
            {
                Id = d.Id, Type = d.Type, IssueDate = d.IssueDate, BranchId = d.BranchId, PartyId = d.PartyId,
                Total = d.GrandTotal, Profit = d.ProfitTotal,
            });
        Expression<Func<DocumentLine, bool>> sl = s.SalesLines ?? (l => true), pl = s.PurchaseLines ?? (l => true);
        return WithLines(s, docs).Select(d => new
            {
                d.Id, d.Type, d.IssueDate, d.BranchId, d.PartyId, d.GrandTotal, d.ProfitTotal,
                All = d.Lines.Sum(l => (long?)(l.LineTotal - l.DocDiscount)) ?? 0,
                In = (d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN
                    ? d.Lines.AsQueryable().Where(pl).Sum(l => (long?)(l.LineTotal - l.DocDiscount))
                    : d.Lines.AsQueryable().Where(sl).Sum(l => (long?)(l.LineTotal - l.DocDiscount))) ?? 0,
                InProfit = d.Lines.AsQueryable().Where(sl).Sum(l => (long?)l.LineProfit) ?? 0,
            })
            .Select(x => new Worth
            {
                Id = x.Id, Type = x.Type, IssueDate = x.IssueDate, BranchId = x.BranchId, PartyId = x.PartyId,
                Total = x.All == 0 || x.In == x.All ? x.GrandTotal : (long)Math.Round((decimal)x.GrandTotal * x.In / x.All),
                Profit = x.In == x.All ? x.ProfitTotal : x.InProfit,
            });
    }

    /// <summary>The scope's money accounts: the person's own (none if they have none), in its branches; a warehouse's own box.</summary>
    private IQueryable<MoneyAccount> Accounts(Scope s)
    {
        var q = _money.Visible(User);
        if (s.Branches is { } b) q = q.Where(a => b.Contains(a.BranchId));
        if (s.Warehouse is Guid w) q = q.Where(a => a.WarehouseId == w);
        return q;
    }

    /// <summary>
    /// Expenses paid in the period from the scope's money accounts — from its warehouses' own boxes
    /// when it has only some warehouses — and within the days of money the person may look back on.
    /// None with a department picked: expenses aren't a department's.
    /// </summary>
    private async Task<long?> ExpensesAsync(Scope s, DateTime start, DateTime end)
    {
        if (s.Department is not null) return null;
        if (Access.MoneySince(User) is DateTime since && since > start) start = since;
        var accounts = Accounts(s);
        if (s.Stores is { } stores) accounts = accounts.Where(a => a.WarehouseId != null && stores.Contains(a.WarehouseId.Value));
        var ids = accounts.Select(a => a.Id);
        return await _db.VoucherLines
            .Where(l => l.Voucher!.Type == VoucherType.EXPENSE && l.Voucher.Status == VoucherStatus.POSTED
                        && l.Voucher.CreatedAt >= start && l.Voucher.CreatedAt < end && ids.Contains(l.AccountId))
            .SumAsync(l => (long?)l.Amount) ?? 0;
    }

    /// <summary>
    /// What customers owe and what is owed to suppliers. The whole company: every party's balance. A
    /// narrower view: what is still owed on its invoices (the account settled oldest-first), their
    /// share when only some of their goods are in it.
    /// </summary>
    private async Task<(long Receivables, long Payables)> OwedAsync(Scope s, bool receivables, bool payables)
    {
        if (s.Whole)
            return (receivables ? await _db.Parties.Where(p => p.Balance > 0).SumAsync(p => (long?)p.Balance) ?? 0 : 0,
                payables ? await _db.Parties.Where(p => p.Balance < 0).SumAsync(p => (long?)-p.Balance) ?? 0 : 0);
        async Task<long> Of(DocumentType type)
        {
            var docs = Docs(s).Where(d => d.Type == type && d.Status != DocumentStatus.CANCELLED);
            var owed = await DocumentLists.OwedAsync(_db, WithLines(s, docs));
            if (owed.Count == 0) return 0;
            if (s.SalesLines is null && s.PurchaseLines is null) return owed.Values.Sum();
            var ids = owed.Keys.ToList();
            var shares = await Counted(s, _db.SalesDocuments.Where(d => ids.Contains(d.Id)))
                .Join(_db.SalesDocuments, w => w.Id, d => d.Id, (w, d) => new { w.Id, w.Total, d.GrandTotal })
                .ToListAsync();
            return shares.Sum(x => x.GrandTotal == 0 ? owed[x.Id] : (long)Math.Round((decimal)owed[x.Id] * x.Total / x.GrandTotal));
        }
        return (receivables ? await Of(DocumentType.SALES_INVOICE) : 0, payables ? await Of(DocumentType.PURCHASE_INVOICE) : 0);
    }

    private sealed class LowRow
    {
        public Guid Id { get; set; }
        public int Qty { get; set; }
    }

    /// <summary>Active items of the scope's departments at or under their reorder level, by what its stores hold.</summary>
    private async Task<IQueryable<LowRow>> LowAsync(Scope s)
    {
        var items = Products(s).Where(p => p.IsActive);
        var stores = await StoresAsync(s);
        if (stores is null)
            return items.Where(p => p.StockOnHand <= p.ReorderLevel).Select(p => new LowRow { Id = p.Id, Qty = p.StockOnHand });
        var ids = stores.ToArray();
        return items.Select(p => new
            {
                p.Id, p.ReorderLevel,
                Qty = _db.StockBalances.Where(b => b.ProductId == p.Id && ids.Contains(b.WarehouseId)).Sum(b => (int?)b.Quantity) ?? 0,
            })
            .Where(x => x.Qty <= x.ReorderLevel).Select(x => new LowRow { Id = x.Id, Qty = x.Qty });
    }

    /// <summary>What the scope's stores hold of its departments' items, at cost.</summary>
    private async Task<long> StockValueAsync(Scope s)
    {
        var stores = await StoresAsync(s);
        if (stores is null)
            return await Products(s).Where(p => p.IsActive && p.StockOnHand > 0)
                .SumAsync(p => (long?)p.StockOnHand * p.CostPrice) ?? 0;
        var state = await _valuation.CurrentAsync();
        HashSet<Guid>? items = s.Departments is null ? null : (await Products(s).Select(p => p.Id).ToListAsync()).ToHashSet();
        return state.Quantity.Where(kv => kv.Value > 0 && stores.Contains(kv.Key.Warehouse)
                                          && (items is null || items.Contains(kv.Key.Product)))
            .Sum(kv => state.ValueOf(kv.Key.Product, kv.Key.Warehouse));
    }

    /// <summary>Items of the scope's departments (and of none, for a person's own departments).</summary>
    private IQueryable<Product> Products(Scope s)
    {
        var q = _db.Products.AsNoTracking();
        if (s.Departments is not { } ds) return q;
        return s.NoDepartmentToo
            ? q.Where(p => p.Category!.DepartmentId == null || ds.Contains(p.Category.DepartmentId.Value))
            : q.Where(p => p.Category!.DepartmentId != null && ds.Contains(p.Category.DepartmentId.Value));
    }

    /// <summary>The scope's stores, or null for every one of the company (transit included).</summary>
    private async Task<HashSet<Guid>?> StoresAsync(Scope s)
    {
        if (s.Stores is { } st) return st.ToHashSet();
        if (s.Branches is not { } b) return null;
        return (await _db.Warehouses.Where(w => w.Kind == WarehouseKind.STORE && b.Contains(w.BranchId))
            .Select(w => w.Id).ToListAsync()).ToHashSet();
    }

    private static Expression<Func<T, bool>> And<T>(Expression<Func<T, bool>> a, Expression<Func<T, bool>> b)
    {
        var p = a.Parameters[0];
        var right = new Rebind(b.Parameters[0], p).Visit(b.Body);
        return Expression.Lambda<Func<T, bool>>(Expression.AndAlso(a.Body, right), p);
    }

    private sealed class Rebind(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : node;
    }

    /// <summary>
    /// A period asked for (yyyy-MM-dd company days, both or neither): null when not asked, Error
    /// when it is wrong (the end before the start, or more than ten years).
    /// </summary>
    private static (DateOnly From, DateOnly To, bool Error)? Period(string? from, string? to)
    {
        if (string.IsNullOrWhiteSpace(from) && string.IsNullOrWhiteSpace(to)) return null;
        var f = CompanyClock.ParseDay(from);
        var t = CompanyClock.ParseDay(to) ?? f;
        if (f is null || t is null || t < f || t.Value.DayNumber - f.Value.DayNumber > 3660)
            return (default, default, true);
        return (f.Value, t.Value, false);
    }

    /// <summary>
    /// Net sales and purchases between two company days: one point a day for up to 62 days, else
    /// one a month (dated its first day). Summed by the database by company day.
    /// </summary>
    private async Task<TrendPointDto[]> BuildTrendAsync(Scope s, DateOnly first, DateOnly last)
    {
        var monthly = last.DayNumber - first.DayNumber + 1 > 62;
        // A day still to come has nothing yet, so a day-by-day line stops at today. A by-month view
        // keeps the whole period — a full year shows all twelve months, the ones to come at zero.
        if (!monthly && first <= CompanyClock.Today && last > CompanyClock.Today) last = CompanyClock.Today;
        var (since, until) = CompanyClock.Days(first, last);
        var zone = CompanyClock.ZoneId;
        var rows = await Counted(s, Docs(s)
                .Where(d => d.IssueDate >= since && d.IssueDate < until && d.Status != DocumentStatus.CANCELLED &&
                            (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN ||
                             d.Type == DocumentType.PURCHASE_INVOICE || d.Type == DocumentType.PURCHASE_RETURN)))
            .Select(d => new { At = AppDbContext.LocalTime(zone, d.IssueDate), d.Type, d.Total })
            .GroupBy(d => new { d.At.Year, d.At.Month, Day = monthly ? 1 : d.At.Day, d.Type })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Type, Total = g.Sum(d => d.Total) })
            .ToListAsync();

        var buckets = new SortedDictionary<string, (long Sales, long Purchases)>(StringComparer.Ordinal);
        if (monthly)
            for (var m = new DateOnly(first.Year, first.Month, 1); m <= last; m = m.AddMonths(1))
                buckets[m.ToString("yyyy-MM-dd")] = (0, 0);
        else
            for (var d = first; d <= last; d = d.AddDays(1))
                buckets[d.ToString("yyyy-MM-dd")] = (0, 0);

        foreach (var r in rows)
        {
            var key = new DateOnly(r.Year, r.Month, r.Day).ToString("yyyy-MM-dd");
            if (!buckets.TryGetValue(key, out var b)) continue;
            buckets[key] = r.Type switch
            {
                DocumentType.SALES_INVOICE => (b.Sales + r.Total, b.Purchases),
                DocumentType.SALES_RETURN => (b.Sales - r.Total, b.Purchases),
                DocumentType.PURCHASE_INVOICE => (b.Sales, b.Purchases + r.Total),
                _ => (b.Sales, b.Purchases - r.Total),
            };
        }
        return buckets.Select(kv => new TrendPointDto(kv.Key, kv.Value.Sales, kv.Value.Purchases)).ToArray();
    }
}
