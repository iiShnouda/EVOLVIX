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

    public AnalyticsController(AppDbContext db) => _db = db;

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
        [FromQuery] string? branchId = null)
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
        return Ok(await ProfitLoss.BuildAsync(_db, User, fromDay, toDay, branch));
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
        var quotes = _db.SalesDocuments.Where(d => d.Type == DocumentType.QUOTATION && d.IssueDate >= start && d.IssueDate < end);
        quotes = quotes.InBranches(User, d => d.BranchId);
        var quoteRows = await quotes.Select(d => new
        {
            Key = byDepartment ? d.DepartmentId ?? Guid.Empty : byBranch ? d.BranchId : d.RepId ?? d.StaffId,
            d.Status,
        }).ToListAsync();

        var keys = docs.Select(d => d.Key).Concat(quoteRows.Select(q => q.Key)).Distinct().ToList();
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
            var myQuotes = quoteRows.Where(q => q.Key == k).ToList();
            return new PerformanceRowDto(k.ToString(), names.GetValueOrDefault(k, ""), net, profit, invoices.Count,
                invoices.Select(d => d.PartyId).Distinct().Count(), invoices.Count == 0 ? 0 : net / invoices.Count,
                returns.Sum(d => d.Net), invoices.Sum(d => d.PaidAmount), myQuotes.Count,
                myQuotes.Count(q => q.Status == DocumentStatus.CONFIRMED), 0);
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
