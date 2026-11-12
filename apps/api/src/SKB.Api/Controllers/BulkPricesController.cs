using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// A supplier's prices at once (owner, 2026-11-10: "when the factory raises or lowers its price, and
/// the margin too"): pick a supplier, some or all of its items, and change the supply price (the
/// supplier's price at the default purchase level, what new purchases start from) by a percent or an
/// amount, and/or the selling price (the default sales level) by a percent, an amount, or from a
/// margin on the supply price, rounded up if asked. Preview shows old → new without saving; apply
/// saves it all in one go, logged. The average cost of the stock already held is not touched: it is
/// what was really paid, and new purchases move it. Supply prices only for whoever may see them.
/// </summary>
[ApiController]
[Route("api/prices/bulk")]
[AnyPermission(Permissions.PricesBulkEdit)]
public sealed class BulkPricesController : ControllerBase
{
    private const int MaxItems = 1000;
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public BulkPricesController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    /// <summary>The supplier's open items, with their supply and selling prices now.</summary>
    [HttpGet("items")]
    public async Task<ActionResult<BulkPriceItemDto[]>> Items([FromQuery] string? supplierId = null,
        [FromQuery] string? departmentId = null, [FromQuery] string? groupId = null,
        [FromQuery] string? seasonId = null, [FromQuery] string? search = null)
    {
        if (!Guid.TryParse(supplierId, out var sup))
            return BadRequest(new { message = "Choose a supplier.", code = "supplier_not_found" });
        var q = _db.Products.AsNoTracking().Where(p => p.IsActive && p.SupplierId == sup);
        if (Guid.TryParse(departmentId, out var dept)) q = q.Where(p => p.Category!.DepartmentId == dept);
        if (Guid.TryParse(groupId, out var gid))
        {
            var under = Catalog.Subtree(gid, await _db.Categories.AsNoTracking().ToListAsync()).ToList();
            q = q.Where(p => under.Contains(p.CategoryId));
        }
        if (Guid.TryParse(seasonId, out var season)) q = q.Where(p => p.SeasonId == season);
        if (Access.Departments(User) is { } mine)
            q = q.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            q = q.Where(p => p.Sku.ToLower().Contains(s) || p.Name.ToLower().Contains(s)
                             || (p.SupplierCode != null && p.SupplierCode.ToLower().Contains(s)));
        }
        var products = await q.Include(p => p.Category).ThenInclude(c => c!.Department).Include(p => p.Season)
            .OrderBy(p => p.Name).Take(MaxItems).ToListAsync();
        var book = await PriceBook.LoadAsync(_db, products.Select(p => p.Id));
        var (sale, buy) = (book.DefaultLevel(PriceSide.SALE), book.DefaultLevel(PriceSide.PURCHASE));
        var seeSupply = Costs.CanSeePurchasePrices(User);
        var seeCosts = Costs.CanSee(User);
        return Ok(products.Select(p =>
        {
            var unit = book.BaseOf(p.Id);
            return new BulkPriceItemDto(p.Id.ToString(), p.Sku, Loc.Name(p), p.SupplierCode,
                p.Category?.Department is { } d ? Loc.Name(d) : null,
                p.Category is { IsRoot: false } c ? Loc.Name(c) : null,
                p.Season is { } se ? Seasons.NameOf(se) : null, Loc.Name(unit?.Unit), p.StockOnHand,
                seeSupply && unit is not null && buy is not null ? book.Effective(p.Id, unit.UnitId, buy.Id).Price : null,
                unit is not null && sale is not null ? book.Effective(p.Id, unit.UnitId, sale.Id).Price : null,
                seeCosts ? p.CostPrice : null);
        }).ToArray());
    }

    /// <summary>What the change would make of each item, saving nothing.</summary>
    [HttpPost("preview")]
    public async Task<ActionResult<BulkPriceResultDto>> Preview([FromBody] BulkPriceRequest req)
    {
        var (plan, error) = await PlanAsync(req);
        if (error is not null) return error;
        return Ok(new BulkPriceResultDto(plan!.Rows.Count(r => r.Changed), plan.Rows.ToArray()));
    }

    /// <summary>Make the change, all items together, and log it.</summary>
    [HttpPost("apply")]
    public async Task<ActionResult<BulkPriceResultDto>> Apply([FromBody] BulkPriceRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var (plan, error) = await PlanAsync(req);
        if (error is not null) return error;
        var existing = await _db.ItemPrices.Where(p => plan!.Ids.Contains(p.ProductId)).ToListAsync();
        foreach (var (pid, unit, level, price) in plan!.Writes)
        {
            var row = existing.FirstOrDefault(e => e.ProductId == pid && e.UnitId == unit && e.PriceLevelId == level);
            if (row is null)
                _db.ItemPrices.Add(new ItemPrice { ProductId = pid, UnitId = unit, PriceLevelId = level, Price = price });
            else if (row.Price != price)
            {
                row.Price = price;
                row.UpdatedAt = DateTime.UtcNow;
            }
        }
        await _db.SaveChangesAsync();
        var changed = plan.Rows.Where(r => r.Changed).ToList();
        await PriceBook.SyncListPricesAsync(_db, changed.Select(r => Guid.Parse(r.Id)).ToList());
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        string Money(long? v) => v is null ? "—" : (v.Value / 100m).ToString("0.##");
        var ip = Request.HttpContext.Connection.RemoteIpAddress?.ToString();
        var ua = Request.Headers.UserAgent.ToString();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "bulk_prices", "product",
            CurrentUser.BranchId(User), ip, ua, req.SupplierId, $"{changed.Count} · {plan.Summary}");
        foreach (var r in changed)
            await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "prices", "product",
                CurrentUser.BranchId(User), ip, ua, r.Id,
                $"{r.Sku}: {Money(r.SupplyBefore)} → {Money(r.SupplyAfter)} · {Money(r.SaleBefore)} → {Money(r.SaleAfter)}");
        return Ok(new BulkPriceResultDto(changed.Count, plan.Rows.ToArray()));
    }

    private sealed record Plan(List<Guid> Ids, List<BulkPriceRowDto> Rows,
        List<(Guid Product, Guid Unit, Guid Level, long Price)> Writes, string Summary);

    private async Task<(Plan? Plan, ActionResult? Error)> PlanAsync(BulkPriceRequest req)
    {
        ActionResult Bad(string code, string message) => BadRequest(new { message, code });
        var ids = (req.ProductIds ?? Array.Empty<string>()).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty).Distinct().ToList();
        if (ids.Count == 0) return (null, Bad("no_items", "Choose the items."));
        if (ids.Count > MaxItems) return (null, Bad("too_many_items", $"At most {MaxItems} items at once."));
        var supply = req.Supply is { Value: not 0 } ? req.Supply : null;
        var sale = req.Sale is { Value: not 0 } || req.Sale?.Mode == "margin" ? req.Sale : null;
        if (supply is null && sale is null) return (null, Bad("no_change", "Say how the prices change."));
        if (supply is not null && supply.Mode is not ("pct" or "amt"))
            return (null, Bad("bad_change", "Change the supply price by a percent or an amount."));
        if (sale is not null && sale.Mode is not ("pct" or "amt" or "margin"))
            return (null, Bad("bad_change", "Change the selling price by a percent, an amount or a margin."));
        if ((supply?.Mode == "pct" && supply.Value <= -100) || (sale?.Mode == "pct" && sale.Value <= -100)
            || (sale?.Mode == "margin" && (sale.Value < -99 || sale.Value > 10000))
            || Math.Abs(supply?.Value ?? 0) > 1_000_000 || Math.Abs(sale?.Value ?? 0) > 1_000_000)
            return (null, Bad("bad_change", "That change is out of range."));
        // The supply price and a margin on it sit close to cost: only for whoever may see them.
        if ((supply is not null || sale?.Mode == "margin") && !Costs.CanSeePurchasePrices(User))
            return (null, (ActionResult)StatusCode(403, new { message = "Supply prices need permission.", code = "costs_not_allowed" }));
        var round = Math.Clamp(req.Round, 0, 100) * 100L;

        var q = _db.Products.AsNoTracking().Where(p => ids.Contains(p.Id) && p.IsActive);
        if (Guid.TryParse(req.SupplierId, out var sup)) q = q.Where(p => p.SupplierId == sup);
        if (Access.Departments(User) is { } mine)
            q = q.Where(p => p.Category!.DepartmentId == null || mine.Contains(p.Category.DepartmentId.Value));
        var products = await q.OrderBy(p => p.Name).ToListAsync();
        if (products.Count != ids.Count) return (null, Bad("product_not_found", "An item was not found."));

        var book = await PriceBook.LoadAsync(_db, ids);
        var saleLevel = book.DefaultLevel(PriceSide.SALE);
        var buyLevel = book.DefaultLevel(PriceSide.PURCHASE);
        if ((sale is not null && saleLevel is null) || (supply is not null && buyLevel is null))
            return (null, Bad("price_level_not_found", "There is no default price level."));

        static long Clamp(decimal v) => (long)Math.Clamp(Math.Round(v, MidpointRounding.AwayFromZero), 0, InvoiceLines.MaxPrice);
        long Changed(long old, BulkPriceChange c, int factor) => c.Mode switch
        {
            "pct" => Clamp(old * (100 + c.Value) / 100m),
            _ => Clamp(old + c.Value * 100m * factor),
        };
        long Rounded(long v) => round > 0 ? Math.Min(InvoiceLines.MaxPrice, (v + round - 1) / round * round) : v;

        var rows = new List<BulkPriceRowDto>();
        var writes = new List<(Guid, Guid, Guid, long)>();
        foreach (var p in products)
        {
            long? supplyBase0 = null, supplyBase1 = null, saleBase0 = null, saleBase1 = null;
            foreach (var u in book.UnitsOf(p.Id))
            {
                var isBase = u.Factor == 1;
                long? buyOld = buyLevel is null ? null : book.Effective(p.Id, u.UnitId, buyLevel.Id).Price;
                var buyNew = buyOld;
                // A larger unit without a supply price of its own follows its base unit's.
                if (!isBase && supply is not null && supplyBase1 is long nb && buyLevel is not null
                    && book.OwnPrice(p.Id, u.UnitId, buyLevel.Id) is null)
                    buyNew = nb * u.Factor;
                // A larger unit follows its base unit unless it has a price of its own.
                if (supply is not null && buyOld is long bo
                    && (isBase || book.OwnPrice(p.Id, u.UnitId, buyLevel!.Id) is not null))
                {
                    buyNew = Changed(bo, supply, u.Factor);
                    writes.Add((p.Id, u.UnitId, buyLevel!.Id, buyNew.Value));
                }

                long? saleOld = saleLevel is null ? null : book.Effective(p.Id, u.UnitId, saleLevel.Id).Price;
                long? saleNew = saleOld;
                if (sale is not null && saleLevel is not null
                    && (isBase || book.OwnPrice(p.Id, u.UnitId, saleLevel.Id) is not null))
                {
                    saleNew = sale.Mode == "margin"
                        ? buyNew is long cost ? Rounded(Clamp(cost * (100 + sale.Value) / 100m)) : null
                        : saleOld is long so ? Rounded(Changed(so, sale, u.Factor)) : null;
                    if (saleNew is long sn) writes.Add((p.Id, u.UnitId, saleLevel.Id, sn));
                    else saleNew = saleOld;
                }
                if (isBase) (supplyBase0, supplyBase1, saleBase0, saleBase1) = (buyOld, buyNew, saleOld, saleNew);
            }
            var seeSupply = Costs.CanSeePurchasePrices(User);
            rows.Add(new BulkPriceRowDto(p.Id.ToString(), p.Sku, Loc.Name(p),
                seeSupply ? supplyBase0 : null, seeSupply ? supplyBase1 : null, saleBase0, saleBase1,
                supplyBase0 != supplyBase1 || saleBase0 != saleBase1));
        }
        string Rule(BulkPriceChange? c, string what) => c is null ? "" : c.Mode switch
        {
            "pct" => $"{what} {c.Value:+0.##;-0.##}% ",
            "amt" => $"{what} {c.Value:+0.##;-0.##} ",
            _ => $"{what} margin {c.Value:0.##}% ",
        };
        var summary = (Rule(supply, "supply") + Rule(sale, "sale") + (round > 0 ? $"round {req.Round}" : "")).Trim();
        return (new Plan(ids, rows, writes, summary), null);
    }
}
