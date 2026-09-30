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
    private readonly StockValuation _valuation;
    private readonly AuditService _audit;
    private readonly LedgerService _ledger;

    public InventoryController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        StockValuation valuation, AuditService audit, LedgerService ledger)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _valuation = valuation;
        _audit = audit;
        _ledger = ledger;
    }

    /// <summary>
    /// Active items with stock, average cost, value and reorder status — across all warehouses (the
    /// person's own, if they see only some), or in one when <paramref name="warehouseId"/> is given
    /// (then cost is that branch's). Totals cover that scope and ignore the search / low-stock filter.
    /// </summary>
    [HttpGet("items")]
    public async Task<ActionResult<InventoryListDto>> Items(
        [FromQuery] string? search = null, [FromQuery] bool lowOnly = false, [FromQuery] string? warehouseId = null,
        [FromQuery] string? modelId = null)
    {
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var products = await _db.Products.AsNoTracking().Where(p => p.IsActive)
            .Include(p => p.Category).Include(p => p.Units).ThenInclude(u => u.Unit)
            .OrderBy(p => p.Name).AsSplitQuery().ToListAsync();
        var state = await _valuation.CurrentAsync();
        var mine = await _warehouses.LimitAsync(User);

        var all = products.Select(p =>
        {
            if (wid is Guid w)
            {
                var (qty, value) = state.Of(p.Id, w);
                var cost = state.PoolOfWarehouse.TryGetValue(w, out var pool)
                           && state.AvgCost.TryGetValue((p.Id, pool), out var c) ? c : p.CostPrice;
                return Mapper.ToInventoryItem(p, qty, cost, value);
            }
            if (mine is not null)
            {
                var (qty, value) = state.Of(p.Id, mine);
                return Mapper.ToInventoryItem(p, qty, qty > 0 ? value / qty : p.CostPrice, value);
            }
            var total = state.Of(p.Id);
            return Mapper.ToInventoryItem(p, p.StockOnHand, p.CostPrice, total.Value);
        }).ToList();

        IEnumerable<InventoryItemDto> rows = all;
        if (lowOnly) rows = rows.Where(i => i.IsLow);
        if (Guid.TryParse(modelId, out var model))
            rows = rows.Where(i => i.ModelId == model.ToString());
        if (!string.IsNullOrWhiteSpace(search))
        {
            // Match the name, the SKU or the barcode of any of its units.
            var s = search.Trim().ToLowerInvariant();
            bool Has(string? v) => v is not null && v.ToLowerInvariant().Contains(s);
            var hits = products.Where(p => Has(p.Name) || Has(p.Sku)
                                           || p.Units.Any(u => Has(u.Barcode)))
                .Select(p => p.Id.ToString()).ToHashSet();
            rows = rows.Where(i => hits.Contains(i.Id));
        }

        var seeCosts = Costs.CanSee(User);
        return Ok(new InventoryListDto(
            rows.Take(MaxListRows).Select(i => Costs.Guard(User, i)).ToArray(),
            seeCosts ? all.Sum(i => i.StockValue) : 0, all.Count, all.Count(i => i.IsLow),
            await CurrencyAsync()));
    }

    /// <summary>
    /// Item card (كارت الصنف): opening balance before <paramref name="from"/>, every movement in the
    /// period with its running balance, and the closing balance — for all warehouses or one.
    /// Defaults to the last 30 days. Values use each branch's average cost at that point in time.
    /// </summary>
    [HttpGet("items/{id:guid}/card")]
    public async Task<ActionResult<ItemCardDto>> Card(Guid id,
        [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? warehouseId = null)
    {
        var product = await _db.Products.AsNoTracking().Include(p => p.Category)
            .Include(p => p.Units).ThenInclude(u => u.Unit)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found", code = "not_found" });
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var today = CompanyClock.Today;
        var fromDay = CompanyClock.ParseDay(from) ?? today.AddDays(-29);
        var toDay = CompanyClock.ParseDay(to) ?? today;
        if (toDay < fromDay) (fromDay, toDay) = (toDay, fromDay);
        var (fromDate, toExclusive) = CompanyClock.Days(fromDay, toDay);

        // One warehouse, or all of them — the person's own, if they see only some.
        var limit = await _warehouses.LimitAsync(User);
        var mine = wid is Guid one ? new HashSet<Guid> { one } : limit;
        var ofItem = _db.StockMovements.AsNoTracking().Where(m => m.ProductId == id);
        var inScope = mine is not null ? ofItem.Where(m => mine.Contains(m.WarehouseId)) : ofItem;
        var moves = await inScope.Where(m => m.CreatedAt >= fromDate && m.CreatedAt < toExclusive)
            .OrderBy(m => m.CreatedAt)
            .Take(MaxCardRows)
            .ToListAsync();

        var opening = mine is null ? (await _valuation.AtAsync(fromDate, id)).Of(id) : (await _valuation.AtAsync(fromDate, id)).Of(id, mine);
        var closing = mine is null ? (await _valuation.AtAsync(toExclusive, id)).Of(id) : (await _valuation.AtAsync(toExclusive, id)).Of(id, mine);
        var now = await _valuation.CurrentAsync(id);
        var names = await _db.Warehouses.AsNoTracking().Include(x => x.Branch).ToDictionaryAsync(x => x.Id);
        var stock = now.Quantity
            .Where(kv => kv.Key.Product == id && kv.Value != 0 && (limit is null || limit.Contains(kv.Key.Warehouse)))
            .Select(kv => new WarehouseStockDto(kv.Key.Warehouse.ToString(), Loc.Name(names[kv.Key.Warehouse]),
                Loc.Name(names[kv.Key.Warehouse].Branch), kv.Value, now.ValueOf(id, kv.Key.Warehouse)))
            .OrderBy(x => x.Name)
            .ToArray();

        var item = wid is Guid only
            ? Mapper.ToInventoryItem(product, now.Of(id, only).Quantity,
                now.CostIn(id, only) is var c && c > 0 ? c : product.CostPrice, now.Of(id, only).Value)
            : mine is not null
                ? Mapper.ToInventoryItem(product, now.Of(id, mine).Quantity,
                    now.Of(id, mine) is { Quantity: > 0 } t ? t.Value / t.Quantity : product.CostPrice, now.Of(id, mine).Value)
                : Mapper.ToInventoryItem(product, product.StockOnHand, product.CostPrice, now.Of(id).Value);

        var seeCosts = Costs.CanSee(User);
        return Ok(new ItemCardDto(
            Costs.Guard(User, item), fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), wid?.ToString(),
            opening.Quantity, seeCosts ? opening.Value : 0,
            moves.Where(m => m.Quantity > 0).Sum(m => m.Quantity),
            moves.Where(m => m.Quantity < 0).Sum(m => -m.Quantity),
            closing.Quantity, seeCosts ? closing.Value : 0,
            (await ToMovementDtosAsync(moves, perWarehouse: wid is not null)).Select(m => Costs.Guard(User, m)).ToArray(),
            stock.Select(w => Costs.Guard(User, w)).ToArray(), await CurrencyAsync()));
    }

    /// <summary>
    /// Stock valuation (تقييم المخزن) at the end of <paramref name="asOf"/> (default today):
    /// each warehouse's quantity × its branch's average cost, by category, item and warehouse. For a
    /// past date it replays the ledger (each warehouse's balance and each branch's average after
    /// their last movement on or before that day).
    /// </summary>
    [HttpGet("valuation")]
    public async Task<ActionResult<ValuationDto>> Valuation(
        [FromQuery] string? asOf = null, [FromQuery] string? warehouseId = null)
    {
        // A valuation is nothing but cost, so it needs the permission to see costs.
        if (!Costs.CanSee(User)) return StatusCode(403, Costs.Refusal);
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var today = CompanyClock.Today;
        var date = CompanyClock.ParseDay(asOf) ?? today;
        var products = await _db.Products.AsNoTracking().Include(p => p.Category).Include(p => p.Model)
            .ToDictionaryAsync(p => p.Id);
        var warehouses = await _db.Warehouses.AsNoTracking().ToDictionaryAsync(w => w.Id, w => Loc.Name(w));
        var state = date >= today ? await _valuation.CurrentAsync() : await _valuation.AtAsync(CompanyClock.StartOf(date.AddDays(1)));
        var mine = await _warehouses.LimitAsync(User);

        var lines = state.Quantity
            .Where(kv => products.TryGetValue(kv.Key.Product, out var p) && (date < today || p.IsActive)
                         && (wid is null || kv.Key.Warehouse == wid) && (mine is null || mine.Contains(kv.Key.Warehouse)))
            .Select(kv => new
            {
                kv.Key.Product, kv.Key.Warehouse, Qty = kv.Value,
                Value = state.ValueOf(kv.Key.Product, kv.Key.Warehouse),
            })
            .ToList();

        var itemRows = lines.GroupBy(l => l.Product)
            .Select(g => new ValuationRowDto(g.Key.ToString(), Loc.Name(products[g.Key]), g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .Where(r => r.Quantity != 0)
            .OrderByDescending(r => r.Value).ToArray();
        var categoryRows = lines.GroupBy(l => Loc.Name(products[l.Product].Category))
            .Select(g => new ValuationRowDto(g.Key, g.Key, g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .OrderByDescending(r => r.Value).ToArray();
        var warehouseRows = lines.GroupBy(l => l.Warehouse)
            .Select(g => new ValuationRowDto(g.Key.ToString(), warehouses.GetValueOrDefault(g.Key, ""),
                g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .OrderByDescending(r => r.Value).ToArray();
        // Variants rolled up to their model (only items made in sizes/colors).
        var modelRows = lines.Where(l => products[l.Product].Model is not null)
            .GroupBy(l => products[l.Product].ModelId!.Value)
            .Select(g => new ValuationRowDto(g.Key.ToString(), Loc.Name(products[g.First().Product].Model),
                g.Sum(l => l.Qty), g.Sum(l => l.Value)))
            .Where(r => r.Quantity != 0)
            .OrderByDescending(r => r.Value).ToArray();

        return Ok(new ValuationDto(
            date.ToString("yyyy-MM-dd"), await CurrencyAsync(), wid?.ToString(),
            lines.Sum(l => l.Qty), lines.Sum(l => l.Value), categoryRows, itemRows, warehouseRows, modelRows));
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
        long valueChange = 0, gains = 0, losses = 0;
        var changed = 0;
        foreach (var (pid, qty) in counted)
        {
            var delta = qty - _inventory.Available(pid, warehouse!.Id);
            if (delta == 0) continue;
            var value = _inventory.Adjust(products[pid], warehouse, delta, reference, note);
            valueChange += value;
            if (value > 0) gains += value; else losses -= value;
            changed++;
        }
        if (changed == 0)
            return BadRequest(new { message = "Counted quantities match the books — nothing to post.", code = "no_change" });
        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        await _ledger.PostStocktakeAsync(reference, warehouse!.BranchId, gains, losses, staffId);

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "stocktake", "stock_adjustment",
            warehouse!.BranchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), reference);

        var posted = await _db.StockMovements.AsNoTracking()
            .Where(m => m.Reference == reference).OrderBy(m => m.CreatedAt).ToListAsync();
        return Ok(new StocktakeResultDto(reference, Loc.Name(warehouse), changed,
            Costs.CanSee(User) ? valueChange : 0,
            (await ToMovementDtosAsync(posted, perWarehouse: true)).Select(m => Costs.Guard(User, m)).ToArray()));
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
        var warehouses = await _db.Warehouses.AsNoTracking().Include(w => w.Branch)
            .Where(w => warehouseIds.Contains(w.Id))
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
                Loc.Name(wh?.Branch), m.WarehouseId.ToString(), Loc.Name(wh),
                m.Reference, m.DocumentId?.ToString(),
                m.DocumentId is Guid d && docTypes.TryGetValue(d, out var t) ? t : null,
                Math.Max(0, m.Quantity), Math.Max(0, -m.Quantity),
                perWarehouse ? m.WarehouseBalanceAfter : m.BalanceAfter,
                m.UnitCost, m.AvgCostAfter, m.Note);
        }).ToArray();
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

}
