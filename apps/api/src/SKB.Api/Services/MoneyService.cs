using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Money accounts (DOMAIN.md §2.6): every amount that goes in or out of a cash box, custody, bank,
/// wallet or post account goes through <see cref="Move"/>. An account never goes below zero, its
/// balance is the sum of its movements, and each movement is numbered per account (<c>Seq</c>).
/// </summary>
public sealed class MoneyService
{
    private readonly AppDbContext _db;

    public MoneyService(AppDbContext db) => _db = db;

    public sealed record MoneyError(string Code, string Message);

    /// <summary>Which kind of account each payment method lands in.</summary>
    public static bool Fits(PaymentMethod method, MoneyAccountKind kind) => method switch
    {
        PaymentMethod.CASH => kind is MoneyAccountKind.CASH_BOX or MoneyAccountKind.CUSTODY,
        PaymentMethod.BANK_TRANSFER or PaymentMethod.INSTAPAY => kind == MoneyAccountKind.BANK,
        PaymentMethod.MOBILE_WALLET => kind == MoneyAccountKind.WALLET,
        PaymentMethod.POST => kind == MoneyAccountKind.POST,
        _ => false,
    };

    /// <summary>The method money moved by when none was named: cash for a cash box, etc.</summary>
    public static PaymentMethod DefaultMethod(MoneyAccountKind kind) => kind switch
    {
        MoneyAccountKind.BANK => PaymentMethod.BANK_TRANSFER,
        MoneyAccountKind.WALLET => PaymentMethod.MOBILE_WALLET,
        MoneyAccountKind.POST => PaymentMethod.POST,
        _ => PaymentMethod.CASH,
    };

    /// <summary>Accounts a user may use: their branch's, or every branch's for all-branch roles.</summary>
    /// <summary>The money accounts a person may see and use: in their branches, and only those named if the owner narrowed it.</summary>
    public IQueryable<MoneyAccount> Visible(ClaimsPrincipal user)
    {
        var q = _db.MoneyAccounts.InBranches(user, a => a.BranchId);
        if (Access.MoneyAccounts(user) is { } only) q = q.Where(a => only.Contains(a.Id));
        return q;
    }

    /// <summary>
    /// Where each box's cash is sent up to (owner, 2026-10-02): a warehouse's box, custody or any other
    /// cash box goes to its branch's default box; a branch's default box goes to the main box; the
    /// main box goes nowhere. Banks, wallets and the post account aren't handed over.
    /// </summary>
    public async Task<Func<MoneyAccount, (Guid Id, string Name)?>> UpTargetsAsync()
    {
        var defaults = await _db.MoneyAccounts.AsNoTracking().Where(a => a.IsDefault && a.IsActive)
            .Select(a => new { a.Id, a.BranchId, a.Name }).ToListAsync();
        var byBranch = defaults.ToDictionary(a => a.BranchId, a => (a.Id, a.Name));
        var main = await _db.MoneyAccounts.AsNoTracking().Where(a => a.IsMain && a.IsActive)
            .Select(a => new { a.Id, a.Name }).FirstOrDefaultAsync();
        return a =>
        {
            if (a.IsMain || !a.IsActive || a.Kind is not (MoneyAccountKind.CASH_BOX or MoneyAccountKind.CUSTODY)) return null;
            if (!a.IsDefault)
                return byBranch.TryGetValue(a.BranchId, out var up) && up.Id != a.Id ? up : null;
            return main is not null && main.Id != a.Id ? (main.Id, main.Name) : null;
        };
    }

    /// <summary>May the person use this account (it's one they see)?</summary>
    public static bool CanUse(ClaimsPrincipal user, MoneyAccount account) =>
        Access.CanUseBranch(user, account.BranchId)
        && (Access.MoneyAccounts(user) is not { } only || only.Contains(account.Id));

    /// <summary>
    /// Lock the accounts' rows until the transaction ends (in id order, so two requests never wait
    /// on each other) and load them tracked. Callers must be inside a transaction.
    /// </summary>
    public async Task<Dictionary<Guid, MoneyAccount>> LockAsync(IEnumerable<Guid> ids)
    {
        var ordered = ids.Distinct().OrderBy(i => i).ToArray();
        if (ordered.Length == 0) return new();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"MoneyAccounts\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        var rows = await _db.MoneyAccounts.Where(a => ordered.Contains(a.Id)).ToListAsync();
        foreach (var a in rows) await _db.Entry(a).ReloadAsync(); // the balance as of the lock
        return rows.ToDictionary(a => a.Id);
    }

    /// <summary>
    /// Money in (+) or out (−) of <paramref name="account"/> (locked by <see cref="LockAsync"/>).
    /// Refuses to take it below zero.
    /// </summary>
    public MoneyError? Move(MoneyAccount account, long amount, MoneyMovementKind kind, Guid staffId,
        string? reference, Guid? voucherId = null, Guid? documentId = null, Guid? partyId = null,
        PaymentMethod? method = null, string? methodReference = null, string? notes = null,
        Guid? settlementId = null)
    {
        if (amount == 0) return null;
        if (account.Balance + amount < 0)
            return new("insufficient_funds",
                $"{Loc.Name(account)} holds {account.Balance / 100m:0.00}; {-amount / 100m:0.00} can't be taken out.");
        // Cash sent up and not yet confirmed stays in the box but can't be spent.
        if (amount < 0 && account.Held > 0 && account.Balance + amount < account.Held)
            return new("insufficient_funds",
                $"{Loc.Name(account)} holds {account.Balance / 100m:0.00}, of which {account.Held / 100m:0.00} is on its way up; {-amount / 100m:0.00} can't be taken out.");
        account.Balance += amount;
        account.LastSeq += 1;
        _db.MoneyMovements.Add(new MoneyMovement
        {
            AccountId = account.Id, Seq = account.LastSeq, Amount = amount, BalanceAfter = account.Balance,
            Kind = kind, Method = method ?? (kind == MoneyMovementKind.OPENING ? null : DefaultMethod(account.Kind)),
            VoucherId = voucherId, DocumentId = documentId, PartyId = partyId, SettlementId = settlementId,
            Reference = reference, MethodReference = methodReference, Notes = notes, CreatedById = staffId,
        });
        return null;
    }

    /// <summary>
    /// The account a paid-now amount (or a refund) goes through: the one asked for (one the person
    /// may use), else the default cash box of <paramref name="branchId"/> — or, if they may not use
    /// that one, their first cash box there. Locked and ready for <see cref="Move"/>.
    /// </summary>
    /// <summary>
    /// Shipping we pay (goods from a supplier, a customer's return — owner decision 2026-09-30): an
    /// expense voucher out of a money account (the one given, else the branch's cash box) into the
    /// shipping expense account. Customers pay the shipping company for their own deliveries directly.
    /// </summary>
    public async Task<(Voucher? Voucher, MoneyError? Error)> ShippingExpenseAsync(long amount, string? accountId,
        Guid branchId, string reference, ClaimsPrincipal user, Guid staffId, LedgerService ledger)
    {
        if (amount <= 0) return (null, null);
        if (amount > InvoiceLines.MaxPrice) return (null, new("bad_amount", "The shipping cost is too large."));
        var (account, error) = await ForDocumentAsync(accountId, branchId, user);
        if (error is not null) return (null, error);
        var method = DefaultMethod(account!.Kind);
        var voucher = new Voucher
        {
            Number = await DocumentNumbers.NextVoucherAsync(_db, VoucherType.EXPENSE), Type = VoucherType.EXPENSE,
            BranchId = account.BranchId, Amount = amount, Notes = $"Shipping — {reference}", CreatedById = staffId,
        };
        voucher.Lines.Add(new VoucherLine { LineNo = 1, Method = method, AccountId = account.Id, Amount = amount });
        error = Move(account, -amount, MoneyMovementKind.EXPENSE, staffId, voucher.Number, voucherId: voucher.Id,
            method: method, notes: voucher.Notes);
        if (error is not null) return (null, error);
        await ledger.PostVoucherAsync(voucher, null, new Dictionary<Guid, MoneyAccount> { [account.Id] = account }, null, staffId);
        _db.Vouchers.Add(voucher);
        return (voucher, null);
    }

    public async Task<(MoneyAccount? Account, MoneyError? Error)> ForDocumentAsync(
        string? requested, Guid branchId, ClaimsPrincipal user)
    {
        Guid id;
        if (!string.IsNullOrWhiteSpace(requested))
        {
            if (!Guid.TryParse(requested, out id) || !await Visible(user).AnyAsync(a => a.Id == id && a.IsActive))
                return (null, new("account_not_found", "Money account not found."));
        }
        else
        {
            var def = await _db.MoneyAccounts.Where(a => a.BranchId == branchId && a.IsDefault && a.IsActive)
                .Select(a => (Guid?)a.Id).FirstOrDefaultAsync();
            if (def is null) return (null, new("no_cash_box", "This branch has no cash box. Add one under Money."));
            if (Access.MoneyAccounts(user) is { } only && !only.Contains(def.Value))
            {
                def = await Visible(user).Where(a => a.BranchId == branchId && a.IsActive && a.Kind == MoneyAccountKind.CASH_BOX)
                    .OrderBy(a => a.Name).Select(a => (Guid?)a.Id).FirstOrDefaultAsync();
                if (def is null) return (null, new("no_cash_box", "You have no cash box in this branch. Choose an account."));
            }
            id = def.Value;
        }
        var locked = await LockAsync(new[] { id });
        return (locked[id], null);
    }

    /// <summary>
    /// Lock parties' rows until the transaction ends and re-read them, before changing a balance.
    /// Without it, two documents for one customer at the same moment would both add to the balance
    /// they read, and one of the two amounts would be lost. Call it before touching the balance.
    /// </summary>
    public static async Task LockPartiesAsync(AppDbContext db, params Guid[] ids)
    {
        var ordered = ids.Distinct().OrderBy(i => i).ToArray();
        if (ordered.Length == 0) return;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"Parties\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        foreach (var entry in db.ChangeTracker.Entries<Party>().Where(e => ordered.Contains(e.Entity.Id)).ToList())
            await entry.ReloadAsync();
    }

    /// <summary>
    /// What is still owed on each invoice: grand total − paid, less what its returns put back on
    /// the party's account (a return credits the account, not the invoice).
    /// </summary>
    public static async Task<Dictionary<Guid, long>> OutstandingAsync(AppDbContext db, IReadOnlyCollection<SalesDocument> docs)
    {
        var ids = docs.Select(d => d.Id).ToList();
        var credited = await db.SalesDocuments.AsNoTracking()
            .Where(r => r.SourceDocumentId != null && ids.Contains(r.SourceDocumentId.Value)
                        && (r.Type == DocumentType.SALES_RETURN || r.Type == DocumentType.PURCHASE_RETURN)
                        && r.Status != DocumentStatus.CANCELLED)
            .GroupBy(r => r.SourceDocumentId!.Value)
            .Select(g => new { Id = g.Key, OnAccount = g.Sum(r => r.GrandTotal - r.PaidAmount) })
            .ToDictionaryAsync(x => x.Id, x => x.OnAccount);
        return docs.ToDictionary(d => d.Id,
            d => d.Status == DocumentStatus.CANCELLED ? 0
                : Math.Max(0, d.GrandTotal - d.PaidAmount - credited.GetValueOrDefault(d.Id)));
    }

    /// <summary>Paid / part paid / unpaid after its paid amount changed; returned and cancelled stay.</summary>
    public static void RefreshPaidStatus(SalesDocument doc)
    {
        if (doc.Status is not (DocumentStatus.CONFIRMED or DocumentStatus.PAID
            or DocumentStatus.PARTIALLY_PAID or DocumentStatus.OVERDUE)) return;
        doc.Status = doc.PaidAmount >= doc.GrandTotal ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;
    }
}
