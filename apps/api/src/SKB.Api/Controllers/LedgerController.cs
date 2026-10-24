using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The general ledger (الحسابات العامة — DOMAIN.md §2.8): the chart of accounts with balances,
/// account and party statements, the trial balance, the journal, manual (compound) entries and
/// the period lock. Documents post their own entries; manual entries can't touch money accounts
/// or stock (use vouchers and stocktakes), and an entry on a party's account moves the party's
/// balance with it. The ledger is company-wide; each part (accounts, journal, each statement,
/// posting, reversing, the lock, closing a year) is a permission of its own.
/// </summary>
[ApiController]
[Route("api/ledger")]
[Authorize]
public sealed class LedgerController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly LedgerService _ledger;
    private readonly AuditService _audit;

    public LedgerController(AppDbContext db, LedgerService ledger, AuditService audit)
    {
        _db = db;
        _ledger = ledger;
        _audit = audit;
    }

    /// <summary>Groups whose sub-accounts come only from their own records (a customer, a cash box…).</summary>
    private static readonly string[] AutoParents =
        { LedgerKeys.Cash, LedgerKeys.Banks, LedgerKeys.Customers, LedgerKeys.Carriers, LedgerKeys.Suppliers, LedgerKeys.Operating };

    /// <summary>
    /// What this person may read of the ledger (rule 11): the entries of their branches. An entry of no
    /// branch (opening balances, a year's close, a manual entry by whoever sees every branch) is the
    /// whole company's, read by whoever sees every branch.
    /// </summary>
    private IQueryable<JournalEntry> VisibleEntries() =>
        Access.Branches(User) is { } branches
            ? _db.JournalEntries.Where(e => e.BranchId != null && branches.Contains(e.BranchId.Value))
            : _db.JournalEntries;

    private IQueryable<JournalLine> VisibleLines() =>
        Access.Branches(User) is { } branches
            ? _db.JournalLines.Where(l => l.Entry!.BranchId != null && branches.Contains(l.Entry.BranchId.Value))
            : _db.JournalLines;

    // ------------------------------------------------------------------ accounts

    [HttpGet("accounts")]
    [AnyPermission(Permissions.LedgerAccounts, Permissions.LedgerAccountsCreate, Permissions.LedgerAccountsEdit,
        Permissions.LedgerPost, Permissions.StatementLedger)]
    public async Task<ActionResult<LedgerAccountDto[]>> Accounts()
    {
        var accounts = await WithLinks(_db.LedgerAccounts).OrderBy(a => a.Code).ToListAsync();
        var sums = await VisibleLines().GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToDictionaryAsync(x => x.Key, x => (x.Debit, x.Credit));
        // Without the right to see costs, the cost accounts show empty and don't count in their groups.
        foreach (var hidden in await HiddenAccountIdsAsync()) sums.Remove(hidden);
        var children = accounts.Where(a => a.ParentId != null).ToLookup(a => a.ParentId!.Value);
        var totals = new Dictionary<Guid, (long Debit, long Credit)>();
        (long, long) Total(LedgerAccount a)
        {
            if (totals.TryGetValue(a.Id, out var t)) return t;
            var (d, c) = sums.GetValueOrDefault(a.Id);
            foreach (var child in children[a.Id])
            {
                var (cd, cc) = Total(child);
                d += cd;
                c += cc;
            }
            return totals[a.Id] = (d, c);
        }
        return Ok(accounts.Select(a =>
        {
            var (d, c) = Total(a);
            return ToDto(a, d, c);
        }).ToArray());
    }

    /// <summary>Add an account under a group (not under the groups that fill themselves, like customers).</summary>
    [HttpPost("accounts")]
    [Authorize(Policy = Permissions.LedgerAccountsCreate)]
    public async Task<ActionResult<LedgerAccountDto>> CreateAccount([FromBody] CreateLedgerAccountRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null) return Bad("bad_name", "Enter the name.");
        if (!Guid.TryParse(req.ParentId, out var parentId)) return Bad("parent_not_found", "Choose the group it goes under.");
        await using var tx = await _db.Database.BeginTransactionAsync();
        var parent = await _db.LedgerAccounts.FirstOrDefaultAsync(a => a.Id == parentId && a.IsGroup && a.IsActive);
        if (parent is null) return Bad("parent_not_found", "Choose the group it goes under.");
        if (parent.SystemKey is not null && AutoParents.Contains(parent.SystemKey))
            return Bad("auto_group", "Accounts here are made from customers, suppliers, cash boxes and expense categories.");
        var lower = name.ToLower();
        if (await _db.LedgerAccounts.AnyAsync(a => a.ParentId == parentId && a.Name.ToLower() == lower))
            return Bad("duplicate_name", $"There is already an account called {name} here.");
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"ledger:" + parentId}))");
        var account = new LedgerAccount
        {
            Code = await _ledger.NextChildCodeAsync(parent), Name = name, Type = parent.Type, ParentId = parentId,
            IsGroup = req.IsGroup,
        };
        _db.LedgerAccounts.Add(account);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "ledger_account", account.Id);
        return Created($"/api/ledger/accounts/{account.Id}", ToDto(account, 0, 0));
    }

    [HttpPut("accounts/{id:guid}")]
    [Authorize(Policy = Permissions.LedgerAccountsEdit)]
    public async Task<ActionResult<LedgerAccountDto>> UpdateAccount(Guid id, [FromBody] UpdateLedgerAccountRequest req)
    {
        var account = await _db.LedgerAccounts.Include(a => a.Party).Include(a => a.MoneyAccount)
            .Include(a => a.ExpenseCategory).ThenInclude(c => c!.Parent).FirstOrDefaultAsync(a => a.Id == id);
        if (account is null) return NotFound(new { message = "Account not found.", code = "not_found" });
        var linked = account.PartyId != null || account.MoneyAccountId != null || account.ExpenseCategoryId != null;
        if (req.Name is not null)
        {
            if (linked) return Bad("linked_account", "This account takes the name of its customer, cash box or category.");
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Enter the name.");
            account.Name = name;
        }
        if (req.IsActive is bool active && active != account.IsActive)
        {
            if (!active)
            {
                if (account.SystemKey is not null || linked)
                    return Bad("system_account", "This account is part of the setup and stays open.");
                var used = await _db.JournalLines.Where(l => l.AccountId == id)
                    .SumAsync(l => (long?)(l.Debit - l.Credit)) ?? 0;
                if (used != 0) return Bad("has_balance", "Bring the account to zero before closing it.");
                if (await _db.LedgerAccounts.AnyAsync(a => a.ParentId == id && a.IsActive))
                    return Bad("has_children", "Close the accounts under it first.");
            }
            account.IsActive = active;
        }
        await _db.SaveChangesAsync();
        await AuditAsync("update", "ledger_account", account.Id);
        var sum = await VisibleLines().Where(l => l.AccountId == id)
            .GroupBy(l => 1).Select(g => new { D = g.Sum(l => l.Debit), C = g.Sum(l => l.Credit) }).FirstOrDefaultAsync();
        return Ok(ToDto(account, sum?.D ?? 0, sum?.C ?? 0));
    }

    // ------------------------------------------------------------------ statements

    /// <summary>An account's lines between two days, with the balance before and after (a group: everything under it).</summary>
    [HttpGet("accounts/{id:guid}/statement")]
    [AnyPermission(Permissions.StatementLedger, Permissions.LedgerAccounts)]
    public async Task<ActionResult<LedgerStatementDto>> AccountStatement(Guid id, [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        var account = await WithLinks(_db.LedgerAccounts).FirstOrDefaultAsync(a => a.Id == id);
        if (account is null) return NotFound(new { message = "Account not found.", code = "not_found" });
        var all = await _db.LedgerAccounts.AsNoTracking().Select(a => new { a.Id, a.ParentId }).ToListAsync();
        var ids = new HashSet<Guid> { id };
        for (var grew = true; grew;)
        {
            grew = false;
            foreach (var a in all)
                if (a.ParentId is Guid p && ids.Contains(p) && ids.Add(a.Id)) grew = true;
        }
        var hidden = await HiddenAccountIdsAsync();
        if (hidden.Contains(id)) return StatusCode(403, Costs.Refusal);
        ids.ExceptWith(hidden);
        return await StatementAsync($"{account.Code} {NameOf(account)}", VisibleLines().Where(l => ids.Contains(l.AccountId)), from, to);
    }

    /// <summary>A customer's / supplier's / carrier's statement (كشف حساب): every line on their accounts.</summary>
    [HttpGet("parties/{partyId:guid}/statement")]
    [AnyPermission(Permissions.StatementCustomers, Permissions.StatementSuppliers, Permissions.StatementCarriers)]
    /// <remarks>
    /// Like the old program's كشف حساب: each line says which book it went through (الدفتر — the sales
    /// department of an invoice, the cash box or bank of a receipt), its document number and notes.
    /// <paramref name="branchId"/> keeps one branch's lines; <paramref name="items"/> adds every
    /// invoice's and return's items (كشف أصناف).
    /// </remarks>
    /// <param name="departmentId">Only invoices and returns of one sales department (owner, 2026-10-02).</param>
    /// <param name="warehouseId">Only invoices and returns with goods in one warehouse.</param>
    public async Task<ActionResult<LedgerStatementDto>> PartyStatement(Guid partyId, [FromQuery] string? from = null,
        [FromQuery] string? to = null, [FromQuery] string? branchId = null, [FromQuery] bool items = false,
        [FromQuery] string? departmentId = null, [FromQuery] string? warehouseId = null)
    {
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId);
        if (party is null) return NotFound(new { message = "Party not found.", code = "not_found" });
        // Customers', suppliers' and shipping companies' statements are a permission each (owner, 2026-10-23).
        if (!((party.Types.Contains(nameof(PartyType.CUSTOMER)) && User.Has(Permissions.StatementCustomers))
              || (party.Types.Contains(nameof(PartyType.SUPPLIER)) && User.Has(Permissions.StatementSuppliers))
              || (party.Types.Contains(nameof(PartyType.CARRIER)) && User.Has(Permissions.StatementCarriers))))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var lines = VisibleLines().Where(l => l.Account!.PartyId == partyId);
        // A cancelled invoice is not on the customer's statement, and a changed one shows only as it
        // stands now (owner, 2026-10-01): its earlier postings, the discounts given on them and their
        // reversals cancel out, so leaving them all out keeps every balance the same. A discount given
        // since it was last posted shows on its own line (owner, 2026-10-24).
        // A cancelled return isn't on it either (owner, 2026-10-24): it and its reversal cancel out.
        var superseded = _db.JournalEntries.Where(e =>
            e.SourceType == "SALES_INVOICE_CANCEL" || e.SourceType == "SALES_RETURN_CANCEL"
            || e.SourceType == "PURCHASE_RETURN_CANCEL"
            || ((e.SourceType == "SALES_RETURN" || e.SourceType == "PURCHASE_RETURN")
                && _db.SalesDocuments.Any(d => d.Id == e.SourceId && d.Status == DocumentStatus.CANCELLED))
            || ((e.SourceType == "SALES_INVOICE" || e.SourceType == "SALES_DISCOUNT")
                && (_db.SalesDocuments.Any(d => d.Id == e.SourceId && d.Status == DocumentStatus.CANCELLED)
                    || _db.JournalEntries.Any(o => o.SourceType == "SALES_INVOICE" && o.SourceId == e.SourceId
                                                   && o.Serial > e.Serial))))
            .Select(e => e.Id);
        lines = lines.Where(l => !superseded.Contains(l.EntryId));
        if (!string.IsNullOrWhiteSpace(branchId))
        {
            if (!Guid.TryParse(branchId, out var branch)) return Bad("branch_not_found", "Branch not found.");
            lines = lines.Where(l => l.Entry!.BranchId == branch);
        }
        if (!string.IsNullOrWhiteSpace(departmentId))
        {
            if (!Guid.TryParse(departmentId, out var dept)) return Bad("department_not_found", "Department not found.");
            lines = lines.Where(l => _db.SalesDocuments.Any(d => d.Id == l.Entry!.SourceId && d.DepartmentId == dept));
        }
        if (!string.IsNullOrWhiteSpace(warehouseId))
        {
            if (!Guid.TryParse(warehouseId, out var wh)) return Bad("warehouse_not_found", "Warehouse not found.");
            lines = lines.Where(l => _db.DocumentLines.Any(dl => dl.DocumentId == l.Entry!.SourceId && dl.WarehouseId == wh));
        }
        return await StatementAsync(party.Name, lines, from, to, (rows, dto) => DetailAsync(rows, dto, items));
    }

    private static readonly string[] DocumentSources =
        { "SALES_INVOICE", "SALES_DISCOUNT", "SALES_RETURN", "PURCHASE_INVOICE", "PURCHASE_RETURN" };

    /// <summary>What each statement line's document says: its number, book, notes, branch and (optionally) items.</summary>
    private async Task<LedgerLineDto[]> DetailAsync(List<JournalLine> rows, LedgerLineDto[] dto, bool items)
    {
        Guid[] Ids(params string[] types) => rows.Where(r => types.Contains(r.Entry!.SourceType) && r.Entry.SourceId != null)
            .Select(r => r.Entry!.SourceId!.Value).Distinct().ToArray();
        var docIds = Ids(DocumentSources);
        var voucherIds = Ids("VOUCHER");
        var noteIds = Ids("NOTE");
        var docs = await _db.SalesDocuments.AsNoTracking().Include(d => d.Department).Include(d => d.PaidAccount)
            .Where(d => docIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id);
        var vouchers = await _db.Vouchers.AsNoTracking().Include(v => v.FromAccount).Include(v => v.ToAccount)
            .Where(v => voucherIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id);
        var notes = await _db.Notes.AsNoTracking().Where(n => noteIds.Contains(n.Id)).ToDictionaryAsync(n => n.Id);
        var branchIds = rows.Where(r => r.Entry!.BranchId != null).Select(r => r.Entry!.BranchId!.Value).Distinct().ToList();
        var branches = await _db.Branches.AsNoTracking().Where(b => branchIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => Loc.Name(b));
        // Where each document's goods went or came from (one or more warehouses).
        var stores = (await _db.DocumentLines.AsNoTracking().Where(l => docIds.Contains(l.DocumentId) && l.WarehouseId != null)
                .Select(l => new { l.DocumentId, l.WarehouseId }).Distinct().ToListAsync())
            .GroupBy(x => x.DocumentId).ToDictionary(g => g.Key, g => g.Select(x => x.WarehouseId!.Value).ToList());
        var storeIds = stores.Values.SelectMany(x => x).Distinct().ToList();
        var storeNames = await _db.Warehouses.AsNoTracking().Where(w => storeIds.Contains(w.Id))
            .ToDictionaryAsync(w => w.Id, w => Loc.Name(w));
        string? StoresOf(Guid docId) => stores.TryGetValue(docId, out var ws)
            ? string.Join("، ", ws.Select(w => storeNames.GetValueOrDefault(w, "")).Where(n => n != ""))
            : null;
        var itemLines = new Dictionary<Guid, StatementItemDto[]>();
        if (items && docIds.Length > 0)
            itemLines = (await _db.DocumentLines.AsNoTracking().Include(l => l.Unit)
                    .Where(l => docIds.Contains(l.DocumentId)).OrderBy(l => l.LineNo).ToListAsync())
                .GroupBy(l => l.DocumentId)
                .ToDictionary(g => g.Key, g => g.Select(l => new StatementItemDto(l.ProductName,
                    l.UnitQuantity > 0 ? l.UnitQuantity : l.Quantity, l.Unit is null ? null : Loc.Name(l.Unit),
                    l.UnitPrice, l.Discount, l.LineTotal, l.IsBonus)).ToArray());

        // An invoice paid on the spot has two lines here; its items go under the first only.
        var listed = new HashSet<Guid>();
        return dto.Select((line, i) =>
        {
            var entry = rows[i].Entry!;
            var branch = entry.BranchId is Guid b ? branches.GetValueOrDefault(b) : null;
            if (entry.SourceId is not Guid source) return line with { BranchName = branch };
            if (docs.TryGetValue(source, out var d))
                return line with
                {
                    // What was paid on the spot went through a cash box or bank: that is its book.
                    DocumentNumber = d.Number,
                    Book = d.PaidAccount is not null && entry.SourceType != "SALES_DISCOUNT"
                           && (d.Type == DocumentType.SALES_INVOICE ? line.Credit > 0 : line.Debit > 0)
                        ? Loc.Name(d.PaidAccount)
                        : d.Department is null ? null : Loc.Name(d.Department),
                    Note = d.Notes, BranchName = branch,
                    Items = listed.Add(d.Id) ? itemLines.GetValueOrDefault(d.Id) : null,
                    DepartmentName = d.Department is null ? null : Loc.Name(d.Department),
                    WarehouseName = StoresOf(d.Id), DocumentId = d.Id.ToString(), DocumentKind = d.Type.ToString(),
                };
            if (vouchers.TryGetValue(source, out var v))
            {
                var account = v.ToAccount ?? v.FromAccount;
                return line with
                {
                    DocumentNumber = v.Number, Book = account is null ? null : Loc.Name(account), Note = v.Notes,
                    BranchName = branch, DocumentId = v.Id.ToString(), DocumentKind = v.Type.ToString(),
                };
            }
            if (notes.TryGetValue(source, out var n))
                return line with
                {
                    DocumentNumber = n.SerialNumber, Book = n.BankName, Note = n.Remark, BranchName = branch,
                    DocumentId = n.Id.ToString(), DocumentKind = "NOTE",
                };
            return line with { BranchName = branch };
        }).ToArray();
    }

    private async Task<ActionResult<LedgerStatementDto>> StatementAsync(string title, IQueryable<JournalLine> lines,
        string? from, string? to, Func<List<JournalLine>, LedgerLineDto[], Task<LedgerLineDto[]>>? detail = null)
    {
        if (!Range(from, to, out var fromDay, out var toDay, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        var opening = await lines.Where(l => l.Entry!.Date < start).SumAsync(l => (long?)(l.Debit - l.Credit)) ?? 0;
        var rows = await lines.AsNoTracking().Include(l => l.Entry).Include(l => l.Account)
            .Where(l => l.Entry!.Date >= start && l.Entry.Date < end)
            .OrderBy(l => l.Entry!.Date).ThenBy(l => l.Entry!.CreatedAt).ThenBy(l => l.LineNo)
            .Take(10000).ToListAsync();
        var names = await AccountNamesAsync(rows.Select(r => r.AccountId));
        var running = opening;
        var dto = rows.Select(l =>
        {
            running += l.Debit - l.Credit;
            return new LedgerLineDto(l.EntryId.ToString(), l.Entry!.Date.ToString("o"), l.Entry.Number, l.Entry.Description,
                l.Entry.SourceType, l.Entry.SourceId?.ToString(), l.Account!.Code, names[l.AccountId], l.Debit, l.Credit,
                l.Memo, running, EntrySerial: l.Entry.Serial);
        }).ToArray();
        if (detail is not null) dto = await detail(rows, dto);
        var debit = rows.Sum(l => l.Debit);
        var credit = rows.Sum(l => l.Credit);
        return Ok(new LedgerStatementDto(title, fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"),
            opening, debit, credit, opening + debit - credit, dto, await CurrencyAsync()));
    }

    /// <summary>
    /// Trial balance (ميزان المراجعة): for every account that takes entries, its balance before the
    /// period, the period's debits and credits, and its balance at the end.
    /// </summary>
    [HttpGet("trial-balance")]
    [Authorize(Policy = Permissions.LedgerTrialBalance)]
    public async Task<ActionResult<TrialBalanceDto>> TrialBalance([FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        // Shows cost of goods sold and stock: the report's own permission is enough (owner, 2026-10-23).
        if (!Range(from, to, out var fromDay, out var toDay, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        var before = await VisibleLines().Where(l => l.Entry!.Date < start).GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, Net = g.Sum(l => l.Debit - l.Credit) }).ToDictionaryAsync(x => x.Key, x => x.Net);
        var during = await VisibleLines().Where(l => l.Entry!.Date >= start && l.Entry.Date < end).GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, D = g.Sum(l => l.Debit), C = g.Sum(l => l.Credit) })
            .ToDictionaryAsync(x => x.Key, x => (x.D, x.C));
        var accounts = await WithLinks(_db.LedgerAccounts).Where(a => !a.IsGroup).OrderBy(a => a.Code).ToListAsync();
        var rows = accounts.Where(a => before.ContainsKey(a.Id) || during.ContainsKey(a.Id)).Select(a =>
        {
            var open = before.GetValueOrDefault(a.Id);
            var (d, c) = during.GetValueOrDefault(a.Id);
            var close = open + d - c;
            return new TrialBalanceRowDto(a.Id.ToString(), a.Code, NameOf(a), a.Type.ToString(), a.ParentId?.ToString(),
                Math.Max(0, open), Math.Max(0, -open), d, c, Math.Max(0, close), Math.Max(0, -close));
        }).ToArray();
        return Ok(new TrialBalanceDto(fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), rows, await CurrencyAsync()));
    }

    // ------------------------------------------------------------------ financial statements

    /// <summary>
    /// Income statement (قائمة الدخل) for a period, straight from the ledger: revenue (net of
    /// sales returns) − cost of goods sold = gross profit; − expenses = net profit.
    /// </summary>
    [HttpGet("income-statement")]
    [Authorize(Policy = Permissions.LedgerIncomeStatement)]
    public async Task<ActionResult<IncomeStatementDto>> IncomeStatement([FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        // The income statement is the company's profit: the report's own permission is enough.
        if (!Range(from, to, out var fromDay, out var toDay, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        var net = await NetByAccountAsync(l => l.Entry!.Date >= start && l.Entry.Date < end && l.Entry.SourceType != "YEAR_CLOSE");
        var (accounts, groupOf) = await ChartAsync();
        var rows = new List<FinancialRowDto>();
        foreach (var a in accounts.Where(a => !a.IsGroup && a.Type is LedgerAccountType.REVENUE or LedgerAccountType.EXPENSE))
        {
            var n = net.GetValueOrDefault(a.Id);
            if (n == 0) continue;
            var section = a.Type == LedgerAccountType.REVENUE ? "REVENUE" : a.SystemKey == LedgerKeys.Cogs ? "COGS" : "EXPENSE";
            rows.Add(new(a.Id.ToString(), a.Code, NameOf(a), section, groupOf(a), section == "REVENUE" ? -n : n));
        }
        var revenue = rows.Where(r => r.Section == "REVENUE").Sum(r => r.Amount);
        var cogs = rows.Where(r => r.Section == "COGS").Sum(r => r.Amount);
        var expenses = rows.Where(r => r.Section == "EXPENSE").Sum(r => r.Amount);
        return Ok(new IncomeStatementDto(fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), rows.ToArray(),
            revenue, cogs, revenue - cogs, expenses, revenue - cogs - expenses, await CurrencyAsync()));
    }

    /// <summary>
    /// Balance sheet (الميزانية) at the end of a day: assets = liabilities + equity, where equity
    /// includes the profit to date (revenue − expenses not yet closed into retained earnings).
    /// </summary>
    [HttpGet("balance-sheet")]
    [Authorize(Policy = Permissions.LedgerBalanceSheet)]
    public async Task<ActionResult<BalanceSheetDto>> BalanceSheet([FromQuery] string? asOf = null)
    {
        // Shows stock at cost and the profit to date: the report's own permission is enough.
        var day = CompanyClock.ParseDay(asOf) ?? CompanyClock.Today;
        var end = CompanyClock.StartOf(day.AddDays(1));
        var net = await NetByAccountAsync(l => l.Entry!.Date < end);
        var (accounts, groupOf) = await ChartAsync();
        var rows = new List<FinancialRowDto>();
        long profit = 0;
        foreach (var a in accounts.Where(a => !a.IsGroup))
        {
            var n = net.GetValueOrDefault(a.Id);
            if (n == 0) continue;
            switch (a.Type)
            {
                case LedgerAccountType.REVENUE:
                case LedgerAccountType.EXPENSE:
                    profit -= n;
                    break;
                case LedgerAccountType.ASSET:
                    rows.Add(new(a.Id.ToString(), a.Code, NameOf(a), "ASSET", groupOf(a), n));
                    break;
                default:
                    rows.Add(new(a.Id.ToString(), a.Code, NameOf(a), a.Type.ToString(), groupOf(a), -n));
                    break;
            }
        }
        return Ok(new BalanceSheetDto(day.ToString("yyyy-MM-dd"), rows.ToArray(),
            rows.Where(r => r.Section == "ASSET").Sum(r => r.Amount),
            rows.Where(r => r.Section == "LIABILITY").Sum(r => r.Amount),
            rows.Where(r => r.Section == "EQUITY").Sum(r => r.Amount) + profit, profit, await CurrencyAsync()));
    }

    /// <summary>Debits − credits per account, over the lines that pass <paramref name="filter"/>.</summary>
    private Task<Dictionary<Guid, long>> NetByAccountAsync(System.Linq.Expressions.Expression<Func<JournalLine, bool>> filter) =>
        VisibleLines().Where(filter).GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, Net = g.Sum(l => l.Debit - l.Credit) })
            .ToDictionaryAsync(x => x.Key, x => x.Net);

    /// <summary>The chart, and for each account the name of its group just under the top level (e.g. current assets).</summary>
    private async Task<(List<LedgerAccount> Accounts, Func<LedgerAccount, string?> GroupOf)> ChartAsync()
    {
        var accounts = await WithLinks(_db.LedgerAccounts).OrderBy(a => a.Code).ToListAsync();
        var byId = accounts.ToDictionary(a => a.Id);
        string? GroupOf(LedgerAccount a)
        {
            var node = a;
            while (node.ParentId is Guid p && byId.TryGetValue(p, out var parent) && parent.ParentId != null) node = parent;
            return node.Id == a.Id || node.ParentId == null ? null : NameOf(node);
        }
        return (accounts, GroupOf);
    }

    // ------------------------------------------------------------------ journal

    [HttpGet("entries")]
    [AnyPermission(Permissions.LedgerJournal, Permissions.LedgerReverse)]
    public async Task<ActionResult<PaginatedDto<JournalEntryDto>>> Entries(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? source = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 30)
    {
        if (!Range(from, to, out _, out _, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = VisibleEntries().AsNoTracking().Where(e => e.Date >= start && e.Date < end);
        if (!Costs.CanSeeProfit(User)) q = q.Where(e => e.SourceType != "YEAR_CLOSE"); // it is the year's profit
        if (!string.IsNullOrWhiteSpace(source)) q = q.Where(e => e.SourceType == source.ToUpper());
        var total = await q.CountAsync();
        var rows = await q.Include(e => e.CreatedBy).Include(e => e.Lines).ThenInclude(l => l.Account)
            .OrderByDescending(e => e.Date).ThenByDescending(e => e.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).AsSplitQuery().ToListAsync();
        return Ok(new PaginatedDto<JournalEntryDto>(await ToDtosAsync(rows), total, page, pageSize));
    }

    [HttpGet("entries/{id:guid}")]
    [AnyPermission(Permissions.LedgerJournal, Permissions.LedgerReverse)]
    public async Task<ActionResult<JournalEntryDto>> Entry(Guid id)
    {
        var e = await VisibleEntries().AsNoTracking().Include(x => x.CreatedBy)
            .Include(x => x.Lines).ThenInclude(l => l.Account).FirstOrDefaultAsync(x => x.Id == id);
        if (e is not null && e.SourceType == "YEAR_CLOSE" && !Costs.CanSeeProfit(User)) e = null;
        return e is null ? NotFound(new { message = "Entry not found.", code = "not_found" }) : Ok((await ToDtosAsync(new() { e }))[0]);
    }

    /// <summary>
    /// A manual (compound) entry, قيد مركب: any number of lines, debits = credits. Not on money
    /// accounts or stock; a line on a party's account moves the party's balance too.
    /// </summary>
    [HttpPost("entries")]
    [Authorize(Policy = Permissions.LedgerPost)]
    public async Task<ActionResult<JournalEntryDto>> Post([FromBody] CreateJournalEntryRequest req)
    {
        var description = req.Description?.Trim();
        if (string.IsNullOrEmpty(description)) return Bad("bad_description", "Say what the entry is for.");
        var today = CompanyClock.Today;
        var day = string.IsNullOrWhiteSpace(req.Date) ? today : CompanyClock.ParseDay(req.Date);
        if (day is null || day > today) return Bad("bad_date", "Choose a date up to today.");
        var lines = req.Lines ?? Array.Empty<JournalLineRequest>();
        if (lines.Length < 2 || lines.Length > 100) return Bad("bad_lines", "An entry needs two to 100 lines.");
        var parsed = new List<(Guid AccountId, long Debit, long Credit, string? Memo)>();
        foreach (var l in lines)
        {
            if (!Guid.TryParse(l.AccountId, out var accountId)) return Bad("account_not_found", "Choose an account on every line.");
            if (l.Debit < 0 || l.Credit < 0 || (l.Debit > 0) == (l.Credit > 0) || l.Debit > InvoiceLines.MaxPrice || l.Credit > InvoiceLines.MaxPrice)
                return Bad("bad_amount", "Each line is either a debit or a credit, above zero.");
            parsed.Add((accountId, l.Debit, l.Credit, l.Memo?.Trim()));
        }
        if (parsed.Sum(l => l.Debit) != parsed.Sum(l => l.Credit))
            return Bad("unbalanced", "Debits and credits must be equal.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && day.Value <= DateOnly.FromDateTime(locked) && !Access.OverridePasses(User))
            return Bad("period_locked", "That date is in a locked period.");
        var ids = parsed.Select(l => l.AccountId).Distinct().ToList();
        var accounts = await _db.LedgerAccounts.Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id);
        if (accounts.Count != ids.Count || accounts.Values.Any(a => !a.IsActive || a.IsGroup))
            return Bad("account_not_found", "Choose open accounts that take entries (not groups).");
        if (accounts.Values.Any(a => a.MoneyAccountId != null))
            return Bad("money_account", "Money moves through receipts, payments, expenses and transfers.");
        if (accounts.Values.Any(a => a.SystemKey is not null && LedgerKeys.DocumentOnly.Contains(a.SystemKey)))
            return Bad("stock_account", "Stock and cheques move only through their own documents.");

        // A line on a party's account changes what they owe, exactly as the ledger says.
        var partyIds = accounts.Values.Where(a => a.PartyId != null).Select(a => a.PartyId!.Value).Distinct().ToArray();
        await MoneyService.LockPartiesAsync(_db, partyIds);
        var parties = await _db.Parties.Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        // Someone limited to some branches posts in the branch they work in; otherwise it is the company's.
        var draft = _ledger.Begin("MANUAL", null, await DocumentNumbers.NextJournalAsync(_db), description,
            Access.AllBranches(User) ? null : Access.Work(User), Me(),
            day.Value.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc));
        foreach (var (accountId, debit, credit, memo) in parsed)
        {
            var account = accounts[accountId];
            draft.Debit(account, debit, memo).Credit(account, credit, memo);
            if (account.PartyId is Guid pid) parties[pid].Balance += debit - credit;
        }
        var entry = _ledger.Post(draft)!;
        entry.SourceId = entry.Id;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "journal_entry", entry.Id);
        return Created($"/api/ledger/entries/{entry.Id}", (await ToDtosAsync(new() { await ReloadAsync(entry.Id) }))[0]);
    }

    /// <summary>Reverse a manual entry (its exact opposite, dated today). Document entries reverse with their document.</summary>
    [HttpPost("entries/{id:guid}/reverse")]
    [Authorize(Policy = Permissions.LedgerReverse)]
    public async Task<ActionResult<JournalEntryDto>> Reverse(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"JournalEntries\" WHERE \"Id\" = {id} FOR UPDATE");
        var original = await VisibleEntries().Include(e => e.Lines).ThenInclude(l => l.Account).FirstOrDefaultAsync(e => e.Id == id);
        if (original is null) return NotFound(new { message = "Entry not found.", code = "not_found" });
        if (original.SourceType != "MANUAL") return Bad("not_manual", "Cancel the document to reverse its entry.");
        if (await _db.JournalEntries.AnyAsync(e => e.SourceType == "MANUAL_REVERSAL" && e.SourceId == id))
            return Bad("already_reversed", "This entry is already reversed.");
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(original.Date) <= DateOnly.FromDateTime(locked)
            && !Access.OverridePasses(User))
            return Bad("period_locked", "That entry is in a locked period.");

        var partyIds = original.Lines.Where(l => l.Account!.PartyId != null).Select(l => l.Account!.PartyId!.Value).Distinct().ToArray();
        await MoneyService.LockPartiesAsync(_db, partyIds);
        var parties = await _db.Parties.Where(p => partyIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var draft = _ledger.Begin("MANUAL_REVERSAL", id, await DocumentNumbers.NextJournalAsync(_db),
            $"Reverses {original.Number}", null, Me());
        foreach (var l in original.Lines.OrderBy(l => l.LineNo))
        {
            draft.Debit(l.Account!, l.Credit, l.Memo).Credit(l.Account!, l.Debit, l.Memo);
            if (l.Account!.PartyId is Guid pid) parties[pid].Balance -= l.Debit - l.Credit;
        }
        var entry = _ledger.Post(draft)!;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("reverse", "journal_entry", original.Id);
        return Ok((await ToDtosAsync(new() { await ReloadAsync(entry.Id) }))[0]);
    }

    // ------------------------------------------------------------------ period lock

    [HttpGet("lock")]
    [AnyPermission(Permissions.LedgerAccounts, Permissions.LedgerJournal, Permissions.LedgerTrialBalance,
        Permissions.LedgerIncomeStatement, Permissions.LedgerBalanceSheet, Permissions.LedgerAccountsCreate,
        Permissions.LedgerAccountsEdit, Permissions.LedgerPost, Permissions.LedgerReverse, Permissions.LedgerLock,
        Permissions.LedgerCloseYear)]
    public async Task<ActionResult<LockDateDto>> GetLock()
    {
        var d = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        return Ok(new LockDateDto(d?.ToString("yyyy-MM-dd")));
    }

    /// <summary>Lock everything on or before a day (or unlock with null).</summary>
    [HttpPut("lock")]
    [Authorize(Policy = Permissions.LedgerLock)]
    public async Task<ActionResult<LockDateDto>> SetLock([FromBody] LockDateDto req)
    {
        DateTime? value = null;
        if (!string.IsNullOrWhiteSpace(req.LockDate))
        {
            if (CompanyClock.ParseDay(req.LockDate) is not DateOnly day || day > CompanyClock.Today)
                return Bad("bad_date", "Choose a date up to today.");
            value = CompanyClock.AsDate(day);
        }
        var settings = await _db.CompanySettings.FirstOrDefaultAsync();
        if (settings is null) return Bad("no_settings", "Company settings are missing.");
        settings.LockDate = value;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("lock", "ledger", settings.Id);
        return Ok(new LockDateDto(value?.ToString("yyyy-MM-dd")));
    }

    // ------------------------------------------------------------------ year-end close

    [HttpGet("closed-years")]
    [AnyPermission(Permissions.LedgerAccounts, Permissions.LedgerJournal, Permissions.LedgerTrialBalance,
        Permissions.LedgerIncomeStatement, Permissions.LedgerBalanceSheet, Permissions.LedgerAccountsCreate,
        Permissions.LedgerAccountsEdit, Permissions.LedgerPost, Permissions.LedgerReverse, Permissions.LedgerLock,
        Permissions.LedgerCloseYear)]
    public async Task<ActionResult<ClosedYearDto[]>> ClosedYears()
    {
        var entries = await _db.JournalEntries.AsNoTracking().Include(e => e.CreatedBy).Include(e => e.Lines)
            .ThenInclude(l => l.Account).Where(e => e.SourceType == "YEAR_CLOSE").OrderByDescending(e => e.Date).ToListAsync();
        // A year's profit is the whole company's: for whoever sees every branch.
        var seeProfit = Costs.CanSeeProfit(User) && Access.AllBranches(User);
        var list = new List<ClosedYearDto>();
        foreach (var e in entries)
            list.Add(new ClosedYearDto(e.Date.Year, e.Id.ToString(),
                seeProfit ? e.Lines.Where(l => l.Account!.SystemKey == LedgerKeys.RetainedEarnings).Sum(l => l.Credit - l.Debit) : 0,
                e.CreatedAt.ToString("o"), e.CreatedBy?.FullName ?? "", (await UnclosedUpToAsync(e.Date.Year)).Count > 0));
        return Ok(list.ToArray());
    }

    /// <summary>
    /// What revenue and expense accounts still hold up to the end of a year (every entry before its
    /// 1 January after, earlier closing entries included): nothing once the year is closed, until
    /// something is entered in it (or before it) later.
    /// </summary>
    private async Task<List<(Guid AccountId, long Net)>> UnclosedUpToAsync(int year)
    {
        var (_, end) = CompanyClock.Days(new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));
        return (await _db.JournalLines
                .Where(l => l.Entry!.Date < end
                            && (l.Account!.Type == LedgerAccountType.REVENUE || l.Account.Type == LedgerAccountType.EXPENSE))
                .GroupBy(l => l.AccountId).Select(g => new { g.Key, Net = g.Sum(l => l.Debit - l.Credit) })
                .Where(x => x.Net != 0).ToListAsync())
            .Select(x => (x.Key, x.Net)).ToList();
    }

    /// <summary>
    /// Close a finished year (إقفال السنة): one closing entry, dated 31 December, brings every
    /// revenue and expense account to zero and moves the net profit into retained earnings. The
    /// year is not locked (owner, 2026-10-24: past years stay open, they are needed for other
    /// reasons): whatever is entered in it later shows it as changed, and closing it again makes its
    /// entry anew. Each closing sweeps everything not closed before its 31 December, so the closed
    /// years after it are made anew too, in order. The income statement leaves closing entries out.
    /// </summary>
    [HttpPost("close-year")]
    [Authorize(Policy = Permissions.LedgerCloseYear)]
    public async Task<ActionResult<ClosedYearDto>> CloseYear([FromBody] CloseYearRequest req)
    {
        if (req.Year < 2000 || req.Year >= CompanyClock.Year)
            return Bad("bad_year", "Only a year that has ended can be closed.");
        // The year is the whole company's: closed by whoever sees every branch (rule 11).
        if (!Access.AllBranches(User))
            return StatusCode(403, new { message = "Closing the year needs every branch.", code = "all_branches_needed" });
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('ledger-close-year'))");
        var closings = (await _db.JournalEntries.Where(e => e.SourceType == "YEAR_CLOSE").ToListAsync())
            .Where(e => e.Date.Year >= req.Year).ToList();
        var years = closings.Select(e => e.Date.Year).Append(req.Year).Distinct().Order().ToList();
        if (closings.Any(e => e.Date.Year == req.Year))
        {
            // Closed already, with nothing entered since in it (or in a closed year after it).
            var changed = false;
            foreach (var y in years) changed |= (await UnclosedUpToAsync(y)).Count > 0;
            if (!changed) return Bad("already_closed", "This year is closed, and nothing in it changed since.");
        }
        else if ((await UnclosedUpToAsync(req.Year)).Count == 0)
            return Bad("nothing_to_close", "Nothing was earned or spent in that year.");

        // Their closing entries are made anew, each from the books as they are by then.
        _db.JournalEntries.RemoveRange(closings);
        await _db.SaveChangesAsync();
        var retained = await _ledger.SystemAsync(LedgerKeys.RetainedEarnings);
        JournalEntry? entry = null;
        long profit = 0;
        foreach (var y in years)
        {
            var net = await UnclosedUpToAsync(y);
            if (net.Count == 0) continue;
            var ids = net.Select(n => n.AccountId).ToList();
            var accounts = await _db.LedgerAccounts.Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id);
            var draft = _ledger.Begin("YEAR_CLOSE", null, $"CLOSE-{y}", $"Year-end close {y}", null, Me(),
                new DateTime(y, 12, 31, 12, 0, 0, DateTimeKind.Utc));
            foreach (var n in net) draft.Credit(accounts[n.AccountId], n.Net);
            draft.Credit(retained, -net.Sum(n => n.Net));
            var posted = _ledger.Post(draft)!;
            await _db.SaveChangesAsync();
            if (y == req.Year) (entry, profit) = (posted, -net.Sum(n => n.Net));
        }
        await tx.CommitAsync();
        await AuditAsync("close_year", "ledger", entry?.Id ?? Guid.Empty);
        // (A year whose earnings were all undone since has nothing left to close.)
        return entry is null
            ? Ok(new ClosedYearDto(req.Year, "", 0, DateTime.UtcNow.ToString("o"), CurrentUser.Name(User)))
            : Created($"/api/ledger/entries/{entry.Id}", new ClosedYearDto(req.Year, entry.Id.ToString(), profit,
                entry.CreatedAt.ToString("o"), CurrentUser.Name(User)));
    }

    // ------------------------------------------------------------------ helpers

    private static IQueryable<LedgerAccount> WithLinks(IQueryable<LedgerAccount> q) => q.AsNoTracking()
        .Include(a => a.Party).Include(a => a.MoneyAccount).Include(a => a.ExpenseCategory).ThenInclude(c => c!.Parent);

    /// <summary>A linked account shows its customer's / cash box's / category's current name.</summary>
    private static string NameOf(LedgerAccount a) =>
        a.Party?.Name ?? (a.MoneyAccount is null ? null : Loc.Name(a.MoneyAccount))
        ?? (a.ExpenseCategory is null ? null
            : a.ExpenseCategory.Parent is null ? Loc.Name(a.ExpenseCategory)
            : $"{Loc.Name(a.ExpenseCategory.Parent)} › {Loc.Name(a.ExpenseCategory)}")
        ?? a.Name;

    private async Task<Dictionary<Guid, string>> AccountNamesAsync(IEnumerable<Guid> ids)
    {
        var list = ids.Distinct().ToList();
        return (await WithLinks(_db.LedgerAccounts).Where(a => list.Contains(a.Id)).ToListAsync())
            .ToDictionary(a => a.Id, NameOf);
    }

    private static LedgerAccountDto ToDto(LedgerAccount a, long debit, long credit) => new(
        a.Id.ToString(), a.Code, NameOf(a), a.Type.ToString(), a.ParentId?.ToString(), a.IsGroup, a.SystemKey,
        a.PartyId?.ToString(), a.MoneyAccountId?.ToString(), a.ExpenseCategoryId?.ToString(), a.IsActive,
        debit, credit, debit - credit);

    private async Task<JournalEntryDto[]> ToDtosAsync(List<JournalEntry> entries)
    {
        var names = await AccountNamesAsync(entries.SelectMany(e => e.Lines).Select(l => l.AccountId));
        var ids = entries.Where(e => e.SourceType == "MANUAL").Select(e => (Guid?)e.Id).ToList();
        var reversed = (await _db.JournalEntries.Where(e => e.SourceType == "MANUAL_REVERSAL" && ids.Contains(e.SourceId))
            .Select(e => e.SourceId!.Value).ToListAsync()).ToHashSet();
        var currency = await CurrencyAsync();
        var hidden = await HiddenAccountIdsAsync();
        return entries.Select(e => new JournalEntryDto(
            e.Id.ToString(), e.Number, e.Date.ToString("o"), e.Description, e.SourceType, e.SourceId?.ToString(),
            e.CreatedBy?.FullName ?? "", e.CreatedAt.ToString("o"),
            e.Lines.Where(l => !hidden.Contains(l.AccountId)).OrderBy(l => l.LineNo)
                .Select(l => new JournalLineDto(l.AccountId.ToString(), l.Account?.Code ?? "",
                names.GetValueOrDefault(l.AccountId, ""), l.Debit, l.Credit, l.Memo)).ToArray(),
            e.SourceType == "MANUAL" && !reversed.Contains(e.Id), currency)).ToArray();
    }

    /// <summary>
    /// Accounts whose numbers are costs or profit — stock (inventory), cost of goods sold, stocktake
    /// gains and losses, retained earnings — and everything under them. Empty for people who may see
    /// costs; for everyone else these are left out of balances, statements and entries.
    /// </summary>
    private async Task<HashSet<Guid>> HiddenAccountIdsAsync()
    {
        if (Costs.CanSeeBoth(User)) return new HashSet<Guid>();
        string[] keys = { LedgerKeys.Inventory, LedgerKeys.Cogs, LedgerKeys.StockGain, LedgerKeys.StockLoss,
            LedgerKeys.RetainedEarnings };
        var all = await _db.LedgerAccounts.AsNoTracking().Select(a => new { a.Id, a.ParentId, a.SystemKey }).ToListAsync();
        var ids = all.Where(a => a.SystemKey != null && keys.Contains(a.SystemKey)).Select(a => a.Id).ToHashSet();
        for (var grew = true; grew;)
        {
            grew = false;
            foreach (var a in all)
                if (a.ParentId is Guid p && ids.Contains(p) && ids.Add(a.Id)) grew = true;
        }
        return ids;
    }

    private Task<JournalEntry> ReloadAsync(Guid id) => _db.JournalEntries.AsNoTracking().Include(e => e.CreatedBy)
        .Include(e => e.Lines).ThenInclude(l => l.Account).FirstAsync(e => e.Id == id);

    /// <summary>A period of whole UTC days; defaults to the year so far.</summary>
    private static bool Range(string? from, string? to, out DateOnly fromDay, out DateOnly toDay, out DateTime start, out DateTime end)
    {
        var today = CompanyClock.Today;
        fromDay = CompanyClock.ParseDay(from) ?? new DateOnly(today.Year, 1, 1);
        toDay = CompanyClock.ParseDay(to) ?? today;
        (start, end) = CompanyClock.Days(fromDay, toDay);
        return toDay >= fromDay && toDay.DayNumber - fromDay.DayNumber <= 5 * 366;
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource, CurrentUser.BranchId(User),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), id.ToString());
}
