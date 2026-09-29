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
[Authorize(Policy = Permissions.AnalyticsView)]
public sealed class AnalyticsController : ControllerBase
{
    private readonly AppDbContext _db;

    public AnalyticsController(AppDbContext db) => _db = db;

    private static readonly DocumentType[] SalesTypes = { DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN };
    private static readonly DocumentType[] PurchaseTypes = { DocumentType.PURCHASE_INVOICE, DocumentType.PURCHASE_RETURN };

    /// <summary>Net sales and purchases for each of the last <paramref name="months"/> months (UTC).</summary>
    [HttpGet("monthly")]
    public async Task<ActionResult<MonthlySalesDto[]>> Monthly([FromQuery] int months = 12)
    {
        months = Math.Clamp(months, 1, 36);
        var now = DateTime.UtcNow;
        var first = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-(months - 1));
        var rows = await Docs().Where(d => d.IssueDate >= first)
            .GroupBy(d => new { d.IssueDate.Year, d.IssueDate.Month, d.Type })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Type, Net = g.Sum(d => d.Subtotal - d.DiscountTotal), Count = g.Count() })
            .ToListAsync();
        var result = new List<MonthlySalesDto>();
        for (var m = first; m <= now; m = m.AddMonths(1))
        {
            long Sum(DocumentType t) => rows.Where(r => r.Year == m.Year && r.Month == m.Month && r.Type == t).Sum(r => r.Net);
            var sales = Sum(DocumentType.SALES_INVOICE);
            var returns = Sum(DocumentType.SALES_RETURN);
            result.Add(new MonthlySalesDto(m.ToString("yyyy-MM"), sales, returns, sales - returns,
                Sum(DocumentType.PURCHASE_INVOICE) - Sum(DocumentType.PURCHASE_RETURN),
                rows.Where(r => r.Year == m.Year && r.Month == m.Month && r.Type == DocumentType.SALES_INVOICE).Sum(r => r.Count)));
        }
        return Ok(result.ToArray());
    }

    /// <summary>The customers (or suppliers) with the most net business in a period.</summary>
    [HttpGet("top-parties")]
    public async Task<ActionResult<TopPartyDto[]>> TopParties(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string side = "customers",
        [FromQuery] int limit = 10)
    {
        var (start, end) = Period(from, to);
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
    public async Task<ActionResult<PerformanceDto>> Performance(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string by = "rep")
    {
        var (start, end) = Period(from, to);
        var byBranch = by.Equals("branch", StringComparison.OrdinalIgnoreCase);
        var docs = await Docs()
            .Where(d => (d.Type == DocumentType.SALES_INVOICE || d.Type == DocumentType.SALES_RETURN)
                        && d.IssueDate >= start && d.IssueDate < end)
            .Select(d => new
            {
                d.Type,
                Key = byBranch
                    ? (d.Type == DocumentType.SALES_RETURN && d.SourceDocument != null ? d.SourceDocument.BranchId : d.BranchId)
                    : (d.Type == DocumentType.SALES_RETURN && d.SourceDocument != null
                        ? d.SourceDocument.RepId ?? d.SourceDocument.StaffId
                        : d.RepId ?? d.StaffId),
                d.PartyId, Net = d.Subtotal - d.DiscountTotal, d.ProfitTotal, d.PaidAmount,
            }).ToListAsync();
        var quotes = _db.SalesDocuments.Where(d => d.Type == DocumentType.QUOTATION && d.IssueDate >= start && d.IssueDate < end);
        if (Scope() is Guid b) quotes = quotes.Where(d => d.BranchId == b);
        var quoteRows = await quotes.Select(d => new { Key = byBranch ? d.BranchId : d.RepId ?? d.StaffId, d.Status }).ToListAsync();

        var keys = docs.Select(d => d.Key).Concat(quoteRows.Select(q => q.Key)).Distinct().ToList();
        var names = byBranch
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
        return Ok(new PerformanceDto(byBranch ? "branch" : "rep", start.ToString("yyyy-MM-dd"),
            end.AddDays(-1).ToString("yyyy-MM-dd"), result, totalNet, rows.Sum(r => r.Profit), rows.Sum(r => r.Invoices),
            currency));
    }

    /// <summary>
    /// Items that moved most in a period (net units sold), and dead stock: items in stock that
    /// didn't sell at all in the period (الأصناف الراكدة), with their value at cost.
    /// </summary>
    [HttpGet("item-movement")]
    public async Task<ActionResult<ItemMovementDto>> ItemMovement(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] int limit = 20)
    {
        var (start, end) = Period(from, to);
        limit = Math.Clamp(limit, 1, 100);
        var lines = _db.DocumentLines.Where(l => l.Document!.Status != DocumentStatus.CANCELLED
                                                 && l.Document.IssueDate >= start && l.Document.IssueDate < end);
        if (Scope() is Guid b) lines = lines.Where(l => l.Document!.BranchId == b);
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

        // Stock on hand: the whole company, or the branch's warehouses for branch-scoped users.
        Dictionary<Guid, int> stock;
        if (Scope() is Guid branch)
            stock = await _db.StockBalances.Where(x => x.Warehouse!.BranchId == branch && x.Quantity > 0)
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
            .OrderByDescending(x => x.StockValue).Take(200).ToArray();
        var currency = await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return Ok(new ItemMovementDto(start.ToString("yyyy-MM-dd"), end.AddDays(-1).ToString("yyyy-MM-dd"),
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
    public async Task<ActionResult<AgingDto>> Aging([FromQuery] string side = "customers")
    {
        var suppliers = side.Equals("suppliers", StringComparison.OrdinalIgnoreCase);
        var type = suppliers ? DocumentType.PURCHASE_INVOICE : DocumentType.SALES_INVOICE;
        var q = _db.SalesDocuments.AsNoTracking().Where(d => d.Type == type && d.Status != DocumentStatus.CANCELLED
                                                             && d.PaidAmount < d.GrandTotal);
        if (Scope() is Guid b) q = q.Where(d => d.BranchId == b);
        var scoped = Scope() is not null;
        var docs = await q.ToListAsync();
        var owed = await MoneyService.OutstandingAsync(_db, docs);
        var today = DateTime.UtcNow.Date;
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
                .Select(d => (Age: (today - d.IssueDate.Date).Days, Left: owed[d.Id])).ToList();
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
        if (Scope() is Guid b) q = q.Where(d => d.BranchId == b);
        return q;
    }

    private Guid? Scope() => MoneyService.ScopeOf(User);

    /// <summary>Whole UTC days; defaults to the last 90 days.</summary>
    private static (DateTime Start, DateTime End) Period(string? from, string? to)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var toDay = DateOnly.TryParse(to, out var t) ? t : today;
        var fromDay = DateOnly.TryParse(from, out var f) ? f : toDay.AddDays(-89);
        if (fromDay > toDay) (fromDay, toDay) = (toDay, fromDay);
        return (fromDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), toDay.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
    }
}
