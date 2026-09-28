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
/// stock valuation at a date (تقييم المخزن) and stocktake adjustments (الجرد والتسويات) — each for
/// the whole company or one warehouse. Everything is read from the products table, the per-warehouse
/// balances and the <see cref="StockMovement"/> ledger — no stored report numbers — so it always
/// ties to what the documents actually did.
/// </summary>
[ApiController]
[Route("api/inventory")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class InventoryController : ControllerBase
{
    private const int MaxStocktakeLines = 1000;
    private const int MaxCardRows = 2000;
    private const int MaxListRows = 500;

    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly AuditService _audit;

    public InventoryController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _audit = audit;
    }

    /// <summary>
    /// Active items with stock, average cost, value and reorder status — across all warehouses, or
    /// in one when <paramref name="warehouseId"/> is given. Totals cover that scope and ignore the
    /// search / low-stock filter.
    /// </summary>
    [HttpGet("items")]
    public async Task<ActionResult<InventoryListDto>> Items(
        [FromQuery] string? search = null, [FromQuery] bool lowOnly = false, [FromQuery] string? warehouseId = null)
    {
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var products = await _db.Products.AsNoTracking().Where(p => p.IsActive)
            .Include(p => p.Category).OrderBy(p => p.Name).ToListAsync();
        var inWarehouse = wid is Guid w
            ? await _db.StockBalances.AsNoTracking().Where(b => b.WarehouseId == w)
                .ToDictionaryAsync(b => b.ProductId, b => b.Quantity)
            : null;

        var all = products
            .Select(p => Mapper.ToInventoryItem(p, inWarehouse is null ? null : inWarehouse.GetValueOrDefault(p.Id)))
            .ToList();

        IEnumerable<InventoryItemDto> rows = all;
        if (lowOnly) rows = rows.Where(i => i.IsLow);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLowerInvariant();
            var barcodes = products.Where(p => p.Barcode != null && p.Barcode.ToLowerInvariant().Contains(s))
                .Select(p => p.Id.ToString()).ToHashSet();
            rows = rows.Where(i => i.Name.ToLowerInvariant().Contains(s) || i.Sku.ToLowerInvariant().Contains(s)
                || barcodes.Contains(i.Id));
        }

        return Ok(new InventoryListDto(
            rows.Take(MaxListRows).ToArray(), all.Sum(i => i.StockValue), all.Count, all.Count(i => i.IsLow),
            await CurrencyAsync()));
    }

    /// <summary>
    /// Item card (كارت الصنف): opening balance before <paramref name="from"/>, every movement in the
    /// period with its running balance, and the closing balance — for all warehouses or one.
    /// Defaults to the last 30 days. Values use the company average cost at each point in time.
    /// </summary>
    [HttpGet("items/{id:guid}/card")]
    public async Task<ActionResult<ItemCardDto>> Card(Guid id,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? warehouseId = null)
    {
        var product = await _db.Products.AsNoTracking().Include(p => p.Category).FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found", code = "not_found" });
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var today = DateTime.UtcNow.Date;
        var fromDate = Utc((ParseDate(from) ?? today.AddDays(-29)).Date);
        var toDate = Utc((ParseDate(to) ?? today).Date);
        if (toDate < fromDate) (fromDate, toDate) = (toDate, fromDate);
        var toExclusive = toDate.AddDays(1);

        var ofItem = _db.StockMovements.AsNoTracking().Where(m => m.ProductId == id);
        var inScope = wid is Guid w ? ofItem.Where(m => m.WarehouseId == w) : ofItem;

        var before = await inScope.Where(m => m.CreatedAt < fromDate)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new { m.BalanceAfter, m.WarehouseBalanceAfter })
            .FirstOrDefaultAsync();
        var opening = before is null ? 0 : wid is null ? before.BalanceAfter : before.WarehouseBalanceAfter;

        var moves = await inScope.Where(m => m.CreatedAt >= fromDate && m.CreatedAt < toExclusive)
            .OrderBy(m => m.CreatedAt)
            .Take(MaxCardRows)
            .ToListAsync();
        var closing = moves.Count == 0 ? opening
            : wid is null ? moves[^1].BalanceAfter : moves[^1].WarehouseBalanceAfter;

        // The average is company-wide, so it comes from the item's last movement in any warehouse.
        async Task<long> AvgBefore(DateTime at) =>
            await ofItem.Where(m => m.CreatedAt < at).OrderByDescending(m => m.CreatedAt)
                .Select(m => m.AvgCostAfter).FirstOrDefaultAsync();

        var stock = await _db.StockBalances.AsNoTracking()
            .Where(b => b.ProductId == id && b.Quantity != 0)
            .Select(b => new { b.WarehouseId, b.Warehouse!.Name, Branch = b.Warehouse.Branch!.Name, b.Quantity })
            .OrderBy(b => b.Name)
            .ToListAsync();

        return Ok(new ItemCardDto(
            Mapper.ToInventoryItem(product), fromDate.ToString("yyyy-MM-dd"), toDate.ToString("yyyy-MM-dd"),
            wid?.ToString(),
            opening, (long)opening * await AvgBefore(fromDate),
            moves.Where(m => m.Quantity > 0).Sum(m => m.Quantity),
            moves.Where(m => m.Quantity < 0).Sum(m => -m.Quantity),
            closing, (long)closing * await AvgBefore(toExclusive),
            await ToMovementDtosAsync(moves, perWarehouse: wid is not null),
            stock.Select(s => new WarehouseStockDto(s.WarehouseId.ToString(), s.Name, s.Branch, s.Quantity,
                (long)s.Quantity * product.CostPrice)).ToArray(),
            await CurrencyAsync()));
    }

    /// <summary>
    /// Stock valuation (تقييم المخزن) at the end of <paramref name="asOf"/> (default today):
    /// quantity × weighted-average cost, by category, item and warehouse. For a past date it replays
    /// the ledger: each item's quantity per warehouse from its last movement there on or before that
    /// day, valued at the company average from the item's last movement anywhere.
    /// </summary>
    [HttpGet("valuation")]
    public async Task<ActionResult<ValuationDto>> Valuation(
        [FromQuery] string? asOf = null, [FromQuery] string? warehouseId = null)
    {
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var today = DateTime.UtcNow.Date;
        var date = Utc((ParseDate(asOf) ?? today).Date);
        var products = await _db.Products.AsNoTracking().Include(p => p.Category).ToDictionaryAsync(p => p.Id);
        var warehouses = await _db.Warehouses.AsNoTracking().ToDictionaryAsync(w => w.Id, w => w.Name);

        // (product, warehouse) → quantity, and product → average cost, at the end of the day.
        List<(Guid Product, Guid Warehouse, int Qty)> held;
        Dictionary<Guid, long> avg;
        if (date >= today)
        {
            var balances = await _db.StockBalances.AsNoTracking().Where(b => b.Quantity != 0).ToListAsync();
            held = balances.Where(b => products.TryGetValue(b.ProductId, out var p) && p.IsActive)
                .Select(b => (b.ProductId, b.WarehouseId, b.Quantity)).ToList();
            avg = products.ToDictionary(kv => kv.Key, kv => kv.Value.CostPrice);
        }
        else
        {
            var end = date.AddDays(1);
            var upTo = _db.StockMovements.AsNoTracking().Where(m => m.CreatedAt < end);

            var lastPerPlace = upTo.GroupBy(m => new { m.ProductId, m.WarehouseId })
                .Select(g => new { g.Key.ProductId, g.Key.WarehouseId, At = g.Max(m => m.CreatedAt) });
            var places = await upTo
                .Join(lastPerPlace, m => new { m.ProductId, m.WarehouseId, At = m.CreatedAt },
                    l => new { l.ProductId, l.WarehouseId, l.At },
                    (m, l) => new { m.ProductId, m.WarehouseId, m.WarehouseBalanceAfter })
                .ToListAsync();
            held = places.GroupBy(r => (r.ProductId, r.WarehouseId))
                .Select(g => (g.Key.ProductId, g.Key.WarehouseId, g.First().WarehouseBalanceAfter))
                .Where(r => r.WarehouseBalanceAfter != 0 && products.ContainsKey(r.ProductId))
                .ToList();

            var lastPerItem = upTo.GroupBy(m => m.ProductId)
                .Select(g => new { ProductId = g.Key, At = g.Max(m => m.CreatedAt) });
            var costs = await upTo
                .Join(lastPerItem, m => new { m.ProductId, At = m.CreatedAt }, l => new { l.ProductId, l.At },
                    (m, l) => new { m.ProductId, m.AvgCostAfter })
                .ToListAsync();
            avg = costs.GroupBy(c => c.ProductId).ToDictionary(g => g.Key, g => g.First().AvgCostAfter);
        }

        if (wid is Guid only) held = held.Where(h => h.Warehouse == only).ToList();
        var lines = held.Select(h => new
        {
            h.Product, h.Warehouse, h.Qty,
            Value = (long)h.Qty * avg.GetValueOrDefault(h.Product),
        }).ToList();

        var itemRows = lines.GroupBy(l => l.Product)
            .Select(g => new ValuationRowDto(g.Key.ToString(), products[g.Key].Name, g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .Where(r => r.Quantity != 0)
            .OrderByDescending(r => r.Value).ToArray();
        var categoryRows = lines.GroupBy(l => products[l.Product].Category?.Name ?? "")
            .Select(g => new ValuationRowDto(g.Key, g.Key, g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .OrderByDescending(r => r.Value).ToArray();
        var warehouseRows = lines.GroupBy(l => l.Warehouse)
            .Select(g => new ValuationRowDto(g.Key.ToString(), warehouses.GetValueOrDefault(g.Key, ""),
                g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .OrderByDescending(r => r.Value).ToArray();

        return Ok(new ValuationDto(
            date.ToString("yyyy-MM-dd"), await CurrencyAsync(), wid?.ToString(),
            lines.Sum(l => l.Qty), lines.Sum(l => l.Value), categoryRows, itemRows, warehouseRows));
    }

    /// <summary>
    /// Stocktake (الجرد) of one warehouse: post the counted quantity for each item. Only items whose
    /// count differs from that warehouse's books move; gains and shrinkage are valued at the current
    /// weighted-average cost. All lines share one ADJ- reference and commit together. The items are
    /// locked while posting so a sale can't slip in between reading the book quantity and writing
    /// the difference.
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

        var (warehouse, whError) = await _warehouses.ResolveAsync(User, req.WarehouseId);
        if (whError is not null) return BadRequest(new { message = whError.Message, code = whError.Code });

        var reason = req.Reason?.Trim();
        var note = string.IsNullOrEmpty(reason) ? null : reason[..Math.Min(500, reason.Length)];

        await using var tx = await _db.Database.BeginTransactionAsync();
        var products = await _inventory.LockProductsAsync(counted.Keys);
        if (products.Count != counted.Count)
            return BadRequest(new { message = "An item on the stocktake was not found.", code = "product_not_found" });

        var reference = await DocumentNumbers.NextAdjustmentAsync(_db);
        long valueChange = 0;
        var changed = 0;
        foreach (var (pid, qty) in counted)
        {
            var delta = qty - _inventory.Available(pid, warehouse!.Id);
            if (delta == 0) continue;
            valueChange += _inventory.Adjust(products[pid], warehouse, delta, reference, note);
            changed++;
        }
        if (changed == 0)
            return BadRequest(new { message = "Counted quantities match the books — nothing to post.", code = "no_change" });

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "stocktake", "stock_adjustment",
            warehouse!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), reference);

        var posted = await _db.StockMovements.AsNoTracking()
            .Where(m => m.Reference == reference).OrderBy(m => m.CreatedAt).ToListAsync();
        return Ok(new StocktakeResultDto(reference, warehouse.Name, changed, valueChange,
            await ToMovementDtosAsync(posted, perWarehouse: true)));
    }

    /// <summary>
    /// Parse an optional warehouse filter. Unknown ids, and warehouses of other branches for
    /// branch-scoped users, are 404 — the same answer, so ids can't be probed.
    /// </summary>
    private async Task<(Guid? Id, ActionResult? NotFound)> VisibleWarehouseAsync(string? warehouseId)
    {
        if (string.IsNullOrWhiteSpace(warehouseId)) return (null, null);
        if (Guid.TryParse(warehouseId, out var id) && await _warehouses.Visible(User).AnyAsync(w => w.Id == id))
            return (id, null);
        return (null, NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" }));
    }

    private async Task<StockMovementDto[]> ToMovementDtosAsync(List<StockMovement> moves, bool perWarehouse)
    {
        var warehouseIds = moves.Select(m => m.WarehouseId).Distinct().ToList();
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => warehouseIds.Contains(w.Id))
            .Select(w => new { w.Id, w.Name, Branch = w.Branch!.Name })
            .ToDictionaryAsync(w => w.Id);
        var docIds = moves.Where(m => m.DocumentId != null).Select(m => m.DocumentId!.Value).Distinct().ToList();
        var docTypes = await _db.SalesDocuments.AsNoTracking().Where(d => docIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Type.ToString());
        foreach (var transferId in await _db.StockTransfers.AsNoTracking().Where(t => docIds.Contains(t.Id))
                     .Select(t => t.Id).ToListAsync())
            docTypes[transferId] = "STOCK_TRANSFER";

        return moves.Select(m =>
        {
            var wh = warehouses.GetValueOrDefault(m.WarehouseId);
            return new StockMovementDto(
                m.Id.ToString(), m.CreatedAt.ToString("o"), m.Type.ToString(),
                wh?.Branch ?? "", m.WarehouseId.ToString(), wh?.Name ?? "",
                m.Reference, m.DocumentId?.ToString(),
                m.DocumentId is Guid d && docTypes.TryGetValue(d, out var t) ? t : null,
                Math.Max(0, m.Quantity), Math.Max(0, -m.Quantity),
                perWarehouse ? m.WarehouseBalanceAfter : m.BalanceAfter,
                m.UnitCost, m.AvgCostAfter, m.Note);
        }).ToArray();
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private static DateTime Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d) ? d : null;
}
