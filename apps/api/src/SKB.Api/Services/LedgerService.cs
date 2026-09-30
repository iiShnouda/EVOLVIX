using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>System accounts of the chart (DOMAIN.md §2.8). Code looks them up by key, never by name.</summary>
public static class LedgerKeys
{
    public const string Assets = "ASSETS", CurrentAssets = "CURRENT_ASSETS", Cash = "CASH", Banks = "BANKS",
        Customers = "CUSTOMERS", Carriers = "CARRIERS", Inventory = "INVENTORY", VatInput = "VAT_INPUT",
        FixedAssets = "FIXED_ASSETS", Liabilities = "LIABILITIES", CurrentLiabilities = "CURRENT_LIABILITIES",
        Suppliers = "SUPPLIERS", VatOutput = "VAT_OUTPUT", Equity = "EQUITY", Capital = "CAPITAL",
        OpeningEquity = "OPENING_EQUITY", RetainedEarnings = "RETAINED_EARNINGS", Revenue = "REVENUE",
        Sales = "SALES", SalesReturns = "SALES_RETURNS", OtherIncome = "OTHER_INCOME", StockGain = "STOCK_GAIN",
        Expenses = "EXPENSES", Cogs = "COGS", Operating = "OPERATING_EXPENSES", Shipping = "SHIPPING_EXPENSE",
        PurchaseExpenses = "PURCHASE_EXPENSES", StockLoss = "STOCK_LOSS", Rounding = "ROUNDING",
        NotesReceivable = "NOTES_RECEIVABLE", NotesUnderCollection = "NOTES_UNDER_COLLECTION",
        NotesPayable = "NOTES_PAYABLE", EmployeeAdvances = "EMPLOYEE_ADVANCES",
        SalariesPayable = "SALARIES_PAYABLE", Salaries = "SALARIES";

    /// <summary>Accounts that only documents post to (their own sub-ledgers keep them in step).</summary>
    public static readonly string[] DocumentOnly =
        { Inventory, NotesReceivable, NotesUnderCollection, NotesPayable, EmployeeAdvances, SalariesPayable };
}

/// <summary>
/// The general ledger (DOMAIN.md §2.8, §3). Builds the chart of accounts, finds or makes the
/// sub-account of a customer / supplier / carrier / money account / expense category, and posts
/// each document's journal entry in the caller's transaction. An entry whose debits and credits
/// differ is a bug and throws.
/// </summary>
public sealed class LedgerService
{
    private readonly AppDbContext _db;
    private readonly Dictionary<string, LedgerAccount> _system = new();

    public LedgerService(AppDbContext db) => _db = db;

    public enum PartyRole { Customer, Supplier, Carrier }

    private sealed record ChartRow(string Code, string Key, string Name, LedgerAccountType Type, string? Parent, bool Group);

    /// <summary>The starter chart. Names are data (Arabic, like the other starter lists); codes are fixed.</summary>
    private static readonly ChartRow[] Chart =
    {
        new("1", LedgerKeys.Assets, "الأصول", LedgerAccountType.ASSET, null, true),
        new("11", LedgerKeys.CurrentAssets, "الأصول المتداولة", LedgerAccountType.ASSET, LedgerKeys.Assets, true),
        new("1101", LedgerKeys.Cash, "النقدية بالخزائن والعهد", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, true),
        new("1102", LedgerKeys.Banks, "البنوك والمحافظ", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, true),
        new("1103", LedgerKeys.Customers, "العملاء", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, true),
        new("1104", LedgerKeys.Carriers, "شركات الشحن", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, true),
        new("1105", LedgerKeys.Inventory, "المخزون", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, false),
        new("1106", LedgerKeys.VatInput, "ضريبة القيمة المضافة - مشتريات", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, false),
        new("1107", LedgerKeys.NotesReceivable, "أوراق القبض", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, false),
        new("1108", LedgerKeys.NotesUnderCollection, "أوراق برسم التحصيل", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, false),
        new("1109", LedgerKeys.EmployeeAdvances, "سلف الموظفين", LedgerAccountType.ASSET, LedgerKeys.CurrentAssets, false),
        new("12", LedgerKeys.FixedAssets, "الأصول الثابتة", LedgerAccountType.ASSET, LedgerKeys.Assets, true),
        new("2", LedgerKeys.Liabilities, "الخصوم", LedgerAccountType.LIABILITY, null, true),
        new("21", LedgerKeys.CurrentLiabilities, "الخصوم المتداولة", LedgerAccountType.LIABILITY, LedgerKeys.Liabilities, true),
        new("2101", LedgerKeys.Suppliers, "الموردون", LedgerAccountType.LIABILITY, LedgerKeys.CurrentLiabilities, true),
        new("2102", LedgerKeys.VatOutput, "ضريبة القيمة المضافة - مبيعات", LedgerAccountType.LIABILITY, LedgerKeys.CurrentLiabilities, false),
        new("2103", LedgerKeys.NotesPayable, "أوراق الدفع", LedgerAccountType.LIABILITY, LedgerKeys.CurrentLiabilities, false),
        new("2104", LedgerKeys.SalariesPayable, "رواتب مستحقة", LedgerAccountType.LIABILITY, LedgerKeys.CurrentLiabilities, false),
        new("3", LedgerKeys.Equity, "حقوق الملكية", LedgerAccountType.EQUITY, null, true),
        new("3101", LedgerKeys.Capital, "رأس المال", LedgerAccountType.EQUITY, LedgerKeys.Equity, false),
        new("3102", LedgerKeys.OpeningEquity, "أرصدة افتتاحية", LedgerAccountType.EQUITY, LedgerKeys.Equity, false),
        new("3103", LedgerKeys.RetainedEarnings, "الأرباح المحتجزة", LedgerAccountType.EQUITY, LedgerKeys.Equity, false),
        new("4", LedgerKeys.Revenue, "الإيرادات", LedgerAccountType.REVENUE, null, true),
        new("4101", LedgerKeys.Sales, "المبيعات", LedgerAccountType.REVENUE, LedgerKeys.Revenue, false),
        new("4102", LedgerKeys.SalesReturns, "مردودات المبيعات", LedgerAccountType.REVENUE, LedgerKeys.Revenue, false),
        new("4103", LedgerKeys.OtherIncome, "إيرادات أخرى", LedgerAccountType.REVENUE, LedgerKeys.Revenue, false),
        new("4104", LedgerKeys.StockGain, "أرباح فروق الجرد", LedgerAccountType.REVENUE, LedgerKeys.Revenue, false),
        new("5", LedgerKeys.Expenses, "المصروفات", LedgerAccountType.EXPENSE, null, true),
        new("5101", LedgerKeys.Cogs, "تكلفة البضاعة المباعة", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
        new("5102", LedgerKeys.Operating, "المصروفات التشغيلية", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, true),
        new("5103", LedgerKeys.Shipping, "مصاريف الشحن", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
        new("5104", LedgerKeys.PurchaseExpenses, "مصاريف المشتريات", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
        new("5105", LedgerKeys.StockLoss, "خسائر فروق الجرد", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
        new("5106", LedgerKeys.Rounding, "فروق التقريب", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
        new("5107", LedgerKeys.Salaries, "الرواتب والأجور", LedgerAccountType.EXPENSE, LedgerKeys.Expenses, false),
    };

    // ------------------------------------------------------------------ accounts

    public async Task<LedgerAccount> SystemAsync(string key)
    {
        if (_system.TryGetValue(key, out var cached)) return cached;
        var account = _db.LedgerAccounts.Local.FirstOrDefault(a => a.SystemKey == key)
                      ?? await _db.LedgerAccounts.FirstAsync(a => a.SystemKey == key);
        _system[key] = account;
        return account;
    }

    /// <summary>Which side of the party's dealings a receivable (they owe us) sits on.</summary>
    public static PartyRole ReceivableRole(Party p) =>
        p.Types.Contains(nameof(PartyType.CUSTOMER)) ? PartyRole.Customer
        : p.Types.Contains(nameof(PartyType.CARRIER)) ? PartyRole.Carrier
        : PartyRole.Supplier;

    /// <summary>Which side of the party's dealings a payable (we owe them) sits on.</summary>
    public static PartyRole PayableRole(Party p) =>
        p.Types.Contains(nameof(PartyType.SUPPLIER)) || p.Types.Contains(nameof(PartyType.FACTORY)) ? PartyRole.Supplier
        : p.Types.Contains(nameof(PartyType.CUSTOMER)) ? PartyRole.Customer
        : PartyRole.Carrier;

    public async Task<LedgerAccount> ForPartyAsync(Party party, PartyRole role)
    {
        var parent = await SystemAsync(role switch
        {
            PartyRole.Customer => LedgerKeys.Customers,
            PartyRole.Supplier => LedgerKeys.Suppliers,
            _ => LedgerKeys.Carriers,
        });
        return await SubAccountAsync(parent, a => a.PartyId == party.Id, a => { a.PartyId = party.Id; a.Name = party.Name; });
    }

    public async Task<LedgerAccount> ForMoneyAsync(MoneyAccount money)
    {
        var parent = await SystemAsync(money.Kind is MoneyAccountKind.CASH_BOX or MoneyAccountKind.CUSTODY
            ? LedgerKeys.Cash : LedgerKeys.Banks);
        return await SubAccountAsync(parent, a => a.MoneyAccountId == money.Id,
            a => { a.MoneyAccountId = money.Id; a.Name = money.Name; });
    }

    public async Task<LedgerAccount> ForExpenseAsync(ExpenseCategory category)
    {
        var parent = await SystemAsync(LedgerKeys.Operating);
        return await SubAccountAsync(parent, a => a.ExpenseCategoryId == category.Id,
            a => { a.ExpenseCategoryId = category.Id; a.Name = category.Name; });
    }

    /// <summary>
    /// Find a linked sub-account under <paramref name="parent"/>, or make it (numbered after its
    /// siblings). An advisory lock on the parent, held to the end of the transaction, keeps two
    /// requests from making the same one or taking the same code.
    /// </summary>
    private async Task<LedgerAccount> SubAccountAsync(LedgerAccount parent, Func<LedgerAccount, bool> match,
        Action<LedgerAccount> link)
    {
        var local = _db.LedgerAccounts.Local.FirstOrDefault(a => a.ParentId == parent.Id && match(a));
        if (local is not null) return local;
        var probe = new LedgerAccount();
        link(probe);
        var q = _db.LedgerAccounts.Where(a => a.ParentId == parent.Id);
        q = probe.PartyId is Guid pid ? q.Where(a => a.PartyId == pid)
            : probe.MoneyAccountId is Guid mid ? q.Where(a => a.MoneyAccountId == mid)
            : q.Where(a => a.ExpenseCategoryId == probe.ExpenseCategoryId);
        var found = await q.FirstOrDefaultAsync();
        if (found is not null) return found;

        if (_db.Database.CurrentTransaction is not null)
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"ledger:" + parent.Id}))");
        found = await q.FirstOrDefaultAsync();
        if (found is not null) return found;

        var account = new LedgerAccount
        {
            Code = await NextChildCodeAsync(parent), Type = parent.Type, ParentId = parent.Id,
        };
        link(account);
        _db.LedgerAccounts.Add(account);
        return account;
    }

    /// <summary>"1103-0001", "1103-0002"… after the parent's code.</summary>
    public async Task<string> NextChildCodeAsync(LedgerAccount parent)
    {
        var prefix = parent.Code + "-";
        var codes = await _db.LedgerAccounts.Where(a => a.ParentId == parent.Id && a.Code.StartsWith(prefix))
            .Select(a => a.Code).ToListAsync();
        codes.AddRange(_db.LedgerAccounts.Local.Where(a => a.ParentId == parent.Id).Select(a => a.Code));
        var next = codes.Select(c => int.TryParse(c[prefix.Length..], out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        return $"{prefix}{next:D4}";
    }

    // ------------------------------------------------------------------ entries

    /// <summary>An entry being put together: add debits and credits, then <see cref="Post"/>.</summary>
    public sealed class Draft
    {
        internal readonly List<(LedgerAccount Account, long Debit, long Credit, string? Memo)> Lines = new();
        internal JournalEntry Entry { get; init; } = null!;

        public Draft Debit(LedgerAccount account, long amount, string? memo = null)
        {
            if (amount < 0) return Credit(account, -amount, memo);
            if (amount > 0) Lines.Add((account, amount, 0, memo));
            return this;
        }

        public Draft Credit(LedgerAccount account, long amount, string? memo = null)
        {
            if (amount < 0) return Debit(account, -amount, memo);
            if (amount > 0) Lines.Add((account, 0, amount, memo));
            return this;
        }
    }

    public Draft Begin(string sourceType, Guid? sourceId, string number, string description, Guid? branchId,
        Guid staffId, DateTime? date = null) => new()
    {
        Entry = new JournalEntry
        {
            SourceType = sourceType, SourceId = sourceId, Number = number, BranchId = branchId,
            Description = description.Length > 300 ? description[..300] : description,
            CreatedById = staffId, Date = date ?? DateTime.UtcNow,
        },
    };

    /// <summary>Add the entry to the unit of work (saved with the caller's changes). Nothing to post → null.</summary>
    public JournalEntry? Post(Draft draft)
    {
        if (draft.Lines.Count == 0) return null;
        var debit = draft.Lines.Sum(l => l.Debit);
        var credit = draft.Lines.Sum(l => l.Credit);
        if (debit != credit)
            throw new InvalidOperationException(
                $"Unbalanced journal entry for {draft.Entry.SourceType} {draft.Entry.Number}: {debit} ≠ {credit}.");
        var n = 0;
        foreach (var (account, d, c, memo) in draft.Lines)
            draft.Entry.Lines.Add(new JournalLine
            {
                // By id only: the account object may come from before the change tracker was cleared.
                LineNo = ++n, AccountId = account.Id, Debit = d, Credit = c,
                Memo = memo is { Length: > 200 } ? memo[..200] : memo,
            });
        _db.JournalEntries.Add(draft.Entry);
        return draft.Entry;
    }

    /// <summary>Post the exact reverse of every entry a source posted (a cancellation).</summary>
    public async Task ReverseAsync(string sourceType, Guid sourceId, string reverseType, string number,
        string description, Guid staffId)
    {
        var entries = await _db.JournalEntries.Include(e => e.Lines).ThenInclude(l => l.Account)
            .Where(e => e.SourceType == sourceType && e.SourceId == sourceId).ToListAsync();
        foreach (var e in entries)
        {
            var draft = Begin(reverseType, sourceId, number, description, e.BranchId, staffId);
            foreach (var l in e.Lines.OrderBy(l => l.LineNo)) draft.Debit(l.Account!, l.Credit, l.Memo).Credit(l.Account!, l.Debit, l.Memo);
            Post(draft);
        }
    }

    // ------------------------------------------------------------------ documents (DOMAIN.md §3)

    /// <summary>
    /// Sales invoice: Dr customer (total) · Cr sales (net of discounts) · Cr VAT · Cr other income
    /// (additions) · Dr COGS · Cr inventory; paid now: Dr money · Cr customer.
    /// </summary>
    public async Task PostSalesInvoiceAsync(SalesDocument doc, Party party, MoneyAccount? paidInto, Guid staffId)
    {
        var customer = await ForPartyAsync(party, PartyRole.Customer);
        var draft = Begin("SALES_INVOICE", doc.Id, doc.Number, $"Sales invoice {doc.Number}", doc.BranchId, staffId)
            .Debit(customer, doc.GrandTotal)
            .Credit(await SystemAsync(LedgerKeys.Sales), doc.Subtotal - doc.DiscountTotal)
            .Credit(await SystemAsync(LedgerKeys.VatOutput), doc.TaxTotal)
            .Credit(await SystemAsync(LedgerKeys.OtherIncome), doc.AdditionTotal)
            .Debit(await SystemAsync(LedgerKeys.Cogs), doc.CostTotal)
            .Credit(await SystemAsync(LedgerKeys.Inventory), doc.CostTotal);
        if (doc.PaidAmount > 0 && paidInto is not null)
            draft.Debit(await ForMoneyAsync(paidInto), doc.PaidAmount).Credit(customer, doc.PaidAmount);
        Post(draft);
    }

    /// <summary>
    /// Sales return: Dr sales returns (net) · Dr VAT · Cr customer (total) · Dr inventory · Cr COGS;
    /// cash back: Dr customer · Cr money.
    /// </summary>
    public async Task PostSalesReturnAsync(SalesDocument doc, Party party, MoneyAccount? refundFrom, Guid staffId)
    {
        var customer = await ForPartyAsync(party, PartyRole.Customer);
        var draft = Begin("SALES_RETURN", doc.Id, doc.Number, $"Sales return {doc.Number}", doc.BranchId, staffId)
            .Debit(await SystemAsync(LedgerKeys.SalesReturns), doc.Subtotal - doc.DiscountTotal)
            .Debit(await SystemAsync(LedgerKeys.VatOutput), doc.TaxTotal)
            .Credit(customer, doc.GrandTotal)
            .Debit(await SystemAsync(LedgerKeys.Inventory), doc.CostTotal)
            .Credit(await SystemAsync(LedgerKeys.Cogs), doc.CostTotal);
        // A return's total is its net + tax (additions aren't refunded); anything else is rounding.
        draft.Debit(await SystemAsync(LedgerKeys.Rounding), doc.GrandTotal - (doc.Subtotal - doc.DiscountTotal) - doc.TaxTotal);
        if (doc.PaidAmount > 0 && refundFrom is not null)
            draft.Debit(customer, doc.PaidAmount).Credit(await ForMoneyAsync(refundFrom), doc.PaidAmount);
        Post(draft);
    }

    /// <summary>
    /// Purchase invoice: Dr inventory (goods net of discounts) · Dr VAT · Dr purchase expenses
    /// (additions such as freight) · Cr supplier (total); paid now: Dr supplier · Cr money.
    /// </summary>
    public async Task PostPurchaseInvoiceAsync(SalesDocument doc, Party party, MoneyAccount? paidFrom, Guid staffId)
    {
        var supplier = await ForPartyAsync(party, PartyRole.Supplier);
        var draft = Begin("PURCHASE_INVOICE", doc.Id, doc.Number, $"Purchase invoice {doc.Number}", doc.BranchId, staffId)
            .Debit(await SystemAsync(LedgerKeys.Inventory), doc.CostTotal)
            .Debit(await SystemAsync(LedgerKeys.VatInput), doc.TaxTotal)
            .Debit(await SystemAsync(LedgerKeys.PurchaseExpenses), doc.AdditionTotal)
            .Credit(supplier, doc.GrandTotal);
        draft.Debit(await SystemAsync(LedgerKeys.Rounding), doc.GrandTotal - doc.CostTotal - doc.TaxTotal - doc.AdditionTotal);
        if (doc.PaidAmount > 0 && paidFrom is not null)
            draft.Debit(supplier, doc.PaidAmount).Credit(await ForMoneyAsync(paidFrom), doc.PaidAmount);
        Post(draft);
    }

    /// <summary>Purchase return: Dr supplier (total) · Cr inventory · Cr VAT; cash back: Dr money · Cr supplier.</summary>
    public async Task PostPurchaseReturnAsync(SalesDocument doc, Party party, MoneyAccount? refundInto, Guid staffId)
    {
        var supplier = await ForPartyAsync(party, PartyRole.Supplier);
        var draft = Begin("PURCHASE_RETURN", doc.Id, doc.Number, $"Purchase return {doc.Number}", doc.BranchId, staffId)
            .Debit(supplier, doc.GrandTotal)
            .Credit(await SystemAsync(LedgerKeys.Inventory), doc.CostTotal)
            .Credit(await SystemAsync(LedgerKeys.VatInput), doc.TaxTotal);
        draft.Credit(await SystemAsync(LedgerKeys.Rounding), doc.GrandTotal - doc.CostTotal - doc.TaxTotal);
        if (doc.PaidAmount > 0 && refundInto is not null)
            draft.Debit(await ForMoneyAsync(refundInto), doc.PaidAmount).Credit(supplier, doc.PaidAmount);
        Post(draft);
    }

    /// <summary>
    /// Receipt: Dr money · Cr party. Payment: Dr party · Cr money. Expense: Dr its category · Cr money.
    /// Transfer: Dr the target · Cr the source.
    /// </summary>
    public async Task PostVoucherAsync(Voucher v, Party? party, IReadOnlyDictionary<Guid, MoneyAccount> accounts,
        ExpenseCategory? category, Guid staffId)
    {
        var label = v.Type switch
        {
            VoucherType.RECEIPT => "Receipt",
            VoucherType.PAYMENT => "Payment",
            VoucherType.EXPENSE => "Expense",
            _ => "Cash transfer",
        };
        var draft = Begin("VOUCHER", v.Id, v.Number, $"{label} {v.Number}", v.BranchId, staffId);
        switch (v.Type)
        {
            case VoucherType.RECEIPT:
                foreach (var l in v.Lines) draft.Debit(await ForMoneyAsync(accounts[l.AccountId]), l.Amount, l.Reference);
                draft.Credit(await ForPartyAsync(party!, ReceivableRole(party!)), v.Amount);
                break;
            case VoucherType.PAYMENT:
                draft.Debit(await ForPartyAsync(party!, PayableRole(party!)), v.Amount);
                foreach (var l in v.Lines) draft.Credit(await ForMoneyAsync(accounts[l.AccountId]), l.Amount, l.Reference);
                break;
            case VoucherType.EXPENSE:
                draft.Debit(await ForExpenseAsync(category!), v.Amount, v.Notes);
                foreach (var l in v.Lines) draft.Credit(await ForMoneyAsync(accounts[l.AccountId]), l.Amount, l.Reference);
                break;
            default:
                draft.Debit(await ForMoneyAsync(accounts[v.ToAccountId!.Value]), v.Amount)
                    .Credit(await ForMoneyAsync(accounts[v.FromAccountId!.Value]), v.Amount);
                break;
        }
        Post(draft);
    }

    public Task ReverseVoucherAsync(Voucher v, Guid staffId) =>
        ReverseAsync("VOUCHER", v.Id, "VOUCHER_CANCEL", v.Number, $"Cancelled {v.Number}", staffId);

    /// <summary>Stocktake: gains Dr inventory · Cr stock gain; losses Dr stock loss · Cr inventory.</summary>
    public async Task PostStocktakeAsync(string reference, Guid branchId, long gains, long losses, Guid staffId)
    {
        var inventory = await SystemAsync(LedgerKeys.Inventory);
        var draft = Begin("STOCKTAKE", null, reference, $"Stocktake {reference}", branchId, staffId)
            .Debit(inventory, gains).Credit(await SystemAsync(LedgerKeys.StockGain), gains)
            .Debit(await SystemAsync(LedgerKeys.StockLoss), losses).Credit(inventory, losses);
        Post(draft);
    }

    /// <summary>A cash-on-delivery parcel delivered: the customer's debt moves to the carrier.</summary>
    public async Task PostCodDeliveredAsync(Shipment s, Guid staffId)
    {
        var draft = Begin("SHIPMENT", s.Id, s.Number, $"Cash on delivery {s.Number}", s.BranchId, staffId)
            .Debit(await ForPartyAsync(s.Carrier!, PartyRole.Carrier), s.CodAmount)
            .Credit(await ForPartyAsync(s.Party!, PartyRole.Customer), s.CodAmount);
        Post(draft);
    }

    /// <summary>Carrier settlement: Dr money (paid) · Dr shipping expense (fees) · Cr carrier.</summary>
    public async Task PostSettlementAsync(CarrierSettlement x, Party carrier, MoneyAccount? into, Guid branchId, Guid staffId)
    {
        var draft = Begin("CARRIER_SETTLEMENT", x.Id, x.Number, $"Carrier settlement {x.Number}", branchId, staffId)
            .Debit(await SystemAsync(LedgerKeys.Shipping), x.Fees)
            .Credit(await ForPartyAsync(carrier, PartyRole.Carrier), x.Fees + x.Received);
        if (x.Received > 0) draft.Debit(await ForMoneyAsync(into!), x.Received);
        Post(draft);
    }

    /// <summary>One step of a cheque / note: Dr <paramref name="debit"/> · Cr <paramref name="credit"/> for its amount.</summary>
    public void PostNote(Note note, string step, LedgerAccount debit, LedgerAccount credit, Guid staffId)
    {
        var draft = Begin("NOTE", note.Id, note.Ref, $"{step} {note.Ref}", note.BranchId, staffId)
            .Debit(debit, note.Amount, note.SerialNumber).Credit(credit, note.Amount, note.SerialNumber);
        Post(draft);
    }

    /// <summary>Money already in a new account: Dr the account · Cr opening balances.</summary>
    public async Task PostMoneyOpeningAsync(MoneyAccount account, long amount, Guid staffId)
    {
        var draft = Begin("MONEY_OPENING", account.Id, "OPENING", $"Opening balance — {account.Name}", account.BranchId, staffId)
            .Debit(await ForMoneyAsync(account), amount)
            .Credit(await SystemAsync(LedgerKeys.OpeningEquity), amount);
        Post(draft);
    }

    // ------------------------------------------------------------------ setup

    /// <summary>
    /// Make sure the chart exists; on the first run over an existing company, post one opening
    /// entry (go-live, DOMAIN.md §2.8) from what the books already hold: each party's balance, each
    /// money account and the stock at average cost, against opening balances. Idempotent.
    /// </summary>
    public static async Task SetupAsync(AppDbContext db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('ledger-setup'))");
        var existing = await db.LedgerAccounts.Where(a => a.SystemKey != null).ToDictionaryAsync(a => a.SystemKey!);
        foreach (var row in Chart)
        {
            if (existing.ContainsKey(row.Key)) continue;
            var account = new LedgerAccount
            {
                Code = row.Code, Name = row.Name, Type = row.Type, IsGroup = row.Group, SystemKey = row.Key,
                ParentId = row.Parent is null ? null : existing[row.Parent].Id,
            };
            db.LedgerAccounts.Add(account);
            existing[row.Key] = account;
        }
        await db.SaveChangesAsync();

        var owner = await db.Staff.Where(s => s.Role == Role.OWNER).OrderBy(s => s.CreatedAt).Select(s => (Guid?)s.Id).FirstOrDefaultAsync();
        if (owner is null || await db.JournalEntries.AnyAsync())
        {
            await tx.CommitAsync();
            return;
        }

        var ledger = new LedgerService(db);
        var draft = ledger.Begin("OPENING", null, "OPENING", "Opening balances (go-live)", null, owner.Value);
        foreach (var p in await db.Parties.Where(p => p.Balance != 0).OrderBy(p => p.Name).ToListAsync())
            draft.Debit(await ledger.ForPartyAsync(p, p.Balance > 0 ? ReceivableRole(p) : PayableRole(p)), p.Balance);
        foreach (var m in await db.MoneyAccounts.Where(m => m.Balance != 0).OrderBy(m => m.CreatedAt).ToListAsync())
            draft.Debit(await ledger.ForMoneyAsync(m), m.Balance);
        var stock = await (from b in db.StockBalances
                           join w in db.Warehouses on b.WarehouseId equals w.Id
                           join c in db.StockCosts on new { b.ProductId, PoolId = w.Kind == WarehouseKind.TRANSIT ? w.Id : w.BranchId }
                               equals new { c.ProductId, c.PoolId }
                           select (long)b.Quantity * c.AvgCost).SumAsync();
        draft.Debit(existing[LedgerKeys.Inventory], stock);
        var net = draft.Lines.Sum(l => l.Debit - l.Credit);
        draft.Credit(existing[LedgerKeys.OpeningEquity], net);
        ledger.Post(draft);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
    }
}
