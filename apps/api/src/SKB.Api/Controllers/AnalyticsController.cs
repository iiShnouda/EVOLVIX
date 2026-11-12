using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Analytics (التحليلات — ROADMAP §2.6): net monthly sales, top customers / suppliers, top-moving
/// items and dead stock. Read-only queries over the documents; "net" means after returns and
/// discounts, before tax. Branch-scoped users see their branch.
/// </summary>
[ApiController]
[Route("api/analytics")]
[Authorize]
public sealed class AnalyticsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly StockValuation _valuation;

    public AnalyticsController(AppDbContext db, WarehouseService warehouses, StockValuation valuation)
    {
        _db = db;
        _warehouses = warehouses;
        _valuation = valuation;
    }

    private static readonly DocumentType[] SalesTypes = { DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN };
    private static readonly DocumentType[] PurchaseTypes = { DocumentType.PURCHASE_INVOICE, DocumentType.PURCHASE_RETURN };

    /// <summary>
    /// Net sales and purchases for each of the last <paramref name="months"/> months, or with
    /// <paramref name="by"/> = "year" each of the last <paramref name="years"/> years (the company's
    /// months and years). Each row's key is "yyyy-MM" or "yyyy".
    /// </summary>
    [HttpGet("monthly")]
    [Authorize(Policy = Permissions.ReportsMonthly)]
    public async Task<ActionResult<MonthlySalesDto[]>> Monthly([FromQuery] int months = 12, [FromQuery] string? by = null,
        [FromQuery] int years = 5)
    {
        var yearly = string.Equals(by, "year", StringComparison.OrdinalIgnoreCase);
        var today = CompanyClock.Today;
        var first = yearly
            ? new DateOnly(today.Year - (Math.Clamp(years, 1, 15) - 1), 1, 1)
            : new DateOnly(today.Year, today.Month, 1).AddMonths(-(Math.Clamp(months, 1, 60) - 1));
        var since = CompanyClock.StartOf(first);
        var zone = CompanyClock.ZoneId;
        var rows = await Docs().Where(d => d.IssueDate >= since)
            .Select(d => new { At = AppDbContext.LocalTime(zone, d.IssueDate), d.Type, d.Subtotal, d.DiscountTotal })
            .GroupBy(d => new { d.At.Year, Month = yearly ? 1 : d.At.Month, d.Type })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Type, Net = g.Sum(d => d.Subtotal - d.DiscountTotal), Count = g.Count() })
            .ToListAsync();
        var result = new List<MonthlySalesDto>();
        for (var m = first; m <= today; m = yearly ? m.AddYears(1) : m.AddMonths(1))
        {
            var period = rows.Where(r => r.Year == m.Year && (yearly || r.Month == m.Month)).ToList();
            long Sum(DocumentType t) => period.Where(r => r.Type == t).Sum(r => r.Net);
            var sales = Sum(DocumentType.SALES_INVOICE);
            var returns = Sum(DocumentType.SALES_RETURN);
            result.Add(new MonthlySalesDto(m.ToString(yearly ? "yyyy" : "yyyy-MM"), sales, returns, sales - returns,
                Sum(DocumentType.PURCHASE_INVOICE) - Sum(DocumentType.PURCHASE_RETURN),
                period.Where(r => r.Type == DocumentType.SALES_INVOICE).Sum(r => r.Count)));
        }
        return Ok(result.ToArray());
    }

    /// <summary>
    /// Gains, losses and net profit for a period: the company, each branch and each warehouse, and the
    /// general expenses paid from the main cash box (see <see cref="ProfitLoss"/>). Profit is for
    /// people who may see costs.
    /// </summary>
    [HttpGet("profit-loss")]
    [AnyPermission(Permissions.ReportsPl, Permissions.DashboardProfit)]
    public async Task<ActionResult<ProfitLossDto>> ProfitAndLoss([FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? branchId = null, [FromQuery] string? warehouseId = null, [FromQuery] string? departmentId = null)
    {
        // A report of profit and loss: its own permission is enough (owner, 2026-10-23).
        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, today.Month, 1);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        if (toDay < fromDay || toDay.DayNumber - fromDay.DayNumber > 5 * 366)
            return BadRequest(new { message = "Choose up to five years, the start before the end.", code = "bad_range" });
        Guid? branch = null;
        if (!string.IsNullOrEmpty(branchId))
        {
            if (!Guid.TryParse(branchId, out var b) || !Access.CanUseBranch(User, b))
                return NotFound(new { message = "Branch not found.", code = "branch_not_found" });
            branch = b;
        }
        // One warehouse or one department of the person's (owner, 2026-11-11: the dashboard's picks).
        Guid? warehouse = null, department = null;
        if (!string.IsNullOrEmpty(warehouseId))
        {
            if (!Guid.TryParse(warehouseId, out var w) || !await _warehouses.Visible(User)
                    .AnyAsync(x => x.Id == w && x.Kind == WarehouseKind.STORE && (branch == null || x.BranchId == branch)))
                return NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" });
            warehouse = w;
        }
        if (!string.IsNullOrEmpty(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var d) || !Access.CanUseDepartment(User, d)
                || !await _db.Departments.AnyAsync(x => x.Id == d))
                return NotFound(new { message = "Department not found.", code = "department_not_found" });
            department = d;
        }
        return Ok(await ProfitLoss.BuildAsync(_db, User, fromDay, toDay, branch, warehouse, department));
    }

    /// <summary>The customers (or suppliers) with the most net business in a period.</summary>
    [HttpGet("top-parties")]
    [Authorize(Policy = Permissions.ReportsParties)]
    public async Task<ActionResult<TopPartyDto[]>> TopParties(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string side = "customers",
        [FromQuery] int limit = 10)
    {
        var (_, _, start, end) = Period(from, to);
        limit = Math.Clamp(limit, 1, 50);
        var suppliers = side.Equals("suppliers", StringComparison.OrdinalIgnoreCase);
        var (invoice, ret) = suppliers
            ? (DocumentType.PURCHASE_INVOICE, DocumentType.PURCHASE_RETURN)
            : (DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN);
        var rows = await Docs().Where(d => (d.Type == invoice || d.Type == ret) && d.IssueDate >= start && d.IssueDate < end)
            .GroupBy(d => d.PartyId)
            .Select(g => new
            {
                PartyId = g.Key,
                Net = g.Sum(d => d.Type == invoice ? d.Subtotal - d.DiscountTotal : -(d.Subtotal - d.DiscountTotal)),
                Count = g.Count(d => d.Type == invoice),
            })
            .OrderByDescending(x => x.Net).Take(limit).ToListAsync();
        var total = rows.Sum(r => r.Net);
        var ids = rows.Select(r => r.PartyId).ToList();
        var names = await _db.Parties.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return Ok(rows.Select(r => new TopPartyDto(r.PartyId.ToString(), names.GetValueOrDefault(r.PartyId, ""), r.Net, r.Count,
            total > 0 ? Math.Round(100.0 * r.Net / total, 1) : 0)).ToArray());
    }

    /// <summary>
    /// Sales performance (أداء المبيعات) in a period, by person — the invoice's sales rep, else who
    /// issued it — or by branch: net sales after returns, profit, invoices, customers served, the
    /// average invoice, returns, what was paid on the spot, and quotations made / won. A return
    /// counts against whoever made the sale it returns.
    /// </summary>
    [HttpGet("performance")]
    [Authorize(Policy = Permissions.ReportsPerformance)]
    public async Task<ActionResult<PerformanceDto>> Performance(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string by = "rep")
    {
        var (fromDay, toDay, start, end) = Period(from, to);
        var byBranch = by.Equals("branch", StringComparison.OrdinalIgnoreCase);
        var byDepartment = by.Equals("department", StringComparison.OrdinalIgnoreCase);
        var docs = await Docs()
            .Where(d => (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN)
                        && d.IssueDate >= start && d.IssueDate < end)
            .Select(d => new
            {
                d.Type,
                // A sale of no department is counted under an empty key.
                Key = byDepartment ? d.DepartmentId ?? Guid.Empty
                    : byBranch
                    ? (d.Type == DocumentType.SALES_RETURN && d.SourceDocument != null ? d.SourceDocument.BranchId : d.BranchId)
                    : (d.Type == DocumentType.SALES_RETURN && d.SourceDocument != null
                        ? d.SourceDocument.RepId ?? d.SourceDocument.StaffId
                        : d.RepId ?? d.StaffId),
                d.PartyId, Net = d.Subtotal - d.DiscountTotal, d.ProfitTotal, d.PaidAmount,
            }).ToListAsync();
        var keys = docs.Select(d => d.Key).Distinct().ToList();
        var names = byDepartment
            ? (await _db.Departments.AsNoTracking().Where(x => keys.Contains(x.Id)).ToListAsync()).ToDictionary(x => x.Id, x => Loc.Name(x))
            : byBranch
            ? (await _db.Branches.AsNoTracking().Where(x => keys.Contains(x.Id)).ToListAsync()).ToDictionary(x => x.Id, x => Loc.Name(x))
            : await _db.Staff.AsNoTracking().Where(x => keys.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.FullName);
        var rows = keys.Select(k =>
        {
            var mine = docs.Where(d => d.Key == k).ToList();
            var invoices = mine.Where(d => d.Type == DocumentType.SALES_INVOICE).ToList();
            var returns = mine.Where(d => d.Type == DocumentType.SALES_RETURN).ToList();
            var net = invoices.Sum(d => d.Net) - returns.Sum(d => d.Net);
            var profit = invoices.Sum(d => d.ProfitTotal) - returns.Sum(d => d.ProfitTotal);
            return new PerformanceRowDto(k.ToString(), names.GetValueOrDefault(k, ""), net, profit, invoices.Count,
                invoices.Select(d => d.PartyId).Distinct().Count(), invoices.Count == 0 ? 0 : net / invoices.Count,
                returns.Sum(d => d.Net), invoices.Sum(d => d.PaidAmount), 0);
        }).ToList();
        var totalNet = rows.Sum(r => r.NetSales);
        var result = rows.Select(r => r with { Share = totalNet > 0 ? Math.Round(100.0 * r.NetSales / totalNet, 1) : 0 })
            .OrderByDescending(r => r.NetSales).ThenBy(r => r.Name).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(Costs.Guard(User, new PerformanceDto(byDepartment ? "department" : byBranch ? "branch" : "rep", fromDay.ToString("yyyy-MM-dd"),
            toDay.ToString("yyyy-MM-dd"), result, totalNet, rows.Sum(r => r.Profit), rows.Sum(r => r.Invoices),
            currency)));
    }

    /// <summary>
    /// Items that moved most in a period (net units sold), and dead stock: items in stock that
    /// didn't sell at all in the period (الأصناف الراكدة), with their value at cost.
    /// </summary>
    [HttpGet("item-movement")]
    [Authorize(Policy = Permissions.ReportsItems)]
    public async Task<ActionResult<ItemMovementDto>> ItemMovement(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] int limit = 20)
    {
        var (fromDay, toDay, start, end) = Period(from, to);
        limit = Math.Clamp(limit, 1, 100);
        var lines = _db.DocumentLines.Where(l => l.Document!.Status != DocumentStatus.CANCELLED
                                                 && l.Document.IssueDate >= start && l.Document.IssueDate < end);
        lines = lines.InBranches(User, l => l.Document!.BranchId);
        var moves = await lines.GroupBy(l => l.ProductId).Select(g => new
        {
            ProductId = g.Key,
            Out = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.Quantity
                : l.Document.Type == DocumentType.SALES_RETURN ? -l.Quantity : 0),
            In = g.Sum(l => l.Document!.Type == DocumentType.PURCHASE_INVOICE ? l.Quantity
                : l.Document.Type == DocumentType.PURCHASE_RETURN ? -l.Quantity : 0),
            Value = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? l.LineTotal - l.DocDiscount
                : l.Document.Type == DocumentType.SALES_RETURN ? -(l.LineTotal - l.DocDiscount) : 0),
        }).ToListAsync();
        var top = moves.Where(m => m.Out > 0).OrderByDescending(m => m.Out).ThenByDescending(m => m.Value).Take(limit).ToList();
        var sold = moves.Where(m => m.Out > 0).Select(m => m.ProductId).ToHashSet();

        // Stock on hand: the whole company, or their branches' warehouses for people who see only some.
        Dictionary<Guid, int> stock;
        if (Access.Branches(User) is not null)
            stock = await _db.StockBalances.InBranches(User, x => x.Warehouse!.BranchId).Where(x => x.Quantity > 0)
                .GroupBy(x => x.ProductId).Select(g => new { g.Key, Q = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Q);
        else
            stock = await _db.Products.Where(p => p.StockOnHand > 0).ToDictionaryAsync(p => p.Id, p => p.StockOnHand);
        var deadIds = stock.Keys.Where(id => !sold.Contains(id)).ToList();
        var products = await _db.Products.AsNoTracking().Include(p => p.Size).Include(p => p.Color)
            .Where(p => (deadIds.Contains(p.Id) && p.IsActive) || top.Select(t => t.ProductId).Contains(p.Id)).ToListAsync();
        var byId = products.ToDictionary(p => p.Id);
        var lastSale = await _db.DocumentLines.Where(l => deadIds.Contains(l.ProductId) && l.Document!.Type == DocumentType.SALES_INVOICE
                                                          && l.Document.Status != DocumentStatus.CANCELLED)
            .GroupBy(l => l.ProductId).Select(g => new { g.Key, Last = g.Max(l => l.Document!.IssueDate) })
            .ToDictionaryAsync(x => x.Key, x => x.Last);
        var dead = deadIds.Where(byId.ContainsKey).Select(id =>
            {
                var p = byId[id];
                return new DeadItemDto(id.ToString(), p.Sku, Loc.Name(p), stock[id], (long)stock[id] * p.CostPrice,
                    lastSale.TryGetValue(id, out var last) ? last.ToString("o") : null);
            })
            // Without the right to see costs, by quantity instead of value (the order would hint at cost).
            .OrderByDescending(x => Costs.CanSee(User) ? x.StockValue : x.Stock).Take(200)
            .Select(x => Costs.Guard(User, x)).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new ItemMovementDto(fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"),
            top.Where(m => byId.ContainsKey(m.ProductId)).Select(m => new ItemMoveDto(m.ProductId.ToString(),
                byId[m.ProductId].Sku, Loc.Name(byId[m.ProductId]), m.Out, m.In, m.Value)).ToArray(),
            dead, currency));
    }

    /// <summary>
    /// Items by supplier and by department (owner, 2026-11-11: "what each supplier supplies and to
    /// which department; only the knitwear factories' goods, or only men's"): for each supplier, each
    /// department or group of the tree (a level at a time: departments, then the groups of the one
    /// opened), or each item — how many items, what sold and came back in the period, profit, what was
    /// bought and what is in stock now. Filtered by suppliers, department, group and season. Only the
    /// person's branches, warehouses and departments; profit, costs and purchase prices only for whoever
    /// may see them.
    /// </summary>
    /// <param name="by">supplier, department or item.</param>
    /// <param name="supplierIds">Comma-separated suppliers; "none" = items without one.</param>
    [HttpGet("assortment")]
    [Authorize(Policy = Permissions.ReportsAssortment)]
    public async Task<ActionResult<AssortmentDto>> Assortment([FromQuery] string by = "supplier",
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? supplierIds = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? groupId = null, [FromQuery] string? seasonId = null)
    {
        var (fromDay, toDay, start, end) = Period(from, to);
        by = by.ToLowerInvariant() is "department" or "item" ? by.ToLowerInvariant() : "supplier";
        var tree = await _db.Categories.AsNoTracking().ToListAsync();
        var departments = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => Loc.Name(d));

        // ---- the items asked for, among the person's departments' (and items of none)
        var items = _db.Products.AsNoTracking();
        if (Access.Departments(User) is { } mine)
            items = items.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
        Guid? dept = null, group = null;
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var d) || !departments.ContainsKey(d) || !Access.CanUseDepartment(User, d))
                return NotFound(new { message = "Department not found.", code = "department_not_found" });
            dept = d;
            items = items.Where(p => p.Category!.DepartmentId == d);
        }
        if (!string.IsNullOrWhiteSpace(groupId))
        {
            var g = Guid.TryParse(groupId, out var gid) ? tree.FirstOrDefault(c => c.Id == gid && !c.IsRoot && c.DepartmentId != null) : null;
            if (g is null || (dept is Guid dd && g.DepartmentId != dd) || !Access.CanUseDepartment(User, g.DepartmentId!.Value))
                return NotFound(new { message = "Group not found.", code = "group_not_found" });
            dept ??= g.DepartmentId;
            group = g.Id;
            var under = Catalog.Subtree(g.Id, tree).ToList();
            items = items.Where(p => under.Contains(p.CategoryId));
        }
        if (Guid.TryParse(seasonId, out var season)) items = items.Where(p => p.SeasonId == season);
        var wanted = (supplierIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (wanted.Length > 0)
        {
            var ids = wanted.Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
            var none = wanted.Contains("none");
            items = items.Where(p => (p.SupplierId != null && ids.Contains(p.SupplierId.Value)) || (none && p.SupplierId == null));
        }
        var products = await items.Select(p => new { p.Id, p.Sku, p.Name, p.SupplierId, p.CategoryId, p.IsActive }).ToListAsync();
        var productIds = products.Select(p => p.Id).ToHashSet();
        var active = products.Where(p => p.IsActive).Select(p => p.Id).ToHashSet();

        // ---- what moved in the period: lines of the person's branches, departments and warehouses
        var lines = _db.DocumentLines.AsNoTracking().Where(l => l.Document!.Status != DocumentStatus.CANCELLED
            && l.Document.IssueDate >= start && l.Document.IssueDate < end
            && (SalesTypes.Contains(l.Document.Type) || PurchaseTypes.Contains(l.Document.Type)));
        lines = lines.InBranches(User, l => l.Document!.BranchId);
        if (Access.Departments(User) is { } myDepartments)
            lines = lines.Where(l => l.Document!.DepartmentId == null || myDepartments.Contains(l.Document.DepartmentId.Value));
        var stores = await _warehouses.LimitAsync(User);
        if (stores is not null)
        {
            var visible = stores.ToList();
            lines = lines.Where(l => l.WarehouseId != null && visible.Contains(l.WarehouseId.Value));
        }
        var moved = (await lines.GroupBy(l => new { l.ProductId, l.Document!.Type })
                .Select(g => new
                {
                    g.Key.ProductId, g.Key.Type, Qty = g.Sum(l => (long)l.Quantity),
                    Net = g.Sum(l => l.LineTotal - l.DocDiscount), Profit = g.Sum(l => l.LineProfit),
                }).ToListAsync())
            .Where(m => productIds.Contains(m.ProductId)).ToLookup(m => m.ProductId);
        var state = await _valuation.CurrentAsync();

        bool seeProfit = Costs.CanSeeProfit(User), seeCosts = Costs.CanSee(User), seePurchases = Costs.CanSeePurchasePrices(User);
        AssortmentRowDto Figures(string id, string name, string kind, IReadOnlyCollection<Guid> ofItems, string? code = null,
            string? detail = null, string? supplier = null, bool children = false)
        {
            long soldQty = 0, retQty = 0, sales = 0, returns = 0, profit = 0, boughtQty = 0, bought = 0, stockQty = 0, stockValue = 0;
            foreach (var pid in ofItems)
            {
                foreach (var m in moved[pid])
                    switch (m.Type)
                    {
                        case DocumentType.SALES_INVOICE: soldQty += m.Qty; sales += m.Net; profit += m.Profit; break;
                        case DocumentType.SALES_RETURN: retQty += m.Qty; returns += m.Net; profit -= m.Profit; break;
                        case DocumentType.PURCHASE_INVOICE: boughtQty += m.Qty; bought += m.Net; break;
                        case DocumentType.PURCHASE_RETURN: boughtQty -= m.Qty; bought -= m.Net; break;
                    }
                var (qty, value) = stores is null ? state.Of(pid) : state.Of(pid, stores);
                stockQty += qty;
                stockValue += value;
            }
            return new AssortmentRowDto(id, name, kind, code, detail, supplier, children,
                ofItems.Count(active.Contains), soldQty, retQty, sales, returns, sales - returns,
                seeProfit ? profit : 0, boughtQty, seePurchases ? bought : 0, stockQty, seeCosts ? stockValue : 0);
        }

        string? DepartmentOf(Guid categoryId) =>
            tree.FirstOrDefault(c => c.Id == categoryId)?.DepartmentId is Guid d ? departments.GetValueOrDefault(d) : null;
        string PathName(Guid categoryId) => string.Join(" › ", new[] { DepartmentOf(categoryId) }
            .Concat(Catalog.PathOf(categoryId, tree).Select(c => Loc.Name(c))).Where(x => !string.IsNullOrEmpty(x)));
        var supplierIdsUsed = products.Where(p => p.SupplierId != null).Select(p => p.SupplierId!.Value).Distinct().ToList();
        var suppliers = await _db.Parties.AsNoTracking().Where(p => supplierIdsUsed.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new { p.Name, p.Code });

        List<AssortmentRowDto> rows;
        if (by == "supplier")
            rows = products.GroupBy(p => p.SupplierId).Select(g =>
            {
                var detail = string.Join("، ", g.Select(p => DepartmentOf(p.CategoryId)).Where(x => x != null).Distinct().OrderBy(x => x));
                return g.Key is Guid sid && suppliers.TryGetValue(sid, out var sup)
                    ? Figures(sid.ToString(), sup.Name, "SUPPLIER", g.Select(p => p.Id).ToList(), sup.Code.ToString(), detail)
                    : Figures("none", "", "NO_SUPPLIER", g.Select(p => p.Id).ToList(), null, detail);
            }).ToList();
        else if (by == "department")
        {
            // The level under what is opened: departments; a department's groups; a group's groups.
            Guid? Key(Guid categoryId)
            {
                var path = Catalog.PathOf(categoryId, tree);
                if (dept is null) return tree.FirstOrDefault(c => c.Id == categoryId)?.DepartmentId;
                var at = group is Guid gg ? path.FindIndex(c => c.Id == gg) + 1 : 0;
                return at < path.Count ? path[at].Id : null;
            }
            rows = products.GroupBy(p => Key(p.CategoryId)).Select(g =>
            {
                var ids = g.Select(p => p.Id).ToList();
                if (dept is null)
                    return g.Key is Guid d
                        ? Figures(d.ToString(), departments.GetValueOrDefault(d, ""), "DEPARTMENT", ids,
                            children: tree.Any(c => c.DepartmentId == d && !c.IsRoot))
                        : Figures("none", "", "NO_DEPARTMENT", ids);
                if (g.Key is Guid k)
                {
                    var node = tree.First(c => c.Id == k);
                    return Figures(k.ToString(), Loc.Name(node), "GROUP", ids, node.Prefix, children: tree.Any(c => c.ParentId == k));
                }
                return Figures((group ?? dept)!.Value.ToString(), "", "DIRECT", ids);
            }).ToList();
        }
        else
            rows = products.Where(p => p.IsActive || moved[p.Id].Any())
                .Select(p => Figures(p.Id.ToString(), p.Name, "ITEM", new[] { p.Id }, p.Sku, PathName(p.CategoryId),
                    p.SupplierId is Guid sid && suppliers.TryGetValue(sid, out var sup) ? sup.Name : null))
                .OrderByDescending(r => r.NetSales).ThenByDescending(r => r.StockQty).ThenBy(r => r.Name)
                .Take(1000).ToList();
        if (by != "item")
            rows = rows.OrderByDescending(r => r.NetSales).ThenByDescending(r => r.StockQty).ThenBy(r => r.Name).ToList();

        var total = Figures("total", "", "TOTAL", products.Select(p => p.Id).ToList());
        var steps = new List<AssortmentStepDto>();
        if (dept is Guid open)
        {
            steps.Add(new AssortmentStepDto(open.ToString(), departments.GetValueOrDefault(open, ""), "DEPARTMENT"));
            if (group is Guid og)
                steps.AddRange(Catalog.PathOf(og, tree).Select(c => new AssortmentStepDto(c.Id.ToString(), Loc.Name(c), "GROUP")));
        }
        var hidden = new[] { seeProfit ? null : "profit", seeCosts ? null : "costs", seePurchases ? null : "purchases" }
            .Where(x => x != null).Select(x => x!).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new AssortmentDto(by, fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), rows.ToArray(), total,
            steps.ToArray(), hidden, currency));
    }

    /// <summary>
    /// Aging (أعمار الديون): what each customer still owes (or what we owe each supplier) on open
    /// invoices, by the invoice's age — up to 30 days, 31–60, 61–90, over 90 — plus the part of
    /// their balance not tied to an open invoice (e.g. an opening balance).
    /// A payment that wasn't linked to an invoice settles the oldest open invoices first, so what
    /// is aged never exceeds what the party really owes. Branch-scoped staff see their branch's
    /// invoices as they stand.
    /// </summary>
    [HttpGet("aging")]
    [Authorize(Policy = Permissions.ReportsAging)]
    public async Task<ActionResult<AgingDto>> Aging([FromQuery] string side = "customers")
    {
        var suppliers = side.Equals("suppliers", StringComparison.OrdinalIgnoreCase);
        var type = suppliers ? DocumentType.PURCHASE_INVOICE : DocumentType.SALES_INVOICE;
        var q = _db.SalesDocuments.AsNoTracking().Where(d => d.Type == type && d.Status != DocumentStatus.CANCELLED
                                                             && d.PaidAmount < d.GrandTotal);
        q = q.InBranches(User, d => d.BranchId);
        var scoped = !Access.AllBranches(User);
        var docs = await q.ToListAsync();
        var owed = await MoneyService.OutstandingAsync(_db, docs);
        var today = CompanyClock.Today;
        var partyIds = docs.Where(d => owed[d.Id] > 0).Select(d => d.PartyId).Distinct().ToList();
        var role = suppliers ? "SUPPLIER" : "CUSTOMER";
        // Owed without an open invoice (opening balances…): only the whole-company view has them.
        var parties = await _db.Parties.AsNoTracking()
            .Where(p => partyIds.Contains(p.Id)
                        || (!scoped && p.Types.Contains(role) && (suppliers ? p.Balance < 0 : p.Balance > 0)))
            .ToListAsync();
        var byParty = docs.Where(d => owed[d.Id] > 0).ToLookup(d => d.PartyId);
        var rows = parties.Select(party =>
        {
            // A payable is a negative balance; show both sides as positive amounts owed.
            var balance = suppliers ? -party.Balance : party.Balance;
            var open = byParty[party.Id].OrderBy(d => d.IssueDate).ThenBy(d => d.Number)
                .Select(d => (Age: today.DayNumber - CompanyClock.DayOf(d.IssueDate).DayNumber, Left: owed[d.Id])).ToList();
            if (!scoped)
            {
                // Payments not linked to an invoice settle the oldest ones first.
                var credit = Math.Max(0, open.Sum(x => x.Left) - Math.Max(0, balance));
                for (var i = 0; i < open.Count && credit > 0; i++)
                {
                    var take = Math.Min(credit, open[i].Left);
                    open[i] = (open[i].Age, open[i].Left - take);
                    credit -= take;
                }
            }
            long Bucket(int min, int max) => open.Where(x => x.Age >= min && x.Age <= max).Sum(x => x.Left);
            var current = Bucket(int.MinValue, 30);
            var b60 = Bucket(31, 60);
            var b90 = Bucket(61, 90);
            var over = Bucket(91, int.MaxValue);
            var total = current + b60 + b90 + over;
            return new AgingRowDto(party.Id.ToString(), party.Name, current, b60, b90, over, total, balance,
                balance - total);
        }).Where(r => r.Total > 0 || r.OnAccount > 0).OrderByDescending(r => r.Total).ThenByDescending(r => r.Balance)
            .ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new AgingDto(suppliers ? "suppliers" : "customers", rows, rows.Sum(r => r.Current),
            rows.Sum(r => r.Days31To60), rows.Sum(r => r.Days61To90), rows.Sum(r => r.Over90), rows.Sum(r => r.Total),
            currency));
    }

    private IQueryable<SalesDocument> Docs()
    {
        var q = _db.SalesDocuments.Where(d => d.Status != DocumentStatus.CANCELLED
                                              && (SalesTypes.Contains(d.Type) || PurchaseTypes.Contains(d.Type)));
        return q.InBranches(User, d => d.BranchId);
    }

    /// <summary>Whole company days; defaults to the last 90 days.</summary>
    private static (DateOnly FromDay, DateOnly ToDay, DateTime Start, DateTime End) Period(string? from, string? to)
    {
        var toDay = CompanyClock.ParseDay(to) ?? CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? toDay.AddDays(-89);
        if (fromDay > toDay) (fromDay, toDay) = (toDay, fromDay);
        var (start, end) = CompanyClock.Days(fromDay, toDay);
        return (fromDay, toDay, start, end);
    }
}
