using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Gains, losses and net profit (owner, 2026-10-06), worked out where the profit is made:
/// <list type="bullet">
/// <item><b>Company and branch</b> — straight from the ledger (the same figures as the income
/// statement), by the branch each entry belongs to.</item>
/// <item><b>Warehouse</b> — what each warehouse earned on the goods it sold (net sales − their cost,
/// returns taken off), its stocktake gains and losses, and the expenses paid from its own cash box.
/// What a branch has that no warehouse does (its own box's expenses, shipping, discounts, salaries…)
/// shows as the branch's "not on a warehouse" row, so the warehouses always add up to the branch.</item>
/// <item><b>General</b> — the main cash box is where money is gathered, not where it is earned: moving
/// money into it is neither gain nor loss. Expenses paid from it (and entries of no branch, such as
/// company-wide salaries) are the company's general expenses, kept apart and taken off only at the
/// company total — or, when asked, shared out over the branches by their share of net sales.</item>
/// </list>
/// Scoped like everything else: a person sees their branches and warehouses; the general row and the
/// company total only when they see every branch.
/// </summary>
public static class ProfitLoss
{
    private sealed record Bucket(Guid? BranchId, bool General);

    public static async Task<ProfitLossDto> BuildAsync(AppDbContext db, ClaimsPrincipal user, DateOnly from, DateOnly to,
        Guid? onlyBranch)
    {
        var (start, end) = CompanyClock.Days(from, to);
        var allBranches = Access.AllBranches(user);
        var mineBranches = Access.Branches(user);
        var mineWarehouses = Access.Warehouses(user);

        // ---- ledger: every revenue and expense amount by entry, in its bucket
        var accounts = await db.LedgerAccounts.AsNoTracking()
            .Where(a => !a.IsGroup && (a.Type == LedgerAccountType.REVENUE || a.Type == LedgerAccountType.EXPENSE))
            .Include(a => a.ExpenseCategory).ThenInclude(c => c!.Parent)
            .ToListAsync();
        var accountIds = accounts.Select(a => a.Id).ToList();
        var mainBoxes = await db.MoneyAccounts.AsNoTracking().Where(a => a.IsMain).Select(a => a.Id).ToListAsync();
        // Expenses paid out of the main box: the company's general expenses.
        var generalVouchers = (await db.Vouchers.AsNoTracking()
            .Where(v => v.Type == VoucherType.EXPENSE && v.Lines.Any(l => mainBoxes.Contains(l.AccountId)))
            .Select(v => v.Id).ToListAsync()).ToHashSet();
        // Expenses paid out of a warehouse's own box belong to that warehouse.
        var boxWarehouse = await db.MoneyAccounts.AsNoTracking().Where(a => a.WarehouseId != null)
            .ToDictionaryAsync(a => a.Id, a => a.WarehouseId!.Value);
        var voucherWarehouse = (await db.Vouchers.AsNoTracking()
                .Where(v => v.Type == VoucherType.EXPENSE)
                .Select(v => new { v.Id, Boxes = v.Lines.Select(l => l.AccountId).ToList() }).ToListAsync())
            .Select(v => (v.Id, Warehouses: v.Boxes.Select(b => boxWarehouse.TryGetValue(b, out var w) ? w : Guid.Empty).Distinct().ToList()))
            .Where(v => v.Warehouses.Count == 1 && v.Warehouses[0] != Guid.Empty)
            .ToDictionary(v => v.Id, v => v.Warehouses[0]);

        var lines = await db.JournalLines.AsNoTracking()
            .Where(l => accountIds.Contains(l.AccountId) && l.Entry!.Date >= start && l.Entry.Date < end
                        && l.Entry.SourceType != "YEAR_CLOSE")
            .GroupBy(l => new { l.AccountId, l.Entry!.BranchId, l.Entry.SourceType, l.Entry.SourceId })
            .Select(g => new { g.Key.AccountId, g.Key.BranchId, g.Key.SourceType, g.Key.SourceId, Net = g.Sum(x => x.Debit - x.Credit) })
            .ToListAsync();
        var byAccount = accounts.ToDictionary(a => a.Id);

        Bucket BucketOf(Guid? branch, string source, Guid? sourceId) =>
            branch is null || (source is "VOUCHER" or "VOUCHER_CANCEL" && sourceId is Guid s && generalVouchers.Contains(s))
                ? new Bucket(null, true)
                : new Bucket(branch, false);

        // Figures from ledger amounts, per bucket and per account.
        var perBucket = new Dictionary<Bucket, Dictionary<Guid, long>>();
        var warehouseExpenses = new Dictionary<Guid, long>();
        foreach (var l in lines)
        {
            var b = BucketOf(l.BranchId, l.SourceType, l.SourceId);
            if (!perBucket.TryGetValue(b, out var map)) perBucket[b] = map = new();
            map[l.AccountId] = map.GetValueOrDefault(l.AccountId) + l.Net;
            if (!b.General && l.SourceType is "VOUCHER" or "VOUCHER_CANCEL" && l.SourceId is Guid vid
                && voucherWarehouse.TryGetValue(vid, out var wh) && byAccount[l.AccountId].Type == LedgerAccountType.EXPENSE)
                warehouseExpenses[wh] = warehouseExpenses.GetValueOrDefault(wh) + l.Net;
        }

        bool BranchVisible(Guid id) => (mineBranches is null || mineBranches.Contains(id)) && (onlyBranch is null || onlyBranch == id);

        // ---- warehouses: goods sold, their cost, stocktake differences (documents and stock movements)
        var docLines = await db.DocumentLines.AsNoTracking()
            .Where(l => l.WarehouseId != null && l.Document!.IssueDate >= start && l.Document.IssueDate < end
                        && l.Document.Status != DocumentStatus.CANCELLED
                        && (l.Document.Type == DocumentType.SALES_INVOICE || l.Document.Type == DocumentType.SALES_RETURN))
            .GroupBy(l => new { Warehouse = l.WarehouseId!.Value, l.Document!.Type })
            .Select(g => new { g.Key.Warehouse, g.Key.Type, Net = g.Sum(x => x.LineTotal - x.DocDiscount), Cost = g.Sum(x => x.LineCost) })
            .ToListAsync();
        var adjustments = await db.StockMovements.AsNoTracking()
            .Where(m => m.Type == StockMovementType.ADJUSTMENT && m.CreatedAt >= start && m.CreatedAt < end)
            .GroupBy(m => m.WarehouseId)
            .Select(g => new
            {
                g.Key,
                Gain = g.Where(m => m.Quantity > 0).Sum(m => (long)m.Quantity * m.UnitCost),
                Loss = g.Where(m => m.Quantity < 0).Sum(m => (long)-m.Quantity * m.UnitCost),
            })
            .ToDictionaryAsync(x => x.Key, x => (x.Gain, x.Loss));
        var warehouses = await db.Warehouses.AsNoTracking().Where(w => w.Kind == WarehouseKind.STORE)
            .Select(w => new { w.Id, w.Name, w.BranchId }).ToListAsync();
        var branches = await db.Branches.AsNoTracking().Select(b => new { b.Id, b.Name }).ToListAsync();

        PlFiguresDto WarehouseFigures(Guid id)
        {
            long Sum(DocumentType t, bool cost) =>
                docLines.Where(d => d.Warehouse == id && d.Type == t).Sum(d => cost ? d.Cost : d.Net);
            var netSales = Sum(DocumentType.SALES_INVOICE, false) - Sum(DocumentType.SALES_RETURN, false);
            var cogs = Sum(DocumentType.SALES_INVOICE, true) - Sum(DocumentType.SALES_RETURN, true);
            var (gain, loss) = adjustments.GetValueOrDefault(id);
            return Figures(netSales, cogs, gain, loss + warehouseExpenses.GetValueOrDefault(id));
        }

        var units = new List<PlUnitDto>();
        foreach (var b in branches.Where(b => BranchVisible(b.Id)).OrderBy(b => b.Name))
        {
            var ledger = FromLedger(perBucket.GetValueOrDefault(new Bucket(b.Id, false)), byAccount);
            var stores = warehouses.Where(w => w.BranchId == b.Id && (mineWarehouses is null || mineWarehouses.Contains(w.Id)))
                .OrderBy(w => w.Name)
                .Select(w => new PlUnitDto(w.Id.ToString(), Loc.Clean(w.Name) ?? w.Name, "WAREHOUSE", WarehouseFigures(w.Id), null, 0))
                .ToList();
            PlFiguresDto figures;
            if (mineWarehouses is not null)
                figures = Sum(stores.Select(s => s.Figures)); // only their warehouses: no branch-wide figures
            else
            {
                figures = ledger;
                var rest = Minus(ledger, Sum(stores.Select(s => s.Figures)));
                if (rest.NetSales != 0 || rest.Cogs != 0 || rest.OtherIncome != 0 || rest.Expenses != 0)
                    stores.Add(new PlUnitDto(b.Id.ToString(), "", "BRANCH_REST", rest, null, 0));
            }
            if (figures.NetSales == 0 && figures.Expenses == 0 && figures.OtherIncome == 0 && stores.All(s => s.Figures.NetSales == 0))
                continue;
            units.Add(new PlUnitDto(b.Id.ToString(), b.Name, "BRANCH", figures, stores.ToArray(), 0));
        }

        // ---- general expenses (main box, no branch) and the company total
        PlFiguresDto? general = null;
        if (allBranches && onlyBranch is null)
            general = FromLedger(perBucket.GetValueOrDefault(new Bucket(null, true)), byAccount);
        var total = Sum(units.Select(u => u.Figures).Concat(general is null ? Array.Empty<PlFiguresDto>() : new[] { general }));

        // Each branch's share of the general expenses, by its share of net sales.
        var generalCost = general is null ? 0 : -general.NetProfit;
        var salesBase = units.Sum(u => Math.Max(0, u.Figures.NetSales));
        if (generalCost != 0 && salesBase > 0)
        {
            long given = 0;
            for (var i = 0; i < units.Count; i++)
            {
                var share = i == units.Count - 1
                    ? generalCost - given
                    : (long)Math.Round((decimal)generalCost * Math.Max(0, units[i].Figures.NetSales) / salesBase);
                given += share;
                units[i] = units[i] with { GeneralShare = share };
            }
        }

        // ---- the detail lines (gains and losses) of everything the person sees
        var seen = perBucket.Where(kv => kv.Key.General ? general is not null
                : kv.Key.BranchId is Guid id && BranchVisible(id) && mineWarehouses is null)
            .SelectMany(kv => kv.Value)
            .GroupBy(kv => kv.Key).ToDictionary(g => g.Key, g => g.Sum(x => x.Value));
        var detail = seen.Where(kv => kv.Value != 0).Select(kv =>
            {
                var a = byAccount[kv.Key];
                var amount = a.Type == LedgerAccountType.REVENUE ? -kv.Value : kv.Value;
                var section = a.SystemKey switch
                {
                    LedgerKeys.Sales or LedgerKeys.SalesReturns => "SALES",
                    LedgerKeys.Cogs => "COGS",
                    _ => a.Type == LedgerAccountType.REVENUE ? "GAIN" : "LOSS",
                };
                return new PlLineDto(a.Code, NameOf(a), section, amount);
            })
            .OrderBy(l => l.Code).ToArray();

        var currency = await db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        return new ProfitLossDto(from.ToString("yyyy-MM-dd"), to.ToString("yyyy-MM-dd"), currency,
            mineWarehouses is null ? total : Sum(units.Select(u => u.Figures)),
            units.ToArray(), general, detail);
    }

    private static string NameOf(LedgerAccount a) =>
        a.ExpenseCategory is null ? a.Name
        : a.ExpenseCategory.Parent is null ? Loc.Name(a.ExpenseCategory)
        : $"{Loc.Name(a.ExpenseCategory.Parent)} › {Loc.Name(a.ExpenseCategory)}";

    private static PlFiguresDto Figures(long netSales, long cogs, long otherIncome, long expenses) =>
        new(netSales, cogs, netSales - cogs, otherIncome, expenses, netSales - cogs + otherIncome - expenses);

    private static PlFiguresDto FromLedger(Dictionary<Guid, long>? amounts, Dictionary<Guid, LedgerAccount> accounts)
    {
        long netSales = 0, cogs = 0, other = 0, expenses = 0;
        foreach (var (id, net) in amounts ?? new())
        {
            var a = accounts[id];
            if (a.Type == LedgerAccountType.REVENUE)
            {
                if (a.SystemKey is LedgerKeys.Sales or LedgerKeys.SalesReturns) netSales -= net;
                else other -= net;
            }
            else if (a.SystemKey == LedgerKeys.Cogs) cogs += net;
            else expenses += net;
        }
        return Figures(netSales, cogs, other, expenses);
    }

    private static PlFiguresDto Sum(IEnumerable<PlFiguresDto> items)
    {
        long n = 0, c = 0, o = 0, e = 0;
        foreach (var f in items)
        {
            n += f.NetSales;
            c += f.Cogs;
            o += f.OtherIncome;
            e += f.Expenses;
        }
        return Figures(n, c, o, e);
    }

    private static PlFiguresDto Minus(PlFiguresDto a, PlFiguresDto b) =>
        Figures(a.NetSales - b.NetSales, a.Cogs - b.Cogs, a.OtherIncome - b.OtherIncome, a.Expenses - b.Expenses);
}
