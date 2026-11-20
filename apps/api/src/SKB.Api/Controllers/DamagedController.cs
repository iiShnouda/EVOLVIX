using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Damaged goods (owner, 2026-11-18): what customers brought back damaged sits in each branch's
/// damaged warehouse at cost, not for sale, until it is repaired (moved back to a store of the
/// branch), written off (to the damaged goods loss) or sent back to its supplier through a purchase
/// return from that warehouse. The list shows them by supplier for the claims. Scoped to the
/// person's branches; every move is audited.
/// </summary>
[ApiController]
[Route("api/inventory/damaged")]
[Authorize]
public sealed class DamagedController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly LedgerService _ledger;
    private readonly AuditService _audit;

    public DamagedController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        LedgerService ledger, AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _ledger = ledger;
        _audit = audit;
    }

    /// <summary>
    /// Damaged goods held now, warehouse by warehouse, each with its item's supplier; cost and value
    /// only for who may see costs.
    /// </summary>
    [HttpGet]
    [AnyPermission(Permissions.DamagedView, Permissions.DamagedRepair, Permissions.ReturnsWriteOff)]
    public async Task<ActionResult<DamagedRowDto[]>> List([FromQuery] string? branchId, [FromQuery] string? supplierId)
    {
        var places = _warehouses.Visible(User).Where(w => w.Kind == WarehouseKind.DAMAGED);
        if (Guid.TryParse(branchId, out var bid)) places = places.Where(w => w.BranchId == bid);
        var q = _db.StockBalances.AsNoTracking().Where(b => b.Quantity > 0 && places.Any(w => w.Id == b.WarehouseId));
        if (supplierId == "none") q = q.Where(b => b.Product!.SupplierId == null);
        else if (Guid.TryParse(supplierId, out var sid)) q = q.Where(b => b.Product!.SupplierId == sid);
        var rows = await q.Select(b => new
        {
            b.WarehouseId, b.Warehouse!.BranchId, b.ProductId, b.Product!.Sku, b.Product.Name, b.Quantity,
            b.Product.SupplierId, SupplierName = b.Product.Supplier != null ? b.Product.Supplier.Name : null,
            SupplierCode = b.Product.Supplier != null ? (int?)b.Product.Supplier.Code : null,
        }).ToListAsync();
        var warehouseIds = rows.Select(r => r.WarehouseId).Distinct().ToList();
        var warehouses = await _db.Warehouses.AsNoTracking().Include(w => w.Branch)
            .Where(w => warehouseIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id);
        var productIds = rows.Select(r => r.ProductId).Distinct().ToList();
        var costs = await _db.StockCosts.AsNoTracking().Where(c => productIds.Contains(c.ProductId))
            .ToDictionaryAsync(c => (c.ProductId, c.PoolId), c => c.AvgCost);
        var seesCost = Costs.CanSee(User);
        return Ok(rows
            .Select(r =>
            {
                var w = warehouses[r.WarehouseId];
                var cost = costs.GetValueOrDefault((r.ProductId, InventoryService.PoolOf(w)));
                return new DamagedRowDto(w.Id.ToString(), Loc.Name(w), w.BranchId.ToString(), Loc.Name(w.Branch),
                    r.ProductId.ToString(), r.Sku, r.Name, r.Quantity, r.SupplierId?.ToString(), r.SupplierName,
                    r.SupplierCode, seesCost ? cost : null, seesCost ? cost * r.Quantity : null);
            })
            .OrderBy(r => r.SupplierName ?? "￿").ThenBy(r => r.BranchName).ThenBy(r => r.Name).ToArray());
    }

    /// <summary>Repaired goods go back from the damaged warehouse to a store of the same branch (same cost pool).</summary>
    [HttpPost("repair")]
    [Authorize(Policy = Permissions.DamagedRepair)]
    public Task<ActionResult<DamagedMoveDto>> Repair([FromBody] DamagedMoveRequest req) => MoveAsync(req, repair: true);

    /// <summary>Damaged goods written off: out of the damaged warehouse at the branch's cost, to the damaged goods loss.</summary>
    [HttpPost("write-off")]
    [Authorize(Policy = Permissions.ReturnsWriteOff)]
    public Task<ActionResult<DamagedMoveDto>> WriteOff([FromBody] DamagedMoveRequest req) => MoveAsync(req, repair: false);

    private async Task<ActionResult<DamagedMoveDto>> MoveAsync(DamagedMoveRequest req, bool repair)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Choose at least one item.", code = "no_lines" });
        if (req.Lines.Length > InvoiceLines.MaxLines)
            return BadRequest(new { message = $"At most {InvoiceLines.MaxLines} lines.", code = "too_many_lines" });
        if (!Guid.TryParse(req.WarehouseId, out var fromId))
            return NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" });
        var from = await _warehouses.Visible(User).FirstOrDefaultAsync(w => w.Id == fromId && w.Kind == WarehouseKind.DAMAGED);
        if (from is null) return NotFound(new { message = "Warehouse not found.", code = "warehouse_not_found" });
        Warehouse? to = null;
        if (repair)
        {
            to = Guid.TryParse(req.ToWarehouseId, out var toId)
                ? await _warehouses.Visible(User).FirstOrDefaultAsync(w => w.Id == toId && w.Kind == WarehouseKind.STORE && w.IsActive)
                : await _warehouses.DefaultForBranchAsync(from.BranchId);
            if (to is null || to.BranchId != from.BranchId || !WarehouseService.CanUse(User, to))
                return BadRequest(new { message = "Choose a store of the same branch.", code = "warehouse_not_found" });
        }
        var wanted = new List<(Guid ProductId, int Quantity)>();
        foreach (var l in req.Lines)
        {
            if (!Guid.TryParse(l.ProductId, out var pid))
                return BadRequest(new { message = "An item was not found.", code = "product_not_found" });
            if (l.Quantity <= 0 || l.Quantity > InvoiceLines.MaxQuantity)
                return BadRequest(new { message = "Enter a quantity for every item.", code = "bad_qty" });
            wanted.Add((pid, l.Quantity));
        }
        // An item on several lines: no more than one line may hold (summed wide, so it can't overflow).
        if (wanted.GroupBy(w => w.ProductId).Any(g => g.Sum(x => (long)x.Quantity) > InvoiceLines.MaxQuantity))
            return BadRequest(new
            {
                message = $"At most {InvoiceLines.MaxQuantity:N0} of an item at once.", code = "bad_qty",
            });
        var notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim()[..Math.Min(300, req.Notes.Trim().Length)];
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        await using var tx = await _db.Database.BeginTransactionAsync();
        var number = await DocumentNumbers.NextDamagedAsync(_db);
        var products = await _inventory.LockProductsAsync(wanted.Select(w => w.ProductId));
        long value = 0;
        foreach (var g in wanted.GroupBy(w => w.ProductId))
        {
            if (!products.TryGetValue(g.Key, out var product))
                return BadRequest(new { message = "An item was not found.", code = "product_not_found" });
            var qty = g.Sum(x => x.Quantity);
            var held = _inventory.Available(g.Key, from.Id);
            if (qty > held)
                return BadRequest(new
                {
                    message = $"{product.Name}: {held} damaged in {Loc.Name(from)}, {qty} asked.", code = "insufficient_stock",
                });
            if (repair) _inventory.Relocate(product, from, to!, qty, Guid.Empty, number, note: notes);
            else value += (long)qty * _inventory.Issue(product, from, qty, StockMovementType.DAMAGED_WRITE_OFF, null, number);
        }
        if (!repair) await _ledger.PostDamagedWriteOffAsync(null, number, from.BranchId, value, staffId);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), repair ? "repair" : "write_off",
            "damaged_goods", from.BranchId.ToString(), HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), from.Id.ToString(),
            $"{number} · {wanted.Sum(w => w.Quantity)}{(repair ? $" → {to!.Name}" : "")}{(notes is null ? "" : $" · {notes}")}");
        return Ok(new DamagedMoveDto(number, wanted.Sum(w => w.Quantity), Costs.CanSee(User) ? value : null));
    }
}
