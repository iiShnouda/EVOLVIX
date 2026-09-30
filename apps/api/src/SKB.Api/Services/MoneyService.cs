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
