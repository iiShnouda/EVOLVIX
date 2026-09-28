using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/purchases")]
[Authorize(Policy = Permissions.PurchasesView)]
public sealed class PurchasesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly AuditService _audit;

    public PurchasesController(AppDbContext db, InventoryService inventory, AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _audit = audit;
    }

    [HttpGet("invoices")]
    public async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == DocumentType.PURCHASE_INVOICE);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
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
        var q = _db.SalesDocuments.Where(d => d.Id == id && d.Type == DocumentType.PURCHASE_INVOICE);
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
    /// Create a purchase invoice: receive stock and recompute each product's weighted-average cost.
    /// This is what makes future sales' COGS and profit correct. Commits atomically.
    /// </summary>
    [HttpPost("invoices")]
    [Authorize(Policy = Permissions.PurchasesCreate)]
    public async Task<ActionResult<SalesDetailDto>> Create([FromBody] CreatePurchaseInvoiceRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one line item.", code = "no_lines" });
        if (!Guid.TryParse(req.PartyId, out var partyId))
            return BadRequest(new { message = "A supplier is required.", code = "no_party" });

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return BadRequest(new { message = "Supplier not found.", code = "party_not_found" });

        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();

        var ids = req.Lines.Select(l => Guid.TryParse(l.ProductId, out var g) ? g : Guid.Empty).ToList();
        var products = await _db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        foreach (var line in req.Lines)
        {
            if (!Guid.TryParse(line.ProductId, out var pid) || !products.TryGetValue(pid, out var product))
                return BadRequest(new { message = "A product on the invoice was not found.", code = "product_not_found" });
            if (line.Quantity <= 0)
                return BadRequest(new { message = $"Quantity must be positive for {product.Name}.", code = "bad_qty" });
            if (line.UnitCost < 0)
                return BadRequest(new { message = $"Cost cannot be negative for {product.Name}.", code = "bad_cost" });
        }

        var number = await NextNumberAsync();
        var doc = new SalesDocument
        {
            Number = number, Type = DocumentType.PURCHASE_INVOICE, BranchId = branchId,
            PartyId = partyId, StaffId = staffId, IssueDate = DateTime.UtcNow,
            DueDate = ParseDate(req.DueDate), Currency = settings.Currency, Notes = req.Notes,
        };

        foreach (var line in req.Lines)
        {
            var product = products[Guid.Parse(line.ProductId)];
            _inventory.Receive(product, line.Quantity, line.UnitCost, branchId,
                StockMovementType.PURCHASE_IN, doc.Id, number);

            var lineTotal = (long)line.Quantity * line.UnitCost;
            doc.Lines.Add(new DocumentLine
            {
                ProductId = product.Id, ProductName = product.Name, Quantity = line.Quantity,
                UnitPrice = line.UnitCost, Discount = 0, LineTotal = lineTotal,
                UnitCost = line.UnitCost, LineCost = lineTotal, LineProfit = 0,
            });
        }

        var subtotal = doc.Lines.Sum(l => l.LineTotal);
        var taxPercent = Math.Clamp(req.TaxPercent ?? settings.DefaultTaxPercent, 0, 100);
        var tax = (long)decimal.Round(subtotal * taxPercent / 100m, MidpointRounding.AwayFromZero);
        var grand = subtotal + tax;

        doc.Subtotal = subtotal;
        doc.DiscountTotal = 0;
        doc.TaxTotal = tax;
        doc.GrandTotal = grand;
        doc.CostTotal = subtotal;
        doc.ProfitTotal = 0;
        doc.PaidAmount = Math.Clamp(req.PaidAmount, 0, grand);
        doc.Status = doc.PaidAmount >= grand ? DocumentStatus.PAID
            : doc.PaidAmount > 0 ? DocumentStatus.PARTIALLY_PAID
            : DocumentStatus.CONFIRMED;

        // We owe the supplier the unpaid balance (payable → negative).
        party.Balance -= grand - doc.PaidAmount;

        _db.SalesDocuments.Add(doc);
        await _db.SaveChangesAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "create", "purchase_invoice",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), doc.Id.ToString());

        await _db.Entry(doc).Reference(d => d.Branch).LoadAsync();
        await _db.Entry(doc).Reference(d => d.Party).LoadAsync();
        await _db.Entry(doc).Reference(d => d.Staff).LoadAsync();
        return Created($"/api/purchases/invoices/{doc.Id}", Mapper.ToDetail(doc));
    }

    private async Task<string> NextNumberAsync()
    {
        var year = DateTime.UtcNow.Year;
        var prefix = $"PUR-{year}-";
        var last = await _db.SalesDocuments.Where(d => d.Number.StartsWith(prefix))
            .OrderByDescending(d => d.Number).Select(d => d.Number).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
