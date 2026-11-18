using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Sales returns (مرتجع مبيعات) and purchase returns (مرتجع مشتريات), made one way (owner,
/// 2026-11-10: "one thing only, like a sales invoice but a return, and only what the customer
/// bought"). A return is typed like an invoice — the party, branch, warehouse, department and items —
/// and the server takes each item from the party's own invoice lines, newest invoice first (on each
/// invoice its paid pieces, then its free ones), never more than they bought less what came back
/// already. Each return line is linked to the invoice line it came from and takes its exact share
/// of it:
/// <list type="bullet">
/// <item>the price they paid, after the line's discount and its share of the invoice discount, and
/// its share of that invoice's tax;</item>
/// <item>the cost: a customer's goods come back into stock at the cost they left at (so the weighted
/// average is restored), goods go back to a supplier at the price we paid (backed out of the
/// average).</item>
/// </list>
/// The return that empties a line (or an invoice) takes exactly what is left of it, so rounding never
/// strands or over-returns a piastre. Money is integer minor units throughout. The controller writes
/// the audit entry.
/// </summary>
public sealed class ReturnsService
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly MoneyService _money;
    private readonly LedgerService _ledger;

    public ReturnsService(AppDbContext db, InventoryService inventory, WarehouseService warehouses, MoneyService money,
        LedgerService ledger)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _money = money;
        _ledger = ledger;
    }

    /// <param name="From">For <c>return_too_soon</c>: when the goods can come back.</param>
    public sealed record ReturnError(string Code, string Message, string? From = null);

    /// <summary>
    /// What has been returned of one invoice line: base units, and the gross amount, line discount,
    /// share of the invoice discount, cost and tax taken back.
    /// </summary>
    /// <param name="Free">Of <paramref name="Quantity"/>, base units taken back by old returns typed without
    /// the invoice (no amounts of the line went back with them).</param>
    public sealed record Returned(int Quantity, long Gross, long Discount, long DocDiscount, long Cost, long Tax = 0,
        int Free = 0);

    private static readonly Returned Nothing = new(0, 0, 0, 0, 0);

    /// <summary>What was already returned per invoice line of <paramref name="invoiceId"/> (non-cancelled returns only).</summary>
    public Task<Dictionary<Guid, Returned>> ReturnedByLineAsync(Guid invoiceId) =>
        ReturnedAsync(_db.DocumentLines.Where(l => l.DocumentId == invoiceId).Select(l => l.Id));

    /// <summary>What was already returned of each of these invoice lines.</summary>
    private async Task<Dictionary<Guid, Returned>> ReturnedAsync(IQueryable<Guid> lineIds)
    {
        var rows = await _db.DocumentLines.AsNoTracking()
            .Where(l => l.SourceLineId != null && lineIds.Contains(l.SourceLineId.Value)
                        && (l.Document!.Type == DocumentType.SALES_RETURN || l.Document.Type == DocumentType.PURCHASE_RETURN)
                        && l.Document.Status != DocumentStatus.CANCELLED)
            .GroupBy(l => new { Line = l.SourceLineId!.Value, l.PricedApart })
            .Select(g => new
            {
                g.Key.Line, g.Key.PricedApart,
                Quantity = g.Sum(l => l.Quantity),
                Gross = g.Sum(l => l.LineTotal + l.Discount),
                Discount = g.Sum(l => l.Discount),
                DocDiscount = g.Sum(l => l.DocDiscount),
                Cost = g.Sum(l => l.LineCost),
                Tax = g.Sum(l => l.Tax),
            })
            .ToListAsync();
        var result = new Dictionary<Guid, Returned>();
        foreach (var r in rows)
        {
            var had = result.GetValueOrDefault(r.Line) ?? Nothing;
            result[r.Line] = r.PricedApart
                ? had with { Quantity = had.Quantity + r.Quantity, Free = had.Free + r.Quantity }
                : had with
                {
                    Quantity = had.Quantity + r.Quantity, Gross = had.Gross + r.Gross, Discount = had.Discount + r.Discount,
                    DocDiscount = had.DocDiscount + r.DocDiscount, Cost = had.Cost + r.Cost, Tax = had.Tax + r.Tax,
                };
        }
        return result;
    }

    public static DocumentType ReturnTypeFor(DocumentType invoiceType) => invoiceType switch
    {
        DocumentType.SALES_INVOICE => DocumentType.SALES_RETURN,
        DocumentType.PURCHASE_INVOICE => DocumentType.PURCHASE_RETURN,
        _ => throw new ArgumentOutOfRangeException(nameof(invoiceType), "Only invoices can be returned."),
    };

    /// <summary>Hours after a sale before its goods can come back (Settings; 0 = at once).</summary>
    private Task<int> ReturnAfterHoursAsync() => _db.CompanySettings.Select(x => x.ReturnAfterHours).FirstOrDefaultAsync();

    // ------------------------------------------------------------------ what can come back

    /// <summary>One invoice line the party can still return pieces of.</summary>
    private sealed record Source(DocumentLine Line, SalesDocument Invoice, int Left, DateTime? From);

    /// <summary>
    /// The party's invoice lines that can still come back, newest invoice first (on each, its paid
    /// lines, then its free goods): of the branch, in the person's reach (branches, departments), of
    /// <paramref name="departmentId"/> when one is given, of <paramref name="invoiceId"/> when one is
    /// given. Lines with nothing left are left out; a sale's line younger than the hours in Settings
    /// says from when it can come back.
    /// </summary>
    private async Task<List<Source>> SourcesAsync(bool isSale, Guid partyId, Guid branchId, Guid? departmentId,
        Guid? invoiceId, IReadOnlyCollection<Guid>? productIds, ClaimsPrincipal user)
    {
        var invoiceType = isSale ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE;
        var invoices = _db.SalesDocuments.Where(d => d.PartyId == partyId && d.Type == invoiceType
                                                     && d.Status != DocumentStatus.CANCELLED && d.BranchId == branchId)
            .InBranches(user, d => d.BranchId);
        if (isSale) invoices = invoices.InDepartments(user);
        if (isSale && departmentId is Guid dept) invoices = invoices.Where(d => d.DepartmentId == dept);
        if (invoiceId is Guid only) invoices = invoices.Where(d => d.Id == only);
        var lines = _db.DocumentLines.Where(l => invoices.Any(d => d.Id == l.DocumentId) && l.Quantity > 0);
        if (productIds is not null) lines = lines.Where(l => productIds.Contains(l.ProductId));
        var found = await lines.Include(l => l.Document).Include(l => l.Unit).AsNoTracking()
            .OrderByDescending(l => l.Document!.IssueDate).ThenByDescending(l => l.Document!.Number)
            .ThenBy(l => l.IsBonus).ThenBy(l => l.LineNo)
            .Take(2000).ToListAsync();
        var returned = await ReturnedAsync(lines.Select(l => l.Id));
        var hours = isSale ? await ReturnAfterHoursAsync() : 0;
        var now = DateTime.UtcNow;
        return found
            .Select(l => new Source(l, l.Document!, l.Quantity - (returned.GetValueOrDefault(l.Id)?.Quantity ?? 0),
                hours > 0 && now < l.Document!.CreatedAt.AddHours(hours) ? l.Document.CreatedAt.AddHours(hours) : null))
            .Where(s => s.Left > 0).ToList();
    }

    /// <summary>
    /// What <paramref name="partyId"/> bought (or we bought from them) and can still return, item by
    /// item, for the return screen: each item's units and its invoice lines, newest first, with what is
    /// left and what they paid for the line after its discounts.
    /// </summary>
    public async Task<(ReturnableItemDto[]? Items, ReturnError? Error)> ReturnableAsync(bool isSale, Guid partyId,
        string? branchId, string? departmentId, string? invoiceId, ClaimsPrincipal user)
    {
        var branch = Access.Work(user);
        if (Guid.TryParse(branchId, out var picked))
        {
            if (!Access.CanUseBranch(user, picked)) return (null, new("branch_not_found", "Branch not found."));
            branch = picked;
        }
        Guid? dept = Guid.TryParse(departmentId, out var d) ? d : null;
        Guid? only = Guid.TryParse(invoiceId, out var i) ? i : null;
        var sources = await SourcesAsync(isSale, partyId, branch, dept, only, null, user);
        var ids = sources.Select(s => s.Line.ProductId).Distinct().ToList();
        var skus = await _db.Products.AsNoTracking().Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.Sku }).ToDictionaryAsync(p => p.Id, p => p.Sku);
        var units = await _db.ItemUnits.AsNoTracking().Include(u => u.Unit).Where(u => ids.Contains(u.ProductId))
            .OrderBy(u => u.Factor).ToListAsync();
        var items = sources.GroupBy(s => s.Line.ProductId).Select(g => new ReturnableItemDto(
            g.Key.ToString(), g.First().Line.ProductName, skus.GetValueOrDefault(g.Key) ?? "",
            units.Where(u => u.ProductId == g.Key)
                .Select(u => new ReturnableUnitDto(u.UnitId.ToString(), u.Unit is null ? "" : Loc.Name(u.Unit), u.Factor, u.Barcode))
                .ToArray(),
            g.Select(s => new ReturnableLineDto(
                s.Line.Id.ToString(), s.Invoice.Id.ToString(), s.Invoice.Number, s.Invoice.IssueDate.ToString("o"),
                s.Line.Quantity, s.Line.Quantity - s.Left, s.Left, s.Line.LineTotal - s.Line.DocDiscount,
                s.Line.IsBonus, s.From?.ToString("o"))).ToArray())).ToArray();
        return (items, null);
    }

    // ------------------------------------------------------------------ the one way to return

    /// <summary>One piece of a return: so many base units of one invoice line, back through a warehouse.</summary>
    /// <param name="Reason">Why it came back (<see cref="ReturnReasons"/>); <paramref name="Note"/> the words for OTHER.</param>
    /// <param name="Damaged">A damaged line of a sales return: WAREHOUSE or WRITE_OFF.</param>
    private sealed record Pick(DocumentLine Source, SalesDocument Invoice, int Quantity, Warehouse Warehouse,
        string? Reason = null, string? Note = null, string? Damaged = null);

    /// <summary>One line's reason, checked: one of the list, OTHER with its words.</summary>
    private static (string? Reason, string? Note, ReturnError? Error) ReasonOf(string? reason, string? note)
    {
        var r = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim().ToUpperInvariant();
        if (r is null) return (null, null, null);
        if (!ReturnReasons.All.Contains(r)) return (null, null, new("bad_reason", "Choose a reason from the list."));
        var n = string.IsNullOrWhiteSpace(note) ? null : note.Trim()[..Math.Min(200, note.Trim().Length)];
        if (r == ReturnReasons.Other && n is null) return (null, null, new("reason_note_required", "Write the reason."));
        return (r, r == ReturnReasons.Other ? n : null, null);
    }

    /// <summary>
    /// A return typed like an invoice (owner, 2026-11-10): the party, where it is made and where the
    /// goods go back to, and the items with how many. Each item is taken from the party's invoice
    /// lines newest first (or from the line or invoice named), at what they paid for it. A sales
    /// return takes nothing from an invoice younger than the hours in Settings (unless the owner
    /// confirms); a purchase return only goods we still hold. All-or-nothing.
    /// </summary>
    /// <param name="exchange">Part of an exchange: nothing is paid back and its entry waits for
    /// <see cref="SettleExchangeAsync"/>; the caller's transaction commits.</param>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CreateForPartyAsync(
        bool isSale, CreateFreeReturnRequest req, ClaimsPrincipal user, Guid staffId, bool exchange = false)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return (null, new("no_lines", "Add at least one item to return."));
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return (null, new("too_many_lines", $"At most {InvoiceLines.MaxLines} lines."));

        if (!Guid.TryParse(req.PartyId, out var partyId))
            return (null, new("no_party", isSale ? "Choose the customer." : "Choose the supplier."));
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null || !party.Types.Contains(isSale ? "CUSTOMER" : "SUPPLIER"))
            return (null, new("party_not_found", isSale ? "Customer not found." : "Supplier not found."));

        // Where it is made, and where the goods go back to / leave from.
        var branchId = Access.Work(user);
        if (Guid.TryParse(req.BranchId, out var picked))
        {
            if (!Access.CanUseBranch(user, picked)) return (null, new("branch_not_found", "Branch not found."));
            branchId = picked;
        }
        Warehouse? warehouse;
        if (Guid.TryParse(req.WarehouseId, out var wid))
        {
            // Goods go back to a supplier from a store or from the branch's damaged goods (owner, 2026-11-18).
            warehouse = await _warehouses.Visible(user)
                .FirstOrDefaultAsync(w => w.Id == wid && w.IsActive
                                          && (w.Kind == WarehouseKind.STORE || (!isSale && w.Kind == WarehouseKind.DAMAGED)));
            if (warehouse is null || warehouse.BranchId != branchId)
                return (null, new("warehouse_not_found", "Warehouse not found."));
        }
        else warehouse = await _warehouses.DefaultForBranchAsync(branchId);
        if (warehouse is null) return (null, new("no_warehouse", "The branch has no active warehouse."));

        Guid? departmentId = null;
        if (isSale && Guid.TryParse(req.DepartmentId, out var dept))
        {
            if (!await _db.Departments.AnyAsync(d => d.Id == dept && d.IsActive) || !Access.CanUseDepartment(user, dept))
                return (null, new("department_not_found", "Department not found."));
            departmentId = dept;
        }
        Guid? invoiceId = Guid.TryParse(req.InvoiceId, out var inv) ? inv : null;

        // ---- Shape of each line: the item, its unit, how many ----
        var productIds = req.Lines.Select(l => Guid.TryParse(l.ProductId, out var g) ? g : Guid.Empty).Distinct().ToList();
        if (productIds.Contains(Guid.Empty)) return (null, new("product_not_found", "An item was not found."));
        var units = await _db.ItemUnits.AsNoTracking().Where(u => productIds.Contains(u.ProductId)).ToListAsync();
        var wanted = new List<(Guid ProductId, int BaseQty, Guid? SourceLineId, string? Reason, string? Note, string? Damaged)>();
        // A damaged line goes where Settings says unless chosen; writing off is a permission of its own.
        var mayWriteOff = user.HasClaim("permission", Permissions.ReturnsWriteOff);
        var settled = isSale
            ? await _db.CompanySettings.Select(x => x.DamagedReturns).FirstOrDefaultAsync() ?? ReturnReasons.ToWarehouse
            : null;
        foreach (var l in req.Lines)
        {
            var pid = Guid.Parse(l.ProductId);
            var unit = Guid.TryParse(l.UnitId, out var uid)
                ? units.FirstOrDefault(u => u.ProductId == pid && u.UnitId == uid)
                : units.Where(u => u.ProductId == pid).OrderBy(u => u.Factor).FirstOrDefault();
            var factor = unit?.Factor ?? (string.IsNullOrWhiteSpace(l.UnitId) ? 1 : 0);
            if (factor <= 0) return (null, new("unit_not_found", "An item's unit was not found."));
            if (l.Quantity <= 0 || (long)l.Quantity * factor > 1_000_000_000)
                return (null, new("bad_qty", "Enter a quantity for every item."));
            var (reason, note, reasonError) = ReasonOf(l.Reason ?? req.Reason, l.Reason is null ? req.ReasonNote : l.ReasonNote);
            if (reasonError is not null) return (null, reasonError);
            string? damaged = null;
            if (isSale && reason == ReturnReasons.Damaged)
            {
                var asked = string.IsNullOrWhiteSpace(l.Damaged) ? null : l.Damaged.Trim().ToUpperInvariant();
                if (asked is not null and not (ReturnReasons.ToWarehouse or ReturnReasons.WriteOff))
                    return (null, new("bad_damaged", "Choose where the damaged goods go."));
                if (asked == ReturnReasons.WriteOff && !mayWriteOff)
                    return (null, new("write_off_not_allowed", "Writing off damaged goods needs permission."));
                damaged = asked ?? (settled == ReturnReasons.WriteOff && mayWriteOff ? ReturnReasons.WriteOff : ReturnReasons.ToWarehouse);
            }
            wanted.Add((pid, l.Quantity * factor, Guid.TryParse(l.SourceLineId, out var sl) ? sl : null, reason, note, damaged));
        }

        // Inside an exchange's transaction, that one commits.
        await using var tx = _db.Database.CurrentTransaction is null ? await _db.Database.BeginTransactionAsync() : null;
        // The party's invoices first (documents before items), so two returns can't take the same pieces.
        var invoiceType = isSale ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE;
        var lockIds = await _db.SalesDocuments
            .Where(d => d.PartyId == party.Id && d.Type == invoiceType && d.Status != DocumentStatus.CANCELLED
                        && d.BranchId == branchId && d.Lines.Any(l => productIds.Contains(l.ProductId)))
            .Select(d => d.Id).OrderBy(x => x).ToArrayAsync();
        if (lockIds.Length > 0)
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({lockIds}) ORDER BY \"Id\" FOR UPDATE");
        var sources = await SourcesAsync(isSale, party.Id, branchId, departmentId, invoiceId, productIds, user);
        var mayOverride = Access.OverridePasses(user);

        // ---- Take each item from the newest invoice lines that still have it ----
        var left = sources.ToDictionary(s => s.Line.Id, s => s.Left);
        var picks = new List<(Source Source, int Quantity, string? Reason, string? Note, string? Damaged)>();
        foreach (var (productId, baseQty, sourceLineId, reason, note, damaged) in wanted)
        {
            var need = baseQty;
            var mine = sources.Where(s => s.Line.ProductId == productId
                                          && (sourceLineId is null || s.Line.Id == sourceLineId)).ToList();
            foreach (var s in mine.Where(s => s.From is null || mayOverride))
            {
                if (need == 0) break;
                var take = Math.Min(need, left[s.Line.Id]);
                if (take <= 0) continue;
                left[s.Line.Id] -= take;
                need -= take;
                picks.Add((s, take, reason, note, damaged));
            }
            if (need == 0) continue;
            var name = mine.FirstOrDefault()?.Line.ProductName
                       ?? await _db.Products.Where(p => p.Id == productId).Select(p => p.Name).FirstOrDefaultAsync() ?? "";
            if (mine.Count == 0)
                return (null, new("not_bought", isSale
                    ? $"{name}: the customer didn't buy this item here, or all of it came back."
                    : $"{name}: this item wasn't bought from the supplier here, or all of it went back."));
            var fresh = mine.Where(s => s.From is not null && !mayOverride).ToList();
            if (fresh.Count > 0 && fresh.Sum(s => left[s.Line.Id]) >= need)
            {
                var from = fresh.Min(s => s.From!.Value);
                return (null, new("return_too_soon",
                    $"{name} can come back from {from:o}. Until then, change the invoice.", from.ToString("o")));
            }
            return (null, new("exceeds_returnable", $"{name}: only {baseQty - need} left to return, {baseQty} requested."));
        }

        // The same invoice line asked for on two lines comes back once, with both quantities (once per reason).
        var merged = picks.GroupBy(p => (p.Source.Line.Id, p.Reason, p.Note, p.Damaged))
            .Select(g => new Pick(g.First().Source.Line, g.First().Source.Invoice, g.Sum(p => p.Quantity), warehouse,
                g.Key.Reason, g.Key.Note, g.Key.Damaged))
            .ToList();
        var single = merged.Select(p => p.Invoice.Id).Distinct().Count() == 1 ? merged[0].Invoice : null;
        // A sale's department, when none was chosen: the one its invoices share.
        if (isSale && departmentId is null)
        {
            var depts = merged.Select(p => p.Invoice.DepartmentId).Distinct().ToList();
            if (depts.Count == 1) departmentId = depts[0];
        }
        return await PostAsync(isSale, party, branchId, departmentId, merged, single, req.Notes,
            0, req.RefundAccountId, 0, null, user, staffId, tx, exchange);
    }

    /// <summary>
    /// A return against invoice <paramref name="invoiceId"/> by its lines (refused parcels, and older
    /// callers). Each line goes back through the warehouse it left from (a closed one: the branch's
    /// default). <paramref name="user"/> may return only invoices of their reach.
    /// </summary>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CreateAsync(
        Guid invoiceId, DocumentType invoiceType, CreateReturnRequest req, ClaimsPrincipal user, Guid staffId)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return (null, new("no_lines", "Choose at least one item to return."));
        var isSale = invoiceType == DocumentType.SALES_INVOICE;

        await using var tx = await _db.Database.BeginTransactionAsync();
        // Lock the invoice row until commit, so two people returning the same invoice at the same
        // moment can't both pass the "remaining quantity" check below.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {invoiceId} FOR UPDATE");
        var q = _db.SalesDocuments.Where(d => d.Id == invoiceId && d.Type == invoiceType).InBranches(user, d => d.BranchId);
        if (isSale) q = q.InDepartments(user);
        var invoice = await q.Include(d => d.Lines).Include(d => d.Party).FirstOrDefaultAsync();
        if (invoice is null) return (null, new("not_found", "Invoice not found."));
        if (invoice.Status == DocumentStatus.CANCELLED)
            return (null, new("invoice_cancelled", "A cancelled invoice cannot be returned."));

        var returned = await ReturnedByLineAsync(invoice.Id);
        var linesById = invoice.Lines.ToDictionary(l => l.Id);
        var wanted = new List<(DocumentLine Source, int Quantity)>();
        var seen = new HashSet<Guid>();
        foreach (var rl in req.Lines)
        {
            if (!Guid.TryParse(rl.LineId, out var lineId) || !linesById.TryGetValue(lineId, out var src))
                return (null, new("line_not_found", "An item on the return is not on the original invoice."));
            if (!seen.Add(lineId))
                return (null, new("duplicate_line", $"{src.ProductName} is listed twice."));
            if (rl.Quantity < 0)
                return (null, new("bad_qty", $"Quantity cannot be negative for {src.ProductName}."));
            if (rl.Quantity == 0) continue;
            var remaining = src.Quantity - (returned.GetValueOrDefault(lineId)?.Quantity ?? 0);
            if (rl.Quantity > remaining)
                return (null, new("exceeds_returnable",
                    $"{src.ProductName}: only {remaining} left to return, {rl.Quantity} requested."));
            wanted.Add((src, rl.Quantity));
        }
        if (wanted.Count == 0)
            return (null, new("no_lines", "Choose at least one item to return."));

        // Goods go back through the warehouse of the original line. A sales return into a warehouse
        // that has since closed lands in the invoice branch's default warehouse instead.
        var warehouseIds = wanted.Where(w => w.Source.WarehouseId != null)
            .Select(w => w.Source.WarehouseId!.Value).Distinct().ToList();
        var warehouses = await _db.Warehouses.Where(w => warehouseIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id);
        var fallback = await _warehouses.DefaultForBranchAsync(invoice.BranchId);
        var picks = new List<Pick>();
        foreach (var (src, qty) in wanted)
        {
            var warehouse = src.WarehouseId is Guid id && warehouses.TryGetValue(id, out var w) && (w.IsActive || !isSale)
                ? w
                : fallback;
            if (warehouse is null)
                return (null, new("no_warehouse", "The invoice's branch has no active warehouse to return into."));
            picks.Add(new Pick(src, invoice, qty, warehouse));
        }
        return await PostAsync(isSale, invoice.Party!, invoice.BranchId, invoice.DepartmentId, picks, invoice, req.Notes,
            req.RefundAmount, req.RefundAccountId, req.ShippingCost, req.ShippingAccountId, user, staffId, tx);
    }

    /// <summary>
    /// Post a return of <paramref name="picks"/> (each invoice line once) inside <paramref name="tx"/>:
    /// the document and its lines at their exact shares, the stock, the party's account, a cash
    /// customer's refund, the ledger, and the invoices it empties marked returned. Commits.
    /// </summary>
    private async Task<(SalesDocument? Doc, ReturnError? Error)> PostAsync(bool isSale, Party party, Guid branchId,
        Guid? departmentId, IReadOnlyList<Pick> picks, SalesDocument? single, string? notes, long refund,
        string? refundAccountId, long shippingCost, string? shippingAccountId, ClaimsPrincipal user, Guid staffId,
        IDbContextTransaction? tx, bool exchange = false)
    {
        var returnType = isSale ? DocumentType.SALES_RETURN : DocumentType.PURCHASE_RETURN;
        if (isSale && shippingCost < 0) return (null, new("bad_amount", "Enter a shipping cost of zero or more."));

        var products = await _inventory.LockProductsAsync(picks.Select(p => p.Source.ProductId));
        foreach (var group in picks.GroupBy(p => (p.Source.ProductId, p.Warehouse.Id)))
        {
            var name = group.First().Source.ProductName;
            if (!products.ContainsKey(group.Key.ProductId))
                return (null, new("product_not_found", $"{name} no longer exists."));
            // We can only send back to the supplier goods we still hold — not ones already sold on.
            var qty = group.Sum(p => p.Quantity);
            var available = _inventory.Available(group.Key.ProductId, group.Key.Id);
            if (!isSale && qty > available)
                return (null, new("insufficient_stock",
                    $"Not enough {name} in {Loc.Name(group.First().Warehouse)} to return: {available} left, {qty} requested."));
        }

        // Every line of the invoices involved, with what came back of it before.
        var invoiceIds = picks.Select(p => p.Invoice.Id).Distinct().ToList();
        var allLines = await _db.DocumentLines.AsNoTracking().Where(l => invoiceIds.Contains(l.DocumentId)).ToListAsync();
        var returned = await ReturnedAsync(_db.DocumentLines.Where(l => invoiceIds.Contains(l.DocumentId)).Select(l => l.Id));
        var invoices = await _db.SalesDocuments.Where(d => invoiceIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id);

        var number = await DocumentNumbers.NextAsync(_db, returnType);
        var doc = new SalesDocument
        {
            Number = number, Type = returnType, BranchId = branchId, PartyId = party.Id, StaffId = staffId,
            IssueDate = DateTime.UtcNow,
            Currency = single?.Currency ?? await _db.CompanySettings.Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP",
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim()[..Math.Min(1000, notes.Trim().Length)],
            SourceDocumentId = single?.Id, RepId = isSale ? single?.RepId ?? staffId : null,
            PriceLevelId = single?.PriceLevelId, DepartmentId = departmentId,
        };

        // A part of a line returned in its own unit (whole cartons of a carton line) keeps that unit;
        // any other part is returned in pieces of the item's base unit.
        var productIds = picks.Select(p => p.Source.ProductId).Distinct().ToList();
        var baseUnits = await _db.ItemUnits.AsNoTracking()
            .Where(u => productIds.Contains(u.ProductId) && u.Factor == 1)
            .ToDictionaryAsync(u => u.ProductId, u => u.UnitId);

        var made = new List<(DocumentLine Line, Guid InvoiceId)>();
        // What came back of each line so far, this return's earlier lines included (one line may come
        // back on two lines of it, for two reasons).
        var running = new Dictionary<Guid, Returned>(returned);
        var writtenOff = 0L;
        foreach (var (src, invoice, qty, picked, reason, note, damagedTo) in picks)
        {
            var product = products[src.ProductId];
            var already = running.GetValueOrDefault(src.Id) ?? Nothing;
            // A customer's damaged goods go to the branch's damaged warehouse (owner, 2026-11-18).
            var warehouse = isSale && damagedTo is not null ? await _warehouses.DamagedForBranchAsync(branchId) : picked;
            // The return's share of the line's gross amount, discount and cost, in proportion to the
            // base units coming back; the return that empties the line takes exactly what is left.
            // (Not once an old return typed without the invoice took some of it: its amounts never
            // came off the line.)
            var completesLine = qty == src.Quantity - already.Quantity && already.Free == 0;
            long Share(long total, long done) => completesLine
                ? total - done
                : (long)decimal.Round(total * (decimal)qty / src.Quantity, MidpointRounding.AwayFromZero);
            var gross = Share(src.LineTotal + src.Discount, already.Gross);
            var discount = Share(src.Discount, already.Discount);
            var docDiscount = Share(src.DocDiscount, already.DocDiscount);
            var lineCost = Share(src.LineCost, already.Cost);
            var lineTotal = gross - discount;
            running[src.Id] = already with
            {
                Quantity = already.Quantity + qty, Gross = already.Gross + gross, Discount = already.Discount + discount,
                DocDiscount = already.DocDiscount + docDiscount, Cost = already.Cost + lineCost,
            };

            if (isSale)
            {
                _inventory.ReceiveValue(product, warehouse, qty, lineCost, StockMovementType.SALES_RETURN_IN, doc.Id, number);
                // Written off at once: out of the damaged warehouse at the cost it came back at.
                if (damagedTo == ReturnReasons.WriteOff)
                {
                    _inventory.IssueValue(product, warehouse, qty, lineCost, StockMovementType.DAMAGED_WRITE_OFF, doc.Id, number);
                    writtenOff += lineCost;
                }
            }
            else
                _inventory.ReturnToSupplierValue(product, warehouse, qty, lineCost,
                    StockMovementType.PURCHASE_RETURN_OUT, doc.Id, number);

            var factor = Math.Max(1, src.UnitFactor);
            var inLineUnit = qty % factor == 0;
            var line = new DocumentLine
            {
                LineNo = doc.Lines.Count + 1,
                ProductId = product.Id, ProductName = src.ProductName, Quantity = qty,
                UnitId = inLineUnit ? src.UnitId : baseUnits.TryGetValue(product.Id, out var b) ? b : src.UnitId,
                UnitFactor = inLineUnit ? factor : 1,
                UnitQuantity = inLineUnit ? qty / factor : qty,
                UnitPrice = inLineUnit ? src.UnitPrice : (long)decimal.Round((decimal)gross / qty, MidpointRounding.AwayFromZero),
                Discount = discount, LineTotal = lineTotal, IsBonus = src.IsBonus, DocDiscount = docDiscount,
                UnitCost = src.UnitCost, LineCost = lineCost, LineProfit = isSale ? lineTotal - docDiscount - lineCost : 0,
                SourceLineId = src.Id, WarehouseId = warehouse.Id, Warehouse = warehouse,
                ReturnReason = reason, ReasonNote = note, Damaged = isSale ? damagedTo : null,
            };
            doc.Lines.Add(line);
            made.Add((line, invoice.Id));
        }

        // Tax comes back in the share it was charged on each invoice; the return that completes an
        // invoice takes whatever tax is still unreturned. Each line carries its part.
        var completed = new List<SalesDocument>();
        foreach (var group in made.GroupBy(m => m.InvoiceId))
        {
            var invoice = invoices[group.Key];
            var lines = allLines.Where(l => l.DocumentId == invoice.Id).ToList();
            var taking = picks.Where(p => p.Invoice.Id == invoice.Id).GroupBy(p => p.Source.Id)
                .ToDictionary(g => g.Key, g => g.Sum(p => p.Quantity));
            var completes = lines.All(l =>
                l.Quantity - (returned.GetValueOrDefault(l.Id)?.Quantity ?? 0) - taking.GetValueOrDefault(l.Id) == 0);
            if (completes) completed.Add(invoice);
            var priorTax = lines.Sum(l => returned.GetValueOrDefault(l.Id)?.Tax ?? 0);
            var taxLeft = Math.Max(0, invoice.TaxTotal - priorTax);
            var taxable = group.Sum(m => m.Line.LineTotal - m.Line.DocDiscount);
            var invoiceTaxable = invoice.Subtotal - invoice.DiscountTotal;
            var tax = completes ? taxLeft
                : invoiceTaxable <= 0 ? 0
                : Math.Min(taxLeft, (long)decimal.Round(invoice.TaxTotal * (decimal)taxable / invoiceTaxable,
                    MidpointRounding.AwayFromZero));
            // Over its lines by their amounts; the last takes what rounding leaves.
            var shared = 0L;
            var list = group.ToList();
            for (var i = 0; i < list.Count; i++)
            {
                var part = i == list.Count - 1 ? tax - shared
                    : taxable <= 0 ? 0
                    : (long)decimal.Round(tax * (decimal)(list[i].Line.LineTotal - list[i].Line.DocDiscount) / taxable,
                        MidpointRounding.AwayFromZero);
                list[i].Line.Tax = part;
                shared += part;
            }
        }

        // The invoice's discounts come back in the same shares they were given; its additions (e.g. a
        // delivery fee) are not refunded by a return.
        var subtotal = doc.Lines.Sum(l => l.LineTotal + l.Discount);
        var discountTotal = doc.Lines.Sum(l => l.Discount + l.DocDiscount);
        var net = subtotal - discountTotal;
        var taxTotal = doc.Lines.Sum(l => l.Tax);
        var grand = net + taxTotal;
        doc.Subtotal = subtotal;
        doc.DiscountTotal = discountTotal;
        doc.TaxTotal = taxTotal;
        doc.GrandTotal = grand;
        doc.CostTotal = doc.Lines.Sum(l => l.LineCost);
        doc.ProfitTotal = isSale ? net - doc.CostTotal : 0;
        // PaidAmount on a return = cash settled now: handed back to the customer (sales) or received
        // back from the supplier (purchases). A cash customer has no account to carry the credit, so
        // they're paid back in full now (owner decision 2026-10-01); everyone else's goes on their account.
        // In an exchange nothing is paid back here: the new invoice takes the credit first.
        doc.PaidAmount = exchange ? 0 : Math.Clamp(isSale && party.IsCashCustomer ? grand : refund, 0, grand);
        doc.Status = doc.PaidAmount >= grand && grand > 0 ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // Balance sign: > 0 they owe us (receivable), < 0 we owe them (payable).
        await MoneyService.LockPartiesAsync(_db, party.Id);
        await _db.Entry(party).ReloadAsync();
        var onAccount = grand - doc.PaidAmount;
        party.Balance += isSale ? -onAccount : onAccount;

        MoneyAccount? refundAccount = null;
        if (doc.PaidAmount > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(refundAccountId, branchId, user);
            moneyError ??= _money.Move(account!, isSale ? -doc.PaidAmount : doc.PaidAmount,
                isSale ? MoneyMovementKind.SALES_REFUND : MoneyMovementKind.PURCHASE_REFUND, staffId, number,
                documentId: doc.Id, partyId: party.Id);
            if (moneyError is not null) return (null, new(moneyError.Code, moneyError.Message));
            refundAccount = account!;
            doc.PaidAccountId = account!.Id;
        }
        if (isSale && !exchange) await _ledger.PostSalesReturnAsync(doc, party, refundAccount, staffId);
        else if (!isSale) await _ledger.PostPurchaseReturnAsync(doc, party, refundAccount, staffId);
        if (writtenOff > 0) await _ledger.PostDamagedWriteOffAsync(doc.Id, number, branchId, writtenOff, staffId);

        // Shipping we paid to get a customer's goods back: our expense.
        if (isSale && shippingCost > 0)
        {
            var (_, shipError) = await _money.ShippingExpenseAsync(shippingCost, shippingAccountId, branchId, number,
                user, staffId, _ledger);
            if (shipError is not null) return (null, new(shipError.Code, shipError.Message));
        }

        foreach (var invoice in completed) invoice.Status = DocumentStatus.RETURNED;
        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        if (tx is not null) await tx.CommitAsync();
        return (doc, null);
    }

    /// <summary>
    /// An exchange's return, once its invoice is made: <paramref name="refund"/> of it is paid back now
    /// from <paramref name="refundAccountId"/> (the rest stays on the customer's account, where the
    /// invoice takes it), and its entry is posted. Inside the exchange's transaction.
    /// </summary>
    public async Task<ReturnError?> SettleExchangeAsync(SalesDocument doc, long refund, string? refundAccountId,
        ClaimsPrincipal user, Guid staffId)
    {
        var party = await _db.Parties.FirstAsync(p => p.Id == doc.PartyId);
        MoneyAccount? account = null;
        refund = Math.Clamp(refund, 0, doc.GrandTotal);
        if (refund > 0)
        {
            var (found, moneyError) = await _money.ForDocumentAsync(refundAccountId, doc.BranchId, user);
            moneyError ??= _money.Move(found!, -refund, MoneyMovementKind.SALES_REFUND, staffId, doc.Number,
                documentId: doc.Id, partyId: party.Id);
            if (moneyError is not null) return new(moneyError.Code, moneyError.Message);
            account = found!;
            doc.PaidAccountId = account.Id;
            doc.PaidAmount = refund;
            party.Balance += refund;
            doc.Status = refund >= doc.GrandTotal ? DocumentStatus.PAID : DocumentStatus.PARTIALLY_PAID;
        }
        await _ledger.PostSalesReturnAsync(doc, party, account, staffId);
        await _db.SaveChangesAsync();
        return null;
    }

    /// <summary>
    /// Cancel return <paramref name="returnId"/> entered by mistake (owner, 2026-10-24). Everything it
    /// moved goes back: a customer's goods leave stock again at the value they came in at (refused once
    /// they were sold on), a supplier's come back at the value they left at; the party's account and any
    /// cash settled at the time go back; its ledger entry is reversed; and the invoices it came from are
    /// no longer returned. It stays on the list, as cancelled. All-or-nothing.
    /// </summary>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CancelAsync(Guid returnId, bool isSale,
        ClaimsPrincipal user, Guid staffId)
    {
        var type = isSale ? DocumentType.SALES_RETURN : DocumentType.PURCHASE_RETURN;
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {returnId} FOR UPDATE");
        var q = _db.SalesDocuments.Where(d => d.Id == returnId && d.Type == type).InBranches(user, d => d.BranchId);
        if (isSale) q = q.InDepartments(user);
        var doc = await q.Include(d => d.Lines).ThenInclude(l => l.Warehouse).FirstOrDefaultAsync();
        if (doc is null) return (null, new("not_found", "Return not found."));
        if (doc.Status == DocumentStatus.CANCELLED)
            return (null, new("return_cancelled", "This return is already cancelled."));
        var lockDate = await _db.CompanySettings.Select(x => x.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(doc.IssueDate) <= DateOnly.FromDateTime(locked)
            && !Access.OverridePasses(user))
            return (null, new("period_locked", "This return is in a locked period."));

        // The invoices it came from (documents before items), then the goods.
        var sourceLineIds = doc.Lines.Where(l => l.SourceLineId != null).Select(l => l.SourceLineId!.Value).ToList();
        var invoiceIds = await _db.DocumentLines.Where(l => sourceLineIds.Contains(l.Id)).Select(l => l.DocumentId)
            .Distinct().ToListAsync();
        if (doc.SourceDocumentId is Guid source && !invoiceIds.Contains(source)) invoiceIds.Add(source);
        var ordered = invoiceIds.OrderBy(x => x).ToArray();
        if (ordered.Length > 0)
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        var invoices = await _db.SalesDocuments.Where(d => ordered.Contains(d.Id)).ToListAsync();
        var lines = doc.Lines.Where(l => l.Quantity > 0 && l.Warehouse is not null).ToList();
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
        // Damaged goods written off with it come back first (at the cost they went out at), then leave with it.
        if (isSale)
            foreach (var l in lines.Where(l => l.Damaged == ReturnReasons.WriteOff))
                if (products.TryGetValue(l.ProductId, out var gone))
                    _inventory.ReceiveValue(gone, l.Warehouse!, l.Quantity, l.LineCost,
                        StockMovementType.DAMAGED_WRITE_OFF_CANCELLED, doc.Id, doc.Number);
        if (isSale)
            foreach (var g in lines.GroupBy(l => (l.ProductId, l.WarehouseId!.Value)))
            {
                var wanted = g.Sum(l => l.Quantity);
                var available = _inventory.Available(g.Key.ProductId, g.Key.Value);
                if (wanted > available)
                    return (null, new("insufficient_stock",
                        $"{g.First().ProductName}: {available} left in {Loc.Name(g.First().Warehouse!)}, {wanted} came back on this return."));
            }
        foreach (var l in lines)
        {
            if (!products.TryGetValue(l.ProductId, out var product))
                return (null, new("product_not_found", $"{l.ProductName} no longer exists."));
            if (isSale)
                _inventory.ReturnToSupplierValue(product, l.Warehouse!, l.Quantity, l.LineCost,
                    StockMovementType.SALES_RETURN_CANCELLED, doc.Id, doc.Number);
            else
                _inventory.ReceiveValue(product, l.Warehouse!, l.Quantity, l.LineCost,
                    StockMovementType.PURCHASE_RETURN_CANCELLED, doc.Id, doc.Number);
        }

        // What went on the party's account comes off it; cash settled at the time goes back.
        await MoneyService.LockPartiesAsync(_db, doc.PartyId);
        var party = await _db.Parties.FirstAsync(p => p.Id == doc.PartyId);
        var onAccount = doc.GrandTotal - doc.PaidAmount;
        party.Balance += isSale ? onAccount : -onAccount;
        if (doc.PaidAmount > 0 && doc.PaidAccountId is Guid accountId)
        {
            var account = (await _money.LockAsync(new[] { accountId }))[accountId];
            var moneyError = _money.Move(account, isSale ? doc.PaidAmount : -doc.PaidAmount,
                MoneyMovementKind.CANCELLATION, staffId, doc.Number, documentId: doc.Id, partyId: doc.PartyId);
            if (moneyError is not null) return (null, new(moneyError.Code, moneyError.Message));
        }
        var source2 = isSale ? "SALES_RETURN" : "PURCHASE_RETURN";
        await _ledger.ReverseAsync(source2, doc.Id, $"{source2}_CANCEL", doc.Number,
            $"{(isSale ? "Sales" : "Purchase")} return {doc.Number} cancelled", staffId);
        if (isSale)
            await _ledger.ReverseAsync(LedgerService.DamagedWriteOffSource, doc.Id, $"{LedgerService.DamagedWriteOffSource}_CANCEL",
                doc.Number, $"Damaged goods of {doc.Number} back with its cancellation", staffId);

        doc.Status = DocumentStatus.CANCELLED;
        foreach (var invoice in invoices.Where(i => i.Status == DocumentStatus.RETURNED))
        {
            invoice.Status = DocumentStatus.CONFIRMED;
            MoneyService.RefreshPaidStatus(invoice);
        }
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        return (doc, null);
    }
}
