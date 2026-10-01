using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Money (الخزينة والبنوك — DOMAIN.md §2.6):
/// <list type="bullet">
/// <item><b>Money accounts:</b> cash boxes, custody, bank accounts, wallets, the post account. Each
/// belongs to a branch and never goes below zero; its statement for a day is the daily cash report.</item>
/// <item><b>Receipts</b> (سند قبض) from a party and <b>payments</b> (سند صرف) to one, paid in one or
/// more ways (part cash, part InstaPay…), optionally allocated to that party's invoices. What isn't
/// allocated stays on the party's account.</item>
/// <item><b>Expenses</b> (مصروف) by category, and <b>transfers</b> between accounts.</item>
/// <item>Any voucher can be <b>cancelled</b>: its money moves back and its allocations come off.</item>
/// </list>
/// Branch-scoped users see and use only their branch's accounts and vouchers. Every change is audited.
/// </summary>
[ApiController]
[Route("api")]
[Authorize(Policy = Permissions.ReceiptsView)]
public sealed class MoneyController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly MoneyService _money;
    private readonly AuditService _audit;
    private readonly LedgerService _ledger;

    public MoneyController(AppDbContext db, MoneyService money, AuditService audit, LedgerService ledger)
    {
        _db = db;
        _money = money;
        _audit = audit;
        _ledger = ledger;
    }

    private static readonly ShipmentStatus[] OnTheWay = { ShipmentStatus.CREATED, ShipmentStatus.PICKED_UP };

    // ------------------------------------------------------------------ accounts

    [HttpGet("money-accounts")]
    public async Task<ActionResult<MoneyAccountDto[]>> Accounts([FromQuery] string? kind = null, [FromQuery] bool? active = null)
    {
        var q = _money.Visible(User).AsNoTracking().Include(a => a.Branch).Include(a => a.Custodian).AsQueryable();
        if (Enum.TryParse<MoneyAccountKind>(kind, true, out var k)) q = q.Where(a => a.Kind == k);
        if (active is bool isActive) q = q.Where(a => a.IsActive == isActive);
        var rows = await q.OrderBy(a => a.Branch!.CreatedAt).ThenByDescending(a => a.IsDefault)
            .ThenBy(a => a.Kind).ThenBy(a => a.Name).ToListAsync();
        return Ok(rows.Select(ToDto).ToArray());
    }

    /// <summary>Add a money account; money already in it is posted as its opening balance.</summary>
    [HttpPost("money-accounts")]
    [Authorize(Policy = Permissions.MoneyAccountsManage)]
    public async Task<ActionResult<MoneyAccountDto>> CreateAccount([FromBody] CreateMoneyAccountRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null) return Bad("bad_name", "Enter the name.");
        if (!Enum.TryParse<MoneyAccountKind>(req.Kind, true, out var kind)) return Bad("bad_kind", "Choose the kind of account.");
        if (!Guid.TryParse(req.BranchId, out var branchId) || !Access.CanUseBranch(User, branchId)
            || !await _db.Branches.AnyAsync(b => b.Id == branchId && b.IsActive))
            return Bad("branch_not_found", "Branch not found.");
        if (req.OpeningBalance < 0 || req.OpeningBalance > InvoiceLines.MaxPrice) return Bad("bad_amount", "The opening balance can't be negative.");
        if (req.IsDefault && kind != MoneyAccountKind.CASH_BOX) return Bad("bad_default", "Only a cash box can be the branch's default.");
        if (await NameTakenAsync(branchId, name, null)) return Bad("duplicate_name", $"There is already an account called {name} in this branch.");

        var account = new MoneyAccount
        {
            Name = name, Kind = kind, BranchId = branchId, Number = Text(req.Number, 40), BankName = Text(req.BankName, 100),
            Currency = await CurrencyAsync(),
        };
        if (kind == MoneyAccountKind.CUSTODY)
        {
            if (!Guid.TryParse(req.CustodianId, out var custodian) || !await _db.Staff.AnyAsync(x => x.Id == custodian && x.IsActive))
                return Bad("custodian_not_found", "Choose who holds the custody.");
            account.CustodianId = custodian;
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        var hasDefault = await _db.MoneyAccounts.AnyAsync(a => a.BranchId == branchId && a.IsDefault);
        if (kind == MoneyAccountKind.CASH_BOX && (req.IsDefault || !hasDefault))
        {
            await ClearDefaultAsync(branchId);
            account.IsDefault = true;
        }
        _db.MoneyAccounts.Add(account);
        await _db.SaveChangesAsync();
        if (req.OpeningBalance > 0)
        {
            var locked = await _money.LockAsync(new[] { account.Id });
            _money.Move(locked[account.Id], req.OpeningBalance, MoneyMovementKind.OPENING, Me(), null, notes: "Opening balance");
            await _ledger.PostMoneyOpeningAsync(locked[account.Id], req.OpeningBalance, Me());
            await _db.SaveChangesAsync();
        }
        await tx.CommitAsync();
        await AuditAsync("create", "money_account", account.Id, branchId);
        return Created($"/api/money-accounts/{account.Id}", ToDto(await ReloadAccountAsync(account.Id)));
    }

    /// <summary>Rename, change details, make the branch's default cash box, close or reopen.</summary>
    [HttpPut("money-accounts/{id:guid}")]
    [Authorize(Policy = Permissions.MoneyAccountsManage)]
    public async Task<ActionResult<MoneyAccountDto>> UpdateAccount(Guid id, [FromBody] UpdateMoneyAccountRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var locked = await _money.LockAsync(new[] { id });
        if (!locked.TryGetValue(id, out var account) || !MoneyService.CanUse(User, account))
            return NotFound(new { message = "Money account not found.", code = "not_found" });

        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Enter the name.");
            if (await NameTakenAsync(account.BranchId, name, account.Id))
                return Bad("duplicate_name", $"There is already an account called {name} in this branch.");
            account.Name = name;
        }
        if (req.Number is not null) account.Number = Text(req.Number, 40);
        if (req.BankName is not null) account.BankName = Text(req.BankName, 100);
        if (req.CustodianId is not null && account.Kind == MoneyAccountKind.CUSTODY)
        {
            if (!Guid.TryParse(req.CustodianId, out var custodian) || !await _db.Staff.AnyAsync(x => x.Id == custodian && x.IsActive))
                return Bad("custodian_not_found", "Choose who holds the custody.");
            account.CustodianId = custodian;
        }
        if (req.IsActive == false && account.IsActive)
        {
            if (account.Balance != 0) return Bad("has_balance", "Move the money out before closing this account.");
            if (account.IsDefault) return Bad("is_default", "Make another cash box the default first.");
            account.IsActive = false;
        }
        else if (req.IsActive == true) account.IsActive = true;
        if (req.IsDefault == true && !account.IsDefault)
        {
            if (account.Kind != MoneyAccountKind.CASH_BOX || !account.IsActive)
                return Bad("bad_default", "Only an open cash box can be the branch's default.");
            await ClearDefaultAsync(account.BranchId);
            account.IsDefault = true;
        }
        else if (req.IsDefault == false && account.IsDefault)
            return Bad("is_default", "Make another cash box the default instead.");
        if (req.OpeningBalance is long opening)
        {
            if (opening < 0 || opening > InvoiceLines.MaxPrice) return Bad("bad_amount", "The opening balance can't be negative.");
            if (account.LastSeq != 0) return Bad("has_movements", "Money has already moved through this account.");
            _money.Move(account, opening, MoneyMovementKind.OPENING, Me(), null, notes: "Opening balance");
            await _ledger.PostMoneyOpeningAsync(account, opening, Me());
        }

        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("update", "money_account", account.Id, account.BranchId);
        return Ok(ToDto(await ReloadAccountAsync(account.Id)));
    }

    /// <summary>
    /// An account's movements between two days (UTC), with the balance before and after. One day =
    /// the daily cash report (حركة اليوم).
    /// </summary>
    [HttpGet("money-accounts/{id:guid}/movements")]
    public async Task<ActionResult<AccountStatementDto>> Statement(Guid id, [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        var account = await _money.Visible(User).AsNoTracking().Include(a => a.Branch).Include(a => a.Custodian)
            .FirstOrDefaultAsync(a => a.Id == id);
        if (account is null) return NotFound(new { message = "Money account not found.", code = "not_found" });
        var fromDay = CompanyClock.ParseDay(from) ?? CompanyClock.Today;
        var toDay = CompanyClock.ParseDay(to) ?? fromDay;
        if (toDay < fromDay || toDay.DayNumber - fromDay.DayNumber > 366)
            return Bad("bad_range", "Choose up to a year, the start before the end.");
        var (start, end) = CompanyClock.Days(fromDay, toDay);

        var opening = await _db.MoneyMovements.Where(m => m.AccountId == id && m.CreatedAt < start)
            .OrderByDescending(m => m.Seq).Select(m => (long?)m.BalanceAfter).FirstOrDefaultAsync() ?? 0;
        var rows = await _db.MoneyMovements.AsNoTracking().Include(m => m.Party).Include(m => m.CreatedBy)
            .Where(m => m.AccountId == id && m.CreatedAt >= start && m.CreatedAt < end)
            .OrderBy(m => m.Seq).Take(5000).ToListAsync();
        var totalIn = rows.Where(m => m.Amount > 0).Sum(m => m.Amount);
        var totalOut = rows.Where(m => m.Amount < 0).Sum(m => -m.Amount);
        return Ok(new AccountStatementDto(ToDto(account), fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"),
            opening, totalIn, totalOut, opening + totalIn - totalOut,
            rows.Select(m => new MoneyMovementDto(m.Id.ToString(), m.Seq, m.CreatedAt.ToString("o"), m.Kind.ToString(),
                m.Amount, m.BalanceAfter, m.Method?.ToString(), m.Reference, m.MethodReference, m.Party?.Name, m.Notes,
                m.CreatedBy?.FullName ?? "", m.VoucherId?.ToString())).ToArray()));
    }

    // ------------------------------------------------------------------ open invoices

    /// <summary>A party's invoices with something still owed: sales (for receipts) or purchases (for payments).</summary>
    [HttpGet("parties/{id:guid}/open-invoices")]
    public async Task<ActionResult<OpenInvoiceDto[]>> OpenInvoices(Guid id, [FromQuery] string? side = "sales")
    {
        var type = string.Equals(side, "purchases", StringComparison.OrdinalIgnoreCase)
            ? DocumentType.PURCHASE_INVOICE : DocumentType.SALES_INVOICE;
        var docs = await ScopedDocs().AsNoTracking().Include(d => d.Branch)
            .Where(d => d.PartyId == id && d.Type == type && d.Status != DocumentStatus.CANCELLED
                        && d.PaidAmount < d.GrandTotal)
            .OrderBy(d => d.IssueDate).ThenBy(d => d.Number).Take(500).ToListAsync();
        var owed = await MoneyService.OutstandingAsync(_db, docs);
        var onCod = await CodParcelDocsAsync(docs.Select(d => d.Id).ToList());
        return Ok(docs.Where(d => owed[d.Id] > 0).Select(d => new OpenInvoiceDto(
            d.Id.ToString(), d.Number, d.Type.ToString(), d.IssueDate.ToString("o"), d.DueDate?.ToString("yyyy-MM-dd"),
            Loc.Name(d.Branch), d.GrandTotal, d.PaidAmount, owed[d.Id], onCod.Contains(d.Id))).ToArray());
    }

    // ------------------------------------------------------------------ vouchers

    [HttpGet("vouchers")]
    public async Task<ActionResult<PaginatedDto<VoucherDto>>> Vouchers(
        [FromQuery] string? type = null, [FromQuery] string? status = null, [FromQuery] string? partyId = null,
        [FromQuery] string? accountId = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 30,
        [FromQuery] string? branchId = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = ScopedVouchers();
        // One of the person's branches (the list is already limited to theirs).
        if (Guid.TryParse(branchId, out var bid)) q = q.Where(v => v.BranchId == bid);
        if (Enum.TryParse<VoucherType>(type, true, out var vt)) q = q.Where(v => v.Type == vt);
        if (Enum.TryParse<VoucherStatus>(status, true, out var vs)) q = q.Where(v => v.Status == vs);
        if (Guid.TryParse(partyId, out var p)) q = q.Where(v => v.PartyId == p);
        if (Guid.TryParse(accountId, out var a))
            q = q.Where(v => v.FromAccountId == a || v.ToAccountId == a || v.Lines.Any(l => l.AccountId == a));
        var total = await q.CountAsync();
        var rows = await WithDetails(q).OrderByDescending(v => v.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(new PaginatedDto<VoucherDto>(rows.Select(v => ToDto(v, currency)).ToArray(), total, page, pageSize));
    }

    [HttpGet("vouchers/{id:guid}")]
    public async Task<ActionResult<VoucherDto>> Voucher(Guid id)
    {
        var v = await WithDetails(ScopedVouchers()).FirstOrDefaultAsync(x => x.Id == id);
        return v is null ? NotFound(new { message = "Voucher not found.", code = "not_found" }) : Ok(ToDto(v, await CurrencyAsync()));
    }

    /// <summary>Money received from a party (سند قبض), optionally settling its sales invoices.</summary>
    [HttpPost("receipts")]
    [Authorize(Policy = Permissions.ReceiptsCreate)]
    public Task<ActionResult<VoucherDto>> Receipt([FromBody] CreateVoucherRequest req) => CreateAsync(VoucherType.RECEIPT, req);

    /// <summary>Money paid to a party (سند صرف), optionally settling its purchase invoices.</summary>
    [HttpPost("payments")]
    [Authorize(Policy = Permissions.PaymentsCreate)]
    public Task<ActionResult<VoucherDto>> Payment([FromBody] CreateVoucherRequest req) => CreateAsync(VoucherType.PAYMENT, req);

    /// <summary>An expense (مصروف) by category, paid from money accounts.</summary>
    [HttpPost("expenses")]
    [Authorize(Policy = Permissions.ExpensesCreate)]
    public Task<ActionResult<VoucherDto>> Expense([FromBody] CreateVoucherRequest req) => CreateAsync(VoucherType.EXPENSE, req);

    /// <summary>Move money between two accounts: cash box to cash box, deposit at or withdraw from the bank.</summary>
    [HttpPost("cash-transfers")]
    [Authorize(Policy = Permissions.CashTransfer)]
    public async Task<ActionResult<VoucherDto>> Transfer([FromBody] CreateCashTransferRequest req)
    {
        if (!Guid.TryParse(req.FromAccountId, out var fromId) || !Guid.TryParse(req.ToAccountId, out var toId))
            return Bad("account_not_found", "Choose both accounts.");
        if (fromId == toId) return Bad("same_account", "Choose two different accounts.");
        if (req.Amount <= 0 || req.Amount > InvoiceLines.MaxPrice) return Bad("bad_amount", "Enter an amount above zero.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var accounts = await _money.LockAsync(new[] { fromId, toId });
        if (accounts.Count != 2 || accounts.Values.Any(a => !a.IsActive || !MoneyService.CanUse(User, a)))
            return Bad("account_not_found", "Money account not found.");
        var (from, to) = (accounts[fromId], accounts[toId]);
        var voucher = new Voucher
        {
            Number = await DocumentNumbers.NextVoucherAsync(_db, VoucherType.TRANSFER), Type = VoucherType.TRANSFER,
            BranchId = from.BranchId, FromAccountId = fromId, ToAccountId = toId, Amount = req.Amount,
            Notes = Text(req.Notes, 500), CreatedById = Me(),
        };
        var error = _money.Move(from, -req.Amount, MoneyMovementKind.TRANSFER_OUT, Me(), voucher.Number, voucherId: voucher.Id)
                    ?? _money.Move(to, req.Amount, MoneyMovementKind.TRANSFER_IN, Me(), voucher.Number, voucherId: voucher.Id);
        if (error is not null) return Bad(error.Code, error.Message);
        await _ledger.PostVoucherAsync(voucher, null, accounts, null, Me());
        _db.Vouchers.Add(voucher);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "cash_transfer", voucher.Id, voucher.BranchId);
        return Created($"/api/vouchers/{voucher.Id}", ToDto(await ReloadVoucherAsync(voucher.Id), await CurrencyAsync()));
    }

    /// <summary>
    /// Cancel a voucher: its money moves back (the account must still hold it), the party's balance
    /// and the invoices it settled go back to how they were.
    /// </summary>
    [HttpPost("vouchers/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.VouchersCancel)]
    public async Task<ActionResult<VoucherDto>> Cancel(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Vouchers\" WHERE \"Id\" = {id} FOR UPDATE");
        var voucher = await ScopedVouchers().Include(v => v.Allocations).Include(v => v.Party)
            .FirstOrDefaultAsync(v => v.Id == id);
        if (voucher is null) return NotFound(new { message = "Voucher not found.", code = "not_found" });
        if (voucher.Status != VoucherStatus.POSTED) return Bad("already_cancelled", "This voucher is already cancelled.");
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(voucher.CreatedAt) <= DateOnly.FromDateTime(locked))
            return Bad("period_locked", "The period this voucher is in is locked.");

        // Invoices first, then accounts: the same order every money path locks in.
        var docIds = voucher.Allocations.Select(a => a.DocumentId).OrderBy(x => x).ToArray();
        if (docIds.Length > 0)
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({docIds}) ORDER BY \"Id\" FOR UPDATE");
        var docs = await _db.SalesDocuments.Where(d => docIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id);
        if (voucher.PartyId is Guid partyId) await MoneyService.LockPartiesAsync(_db, partyId);
        var moves = await _db.MoneyMovements.AsNoTracking()
            .Where(m => m.VoucherId == id && m.Kind != MoneyMovementKind.CANCELLATION).OrderBy(m => m.CreatedAt).ToListAsync();
        var accounts = await _money.LockAsync(moves.Select(m => m.AccountId));
        // Money goes back through its accounts: only someone who may use them can cancel.
        if (accounts.Values.Any(a => !MoneyService.CanUse(User, a)))
            return NotFound(new { message = "Voucher not found.", code = "not_found" });
        foreach (var m in moves)
        {
            var error = _money.Move(accounts[m.AccountId], -m.Amount, MoneyMovementKind.CANCELLATION, Me(), voucher.Number,
                voucherId: voucher.Id, partyId: m.PartyId, method: m.Method, notes: "Cancelled");
            if (error is not null) return Bad(error.Code, error.Message);
        }
        if (voucher.Party is not null)
        {
            if (voucher.Type == VoucherType.RECEIPT) voucher.Party.Balance += voucher.Amount;
            else if (voucher.Type == VoucherType.PAYMENT) voucher.Party.Balance -= voucher.Amount;
        }
        foreach (var a in voucher.Allocations)
        {
            var doc = docs[a.DocumentId];
            doc.PaidAmount = Math.Max(0, doc.PaidAmount - a.Amount);
            MoneyService.RefreshPaidStatus(doc);
        }
        await _ledger.ReverseVoucherAsync(voucher, Me());
        voucher.Status = VoucherStatus.CANCELLED;
        voucher.CancelledAt = DateTime.UtcNow;
        voucher.CancelledById = Me();
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", "voucher", voucher.Id, voucher.BranchId);
        return Ok(ToDto(await ReloadVoucherAsync(voucher.Id), await CurrencyAsync()));
    }

    private async Task<ActionResult<VoucherDto>> CreateAsync(VoucherType type, CreateVoucherRequest req)
    {
        var lines = new List<(PaymentMethod Method, Guid AccountId, long Amount, string? Reference)>();
        foreach (var l in req.Lines ?? Array.Empty<VoucherLineRequest>())
        {
            if (!Enum.TryParse<PaymentMethod>(l.Method, true, out var method)) return Bad("bad_method", "Choose how the money was paid.");
            if (!Guid.TryParse(l.AccountId, out var accountId)) return Bad("account_not_found", "Choose where the money goes.");
            if (l.Amount <= 0 || l.Amount > InvoiceLines.MaxPrice) return Bad("bad_amount", "Enter an amount above zero.");
            lines.Add((method, accountId, l.Amount, Text(l.Reference, 60)));
        }
        if (lines.Count == 0) return Bad("bad_amount", "Enter how much, and how it was paid.");
        if (lines.Count > 10) return Bad("too_many_lines", "At most 10 ways of paying on one voucher.");
        var total = lines.Sum(l => l.Amount);
        if (total > InvoiceLines.MaxPrice) return Bad("bad_amount", "The amount is too large.");

        Guid? partyId = null, categoryId = null;
        if (type == VoucherType.EXPENSE)
        {
            if (!Guid.TryParse(req.CategoryId, out var c) || !await _db.ExpenseCategories.AnyAsync(x => x.Id == c && x.IsActive))
                return Bad("category_not_found", "Choose what the expense was for.");
            categoryId = c;
        }
        else
        {
            if (!Guid.TryParse(req.PartyId, out var p)) return Bad("party_not_found", "Choose the customer or supplier.");
            partyId = p;
        }

        var allocations = new List<(Guid DocumentId, long Amount)>();
        foreach (var a in req.Allocations ?? Array.Empty<AllocationRequest>())
        {
            if (type == VoucherType.EXPENSE) return Bad("bad_allocation", "An expense doesn't settle invoices.");
            if (!Guid.TryParse(a.DocumentId, out var docId) || allocations.Any(x => x.DocumentId == docId))
                return Bad("invoice_not_found", "An invoice was not found.");
            if (a.Amount <= 0) return Bad("bad_allocation", "Each invoice needs an amount above zero.");
            allocations.Add((docId, a.Amount));
        }
        if (allocations.Count > 100) return Bad("bad_allocation", "At most 100 invoices on one voucher.");
        if (allocations.Sum(a => a.Amount) > total)
            return Bad("over_allocated", "The invoices settled add up to more than the amount.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        Party? party = null;
        if (partyId is Guid pid)
        {
            party = await _db.Parties.FirstOrDefaultAsync(x => x.Id == pid && x.IsActive);
            if (party is null) return Bad("party_not_found", "Choose the customer or supplier.");
        }

        // Lock order everywhere: invoices, then the party, then money accounts. Invoices are locked
        // so two receipts can't settle the same amount twice.
        var docs = new Dictionary<Guid, SalesDocument>();
        if (allocations.Count > 0)
        {
            var docIds = allocations.Select(a => a.DocumentId).OrderBy(x => x).ToArray();
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({docIds}) ORDER BY \"Id\" FOR UPDATE");
            var docType = type == VoucherType.RECEIPT ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE;
            docs = await ScopedDocs().Where(d => docIds.Contains(d.Id) && d.PartyId == partyId && d.Type == docType
                                               && d.Status != DocumentStatus.CANCELLED).ToDictionaryAsync(d => d.Id);
            foreach (var d in docs.Values) await _db.Entry(d).ReloadAsync();
            if (docs.Count != docIds.Length) return Bad("invoice_not_found", "An invoice was not found for this party.");
            var owed = await MoneyService.OutstandingAsync(_db, docs.Values.ToList());
            foreach (var (docId, amount) in allocations)
                if (amount > owed[docId])
                    return Bad("over_outstanding", $"{docs[docId].Number}: only {owed[docId] / 100m:0.00} is still owed.");
            if (type == VoucherType.RECEIPT)
            {
                var onCod = await CodParcelDocsAsync(docIds.ToList());
                if (onCod.Count > 0)
                    return Bad("on_cod_parcel",
                        $"{docs[onCod.First()].Number} is in a cash-on-delivery parcel: the shipping company collects it.");
            }
        }

        if (party is not null) await MoneyService.LockPartiesAsync(_db, party.Id);
        var accounts = await _money.LockAsync(lines.Select(l => l.AccountId));
        foreach (var l in lines)
        {
            if (!accounts.TryGetValue(l.AccountId, out var acc) || !acc.IsActive || !MoneyService.CanUse(User, acc))
                return Bad("account_not_found", "Money account not found.");
            if (!MoneyService.Fits(l.Method, acc.Kind))
                return Bad("method_mismatch", $"{Loc.Name(acc)} can't take a {l.Method} payment.");
        }

        var voucher = new Voucher
        {
            Number = await DocumentNumbers.NextVoucherAsync(_db, type), Type = type,
            BranchId = accounts[lines[0].AccountId].BranchId, PartyId = partyId, ExpenseCategoryId = categoryId,
            Amount = total, Notes = Text(req.Notes, 500), CreatedById = Me(),
        };
        var kind = type switch
        {
            VoucherType.RECEIPT => MoneyMovementKind.RECEIPT,
            VoucherType.PAYMENT => MoneyMovementKind.PAYMENT,
            _ => MoneyMovementKind.EXPENSE,
        };
        foreach (var l in lines)
        {
            voucher.Lines.Add(new VoucherLine
            {
                LineNo = voucher.Lines.Count + 1, Method = l.Method, AccountId = l.AccountId, Amount = l.Amount,
                Reference = l.Reference,
            });
            var error = _money.Move(accounts[l.AccountId], type == VoucherType.RECEIPT ? l.Amount : -l.Amount, kind, Me(),
                voucher.Number, voucherId: voucher.Id, partyId: partyId, method: l.Method, methodReference: l.Reference);
            if (error is not null) return Bad(error.Code, error.Message);
        }
        // Balance sign: > 0 they owe us. A receipt lowers what they owe; a payment lowers what we owe.
        if (party is not null) party.Balance += type == VoucherType.RECEIPT ? -total : total;
        foreach (var (docId, amount) in allocations)
        {
            var doc = docs[docId];
            doc.PaidAmount += amount;
            MoneyService.RefreshPaidStatus(doc);
            voucher.Allocations.Add(new VoucherAllocation { DocumentId = docId, Amount = amount });
        }
        var category = categoryId is Guid cid ? await _db.ExpenseCategories.FirstAsync(c => c.Id == cid) : null;
        await _ledger.PostVoucherAsync(voucher, party, accounts, category, Me());
        _db.Vouchers.Add(voucher);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", type.ToString().ToLowerInvariant(), voucher.Id, voucher.BranchId);
        return Created($"/api/vouchers/{voucher.Id}", ToDto(await ReloadVoucherAsync(voucher.Id), await CurrencyAsync()));
    }

    // ------------------------------------------------------------------ expense categories

    [HttpGet("expense-categories")]
    public async Task<ActionResult<ExpenseCategoryDto[]>> Categories()
    {
        var rows = await _db.ExpenseCategories.AsNoTracking().Include(c => c.Parent).ToListAsync();
        return Ok(rows.OrderBy(c => c.Parent?.Name ?? c.Name).ThenBy(c => c.ParentId is null ? 0 : 1).ThenBy(c => c.Name)
            .Select(ToDto).ToArray());
    }

    [HttpPost("expense-categories")]
    [Authorize(Policy = Permissions.ExpenseCategoriesManage)]
    public async Task<ActionResult<ExpenseCategoryDto>> CreateCategory([FromBody] CreateExpenseCategoryRequest req)
    {
        var name = Loc.Clean(req.Name);
        if (name is null) return Bad("bad_name", "Enter the name.");
        Guid? parentId = null;
        if (!string.IsNullOrWhiteSpace(req.ParentId))
        {
            if (!Guid.TryParse(req.ParentId, out var p) || !await _db.ExpenseCategories.AnyAsync(c => c.Id == p && c.ParentId == null && c.IsActive))
                return Bad("category_not_found", "Main category not found.");
            parentId = p;
        }
        if (await CategoryTakenAsync(name, parentId, null)) return Bad("duplicate_name", $"There is already a category called {name}.");
        var category = new ExpenseCategory { Name = name, ParentId = parentId };
        _db.ExpenseCategories.Add(category);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "expense_category", category.Id, null);
        await _db.Entry(category).Reference(c => c.Parent).LoadAsync();
        return Created($"/api/expense-categories/{category.Id}", ToDto(category));
    }

    [HttpPut("expense-categories/{id:guid}")]
    [Authorize(Policy = Permissions.ExpenseCategoriesManage)]
    public async Task<ActionResult<ExpenseCategoryDto>> UpdateCategory(Guid id, [FromBody] UpdateExpenseCategoryRequest req)
    {
        var category = await _db.ExpenseCategories.Include(c => c.Parent).FirstOrDefaultAsync(c => c.Id == id);
        if (category is null) return NotFound(new { message = "Category not found.", code = "not_found" });
        if (req.ParentId is not null)
        {
            Guid? parentId = null;
            if (req.ParentId != "")
            {
                if (!Guid.TryParse(req.ParentId, out var p) || p == id
                    || !await _db.ExpenseCategories.AnyAsync(c => c.Id == p && c.ParentId == null && c.IsActive))
                    return Bad("category_not_found", "Main category not found.");
                if (await _db.ExpenseCategories.AnyAsync(c => c.ParentId == id))
                    return Bad("has_children", "A category with sub-categories stays a main category.");
                parentId = p;
            }
            category.ParentId = parentId;
        }
        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Enter the name.");
            if (await CategoryTakenAsync(name, category.ParentId, id)) return Bad("duplicate_name", $"There is already a category called {name}.");
            category.Name = name;
        }
        if (req.IsActive is bool active) category.IsActive = active;
        await _db.SaveChangesAsync();
        await AuditAsync("update", "expense_category", category.Id, null);
        await _db.Entry(category).Reference(c => c.Parent).LoadAsync();
        return Ok(ToDto(category));
    }

    // ------------------------------------------------------------------ helpers

    private IQueryable<SalesDocument> ScopedDocs()
    {
        return _db.SalesDocuments.InBranches(User, d => d.BranchId);
    }

    private IQueryable<Voucher> ScopedVouchers()
    {
        return _db.Vouchers.InBranches(User, v => v.BranchId);
    }

    private static IQueryable<Voucher> WithDetails(IQueryable<Voucher> q) => q.AsNoTracking()
        .Include(v => v.Branch).Include(v => v.Party).Include(v => v.ExpenseCategory)
        .Include(v => v.FromAccount).Include(v => v.ToAccount).Include(v => v.CreatedBy).Include(v => v.CancelledBy)
        .Include(v => v.Lines).ThenInclude(l => l.Account)
        .Include(v => v.Allocations).ThenInclude(a => a.Document)
        .AsSplitQuery();

    private Task<Voucher> ReloadVoucherAsync(Guid id) => WithDetails(_db.Vouchers).FirstAsync(v => v.Id == id);

    private Task<MoneyAccount> ReloadAccountAsync(Guid id) => _db.MoneyAccounts.AsNoTracking()
        .Include(a => a.Branch).Include(a => a.Custodian).FirstAsync(a => a.Id == id);

    /// <summary>Invoices in a cash-on-delivery parcel still on its way: the carrier collects those.</summary>
    private async Task<HashSet<Guid>> CodParcelDocsAsync(List<Guid> docIds) =>
        (await _db.ShipmentInvoices.Where(x => docIds.Contains(x.DocumentId) && x.CodShare > 0
                                               && OnTheWay.Contains(x.Shipment!.Status))
            .Select(x => x.DocumentId).ToListAsync()).ToHashSet();

    private async Task ClearDefaultAsync(Guid branchId)
    {
        var current = await _db.MoneyAccounts.Where(a => a.BranchId == branchId && a.IsDefault).ToListAsync();
        foreach (var a in current) a.IsDefault = false;
        if (current.Count > 0) await _db.SaveChangesAsync(); // before the new default, for the unique index
    }

    private Task<bool> NameTakenAsync(Guid branchId, string name, Guid? except)
    {
        var lower = name.ToLower();
        return _db.MoneyAccounts.AnyAsync(a => a.BranchId == branchId && a.IsActive && a.Id != except && a.Name.ToLower() == lower);
    }

    private Task<bool> CategoryTakenAsync(string name, Guid? parentId, Guid? except)
    {
        var lower = name.ToLower();
        return _db.ExpenseCategories.AnyAsync(c => c.ParentId == parentId && c.Id != except && c.Name.ToLower() == lower);
    }

    private static MoneyAccountDto ToDto(MoneyAccount a) => new(
        a.Id.ToString(), Loc.Name(a), a.Kind.ToString(), a.BranchId.ToString(), Loc.Name(a.Branch),
        a.CustodianId?.ToString(), a.Custodian?.FullName, a.Number, a.BankName, a.Balance, a.Currency, a.IsDefault,
        a.IsActive, a.LastSeq > 0);

    private static ExpenseCategoryDto ToDto(ExpenseCategory c) => new(
        c.Id.ToString(), Loc.Name(c), c.ParentId?.ToString(), c.Parent is null ? null : Loc.Name(c.Parent), c.IsActive);

    private static VoucherDto ToDto(Voucher v, string currency)
    {
        var allocated = v.Allocations.Sum(a => a.Amount);
        return new VoucherDto(
            v.Id.ToString(), v.Number, v.Type.ToString(), v.Status.ToString(), Loc.Name(v.Branch),
            v.PartyId?.ToString(), v.Party?.Name, v.ExpenseCategoryId?.ToString(),
            v.ExpenseCategory is null ? null : Loc.Name(v.ExpenseCategory),
            v.FromAccount is null ? null : Loc.Name(v.FromAccount), v.ToAccount is null ? null : Loc.Name(v.ToAccount),
            v.Amount, v.Type is VoucherType.RECEIPT or VoucherType.PAYMENT ? v.Amount - allocated : 0, v.Notes,
            v.CreatedAt.ToString("o"), v.CreatedBy?.FullName ?? "", v.CancelledAt?.ToString("o"), v.CancelledBy?.FullName,
            v.Lines.OrderBy(l => l.LineNo).Select(l => new VoucherLineDto(l.Method.ToString(), l.AccountId.ToString(),
                l.Account is null ? "" : Loc.Name(l.Account), l.Amount, l.Reference)).ToArray(),
            v.Allocations.OrderBy(a => a.Document?.Number).Select(a => new VoucherAllocationDto(
                a.DocumentId.ToString(), a.Document?.Number ?? "", a.Amount)).ToArray(),
            currency);
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private static string? Text(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, string resource, Guid id, Guid? branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource,
            (branchId?.ToString()) ?? CurrentUser.BranchId(User),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(),
            id.ToString());
}
