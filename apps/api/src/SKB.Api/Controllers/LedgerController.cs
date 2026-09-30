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
/// balance with it. The ledger is company-wide: seeing it needs <c>ledger:view</c>.
/// </summary>
[ApiController]
[Route("api/ledger")]
[Authorize(Policy = Permissions.LedgerView)]
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

    // ------------------------------------------------------------------ accounts

    [HttpGet("accounts")]
    public async Task<ActionResult<LedgerAccountDto[]>> Accounts()
    {
        var accounts = await WithLinks(_db.LedgerAccounts).OrderBy(a => a.Code).ToListAsync();
        var sums = await _db.JournalLines.GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToDictionaryAsync(x => x.Key, x => (x.Debit, x.Credit));
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
    [Authorize(Policy = Permissions.LedgerManage)]
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
    [Authorize(Policy = Permissions.LedgerManage)]
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
        var sum = await _db.JournalLines.Where(l => l.AccountId == id)
            .GroupBy(l => 1).Select(g => new { D = g.Sum(l => l.Debit), C = g.Sum(l => l.Credit) }).FirstOrDefaultAsync();
        return Ok(ToDto(account, sum?.D ?? 0, sum?.C ?? 0));
    }

    // ------------------------------------------------------------------ statements

    /// <summary>An account's lines between two days, with the balance before and after (a group: everything under it).</summary>
    [HttpGet("accounts/{id:guid}/statement")]
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
        return await StatementAsync($"{account.Code} {NameOf(account)}", _db.JournalLines.Where(l => ids.Contains(l.AccountId)), from, to);
    }

    /// <summary>A customer's / supplier's / carrier's statement (كشف حساب): every line on their accounts.</summary>
    [HttpGet("parties/{partyId:guid}/statement")]
    public async Task<ActionResult<LedgerStatementDto>> PartyStatement(Guid partyId, [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        var party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId);
        if (party is null) return NotFound(new { message = "Party not found.", code = "not_found" });
        return await StatementAsync(party.Name, _db.JournalLines.Where(l => l.Account!.PartyId == partyId), from, to);
    }

    private async Task<ActionResult<LedgerStatementDto>> StatementAsync(string title, IQueryable<JournalLine> lines,
        string? from, string? to)
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
                l.Memo, running);
        }).ToArray();
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
    public async Task<ActionResult<TrialBalanceDto>> TrialBalance([FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        if (!Range(from, to, out var fromDay, out var toDay, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        var before = await _db.JournalLines.Where(l => l.Entry!.Date < start).GroupBy(l => l.AccountId)
            .Select(g => new { g.Key, Net = g.Sum(l => l.Debit - l.Credit) }).ToDictionaryAsync(x => x.Key, x => x.Net);
        var during = await _db.JournalLines.Where(l => l.Entry!.Date >= start && l.Entry.Date < end).GroupBy(l => l.AccountId)
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
    public async Task<ActionResult<IncomeStatementDto>> IncomeStatement([FromQuery] string? from = null, [FromQuery] string? to = null)
    {
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
    public async Task<ActionResult<BalanceSheetDto>> BalanceSheet([FromQuery] string? asOf = null)
    {
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
        _db.JournalLines.Where(filter).GroupBy(l => l.AccountId)
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
    public async Task<ActionResult<PaginatedDto<JournalEntryDto>>> Entries(
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? source = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 30)
    {
        if (!Range(from, to, out _, out _, out var start, out var end))
            return Bad("bad_range", "Choose up to five years, the start before the end.");
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = _db.JournalEntries.AsNoTracking().Where(e => e.Date >= start && e.Date < end);
        if (!string.IsNullOrWhiteSpace(source)) q = q.Where(e => e.SourceType == source.ToUpper());
        var total = await q.CountAsync();
        var rows = await q.Include(e => e.CreatedBy).Include(e => e.Lines).ThenInclude(l => l.Account)
            .OrderByDescending(e => e.Date).ThenByDescending(e => e.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).AsSplitQuery().ToListAsync();
        return Ok(new PaginatedDto<JournalEntryDto>(await ToDtosAsync(rows), total, page, pageSize));
    }

    [HttpGet("entries/{id:guid}")]
    public async Task<ActionResult<JournalEntryDto>> Entry(Guid id)
    {
        var e = await _db.JournalEntries.AsNoTracking().Include(x => x.CreatedBy)
            .Include(x => x.Lines).ThenInclude(l => l.Account).FirstOrDefaultAsync(x => x.Id == id);
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
        if (lockDate is DateTime locked && day.Value <= DateOnly.FromDateTime(locked))
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

        var draft = _ledger.Begin("MANUAL", null, await DocumentNumbers.NextJournalAsync(_db), description, null, Me(),
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
    [Authorize(Policy = Permissions.LedgerPost)]
    public async Task<ActionResult<JournalEntryDto>> Reverse(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"JournalEntries\" WHERE \"Id\" = {id} FOR UPDATE");
        var original = await _db.JournalEntries.Include(e => e.Lines).ThenInclude(l => l.Account).FirstOrDefaultAsync(e => e.Id == id);
        if (original is null) return NotFound(new { message = "Entry not found.", code = "not_found" });
        if (original.SourceType != "MANUAL") return Bad("not_manual", "Cancel the document to reverse its entry.");
        if (await _db.JournalEntries.AnyAsync(e => e.SourceType == "MANUAL_REVERSAL" && e.SourceId == id))
            return Bad("already_reversed", "This entry is already reversed.");
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(original.Date) <= DateOnly.FromDateTime(locked))
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
        // A closed year stays locked: the lock can't move back before its 31 December.
        var closed = await _db.JournalEntries.Where(e => e.SourceType == "YEAR_CLOSE")
            .Select(e => (DateTime?)e.Date).MaxAsync();
        if (closed is DateTime c && (value is null || value < c.Date))
            return Bad("year_closed", "A closed year stays locked.");
        settings.LockDate = value;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("lock", "ledger", settings.Id);
        return Ok(new LockDateDto(value?.ToString("yyyy-MM-dd")));
    }

    // ------------------------------------------------------------------ year-end close

    [HttpGet("closed-years")]
    public async Task<ActionResult<ClosedYearDto[]>> ClosedYears()
    {
        var entries = await _db.JournalEntries.AsNoTracking().Include(e => e.CreatedBy).Include(e => e.Lines)
            .ThenInclude(l => l.Account).Where(e => e.SourceType == "YEAR_CLOSE").OrderByDescending(e => e.Date).ToListAsync();
        return Ok(entries.Select(e => new ClosedYearDto(e.Date.Year, e.Id.ToString(),
            e.Lines.Where(l => l.Account!.SystemKey == LedgerKeys.RetainedEarnings).Sum(l => l.Credit - l.Debit),
            e.CreatedAt.ToString("o"), e.CreatedBy?.FullName ?? "")).ToArray());
    }

    /// <summary>
    /// Close a finished year (إقفال السنة): one closing entry, dated 31 December, brings every
    /// revenue and expense account to zero and moves the net profit into retained earnings; the
    /// year is then locked. It sweeps everything not closed yet up to that day (so an earlier year
    /// that was never closed is swept too), which is why years close in order: none before a
    /// closed one. The income statement leaves closing entries out.
    /// </summary>
    [HttpPost("close-year")]
    [Authorize(Policy = Permissions.LedgerLock)]
    public async Task<ActionResult<ClosedYearDto>> CloseYear([FromBody] CloseYearRequest req)
    {
        if (req.Year < 2000 || req.Year >= CompanyClock.Year)
            return Bad("bad_year", "Only a year that has ended can be closed.");
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('ledger-close-year'))");
        var (start, end) = CompanyClock.Days(new DateOnly(req.Year, 1, 1), new DateOnly(req.Year, 12, 31));
        if (await _db.JournalEntries.AnyAsync(e => e.SourceType == "YEAR_CLOSE" && e.Date >= start))
            return Bad("already_closed", "This year, or a later one, is already closed.");
        // Everything up to 31 December, earlier closing entries included (they zeroed their years).
        var net = await _db.JournalLines
            .Where(l => l.Entry!.Date < end
                        && (l.Account!.Type == LedgerAccountType.REVENUE || l.Account.Type == LedgerAccountType.EXPENSE))
            .GroupBy(l => l.AccountId).Select(g => new { g.Key, Net = g.Sum(l => l.Debit - l.Credit) })
            .Where(x => x.Net != 0).ToListAsync();
        if (net.Count == 0) return Bad("nothing_to_close", "Nothing was earned or spent in that year.");
        var accounts = await _db.LedgerAccounts.Where(a => net.Select(n => n.Key).Contains(a.Id)).ToDictionaryAsync(a => a.Id);
        var draft = _ledger.Begin("YEAR_CLOSE", null, $"CLOSE-{req.Year}", $"Year-end close {req.Year}", null, Me(),
            new DateTime(req.Year, 12, 31, 12, 0, 0, DateTimeKind.Utc));
        foreach (var n in net) draft.Credit(accounts[n.Key], n.Net);
        var profit = -net.Sum(n => n.Net);
        draft.Credit(await _ledger.SystemAsync(LedgerKeys.RetainedEarnings), profit);
        var entry = _ledger.Post(draft)!;
        var settings = await _db.CompanySettings.FirstAsync();
        var yearEnd = new DateTime(req.Year, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        if (settings.LockDate is null || settings.LockDate < yearEnd) settings.LockDate = yearEnd;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("close_year", "ledger", entry.Id);
        return Created($"/api/ledger/entries/{entry.Id}", new ClosedYearDto(req.Year, entry.Id.ToString(), profit,
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
        return entries.Select(e => new JournalEntryDto(
            e.Id.ToString(), e.Number, e.Date.ToString("o"), e.Description, e.SourceType, e.SourceId?.ToString(),
            e.CreatedBy?.FullName ?? "", e.CreatedAt.ToString("o"),
            e.Lines.OrderBy(l => l.LineNo).Select(l => new JournalLineDto(l.AccountId.ToString(), l.Account?.Code ?? "",
                names.GetValueOrDefault(l.AccountId, ""), l.Debit, l.Credit, l.Memo)).ToArray(),
            e.SourceType == "MANUAL" && !reversed.Contains(e.Id), currency)).ToArray();
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
