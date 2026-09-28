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

    public ReturnsService(AppDbContext db, InventoryService inventory)
    {
        _db = db;
        _inventory = inventory;
    }

    public sealed record ReturnError(string Code, string Message);

    /// <summary>Quantity and discount already returned per invoice line (non-cancelled returns only).</summary>
    public async Task<Dictionary<Guid, (int Quantity, long Discount)>> ReturnedByLineAsync(Guid invoiceId)
    {
        var rows = await _db.DocumentLines
            .Where(l => l.SourceLineId != null && l.Document!.SourceDocumentId == invoiceId
                        && l.Document.Status != DocumentStatus.CANCELLED)
            .GroupBy(l => l.SourceLineId!.Value)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.Quantity), Discount = g.Sum(l => l.Discount) })
            .ToListAsync();
        return rows.ToDictionary(r => r.LineId, r => (r.Quantity, r.Discount));
    }

    public static DocumentType ReturnTypeFor(DocumentType invoiceType) => invoiceType switch
    {
        DocumentType.SALES_INVOICE => DocumentType.SALES_RETURN,
        DocumentType.PURCHASE_INVOICE => DocumentType.PURCHASE_RETURN,
        _ => throw new ArgumentOutOfRangeException(nameof(invoiceType), "Only invoices can be returned."),
    };

    /// <summary>
    /// Post a return against invoice <paramref name="invoiceId"/>. All-or-nothing: the return
    /// document, its stock movements, the party balance and the invoice status commit together.
    /// <paramref name="branchScope"/> limits which invoices the caller may return (null = all branches).
    /// </summary>
    public async Task<(SalesDocument? Doc, ReturnError? Error)> CreateAsync(
        Guid invoiceId, DocumentType invoiceType, CreateReturnRequest req, Guid? branchScope, Guid staffId)
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

        var q = _db.SalesDocuments.Where(d => d.Id == invoiceId && d.Type == invoiceType);
        if (branchScope is Guid scope) q = q.Where(d => d.BranchId == scope);
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

        var productIds = wanted.Select(w => w.Source.ProductId).Distinct().ToList();
        var products = await _db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        foreach (var group in wanted.GroupBy(w => w.Source.ProductId))
        {
            var name = group.First().Source.ProductName;
            if (!products.TryGetValue(group.Key, out var product))
                return (null, new("product_not_found", $"{name} no longer exists."));
            // We can only send back to the supplier goods we still hold — not ones already sold on.
            var qty = group.Sum(w => w.Quantity);
            if (!isSale && qty > product.StockOnHand)
                return (null, new("insufficient_stock",
                    $"Not enough {name} in stock to return: {product.StockOnHand} left, {qty} requested."));
        }

        // ---- Pass 2: post the return ----
        var number = await DocumentNumbers.NextAsync(_db, returnType);
        var doc = new SalesDocument
        {
            Number = number, Type = returnType, BranchId = invoice.BranchId, PartyId = invoice.PartyId,
            StaffId = staffId, IssueDate = DateTime.UtcNow, Currency = invoice.Currency,
            Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim(),
            SourceDocumentId = invoice.Id,
        };

        foreach (var (src, qty) in wanted)
        {
            var product = products[src.ProductId];
            var already = returned.TryGetValue(src.Id, out var r) ? r : (Quantity: 0, Discount: 0L);

            // Proportional share of the line's flat discount; the return that empties the line takes the rest.
            var discount = qty == src.Quantity - already.Quantity
                ? src.Discount - already.Discount
                : (long)decimal.Round(src.Discount * (decimal)qty / src.Quantity, MidpointRounding.AwayFromZero);
            var lineTotal = (long)qty * src.UnitPrice - discount;
            var lineCost = (long)qty * src.UnitCost;

            if (isSale)
                _inventory.Receive(product, qty, src.UnitCost, doc.BranchId,
                    StockMovementType.SALES_RETURN_IN, doc.Id, number);
            else
                _inventory.ReturnToSupplier(product, qty, src.UnitCost, doc.BranchId,
                    StockMovementType.PURCHASE_RETURN_OUT, doc.Id, number);

            doc.Lines.Add(new DocumentLine
            {
                ProductId = product.Id, ProductName = src.ProductName, Quantity = qty,
                UnitPrice = src.UnitPrice, Discount = discount, LineTotal = lineTotal,
                UnitCost = src.UnitCost, LineCost = lineCost, LineProfit = isSale ? lineTotal - lineCost : 0,
                SourceLineId = src.Id,
            });
        }

        var subtotal = doc.Lines.Sum(l => (long)l.Quantity * l.UnitPrice);
        var discountTotal = doc.Lines.Sum(l => l.Discount);
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
        doc.PaidAmount = Math.Clamp(req.RefundAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // Balance sign: > 0 they owe us (receivable), < 0 we owe them (payable).
        // A sales return lowers what the customer owes; a purchase return lowers what we owe the supplier.
        var onAccount = grand - doc.PaidAmount;
        invoice.Party!.Balance += isSale ? -onAccount : onAccount;

        if (completesInvoice) invoice.Status = DocumentStatus.RETURNED;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        return (doc, null);
    }
}
