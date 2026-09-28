using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Inventory depth (Phase 2): stock list with value + reorder status, the item card (كارت الصنف),
/// stock valuation at a date (تقييم المخزن) and stocktake adjustments (الجرد والتسويات).
/// Everything is read from the products table and the <see cref="StockMovement"/> ledger — no
/// stored report numbers — so it always ties to what the invoices actually did.
/// </summary>
[ApiController]
[Route("api/inventory")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class InventoryController : ControllerBase
{
    private const int MaxStocktakeLines = 1000;
    private const int MaxCardRows = 2000;

    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly AuditService _audit;

    public InventoryController(AppDbContext db, InventoryService inventory, AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _audit = audit;
    }

    /// <summary>Active items with stock, average cost, value and reorder status. Totals ignore the filter.</summary>
    [HttpGet("items")]
    public async Task<ActionResult<InventoryListDto>> Items(
        [FromQuery] string? search = null, [FromQuery] bool lowOnly = false)
    {
        var active = _db.Products.AsNoTracking().Where(p => p.IsActive);
        var totalValue = await active.SumAsync(p => (long?)((long)p.StockOnHand * p.CostPrice)) ?? 0;
        var totalItems = await active.CountAsync();
        var lowCount = await active.CountAsync(p => p.StockOnHand <= p.ReorderLevel);

        var q = active;
        if (lowOnly) q = q.Where(p => p.StockOnHand <= p.ReorderLevel);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(p => p.Name.ToLower().Contains(s) || p.Sku.ToLower().Contains(s)
                || (p.Barcode != null && p.Barcode.ToLower().Contains(s)));
        }
        var rows = await q.Include(p => p.Category).OrderBy(p => p.Name).Take(500).ToListAsync();

        return Ok(new InventoryListDto(
            rows.Select(Mapper.ToInventoryItem).ToArray(), totalValue, totalItems, lowCount, await CurrencyAsync()));
    }

    /// <summary>
    /// Item card (كارت الصنف): opening balance before <paramref name="from"/>, every movement in the
    /// period with its running balance, and the closing balance. Defaults to the last 30 days.
    /// </summary>
    [HttpGet("items/{id:guid}/card")]
    public async Task<ActionResult<ItemCardDto>> Card(Guid id, [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        var product = await _db.Products.AsNoTracking().Include(p => p.Category).FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found", code = "not_found" });

        var today = DateTime.UtcNow.Date;
        var fromDate = Utc((ParseDate(from) ?? today.AddDays(-29)).Date);
        var toDate = Utc((ParseDate(to) ?? today).Date);
        if (toDate < fromDate) (fromDate, toDate) = (toDate, fromDate);
        var toExclusive = toDate.AddDays(1);

        var before = await _db.StockMovements.AsNoTracking()
            .Where(m => m.ProductId == id && m.CreatedAt < fromDate)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new { m.BalanceAfter, m.AvgCostAfter })
            .FirstOrDefaultAsync();
        var opening = before?.BalanceAfter ?? 0;
        var openingAvg = before?.AvgCostAfter ?? 0;

        var moves = await _db.StockMovements.AsNoTracking()
            .Where(m => m.ProductId == id && m.CreatedAt >= fromDate && m.CreatedAt < toExclusive)
            .OrderBy(m => m.CreatedAt)
            .Take(MaxCardRows)
            .ToListAsync();

        var rows = await ToMovementDtosAsync(moves);
        var last = moves.LastOrDefault();
        var closing = last?.BalanceAfter ?? opening;
        var closingAvg = last?.AvgCostAfter ?? openingAvg;

        return Ok(new ItemCardDto(
            Mapper.ToInventoryItem(product), fromDate.ToString("yyyy-MM-dd"), toDate.ToString("yyyy-MM-dd"),
            opening, (long)opening * openingAvg,
            moves.Where(m => m.Quantity > 0).Sum(m => m.Quantity),
            moves.Where(m => m.Quantity < 0).Sum(m => -m.Quantity),
            closing, (long)closing * closingAvg, rows, await CurrencyAsync()));
    }

    /// <summary>
    /// Stock valuation (تقييم المخزن) at the end of <paramref name="asOf"/> (default today):
    /// quantity × weighted-average cost per item, grouped by category. For a past date it replays
    /// the movement ledger (each item's last balance + average cost on or before that day).
    /// </summary>
    [HttpGet("valuation")]
    public async Task<ActionResult<ValuationDto>> Valuation([FromQuery] string? asOf = null)
    {
        var today = DateTime.UtcNow.Date;
        var date = Utc((ParseDate(asOf) ?? today).Date);
        var products = await _db.Products.AsNoTracking().Include(p => p.Category).ToListAsync();

        Dictionary<Guid, (int Qty, long Avg)> state;
        if (date >= today)
        {
            state = products.Where(p => p.IsActive).ToDictionary(p => p.Id, p => (p.StockOnHand, p.CostPrice));
        }
        else
        {
            var end = date.AddDays(1);
            var latest = _db.StockMovements.Where(m => m.CreatedAt < end)
                .GroupBy(m => m.ProductId)
                .Select(g => new { ProductId = g.Key, At = g.Max(m => m.CreatedAt) });
            var rows = await _db.StockMovements.AsNoTracking()
                .Join(latest, m => new { m.ProductId, At = m.CreatedAt }, l => new { l.ProductId, l.At },
                    (m, l) => new { m.ProductId, m.BalanceAfter, m.AvgCostAfter })
                .ToListAsync();
            state = rows.GroupBy(r => r.ProductId)
                .ToDictionary(g => g.Key, g => (g.First().BalanceAfter, g.First().AvgCostAfter));
        }

        var byId = products.ToDictionary(p => p.Id);
        var items = state
            .Where(kv => kv.Value.Qty != 0 && byId.ContainsKey(kv.Key))
            .Select(kv => new
            {
                Product = byId[kv.Key],
                kv.Value.Qty,
                Value = (long)kv.Value.Qty * kv.Value.Avg,
            })
            .ToList();

        var categories = items
            .GroupBy(i => i.Product.Category?.Name ?? "")
            .Select(g => new ValuationRowDto(g.Key, g.Key, g.Sum(i => i.Qty), g.Sum(i => i.Value)))
            .OrderByDescending(r => r.Value)
            .ToArray();
        var itemRows = items
            .OrderByDescending(i => i.Value)
            .Select(i => new ValuationRowDto(i.Product.Id.ToString(), i.Product.Name, i.Qty, i.Value))
            .ToArray();

        return Ok(new ValuationDto(
            date.ToString("yyyy-MM-dd"), await CurrencyAsync(),
            items.Sum(i => i.Qty), items.Sum(i => i.Value), categories, itemRows));
    }

    /// <summary>
    /// Stocktake (الجرد): post the counted quantity for each item. Only items whose count differs
    /// from the books move; gains and shrinkage are valued at the current weighted-average cost.
    /// All lines share one ADJ- reference and commit together. The item rows are locked while
    /// posting so a sale can't slip in between reading the book quantity and writing the difference.
    /// </summary>
    [HttpPost("stocktake")]
    [Authorize(Policy = Permissions.InventoryEdit)]
    public async Task<ActionResult<StocktakeResultDto>> Stocktake([FromBody] StocktakeRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Enter at least one counted quantity.", code = "no_lines" });
        if (req.Lines.Length > MaxStocktakeLines)
            return BadRequest(new { message = $"At most {MaxStocktakeLines} items per stocktake.", code = "too_many_lines" });

        var counted = new Dictionary<Guid, int>();
        foreach (var line in req.Lines)
        {
            if (!Guid.TryParse(line.ProductId, out var pid))
                return BadRequest(new { message = "An item on the stocktake was not found.", code = "product_not_found" });
            if (line.CountedQuantity < 0)
                return BadRequest(new { message = "A counted quantity cannot be negative.", code = "bad_qty" });
            if (!counted.TryAdd(pid, line.CountedQuantity))
                return BadRequest(new { message = "An item is listed twice.", code = "duplicate_line" });
        }

        Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
        var note = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason.Trim()[..Math.Min(500, req.Reason.Trim().Length)];
        var ids = counted.Keys.ToArray();

        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"Products\" WHERE \"Id\" = ANY({ids}) FOR UPDATE");

        var products = await _db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        if (products.Count != ids.Length)
            return BadRequest(new { message = "An item on the stocktake was not found.", code = "product_not_found" });

        var reference = await DocumentNumbers.NextAdjustmentAsync(_db);
        long valueChange = 0;
        var changed = 0;
        foreach (var (pid, qty) in counted)
        {
            var product = products[pid];
            var delta = qty - product.StockOnHand;
            if (delta == 0) continue;
            valueChange += _inventory.Adjust(product, delta, branchId, reference, note);
            changed++;
        }
        if (changed == 0)
            return BadRequest(new { message = "Counted quantities match the books — nothing to post.", code = "no_change" });

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "stocktake", "stock_adjustment",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), reference);

        var posted = await _db.StockMovements.AsNoTracking()
            .Where(m => m.Reference == reference).OrderBy(m => m.CreatedAt).ToListAsync();
        return Ok(new StocktakeResultDto(reference, changed, valueChange, await ToMovementDtosAsync(posted)));
    }

    private async Task<StockMovementDto[]> ToMovementDtosAsync(List<StockMovement> moves)
    {
        var branchIds = moves.Select(m => m.BranchId).Distinct().ToList();
        var branches = await _db.Branches.AsNoTracking().Where(b => branchIds.Contains(b.Id))
            .ToDictionaryAsync(b => b.Id, b => b.Name);
        var docIds = moves.Where(m => m.DocumentId != null).Select(m => m.DocumentId!.Value).Distinct().ToList();
        var docTypes = await _db.SalesDocuments.AsNoTracking().Where(d => docIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Type);

        return moves.Select(m => new StockMovementDto(
            m.Id.ToString(), m.CreatedAt.ToString("o"), m.Type.ToString(),
            branches.GetValueOrDefault(m.BranchId, ""), m.Reference, m.DocumentId?.ToString(),
            m.DocumentId is Guid d && docTypes.TryGetValue(d, out var t) ? t.ToString() : null,
            Math.Max(0, m.Quantity), Math.Max(0, -m.Quantity), m.BalanceAfter,
            m.UnitCost, m.AvgCostAfter, m.Note)).ToArray();
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private static DateTime Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
