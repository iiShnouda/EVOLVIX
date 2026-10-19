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
        [FromQuery] string? modelId = null, [FromQuery] string? branchId = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? groupId = null,
        [FromQuery] string? code = null, [FromQuery] string? supplierId = null,
        [FromQuery] int page = 1, [FromQuery] int? pageSize = null, [FromQuery] string? sort = null,
        [FromQuery] string? dir = null, [FromQuery] bool inStock = false)
    {
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        // One department's items (owner, 2026-10-01: branch, warehouse and department in every search),
        // or one group of its tree and everything under it (2026-10-06).
        var productQuery = _db.Products.AsNoTracking().Where(p => p.IsActive);
        var tree = await _db.Categories.AsNoTracking().ToListAsync();
        if (Guid.TryParse(departmentId, out var dept))
            productQuery = productQuery.Where(p => p.Category!.DepartmentId == dept);
        if (Guid.TryParse(groupId, out var gid))
        {
            var under = Catalog.Subtree(gid, tree).ToList();
            productQuery = productQuery.Where(p => under.Contains(p.CategoryId));
        }
        // The item's code in its own box, and the supplier on its own (owner, 2026-10-17).
        if (!string.IsNullOrWhiteSpace(code))
        {
            var c = code.Trim().ToLower();
            productQuery = productQuery.Where(p => p.Sku.ToLower().Contains(c)
                || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(c))
                || p.Units.Any(u => u.Barcode != null && u.Barcode.ToLower().Contains(c)));
        }
        if (Guid.TryParse(supplierId, out var sup))
            productQuery = productQuery.Where(p => p.SupplierId == sup);
        var products = await productQuery
            .Include(p => p.Category).Include(p => p.Units).ThenInclude(u => u.Unit).Include(p => p.Supplier)
            .OrderBy(p => p.Name).AsSplitQuery().ToListAsync();
        var state = await _valuation.CurrentAsync();
        var mine = await _warehouses.LimitAsync(User);
        // One branch: the stock of its warehouses the person may see.
        if (wid is null && Guid.TryParse(branchId, out var bid))
        {
            if (!Access.CanUseBranch(User, bid))
                return NotFound(new { message = "Branch not found.", code = "branch_not_found" });
            var inBranch = (await _warehouses.Visible(User)
                .Where(w => w.BranchId == bid && w.Kind == WarehouseKind.STORE).Select(w => w.Id).ToListAsync()).ToHashSet();
            mine = inBranch;
        }

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
        if (inStock) rows = rows.Where(i => i.StockOnHand > 0);
        if (Guid.TryParse(modelId, out var model))
            rows = rows.Where(i => i.ModelId == model.ToString());
        if (!string.IsNullOrWhiteSpace(search))
        {
            // Every typed word in the name, code or supplier code — letter forms made one and a
            // slipped letter allowed (owner, 2026-10-06) — or in its group's name; or a unit's barcode.
            var s = search.Trim().ToLowerInvariant();
            var typed = TextKey.Words(search);
            var groupWords = tree.ToDictionary(c => c.Id, c => Catalog.PathOf(c.Id, tree)
                .SelectMany(g => TextKey.Words(g.Name + " " + (g.Keywords ?? "").Replace('\n', ' '))).ToArray());
            bool Words(Product p)
            {
                var have = p.SearchKey.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Concat(groupWords.GetValueOrDefault(p.CategoryId, Array.Empty<string>())).ToArray();
                return typed.Length > 0 && typed.All(w => TextKey.Match(w, have) >= 0);
            }
            var hits = products.Where(p => Words(p) || p.Units.Any(u => u.Barcode?.ToLowerInvariant().Contains(s) == true))
                .Select(p => p.Id.ToString()).ToHashSet();
            rows = rows.Where(i => hits.Contains(i.Id));
        }

        var seeCosts = Costs.CanSee(User);
        // Sorted by any column and sent a page at a time (owner, 2026-10-18: "don't load all the
        // data at once"); cost and value sort only for people who may see them.
        var desc = dir == "desc";
        Func<InventoryItemDto, object> key = sort switch
        {
            "code" => i => i.Sku,
            "department" => i => i.CategoryName,
            "supplier" => i => i.SupplierName ?? "",
            "stock" => i => i.StockOnHand,
            "reorder" => i => i.ReorderLevel,
            "sale" => i => i.SalePrice,
            "cost" when seeCosts => i => i.AvgCost,
            "value" when seeCosts => i => i.StockValue,
            _ => i => i.Name,
        };
        var list = rows.ToList();
        var ordered = desc ? list.OrderByDescending(key).ThenBy(i => i.Name) : list.OrderBy(key).ThenBy(i => i.Name);
        // Screens that need every item's stock (sales, stocktakes, transfers) ask for no page size.
        var size = Math.Clamp(pageSize ?? MaxListRows, 1, MaxListRows);
        var at = Math.Max(1, page);
        var pageRows = ordered.Skip((at - 1) * size).Take(size).ToList();

        // Where each one is: the branch and warehouse holding it (among those the person may see).
        var names = await _db.Warehouses.AsNoTracking().Include(x => x.Branch)
            .Where(x => x.Kind == WarehouseKind.STORE).ToDictionaryAsync(x => x.Id);
        var ids = pageRows.Select(i => Guid.Parse(i.Id)).ToHashSet();
        var places = state.Quantity
            .Where(kv => kv.Value != 0 && ids.Contains(kv.Key.Product) && names.ContainsKey(kv.Key.Warehouse)
                         && (wid is Guid only ? kv.Key.Warehouse == only : mine is null || mine.Contains(kv.Key.Warehouse)))
            .GroupBy(kv => kv.Key.Product)
            .ToDictionary(g => g.Key.ToString(), g => g
                .Select(kv => $"{Loc.Name(names[kv.Key.Warehouse].Branch)} / {Loc.Name(names[kv.Key.Warehouse])} ({kv.Value})")
                .OrderBy(x => x).ToArray());

        return Ok(new InventoryListDto(
            pageRows.Select(i => Costs.Guard(User, i with { Places = places.GetValueOrDefault(i.Id) ?? Array.Empty<string>() }))
                .ToArray(),
            seeCosts ? all.Sum(i => i.StockValue) : 0, all.Count, all.Count(i => i.IsLow),
            await CurrencyAsync(), list.Count, at, size));
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
        var product = await _db.Products.AsNoTracking().Include(p => p.Category).ThenInclude(c => c!.Department)
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
        // From its last purchase (owner, 2026-10-18): the supplier's discount, and the margin as the
        // owner works it out — on the supplier's price before the discount, the discount counted in
        // it — each with its own permission.
        decimal? discountPct = null, marginPct = null;
        if (seeCosts)
        {
            var myDocs = _db.SalesDocuments.InBranches(User, d => d.BranchId).Select(d => d.Id);
            var last = await _db.DocumentLines.AsNoTracking()
                .Where(l => l.ProductId == id && l.Document!.Type == DocumentType.PURCHASE_INVOICE
                            && l.Document.Status != DocumentStatus.CANCELLED && !l.IsBonus && l.Quantity > 0)
                .Where(l => myDocs.Contains(l.DocumentId))
                .OrderByDescending(l => l.Document!.IssueDate).ThenByDescending(l => l.LineNo)
                .Select(l => new { l.Quantity, l.UnitQuantity, l.UnitPrice, l.Discount, l.DocDiscount })
                .FirstOrDefaultAsync();
            if (last is not null)
            {
                var before = (decimal)last.UnitPrice * last.UnitQuantity / last.Quantity;
                var off = (decimal)(last.Discount + last.DocDiscount) / last.Quantity;
                if (before > 0)
                {
                    discountPct = Math.Round(off * 100 / before, 1);
                    if (Costs.CanSeeProfit(User))
                        marginPct = Math.Round((product.SalePrice - (before - off)) * 100 / before, 1);
                }
            }
        }
        return Ok(new ItemCardDto(
            Costs.Guard(User, item), fromDay.ToString("yyyy-MM-dd"), toDay.ToString("yyyy-MM-dd"), wid?.ToString(),
            opening.Quantity, seeCosts ? opening.Value : 0,
            moves.Where(m => m.Quantity > 0).Sum(m => m.Quantity),
            moves.Where(m => m.Quantity < 0).Sum(m => -m.Quantity),
            closing.Quantity, seeCosts ? closing.Value : 0,
            (await ToMovementDtosAsync(moves, perWarehouse: wid is not null)).Select(m => Costs.Guard(User, m)).ToArray(),
            stock.Select(w => Costs.Guard(User, w)).ToArray(), await CurrencyAsync(), discountPct, marginPct));
    }

    /// <summary>
    /// The item's whole story (owner, 2026-10-02): every purchase (supplier, discount, cost), sale
    /// (customer, price, discount, profit) and return, newest first, in the person's branches. Each
    /// part needs its own permission; costs and profit need costs:view as everywhere.
    /// </summary>
    [HttpGet("items/{id:guid}/life")]
    public async Task<ActionResult<ItemLifeDto>> Life(Guid id)
    {
        var product = await _db.Products.AsNoTracking().Include(p => p.Supplier)
            .Include(p => p.Category).ThenInclude(c => c!.Department)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { message = "Item not found", code = "not_found" });
        bool Has(string permission) => User.HasClaim("permission", permission);
        var seeCosts = Costs.CanSee(User);
        var seeProfit = Costs.CanSeeProfit(User);
        var canBuy = Has(Permissions.ProductsCardPurchases);
        var canSell = Has(Permissions.ProductsCardSales);
        var canReturn = Has(Permissions.ProductsCardReturns);

        var types = new[] { DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.PURCHASE_INVOICE,
            DocumentType.PURCHASE_RETURN };
        var mine = _db.SalesDocuments.InBranches(User, d => d.BranchId).Select(d => d.Id);
        var rows = await _db.DocumentLines.AsNoTracking()
            .Where(l => l.ProductId == id && types.Contains(l.Document!.Type) && l.Document.Status != DocumentStatus.CANCELLED)
            .Where(l => mine.Contains(l.DocumentId))
            .OrderByDescending(l => l.Document!.IssueDate).ThenByDescending(l => l.LineNo)
            .Select(l => new LifeRow(
                l.DocumentId, l.Document!.Number, l.Document.Type, l.Document.IssueDate, l.Document.Party!.Name,
                l.Document.Party.Code, l.Warehouse!.Name, l.Document.Branch!.Name, l.Document.Staff!.FullName,
                l.Quantity, l.UnitQuantity, l.Unit!.Name, l.UnitPrice, l.UnitFactor, l.Discount, l.DocDiscount,
                l.LineTotal, l.UnitCost, l.LineProfit, l.IsBonus,
                _db.InvoiceRevisions.Any(r => r.DocumentId == l.DocumentId && r.Kind == "EDIT")))
            .Take(MaxCardRows).ToListAsync();

        ItemLifeLineDto ToLine(LifeRow r)
        {
            var net = r.LineTotal - r.DocDiscount;
            var perUnit = r.Quantity > 0 ? (long)Math.Round((decimal)net / r.Quantity) : 0;
            var factor = Math.Max(1, r.UnitFactor);
            // What we paid a supplier is the supply price: only for costs:view, like every cost.
            var hidden = !seeCosts && r.Type is DocumentType.PURCHASE_INVOICE or DocumentType.PURCHASE_RETURN;
            return new ItemLifeLineDto(r.DocumentId.ToString(), r.Number, r.Type.ToString(),
                DateTime.SpecifyKind(r.IssueDate, DateTimeKind.Utc).ToString("o"),
                r.Party, r.PartyCode, r.Warehouse, r.Branch, r.Staff, r.Quantity, r.UnitQuantity, r.Unit,
                hidden ? null : (long)Math.Round((decimal)r.UnitPrice / factor), hidden ? null : r.Discount + r.DocDiscount,
                hidden ? null : perUnit,
                seeCosts ? r.UnitCost : null, seeProfit ? r.LineProfit : null, r.IsBonus, r.Edited);
        }

        var buys = rows.Where(r => r.Type == DocumentType.PURCHASE_INVOICE).ToList();
        var sells = rows.Where(r => r.Type == DocumentType.SALES_INVOICE).ToList();
        var backIn = rows.Where(r => r.Type == DocumentType.SALES_RETURN).ToList();
        var backOut = rows.Where(r => r.Type == DocumentType.PURCHASE_RETURN).ToList();
        var lastCost = buys.FirstOrDefault() is { } last && last.Quantity > 0
            ? (long)Math.Round((decimal)(last.LineTotal - last.DocDiscount) / last.Quantity) : (long?)null;
        var cost = product.CostPrice > 0 ? product.CostPrice : lastCost ?? 0;
        var totals = new ItemLifeTotalsDto(
            buys.Sum(r => r.Quantity), sells.Sum(r => r.Quantity), backIn.Sum(r => r.Quantity), backOut.Sum(r => r.Quantity),
            seeCosts ? buys.Sum(r => r.LineTotal - r.DocDiscount) : null,
            sells.Sum(r => r.LineTotal - r.DocDiscount) - backIn.Sum(r => r.LineTotal - r.DocDiscount),
            seeProfit ? sells.Sum(r => r.LineProfit) - backIn.Sum(r => r.LineProfit) : null,
            seeCosts ? lastCost : null, product.SalePrice,
            seeCosts && seeProfit && cost > 0 ? (int)Math.Round((product.SalePrice - cost) * 100m / cost) : null);

        var limit = await _warehouses.LimitAsync(User);
        var now = await _valuation.CurrentAsync(id);
        var names = await _db.Warehouses.AsNoTracking().Include(x => x.Branch).ToDictionaryAsync(x => x.Id);
        var stock = now.Quantity
            .Where(kv => kv.Key.Product == id && kv.Value != 0 && (limit is null || limit.Contains(kv.Key.Warehouse)))
            .Select(kv => Costs.Guard(User, new WarehouseStockDto(kv.Key.Warehouse.ToString(), Loc.Name(names[kv.Key.Warehouse]),
                Loc.Name(names[kv.Key.Warehouse].Branch), kv.Value, now.ValueOf(id, kv.Key.Warehouse))))
            .OrderBy(x => x.Name).ToArray();

        return Ok(new ItemLifeDto(product.Id.ToString(), Loc.Name(product), product.Sku, product.Supplier?.Name,
            product.Category?.Department is { } dep ? Loc.Name(dep) : null, await CurrencyAsync(), totals,
            canBuy ? buys.Select(ToLine).ToArray() : null,
            canSell ? sells.Select(ToLine).ToArray() : null,
            canReturn ? backIn.Concat(backOut).OrderByDescending(r => r.IssueDate).Select(ToLine).ToArray() : null,
            Has(Permissions.ProductsCardPrices), stock));
    }

    /// <summary>
    /// Stock valuation (تقييم المخزن) at the end of <paramref name="asOf"/> (default today):
    /// each warehouse's quantity × its branch's average cost, by category, item and warehouse. For a
    /// past date it replays the ledger (each warehouse's balance and each branch's average after
    /// their last movement on or before that day).
    /// </summary>
    [HttpGet("valuation")]
    [Authorize(Policy = Permissions.InventoryValuation)]
    public async Task<ActionResult<ValuationDto>> Valuation(
        [FromQuery] string? asOf = null, [FromQuery] string? warehouseId = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? supplierId = null,
        [FromQuery] string? search = null, [FromQuery] string? productIds = null,
        [FromQuery] bool low = false, [FromQuery] bool empty = false)
    {
        // Each part and column has its own permission (owner, 2026-10-19); values need costs:view.
        bool Has(string p) => User.HasClaim("permission", p);
        var seeCosts = Costs.CanSee(User);
        var seePrices = Has(Permissions.ValuationPrices);
        var seeSuppliers = Has(Permissions.ValuationSuppliers);
        var (wid, notFound) = await VisibleWarehouseAsync(warehouseId);
        if (notFound is not null) return notFound;

        var today = CompanyClock.Today;
        var date = CompanyClock.ParseDay(asOf) ?? today;
        var products = await _db.Products.AsNoTracking().Include(p => p.Category).ThenInclude(c => c!.Department)
            .Include(p => p.Model).Include(p => p.Supplier)
            .ToDictionaryAsync(p => p.Id);
        var warehouses = await _db.Warehouses.AsNoTracking().ToDictionaryAsync(w => w.Id, w => Loc.Name(w));
        var state = date >= today ? await _valuation.CurrentAsync() : await _valuation.AtAsync(CompanyClock.StartOf(date.AddDays(1)));
        var mine = await _warehouses.LimitAsync(User);

        var all = state.Quantity
            .Where(kv => products.TryGetValue(kv.Key.Product, out var p) && (date < today || p.IsActive)
                         && (wid is null || kv.Key.Warehouse == wid) && (mine is null || mine.Contains(kv.Key.Warehouse)))
            .Select(kv => new
            {
                kv.Key.Product, kv.Key.Warehouse, Qty = kv.Value,
                Value = state.ValueOf(kv.Key.Product, kv.Key.Warehouse),
            })
            .ToList();
        // Every item in stock here, before the filters: the counter's "of".
        var totalItems = all.GroupBy(l => l.Product).Count(g => g.Sum(l => l.Qty) != 0);

        // The filters: department, supplier (name or code typed, or picked), name/code, chosen items.
        Guid? dept = Guid.TryParse(departmentId, out var d) ? d : null;
        Guid? supplier = seeSuppliers && Guid.TryParse(supplierId, out var sp) ? sp : null;
        var picked = (productIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToHashSet();
        var text = search?.Trim();
        bool Passes(Product p) =>
            (dept is null || p.Category?.DepartmentId == dept)
            && (supplier is null || p.SupplierId == supplier)
            && (picked.Count == 0 || picked.Contains(p.Id))
            && (string.IsNullOrEmpty(text)
                || p.Name.Contains(text, StringComparison.OrdinalIgnoreCase)
                || p.Sku.Contains(text, StringComparison.OrdinalIgnoreCase)
                || (p.SupplierCode ?? "").Contains(text, StringComparison.OrdinalIgnoreCase)
                || (seeSuppliers && p.Supplier is not null
                    && (p.Supplier.Name.Contains(text, StringComparison.OrdinalIgnoreCase) || p.Supplier.Code.ToString() == text)));

        var lines = all.Where(l => Passes(products[l.Product])).ToList();
        var qtyOf = lines.GroupBy(l => l.Product).ToDictionary(g => g.Key, g => g.Sum(l => l.Qty));
        // Reached the reorder level, and run out (owner, 2026-10-19): ticked, only those (either).
        bool IsLow(Product p, int q) => p.ReorderLevel > 0 && q > 0 && q <= p.ReorderLevel;
        IEnumerable<Guid> chosen = qtyOf.Where(kv => kv.Value != 0).Select(kv => kv.Key);
        if (low || empty)
        {
            var candidates = empty
                ? products.Values.Where(p => p.IsActive && Passes(p)).Select(p => p.Id).Union(qtyOf.Keys)
                : qtyOf.Keys;
            chosen = candidates.Where(id =>
            {
                var q = qtyOf.GetValueOrDefault(id);
                return (low && IsLow(products[id], q)) || (empty && q <= 0);
            });
        }
        var keep = chosen.ToHashSet();
        lines = lines.Where(l => keep.Contains(l.Product)).ToList();

        long? Money(long v) => seeCosts ? v : null;
        var itemRows = Has(Permissions.ValuationItems)
            ? keep.Select(id =>
                {
                    var p = products[id];
                    var mineLines = lines.Where(l => l.Product == id).ToList();
                    var q = mineLines.Sum(l => l.Qty);
                    var v = mineLines.Sum(l => l.Value);
                    return new ValuationItemDto(id.ToString(), p.Sku, Loc.Name(p),
                        seeSuppliers ? p.Supplier?.Name : null, seeSuppliers ? p.Supplier?.Code : null,
                        q, Money(v), seeCosts && q != 0 ? v / q : null, seePrices ? p.SalePrice : null,
                        p.ReorderLevel, IsLow(p, q), q <= 0);
                })
                .OrderByDescending(r => r.Value ?? 0).ThenBy(r => r.Label).ToArray()
            : Array.Empty<ValuationItemDto>();
        // By department, the top of the tree (owner, 2026-10-19: "it's men's, not polo"); an item in no
        // department shows its group. With how many items each holds.
        string DepartmentOf(Guid id) => products[id].Category?.Department is { } dd
            ? Loc.Name(dd) : Loc.Name(products[id].Category);
        var categoryRows = Has(Permissions.ValuationDepartments)
            ? keep.GroupBy(DepartmentOf)
                .Select(g => new ValuationRowDto(g.Key, g.Key,
                    lines.Where(l => g.Contains(l.Product)).Sum(l => l.Qty),
                    Money(lines.Where(l => g.Contains(l.Product)).Sum(l => l.Value)), g.Count()))
                .OrderByDescending(r => r.Value ?? 0).ThenByDescending(r => r.Count).ToArray()
            : Array.Empty<ValuationRowDto>();
        var warehouseRows = Has(Permissions.ValuationWarehouses)
            ? lines.GroupBy(l => l.Warehouse)
                .Select(g => new ValuationRowDto(g.Key.ToString(), warehouses.GetValueOrDefault(g.Key, ""),
                    g.Sum(l => l.Qty), Money(g.Sum(l => l.Value)), g.Where(l => l.Qty != 0).Select(l => l.Product).Distinct().Count()))
                .OrderByDescending(r => r.Value ?? 0).ToArray()
            : Array.Empty<ValuationRowDto>();
        // Variants rolled up to their model (only items made in sizes/colors).
        var modelRows = Has(Permissions.ValuationItems)
            ? lines.Where(l => products[l.Product].Model is not null)
                .GroupBy(l => products[l.Product].ModelId!.Value)
                .Select(g => new ValuationRowDto(g.Key.ToString(), Loc.Name(products[g.First().Product].Model),
                    g.Sum(l => l.Qty), Money(g.Sum(l => l.Value)), g.Select(l => l.Product).Distinct().Count()))
                .Where(r => r.Quantity != 0)
                .OrderByDescending(r => r.Value ?? 0).ToArray()
            : Array.Empty<ValuationRowDto>();

        return Ok(new ValuationDto(
            date.ToString("yyyy-MM-dd"), await CurrencyAsync(), wid?.ToString(),
            lines.Sum(l => l.Qty), Money(lines.Sum(l => l.Value)), totalItems, keep.Count,
            categoryRows, itemRows, warehouseRows, modelRows));
    }

    /// <summary>
    /// A warehouse's statement (owner, 2026-10-19: كشف حساب for warehouses): every movement in or out
    /// of it between two company days, oldest first, with the pieces before and after; values only
    /// for people who may see costs.
    /// </summary>
    [HttpGet("warehouses/{id:guid}/statement")]
    public async Task<ActionResult<WarehouseStatementDto>> WarehouseStatement(Guid id, [FromQuery] string? from = null,
        [FromQuery] string? to = null)
    {
        var (wid, notFound) = await VisibleWarehouseAsync(id.ToString());
        if (notFound is not null) return notFound;
        var seeCosts = Costs.CanSee(User);
        var start = CompanyClock.StartOf(CompanyClock.ParseDay(from) ?? CompanyClock.Today);
        var end = CompanyClock.StartOf((CompanyClock.ParseDay(to) ?? CompanyClock.Today).AddDays(1));
        var all = _db.StockMovements.AsNoTracking().Where(m => m.WarehouseId == wid);
        var opening = await all.Where(m => m.CreatedAt < start).SumAsync(m => (int?)m.Quantity) ?? 0;
        var openingValue = seeCosts
            ? await all.Where(m => m.CreatedAt < start).SumAsync(m => (long?)m.Quantity * m.UnitCost) ?? 0 : 0;
        var rows = await all.Where(m => m.CreatedAt >= start && m.CreatedAt < end)
            .Include(m => m.Product).OrderBy(m => m.CreatedAt).ThenBy(m => m.Id).Take(5000).ToListAsync();
        // Where each movement came from or went to (owner, 2026-10-19): the customer or supplier on
        // its invoice or return, or the other warehouse on a transfer.
        var docIds = rows.Where(m => m.DocumentId != null).Select(m => m.DocumentId!.Value).Distinct().ToList();
        var parties = await _db.SalesDocuments.AsNoTracking().Where(d => docIds.Contains(d.Id))
            .Select(d => new { d.Id, Name = d.Party != null ? d.Party.Name : null })
            .ToDictionaryAsync(d => d.Id, d => d.Name);
        var transfers = await _db.StockTransfers.AsNoTracking().Where(t => docIds.Contains(t.Id))
            .Include(t => t.FromWarehouse).Include(t => t.ToWarehouse).ToDictionaryAsync(t => t.Id);
        string? Counterpart(StockMovement m)
        {
            if (m.DocumentId is not Guid d) return null;
            if (transfers.TryGetValue(d, out var t))
            {
                var other = m.Type == StockMovementType.TRANSFER_OUT ? t.ToWarehouse : t.FromWarehouse;
                return other is null ? null : Loc.Name(other);
            }
            return parties.GetValueOrDefault(d);
        }
        var balance = opening;
        var lines = rows.Select(m =>
        {
            balance += m.Quantity;
            return new WarehouseStatementLineDto(m.CreatedAt.ToString("O"), m.Type.ToString(), m.Reference,
                m.DocumentId?.ToString(), m.ProductId.ToString(), m.Product?.Sku ?? "",
                m.Product is null ? "" : Loc.Name(m.Product), m.Quantity,
                seeCosts ? m.Quantity * m.UnitCost : null, balance, m.Note, Counterpart(m));
        }).ToArray();
        var name = Loc.Name(await _db.Warehouses.AsNoTracking().FirstAsync(w => w.Id == wid));
        return Ok(new WarehouseStatementDto(name, await CurrencyAsync(), opening, seeCosts ? openingValue : null,
            rows.Where(m => m.Quantity > 0).Sum(m => m.Quantity), -rows.Where(m => m.Quantity < 0).Sum(m => m.Quantity),
            balance, seeCosts ? openingValue + rows.Sum(m => (long)m.Quantity * m.UnitCost) : null, lines));
    }

    /// <summary>
    /// Stocktake (الجرد) of one warehouse: post the counted quantity for each item. Only items whose
    /// count differs from that warehouse's books move; gains and shrinkage are valued at the current
    /// weighted-average cost. All lines share one ADJ- reference and commit together. The items are
    /// locked while posting so a sale can't slip in between reading the book quantity and writing
    /// the difference.
    /// </summary>
    [HttpPost("stocktake")]
    [Authorize(Policy = Permissions.InventoryStocktake)]
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


    private sealed record LifeRow(
        Guid DocumentId, string Number, DocumentType Type, DateTime IssueDate, string Party, int PartyCode,
        string? Warehouse, string Branch, string Staff, int Quantity, int UnitQuantity, string? Unit, long UnitPrice,
        int UnitFactor, long Discount, long DocDiscount, long LineTotal, long UnitCost, long LineProfit, bool IsBonus,
        bool Edited);
}
