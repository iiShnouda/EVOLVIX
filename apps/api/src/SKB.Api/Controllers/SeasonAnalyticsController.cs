using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The season comparison (the same season across years) and the purchase suggestions (what to buy
/// again), owner 2026-11-18. Read-only; only the person's branches, departments and warehouses; profit
/// and costs only for whoever may see them.
/// </summary>
[ApiController]
[Route("api/analytics")]
[Authorize]
public sealed class SeasonAnalyticsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly WarehouseService _warehouses;
    private readonly StockValuation _valuation;

    public SeasonAnalyticsController(AppDbContext db, WarehouseService warehouses, StockValuation valuation)
    {
        _db = db;
        _warehouses = warehouses;
        _valuation = valuation;
    }

    private static readonly DocumentType[] SalesTypes = { DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN };

    /// <summary>
    /// The same season across years (summer 2024, summer 2025, summer 2026…): for each year, what its
    /// items sold and got back, net, profit, how many items and what was left at the season's end — in
    /// all, by department, by supplier or by item. An item belongs to the season it was bought for (its
    /// own season and year), whenever it sold; items with no season are left out and only added up in
    /// <see cref="SeasonCompareDto.Unplaced"/>.
    /// </summary>
    /// <param name="season">SUMMER or WINTER (default: the one it is now).</param>
    /// <param name="years">Comma-separated years; default the last <paramref name="count"/> that began.</param>
    /// <param name="by">department, supplier or item.</param>
    [HttpGet("season-compare")]
    [Authorize(Policy = Permissions.ReportsSeasonCompare)]
    public async Task<ActionResult<SeasonCompareDto>> SeasonCompare([FromQuery] string? season = null,
        [FromQuery] string? years = null, [FromQuery] int count = 3, [FromQuery] string by = "department",
        [FromQuery] string? departmentId = null, [FromQuery] string? supplierIds = null)
    {
        var today = CompanyClock.Today;
        var kind = DepartmentSeasons.Parse(season) ?? Seasons.Of(today).Kind;
        by = by.ToLowerInvariant() is "supplier" or "item" ? by.ToLowerInvariant() : "department";
        // The latest season of the kind that has begun: summer from April, winter (named for the year it
        // ends in) from October of the year before.
        var latest = kind == Seasons.Summer ? (today.Month >= 4 ? today.Year : today.Year - 1)
            : (today.Month >= 10 ? today.Year + 1 : today.Year);
        var read = await Seasons.KindsAndYearsAsync(_db);
        var all = read.Where(s => s.Kind == kind && s.Year != null).ToList();
        var available = all.Select(s => s.Year!.Value).Distinct().OrderByDescending(y => y).ToArray();
        var chosen = (years ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => int.TryParse(x, out var y) && y is >= 1900 and <= 2099 ? y : 0).Where(y => y > 0)
            .Distinct().Take(10).ToList();
        if (chosen.Count == 0)
        {
            chosen = available.Where(y => y <= latest).Take(Math.Clamp(count, 1, 10)).ToList();
            if (chosen.Count == 0) chosen.Add(latest);
        }
        chosen.Sort();
        var yearOf = all.Where(s => chosen.Contains(s.Year!.Value)).ToDictionary(s => s.Id, s => s.Year!.Value);

        var tree = await _db.Categories.AsNoTracking().ToListAsync();
        var departments = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => Loc.Name(d));
        var mine = Access.Departments(User);
        var items = _db.Products.AsNoTracking();
        if (mine is { } md)
            items = items.Where(p => p.Category!.DepartmentId == null || md.Contains(p.Category.DepartmentId.Value));
        Guid? dept = null;
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var d) || !departments.ContainsKey(d) || !Access.CanUseDepartment(User, d))
                return NotFound(new { message = "Department not found.", code = "department_not_found" });
            dept = d;
            items = items.Where(p => p.Category!.DepartmentId == d);
        }
        var wanted = (supplierIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (wanted.Length > 0)
        {
            var ids = wanted.Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
            var none = wanted.Contains("none");
            items = items.Where(p => (p.SupplierId != null && ids.Contains(p.SupplierId.Value)) || (none && p.SupplierId == null));
        }
        var everything = await items.Select(p => new { p.Id, p.Sku, p.Name, p.SupplierId, p.CategoryId, p.SeasonId, p.IsActive })
            .ToListAsync();
        var products = everything.Where(p => p.SeasonId is Guid sid && yearOf.ContainsKey(sid)).ToList();
        // Items with no season (or one with no kind or year) are left out of every year.
        var seasonsRead = read.ToDictionary(s => s.Id);
        var unplacedIds = everything.Where(p => p.SeasonId is not Guid sid
                || !seasonsRead.TryGetValue(sid, out var r) || r.Kind is null || r.Year is null)
            .Select(p => p.Id).ToHashSet();
        var wantedIds = products.Select(p => p.Id).Concat(unplacedIds).ToHashSet();

        // Sales and returns of the person's branches, departments and warehouses, whenever they were.
        var lines = _db.DocumentLines.AsNoTracking().Where(l => l.Document!.Status != DocumentStatus.CANCELLED
            && SalesTypes.Contains(l.Document.Type));
        lines = lines.InBranches(User, l => l.Document!.BranchId);
        if (mine is { } myDepartments)
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
            .Where(m => wantedIds.Contains(m.ProductId)).ToLookup(m => m.ProductId);

        // What was left at each season's end (today's stock for a season not over yet).
        var ends = new Dictionary<int, StockValuation.State>();
        foreach (var y in chosen)
        {
            var end = Seasons.EndOf(kind, y);
            ends[y] = end >= today ? await _valuation.CurrentAsync() : await _valuation.AtAsync(CompanyClock.StartOf(end.AddDays(1)));
        }

        bool seeProfit = Costs.CanSeeProfit(User), seeCosts = Costs.CanSee(User);
        var itemYear = products.ToDictionary(p => p.Id, p => yearOf[p.SeasonId!.Value]);
        SeasonCompareRowDto Row(string id, string name, string rowKind, IReadOnlyCollection<Guid> ofItems, string? code = null,
            string? detail = null, bool children = false)
        {
            var cells = chosen.Select(y =>
            {
                var these = ofItems.Where(i => itemYear[i] == y).ToList();
                long soldQty = 0, retQty = 0, sales = 0, returns = 0, profit = 0, stockQty = 0, stockValue = 0;
                foreach (var pid in these)
                {
                    foreach (var m in moved[pid])
                        if (m.Type == DocumentType.SALES_INVOICE) { soldQty += m.Qty; sales += m.Net; profit += m.Profit; }
                        else { retQty += m.Qty; returns += m.Net; profit -= m.Profit; }
                    var (qty, value) = stores is null ? ends[y].Of(pid) : ends[y].Of(pid, stores);
                    stockQty += qty;
                    stockValue += value;
                }
                return new SeasonCompareCellDto(y, these.Count, soldQty, retQty, sales, returns, sales - returns,
                    seeProfit ? profit : 0, stockQty, seeCosts ? stockValue : 0);
            }).ToArray();
            return new SeasonCompareRowDto(id, name, rowKind, code, detail, children, cells);
        }

        string? DepartmentOf(Guid categoryId) =>
            tree.FirstOrDefault(c => c.Id == categoryId)?.DepartmentId is Guid d ? departments.GetValueOrDefault(d) : null;
        var supplierIdsUsed = products.Where(p => p.SupplierId != null).Select(p => p.SupplierId!.Value).Distinct().ToList();
        var suppliers = await _db.Parties.AsNoTracking().Where(p => supplierIdsUsed.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new { p.Name, p.Code });

        List<SeasonCompareRowDto> rows;
        if (by == "supplier")
            rows = products.GroupBy(p => p.SupplierId).Select(g =>
            {
                var detail = string.Join("، ", g.Select(p => DepartmentOf(p.CategoryId)).Where(x => x != null).Distinct().OrderBy(x => x));
                return g.Key is Guid sid && suppliers.TryGetValue(sid, out var sup)
                    ? Row(sid.ToString(), sup.Name, "SUPPLIER", g.Select(p => p.Id).ToList(), sup.Code.ToString(), detail, true)
                    : Row("none", "", "NO_SUPPLIER", g.Select(p => p.Id).ToList(), null, detail, true);
            }).ToList();
        else if (by == "department")
            rows = products.GroupBy(p => tree.FirstOrDefault(c => c.Id == p.CategoryId)?.DepartmentId).Select(g =>
                g.Key is Guid d
                    ? Row(d.ToString(), departments.GetValueOrDefault(d, ""), "DEPARTMENT", g.Select(p => p.Id).ToList(), children: true)
                    : Row("none", "", "NO_DEPARTMENT", g.Select(p => p.Id).ToList())).ToList();
        else
            rows = products.Where(p => p.IsActive || moved[p.Id].Any())
                .Select(p => Row(p.Id.ToString(), p.Name, "ITEM", new[] { p.Id }, p.Sku,
                    string.Join(" · ", new[]
                    {
                        DepartmentOf(p.CategoryId),
                        p.SupplierId is Guid sid && suppliers.TryGetValue(sid, out var sup) ? sup.Name : null,
                    }.Where(x => !string.IsNullOrEmpty(x)))))
                .ToList();
        rows = rows.OrderByDescending(r => r.Years.Sum(c => c.NetSales)).ThenBy(r => r.Name).Take(1000).ToList();

        var total = Row("total", "", "TOTAL", products.Select(p => p.Id).ToList());
        long unplacedQty = 0, unplacedNet = 0;
        foreach (var pid in unplacedIds)
        foreach (var m in moved[pid])
            if (m.Type == DocumentType.SALES_INVOICE) { unplacedQty += m.Qty; unplacedNet += m.Net; }
            else { unplacedQty -= m.Qty; unplacedNet -= m.Net; }

        var path = dept is Guid open
            ? new[] { new AssortmentStepDto(open.ToString(), departments.GetValueOrDefault(open, ""), "DEPARTMENT") }
            : Array.Empty<AssortmentStepDto>();
        var hidden = new[] { seeProfit ? null : "profit", seeCosts ? null : "costs" }.Where(x => x != null).Select(x => x!).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new SeasonCompareDto(kind, chosen.ToArray(), available, by, rows.ToArray(), total,
            new SeasonUnplacedDto(unplacedQty, unplacedNet), path, hidden, currency));
    }

    /// <summary>
    /// What to buy again: for each item, the stock on hand, what sold (less what came back) in the last
    /// <paramref name="days"/> days, the average a day, how many days the stock lasts, the reorder level
    /// and a suggested quantity = target days × average a day − stock (never below 0, rounded up). Most
    /// urgent first, grouped by supplier with totals. Without <paramref name="all"/> only items to buy
    /// (a suggestion, or at or under the reorder level).
    /// </summary>
    /// <param name="season">SUMMER or WINTER: that season's departments (by their names) and those of none.</param>
    /// <param name="year">Only items whose own season is of this year (and of <paramref name="season"/>'s kind).</param>
    [HttpGet("purchase-suggestions")]
    [Authorize(Policy = Permissions.ReportsPurchaseSuggestions)]
    public async Task<ActionResult<PurchaseSuggestionsDto>> PurchaseSuggestions([FromQuery] int days = 30,
        [FromQuery] int target = 30, [FromQuery] string? supplierId = null, [FromQuery] string? departmentId = null,
        [FromQuery] string? season = null, [FromQuery] int? year = null, [FromQuery] bool all = false)
    {
        days = Math.Clamp(days, 1, 365);
        target = Math.Clamp(target, 1, 365);
        var departments = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => Loc.Name(d));
        var ofDepartments = DepartmentSeasons.Within(Access.Departments(User), await DepartmentSeasons.IdsAsync(_db, season));
        var items = _db.Products.AsNoTracking().Where(p => p.IsActive);
        if (ofDepartments is { } mine)
            items = items.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var d) || !departments.ContainsKey(d) || !Access.CanUseDepartment(User, d))
                return NotFound(new { message = "Department not found.", code = "department_not_found" });
            items = items.Where(p => p.Category!.DepartmentId == d);
        }
        if (supplierId == "none") items = items.Where(p => p.SupplierId == null);
        else if (Guid.TryParse(supplierId, out var sup)) items = items.Where(p => p.SupplierId == sup);
        if (year is int y && await Seasons.IdsAsync(_db, DepartmentSeasons.Parse(season), y) is { } ofYear)
            items = items.Where(p => p.SeasonId != null && ofYear.Contains(p.SeasonId.Value));
        var products = await items.Select(p => new
        {
            p.Id, p.Sku, p.Name, p.SupplierId, p.ReorderLevel, p.CostPrice, DepartmentId = p.Category!.DepartmentId,
        }).ToListAsync();
        var ids = products.Select(p => p.Id).ToHashSet();

        // Net sold in the last days: the person's branches, departments and warehouses.
        var today = CompanyClock.Today;
        var (start, end) = CompanyClock.Days(today.AddDays(1 - days), today);
        var lines = _db.DocumentLines.AsNoTracking().Where(l => l.Document!.Status != DocumentStatus.CANCELLED
            && SalesTypes.Contains(l.Document.Type) && l.Document.IssueDate >= start && l.Document.IssueDate < end);
        lines = lines.InBranches(User, l => l.Document!.BranchId);
        if (Access.Departments(User) is { } myDepartments)
            lines = lines.Where(l => l.Document!.DepartmentId == null || myDepartments.Contains(l.Document.DepartmentId.Value));
        var stores = await _warehouses.LimitAsync(User);
        if (stores is not null)
        {
            var visible = stores.ToList();
            lines = lines.Where(l => l.WarehouseId != null && visible.Contains(l.WarehouseId.Value));
        }
        var sold = (await lines.GroupBy(l => l.ProductId)
                .Select(g => new
                {
                    ProductId = g.Key,
                    Qty = g.Sum(l => l.Document!.Type == DocumentType.SALES_INVOICE ? (long)l.Quantity : -(long)l.Quantity),
                }).ToListAsync())
            .Where(x => ids.Contains(x.ProductId)).ToDictionary(x => x.ProductId, x => Math.Max(0, x.Qty));
        var state = await _valuation.CurrentAsync();
        var seeCosts = Costs.CanSee(User);

        var rows = products.Select(p =>
        {
            var qty = sold.GetValueOrDefault(p.Id);
            long stock = stores is null ? state.Of(p.Id).Quantity : state.Of(p.Id, stores).Quantity;
            // target × (sold / days) − stock, rounded up, in whole numbers.
            var need = target * qty - stock * days;
            var suggested = need <= 0 ? 0 : (need + days - 1) / days;
            decimal? daysLeft = qty > 0 ? Math.Round(Math.Max(0, stock) * (decimal)days / qty, 1) : null;
            return new PurchaseSuggestionRowDto(p.Id.ToString(), p.Sku, p.Name,
                p.DepartmentId is Guid d ? departments.GetValueOrDefault(d) : null, stock, qty,
                Math.Round((decimal)qty / days, 2), daysLeft, p.ReorderLevel, suggested,
                seeCosts ? p.CostPrice : 0, seeCosts ? suggested * p.CostPrice : 0)
            {
                SupplierId = p.SupplierId,
            };
        }).Where(r => all ? r.SoldQty > 0 || r.Stock > 0 || r.Suggested > 0 : r.Suggested > 0 || (r.ReorderLevel > 0 && r.Stock <= r.ReorderLevel))
            .OrderBy(r => r.DaysLeft ?? decimal.MaxValue).ThenByDescending(r => r.Suggested).ThenBy(r => r.Name).ToList();

        var supplierIds = rows.Where(r => r.SupplierId != null).Select(r => r.SupplierId!.Value).Distinct().ToList();
        var suppliers = await _db.Parties.AsNoTracking().Where(p => supplierIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new { p.Name, p.Code });
        var groups = rows.GroupBy(r => r.SupplierId).Select(g =>
            {
                var list = g.Take(2000).ToArray();
                var known = g.Key is Guid sid && suppliers.ContainsKey(sid);
                return new PurchaseSuggestionGroupDto(known ? g.Key!.Value.ToString() : "none",
                    known ? suppliers[g.Key!.Value].Name : "", known ? suppliers[g.Key!.Value].Code.ToString() : null,
                    list, list.Length, list.Sum(r => r.Suggested), list.Sum(r => r.Value));
            })
            .OrderBy(g => g.Rows.Min(r => r.DaysLeft ?? decimal.MaxValue)).ThenByDescending(g => g.Suggested).ThenBy(g => g.Name)
            .ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new PurchaseSuggestionsDto(days, target, groups, rows.Count, rows.Sum(r => r.Suggested), rows.Sum(r => r.Value),
            seeCosts ? Array.Empty<string>() : new[] { "costs" }, currency));
    }
}
