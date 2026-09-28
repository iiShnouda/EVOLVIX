using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/sales")]
[Authorize(Policy = Permissions.SalesView)]
public sealed class SalesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly AuditService _audit;

    public SalesController(AppDbContext db, InventoryService inventory, AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _audit = audit;
    }

    [HttpGet("invoices")]
    public async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == DocumentType.SALES_INVOICE);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<DocumentStatus>(status, out var st))
            q = q.Where(d => d.Status == st);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(d => d.Number.ToLower().Contains(s) || d.Party!.Name.ToLower().Contains(s));
        }

        var total = await q.CountAsync();
        var rows = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .OrderByDescending(d => d.IssueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Ok(new PaginatedDto<SalesSummaryDto>(
            rows.Select(Mapper.ToSummary).ToArray(), total, page, pageSize));
    }

    [HttpGet("invoices/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        var doc = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.Lines)
            .FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found" });
        return Ok(Mapper.ToDetail(doc));
    }

    /// <summary>
    /// Create a sales invoice: consume stock at weighted-average cost, compute profit, and enforce
    /// the profit floor (never below cost; and never below the configured minimum markup unless the
    /// user may override). All-or-nothing: the whole document + stock movements commit atomically.
    /// </summary>
    [HttpPost("invoices")]
    [Authorize(Policy = Permissions.SalesCreate)]
    public async Task<ActionResult<SalesDetailDto>> Create([FromBody] CreateSalesInvoiceRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A customer is required.", code = "no_party" });

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Customer not found.", code = "party_not_found" });

        var settings = await GetSettingsAsync();
        var canOverride = User.HasClaim("permission", Permissions.SalesOverrideFloor);

        // Load every referenced product once (tracked, so cost/stock updates persist).
        var ids = req.Lines.Select(l => Guid.TryParse(l.ProductId, out var g) ? g : Guid.Empty).ToList();
        var products = await _db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        // ---- Pass 1: validate everything before touching stock ----
        foreach (var line in req.Lines)
        {
            if (!Guid.TryParse(line.ProductId, out var pid) || !products.TryGetValue(pid, out var product))
                return BadRequest(new { message = "A product on the invoice was not found.", code = "product_not_found" });
            if (line.Quantity <= 0)
                return BadRequest(new { message = $"Quantity must be positive for {product.Name}.", code = "bad_qty" });
            if (line.UnitPrice < 0 || line.Discount < 0)
                return BadRequest(new { message = $"Price/discount cannot be negative for {product.Name}.", code = "bad_price" });
            if (line.Quantity > product.StockOnHand)
                return BadRequest(new
                {
                    message = $"Not enough stock for {product.Name}: {product.StockOnHand} left, {line.Quantity} requested.",
                    code = "insufficient_stock",
                });

            var floorError = CheckFloor(line.UnitPrice, product.CostPrice, settings.MinMarkupPercent,
                canOverride, req.OverrideFloor);
            if (floorError is not null)
                return BadRequest(new
                {
                    message = floorError == "below_cost"
                        ? $"{product.Name}: price is below cost — selling at a loss is never allowed."
                        : $"{product.Name}: price is below the minimum profit floor. Ask a manager to override.",
                    code = floorError,
                });
        }

        // ---- Pass 2: post the document ----
        var number = await NextNumberAsync(DocumentType.SALES_INVOICE);
        var doc = new SalesDocument
        {
            Number = number, Type = DocumentType.SALES_INVOICE, BranchId = branchId,
            PartyId = partyId, StaffId = staffId, IssueDate = DateTime.UtcNow,
            DueDate = ParseDate(req.DueDate), Currency = settings.Currency, Notes = req.Notes,
        };

        foreach (var line in req.Lines)
        {
            var product = products[Guid.Parse(line.ProductId)];
            var unitCost = _inventory.Issue(product, line.Quantity, branchId,
                StockMovementType.SALE_OUT, doc.Id, number);

            var lineTotal = (long)line.Quantity * line.UnitPrice - line.Discount;
            var lineCost = (long)line.Quantity * unitCost;
            doc.Lines.Add(new DocumentLine
            {
                ProductId = product.Id, ProductName = product.Name, Quantity = line.Quantity,
                UnitPrice = line.UnitPrice, Discount = line.Discount, LineTotal = lineTotal,
                UnitCost = unitCost, LineCost = lineCost, LineProfit = lineTotal - lineCost,
            });
        }

        var subtotal = doc.Lines.Sum(l => (long)l.Quantity * l.UnitPrice);
        var discountTotal = doc.Lines.Sum(l => l.Discount);
        var taxable = subtotal - discountTotal;
        var taxPercent = Math.Clamp(req.TaxPercent ?? settings.DefaultTaxPercent, 0, 100);
        var tax = (long)decimal.Round(taxable * taxPercent / 100m, MidpointRounding.AwayFromZero);
        var grand = taxable + tax;
        var costTotal = doc.Lines.Sum(l => l.LineCost);

        doc.Subtotal = subtotal;
        doc.DiscountTotal = discountTotal;
        doc.TaxTotal = tax;
        doc.GrandTotal = grand;
        doc.CostTotal = costTotal;
        doc.ProfitTotal = taxable - costTotal;
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // The customer owes us the unpaid balance (receivable → positive).
        party.Balance += grand - doc.PaidAmount;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "sales_invoice",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await _db.Entry(doc).Reference(d => d.Branch).LoadAsync();
        await _db.Entry(doc).Reference(d => d.Party).LoadAsync();
        await _db.Entry(doc).Reference(d => d.Staff).LoadAsync();
        return Created($"/api/sales/invoices/{doc.Id}", Mapper.ToDetail(doc));
    }

    // Never below cost; and never below cost×(1+min/100) unless the user may override.
    private static string? CheckFloor(long unitPrice, long unitCost, int minMarkup, bool canOverride, bool overrideRequested)
    {
        if (unitPrice < unitCost) return "below_cost";
        var floor = (long)decimal.Round(unitCost * (100m + Math.Max(0, minMarkup)) / 100m, MidpointRounding.AwayFromZero);
        if (unitPrice < floor && !(canOverride && overrideRequested)) return "below_floor";
        return null;
    }

    private async Task<CompanySettings> GetSettingsAsync() =>
        await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();

    private async Task<string> NextNumberAsync(DocumentType type)
    {
        var year = DateTime.UtcNow.Year;
        var prefix = type == DocumentType.PURCHASE_INVOICE ? $"PUR-{year}-" : $"INV-{year}-";
        var last = await _db.SalesDocuments.Where(d => d.Number.StartsWith(prefix))
            .OrderByDescending(d => d.Number).Select(d => d.Number).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
