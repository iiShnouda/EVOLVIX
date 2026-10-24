using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;

namespace SKB.Api.Services;

/// <summary>
/// Sales returns (مرتجع مبيعات) and purchase returns (مرتجع مشتريات). A return is always issued
/// against one original invoice and reverses part or all of it:
/// <list type="bullet">
/// <item>Sales return: goods come back into stock at the cost they left at (the original line's
/// UnitCost, so the weighted average is restored correctly), the revenue and profit are reversed,
/// and the customer's receivable is credited.</item>
/// <item>Purchase return: goods leave stock at the price we paid (the original line's UnitCost),
/// that receipt is backed out of the weighted average, and what we owe the supplier drops.</item>
/// </list>
/// Quantities are capped per invoice line (bought/sold − already returned), so an invoice can never
/// be returned twice. Discount and tax come back in proportion; the return that completes a line
/// (or the whole invoice) takes exactly what is left, so rounding never strands or over-returns a piastre.
/// Money is integer minor units throughout. The controller writes the audit entry.
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

    public sealed record ReturnError(string Code, string Message);

    /// <summary>
    /// What has been returned of one invoice line: base units, and the gross amount, line discount,
    /// share of the invoice discount and cost taken back.
    /// </summary>
    /// <param name="Free">Of <paramref name="Quantity"/>, base units taken back by returns typed without
    /// the invoice that counted against this line (no amounts of the line went back with them).</param>
    public sealed record Returned(int Quantity, long Gross, long Discount, long DocDiscount, long Cost, int Free = 0);

    private static readonly Returned Nothing = new(0, 0, 0, 0, 0);

    /// <summary>What was already returned per invoice line (non-cancelled returns only).</summary>
    public async Task<Dictionary<Guid, Returned>> ReturnedByLineAsync(Guid invoiceId)
    {
        var rows = await _db.DocumentLines
            .Where(l => l.SourceLineId != null && l.Document!.SourceDocumentId == invoiceId
                        && l.Document.Status != DocumentStatus.CANCELLED)
            .GroupBy(l => l.SourceLineId!.Value)
            .Select(g => new
            {
                LineId = g.Key,
                Quantity = g.Sum(l => l.Quantity),
                Gross = g.Sum(l => l.LineTotal + l.Discount),
                Discount = g.Sum(l => l.Discount),
                DocDiscount = g.Sum(l => l.DocDiscount),
                Cost = g.Sum(l => l.LineCost),
            })
            .ToListAsync();
        var result = rows.ToDictionary(r => r.LineId, r => new Returned(r.Quantity, r.Gross, r.Discount, r.DocDiscount, r.Cost));
        // Returns typed without an invoice that were counted against this invoice's lines.
        var free = await _db.DocumentLines
            .Where(l => l.SourceLineId != null && l.Document!.SourceDocumentId == null
                        && l.Document.Status != DocumentStatus.CANCELLED
                        && _db.DocumentLines.Any(src => src.Id == l.SourceLineId && src.DocumentId == invoiceId))
            .GroupBy(l => l.SourceLineId!.Value)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToListAsync();
        foreach (var f in free)
            result[f.LineId] = result.TryGetValue(f.LineId, out var r)
                ? r with { Quantity = r.Quantity + f.Quantity, Free = f.Quantity }
                : new Returned(f.Quantity, 0, 0, 0, 0, f.Quantity);
        return result;
    }

    /// <summary>
    /// A return without an invoice (owner decision 2026-10-01), typed like one: goods come back from
    /// a customer at their branch's current average cost, or go back to a supplier at the net price
    /// typed (its discount returns to the supplier with it). It goes on the party's account; a cash
    /// customer is paid back at once from the branch's cash box. All-or-nothing.
    /// </summary>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CreateFreeAsync(
        bool isSale, CreateFreeReturnRequest req, ClaimsPrincipal user, Guid staffId)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return (null, new("no_lines", "Add at least one item to return."));
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return (null, new("too_many_lines", $"At most {InvoiceLines.MaxLines} lines."));
        var returnType = isSale ? DocumentType.SALES_RETURN : DocumentType.PURCHASE_RETURN;

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
            warehouse = await _warehouses.Visible(user)
                .FirstOrDefaultAsync(w => w.Id == wid && w.IsActive && w.Kind == WarehouseKind.STORE);
            if (warehouse is null || warehouse.BranchId != branchId)
                return (null, new("warehouse_not_found", "Warehouse not found."));
        }
        else warehouse = await _warehouses.DefaultForBranchAsync(branchId);
        if (warehouse is null) return (null, new("no_warehouse", "The branch has no active warehouse."));

        Guid? departmentId = null;
        if (Guid.TryParse(req.DepartmentId, out var dept))
        {
            if (!await _db.Departments.AnyAsync(d => d.Id == dept && d.IsActive) || !Access.CanUseDepartment(user, dept))
                return (null, new("department_not_found", "Department not found."));
            departmentId = dept;
        }

        // ---- Check every line before anything moves ----
        var productIds = req.Lines.Select(l => Guid.TryParse(l.ProductId, out var g) ? g : Guid.Empty).Distinct().ToList();
        if (productIds.Contains(Guid.Empty)) return (null, new("product_not_found", "An item was not found."));
        var units = await _db.ItemUnits.AsNoTracking().Include(u => u.Unit)
            .Where(u => productIds.Contains(u.ProductId)).ToListAsync();

        await using var tx = await _db.Database.BeginTransactionAsync();
        var products = await _inventory.LockProductsAsync(productIds);
        var lines = new List<(Product Product, ItemUnit Unit, FreeReturnLineRequest Req)>();
        foreach (var l in req.Lines)
        {
            var pid = Guid.Parse(l.ProductId);
            if (!products.TryGetValue(pid, out var product)) return (null, new("product_not_found", "An item was not found."));
            var unit = Guid.TryParse(l.UnitId, out var uid)
                ? units.FirstOrDefault(u => u.ProductId == pid && u.UnitId == uid)
                : units.Where(u => u.ProductId == pid).OrderBy(u => u.Factor).FirstOrDefault();
            if (unit is null) return (null, new("unit_not_found", $"{Loc.Name(product)}: unknown unit."));
            if (l.Quantity <= 0) return (null, new("bad_qty", $"{Loc.Name(product)}: enter a quantity."));
            if (l.UnitPrice < 0 || l.Discount < 0 || l.Discount > (long)l.Quantity * l.UnitPrice)
                return (null, new("bad_amount", $"{Loc.Name(product)}: check the price and discount."));
            lines.Add((product, unit, l));
        }
        // The price is the party's last invoice price (or less); another price is its own permission.
        var canChangePrice = user.HasClaim("permission", isSale ? Permissions.SalesChangePrice : Permissions.PurchasesChangePrice);
        if (!canChangePrice)
        {
            var last = await PriceBasis.LastPricesAsync(_db, party.Id, productIds,
                isSale ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE);
            foreach (var (product, unit, l) in lines)
                if (!last.TryGetValue((product.Id, unit.UnitId), out var lastPrice) || l.UnitPrice > lastPrice)
                    return (null, new("price_not_allowed",
                        $"{Loc.Name(product)}: the price can't be more than the last invoice price. Changing a price needs permission."));
        }
        // Goods go back to a supplier only while we still hold them.
        if (!isSale)
            foreach (var g in lines.GroupBy(x => x.Product.Id))
            {
                var qty = g.Sum(x => x.Req.Quantity * x.Unit.Factor);
                var available = _inventory.Available(g.Key, warehouse.Id);
                if (qty > available)
                    return (null, new("insufficient_stock",
                        $"Not enough {Loc.Name(g.First().Product)} in {Loc.Name(warehouse)} to return: {available} left, {qty} requested."));
            }

        // What comes back is counted against the party's own invoices of those items, newest first
        // (owner, 2026-10-02): the same pieces can't then be returned again on the invoice. A line
        // one invoice line can't take whole stays on its own.
        var invoiceType = isSale ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE;
        var candidates = await _db.DocumentLines.AsNoTracking()
            .Where(l => productIds.Contains(l.ProductId) && !l.IsBonus && l.Document!.PartyId == party.Id
                        && l.Document.Type == invoiceType && l.Document.Status != DocumentStatus.CANCELLED)
            .OrderByDescending(l => l.Document!.IssueDate).ThenBy(l => l.LineNo)
            .Select(l => new { l.Id, l.ProductId, l.Quantity })
            .ToListAsync();
        var candidateIds = candidates.Select(c => c.Id).ToList();
        var taken = await _db.DocumentLines.AsNoTracking()
            .Where(l => l.SourceLineId != null && candidateIds.Contains(l.SourceLineId.Value)
                        && l.Document!.Status != DocumentStatus.CANCELLED)
            .GroupBy(l => l.SourceLineId!.Value)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToDictionaryAsync(x => x.LineId, x => x.Quantity);
        Guid? SourceFor(Guid productId, int baseQty)
        {
            var hit = candidates.FirstOrDefault(c => c.ProductId == productId
                                                     && c.Quantity - taken.GetValueOrDefault(c.Id) >= baseQty);
            if (hit is null) return null;
            taken[hit.Id] = taken.GetValueOrDefault(hit.Id) + baseQty;
            return hit.Id;
        }

        // ---- Post it ----
        var number = await DocumentNumbers.NextAsync(_db, returnType);
        var doc = new SalesDocument
        {
            Number = number, Type = returnType, BranchId = branchId, PartyId = party.Id, StaffId = staffId,
            IssueDate = DateTime.UtcNow, Currency = await _db.CompanySettings.Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP",
            Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim()[..Math.Min(1000, req.Notes.Trim().Length)],
            DepartmentId = departmentId, RepId = isSale ? staffId : null,
        };
        foreach (var (product, unit, l) in lines)
        {
            var baseQty = l.Quantity * unit.Factor;
            var gross = (long)l.Quantity * l.UnitPrice;
            var lineTotal = gross - l.Discount;
            long lineCost;
            if (isSale)
            {
                lineCost = (long)baseQty * _inventory.CostAt(product, warehouse);
                _inventory.ReceiveValue(product, warehouse, baseQty, lineCost, StockMovementType.SALES_RETURN_IN, doc.Id, number);
            }
            else
            {
                // Back to the supplier at the net price: its discount goes back with it.
                lineCost = lineTotal;
                _inventory.ReturnToSupplierValue(product, warehouse, baseQty, lineCost,
                    StockMovementType.PURCHASE_RETURN_OUT, doc.Id, number);
            }
            doc.Lines.Add(new DocumentLine
            {
                LineNo = doc.Lines.Count + 1, ProductId = product.Id, ProductName = product.Name,
                Quantity = baseQty, UnitId = unit.UnitId, UnitFactor = unit.Factor, UnitQuantity = l.Quantity,
                UnitPrice = l.UnitPrice, Discount = l.Discount, LineTotal = lineTotal,
                UnitCost = baseQty > 0 ? (long)decimal.Round((decimal)lineCost / baseQty, MidpointRounding.AwayFromZero) : 0,
                LineCost = lineCost, LineProfit = isSale ? lineTotal - lineCost : 0,
                WarehouseId = warehouse.Id, Warehouse = warehouse,
                SourceLineId = SourceFor(product.Id, baseQty),
            });
        }
        doc.Subtotal = doc.Lines.Sum(l => l.LineTotal + l.Discount);
        doc.DiscountTotal = doc.Lines.Sum(l => l.Discount);
        doc.GrandTotal = doc.Subtotal - doc.DiscountTotal;
        doc.CostTotal = doc.Lines.Sum(l => l.LineCost);
        doc.ProfitTotal = isSale ? doc.GrandTotal - doc.CostTotal : 0;

        // On the account; a cash customer is paid back now (owner decision 2026-10-01).
        MoneyAccount? refundAccount = null;
        if (isSale && party.IsCashCustomer && doc.GrandTotal > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(null, branchId, user);
            moneyError ??= _money.Move(account!, -doc.GrandTotal, MoneyMovementKind.SALES_REFUND, staffId, number,
                documentId: doc.Id, partyId: party.Id);
            if (moneyError is not null) return (null, new(moneyError.Code, moneyError.Message));
            refundAccount = account;
            doc.PaidAmount = doc.GrandTotal;
            doc.PaidAccountId = account!.Id;
        }
        doc.Status = doc.PaidAmount >= doc.GrandTotal && doc.GrandTotal > 0 ? DocumentStatus.PAID : DocumentStatus.CONFIRMED;
        await MoneyService.LockPartiesAsync(_db, party.Id);
        await _db.Entry(party).ReloadAsync();
        var onAccount = doc.GrandTotal - doc.PaidAmount;
        party.Balance += isSale ? -onAccount : onAccount;
        if (isSale) await _ledger.PostSalesReturnAsync(doc, party, refundAccount, staffId);
        else await _ledger.PostPurchaseReturnAsync(doc, party, refundAccount, staffId);

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        return (doc, null);
    }

    public static DocumentType ReturnTypeFor(DocumentType invoiceType) => invoiceType switch
    {
        DocumentType.SALES_INVOICE => DocumentType.SALES_RETURN,
        DocumentType.PURCHASE_INVOICE => DocumentType.PURCHASE_RETURN,
        _ => throw new ArgumentOutOfRangeException(nameof(invoiceType), "Only invoices can be returned."),
    };

    /// <summary>
    /// Cancel return <paramref name="returnId"/> entered by mistake (owner, 2026-10-24). Everything it
    /// moved goes back: a customer's goods leave stock again at the value they came in at (refused once
    /// they were sold on), a supplier's come back at the value they left at; the party's account and any
    /// cash settled at the time go back; its ledger entry is reversed; and the invoice it was against is
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

        // The invoice it was against (documents before items), then the goods.
        SalesDocument? invoice = null;
        if (doc.SourceDocumentId is Guid source)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = {source} FOR UPDATE");
            invoice = await _db.SalesDocuments.FirstOrDefaultAsync(d => d.Id == source);
        }
        var lines = doc.Lines.Where(l => l.Quantity > 0 && l.Warehouse is not null).ToList();
        var products = await _inventory.LockProductsAsync(lines.Select(l => l.ProductId));
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

        doc.Status = DocumentStatus.CANCELLED;
        if (invoice?.Status == DocumentStatus.RETURNED)
        {
            invoice.Status = DocumentStatus.CONFIRMED;
            MoneyService.RefreshPaidStatus(invoice);
        }
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        return (doc, null);
    }

    /// <summary>
    /// Post a return against invoice <paramref name="invoiceId"/>. All-or-nothing: the return
    /// document, its stock movements, the party balance and the invoice status commit together.
    /// <paramref name="user"/> may return only invoices of their branches.
    /// </summary>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CreateAsync(
        Guid invoiceId, DocumentType invoiceType, CreateReturnRequest req, ClaimsPrincipal user, Guid staffId)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return (null, new("no_lines", "Choose at least one item to return."));

        var isSale = invoiceType == DocumentType.SALES_INVOICE;
        var returnType = ReturnTypeFor(invoiceType);

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
        int ReturnedQty(Guid lineId) => returned.TryGetValue(lineId, out var r) ? r.Quantity : 0;

        // ---- Pass 1: validate every requested line before touching stock ----
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
            if (rl.Quantity == 0) continue; // not returning this line

            var remaining = src.Quantity - ReturnedQty(lineId);
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
        Warehouse? WarehouseFor(DocumentLine src) =>
            src.WarehouseId is Guid id && warehouses.TryGetValue(id, out var w) && (w.IsActive || !isSale)
                ? w
                : fallback;
        var routed = new List<(DocumentLine Source, int Quantity, Warehouse Warehouse)>();
        foreach (var (src, qty) in wanted)
        {
            var warehouse = WarehouseFor(src);
            if (warehouse is null)
                return (null, new("no_warehouse", "The invoice's branch has no active warehouse to return into."));
            routed.Add((src, qty, warehouse));
        }

        var products = await _inventory.LockProductsAsync(wanted.Select(w => w.Source.ProductId));
        foreach (var group in routed.GroupBy(w => (w.Source.ProductId, w.Warehouse.Id)))
        {
            var name = group.First().Source.ProductName;
            if (!products.ContainsKey(group.Key.ProductId))
                return (null, new("product_not_found", $"{name} no longer exists."));
            // We can only send back to the supplier goods we still hold — not ones already sold on.
            var qty = group.Sum(w => w.Quantity);
            var available = _inventory.Available(group.Key.ProductId, group.Key.Id);
            if (!isSale && qty > available)
                return (null, new("insufficient_stock",
                    $"Not enough {name} in {Loc.Name(group.First().Warehouse)} to return: {available} left, {qty} requested."));
        }

        // ---- Pass 2: post the return ----
        var number = await DocumentNumbers.NextAsync(_db, returnType);
        var doc = new SalesDocument
        {
            Number = number, Type = returnType, BranchId = invoice.BranchId, PartyId = invoice.PartyId,
            StaffId = staffId, IssueDate = DateTime.UtcNow, Currency = invoice.Currency,
            Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim(),
            SourceDocumentId = invoice.Id, RepId = invoice.RepId, PriceLevelId = invoice.PriceLevelId,
            DepartmentId = invoice.DepartmentId,
        };

        // A part of a line returned in its own unit (whole cartons of a carton line) keeps that unit;
        // any other part is returned in pieces of the item's base unit.
        var productIds = routed.Select(w => w.Source.ProductId).Distinct().ToList();
        var baseUnits = await _db.ItemUnits.AsNoTracking()
            .Where(u => productIds.Contains(u.ProductId) && u.Factor == 1)
            .ToDictionaryAsync(u => u.ProductId, u => u.UnitId);

        foreach (var (src, qty, warehouse) in routed)
        {
            var product = products[src.ProductId];
            var already = returned.GetValueOrDefault(src.Id) ?? Nothing;

            // The return's share of the line's gross amount, discount and cost, in proportion to the
            // base units coming back; the return that empties the line takes exactly what is left,
            // so rounding never strands or over-returns a piastre.
            // (Not once a return without the invoice took some of it: its amounts never came off the line.)
            var completesLine = qty == src.Quantity - already.Quantity && already.Free == 0;
            long Share(long total, long done) => completesLine
                ? total - done
                : (long)decimal.Round(total * (decimal)qty / src.Quantity, MidpointRounding.AwayFromZero);
            var gross = Share(src.LineTotal + src.Discount, already.Gross);
            var discount = Share(src.Discount, already.Discount);
            var docDiscount = Share(src.DocDiscount, already.DocDiscount);
            var lineCost = Share(src.LineCost, already.Cost);
            var lineTotal = gross - discount;

            if (isSale)
                _inventory.ReceiveValue(product, warehouse, qty, lineCost,
                    StockMovementType.SALES_RETURN_IN, doc.Id, number);
            else
                _inventory.ReturnToSupplierValue(product, warehouse, qty, lineCost,
                    StockMovementType.PURCHASE_RETURN_OUT, doc.Id, number);

            var factor = Math.Max(1, src.UnitFactor);
            var inLineUnit = qty % factor == 0;
            doc.Lines.Add(new DocumentLine
            {
                LineNo = doc.Lines.Count + 1,
                ProductId = product.Id, ProductName = src.ProductName, Quantity = qty,
                UnitId = inLineUnit ? src.UnitId : baseUnits.TryGetValue(product.Id, out var b) ? b : src.UnitId,
                UnitFactor = inLineUnit ? factor : 1,
                UnitQuantity = inLineUnit ? qty / factor : qty,
                UnitPrice = inLineUnit
                    ? src.UnitPrice
                    : (long)decimal.Round((decimal)gross / qty, MidpointRounding.AwayFromZero),
                Discount = discount, LineTotal = lineTotal, IsBonus = src.IsBonus, DocDiscount = docDiscount,
                UnitCost = src.UnitCost, LineCost = lineCost, LineProfit = isSale ? lineTotal - docDiscount - lineCost : 0,
                SourceLineId = src.Id, WarehouseId = warehouse.Id, Warehouse = warehouse,
            });
        }

        // The invoice's discounts come back in the same shares they were given; its additions (e.g. a
        // delivery fee) are not refunded by a return.
        var subtotal = doc.Lines.Sum(l => l.LineTotal + l.Discount);
        var discountTotal = doc.Lines.Sum(l => l.Discount + l.DocDiscount);
        var taxable = subtotal - discountTotal;

        // Tax comes back in the same proportion it was charged; the return that completes the
        // invoice takes whatever tax is still unreturned.
        var priorTax = await _db.SalesDocuments
            .Where(d => d.SourceDocumentId == invoice.Id && d.Status != DocumentStatus.CANCELLED)
            .SumAsync(d => (long?)d.TaxTotal) ?? 0;
        var taxLeft = Math.Max(0, invoice.TaxTotal - priorTax);
        var completesInvoice = invoice.Lines.All(l =>
            l.Quantity - ReturnedQty(l.Id) - wanted.Where(w => w.Source.Id == l.Id).Sum(w => w.Quantity) == 0);
        var invoiceTaxable = invoice.Subtotal - invoice.DiscountTotal;
        var tax = completesInvoice ? taxLeft
            : invoiceTaxable <= 0 ? 0
            : Math.Min(taxLeft, (long)decimal.Round(
                invoice.TaxTotal * (decimal)taxable / invoiceTaxable, MidpointRounding.AwayFromZero));
        var grand = taxable + tax;

        doc.Subtotal = subtotal;
        doc.DiscountTotal = discountTotal;
        doc.TaxTotal = tax;
        doc.GrandTotal = grand;
        doc.CostTotal = doc.Lines.Sum(l => l.LineCost);
        doc.ProfitTotal = isSale ? taxable - doc.CostTotal : 0;
        // PaidAmount on a return = cash settled now: handed back to the customer (sales) or
        // received back from the supplier (purchases). The rest is settled on account.
        // A cash customer has no account to carry the credit, so they're paid back in full now
        // (owner decision 2026-10-01); everyone else's return goes on their account.
        var refund = isSale && invoice.Party!.IsCashCustomer ? grand : req.RefundAmount;
        doc.PaidAmount = Math.Clamp(refund, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // Balance sign: > 0 they owe us (receivable), < 0 we owe them (payable).
        // A sales return lowers what the customer owes; a purchase return lowers what we owe the supplier.
        var onAccount = grand - doc.PaidAmount;
        await MoneyService.LockPartiesAsync(_db, invoice.PartyId);
        invoice.Party!.Balance += isSale ? -onAccount : onAccount;

        // A refund moves money: out of a money account to the customer, or back in from the supplier.
        MoneyAccount? refundAccount = null;
        if (doc.PaidAmount > 0)
        {
            var (account, moneyError) = await _money.ForDocumentAsync(req.RefundAccountId, invoice.BranchId, user);
            moneyError ??= _money.Move(account!, isSale ? -doc.PaidAmount : doc.PaidAmount,
                isSale ? MoneyMovementKind.SALES_REFUND : MoneyMovementKind.PURCHASE_REFUND, staffId, number,
                documentId: doc.Id, partyId: invoice.PartyId);
            if (moneyError is not null) return (null, new(moneyError.Code, moneyError.Message));
            refundAccount = account!;
            doc.PaidAccountId = account!.Id;
        }
        if (isSale) await _ledger.PostSalesReturnAsync(doc, invoice.Party!, refundAccount, staffId);
        else await _ledger.PostPurchaseReturnAsync(doc, invoice.Party!, refundAccount, staffId);

        // Shipping we paid to get a customer's goods back: our expense.
        if (isSale && req.ShippingCost != 0)
        {
            if (req.ShippingCost < 0) return (null, new("bad_amount", "Enter a shipping cost of zero or more."));
            var (_, shipError) = await _money.ShippingExpenseAsync(req.ShippingCost, req.ShippingAccountId,
                invoice.BranchId, number, user, staffId, _ledger);
            if (shipError is not null) return (null, new(shipError.Code, shipError.Message));
        }

        if (completesInvoice) invoice.Status = DocumentStatus.RETURNED;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        return (doc, null);
    }
}
