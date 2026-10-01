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
/// Transfer permits (إذن تحويل): move goods between warehouses, across branches too.
/// Sending takes the goods out of the source into the system "In transit" warehouse; the
/// destination confirms receipt to take them in (or, when the company switches receipt off,
/// they arrive at once). A permit still in transit can be cancelled, which returns the goods to
/// the source. Stock value and average cost never change on a transfer — only where units sit.
///
/// Who may do what: sending needs inventory:edit on a source warehouse the user can use;
/// receiving needs it on the destination; cancelling on the source. Branch-scoped users see the
/// permits that touch their branch.
/// </summary>
[ApiController]
[Route("api/transfers")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class TransfersController : ControllerBase
{
    private const int MaxLines = 500;

    private readonly AppDbContext _db;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;
    private readonly AuditService _audit;

    public TransfersController(AppDbContext db, InventoryService inventory, WarehouseService warehouses,
        AuditService audit)
    {
        _db = db;
        _inventory = inventory;
        _warehouses = warehouses;
        _audit = audit;
    }

    /// <summary>
    /// Permits, newest first. Filters: status, a warehouse on either end, an item on any line,
    /// and a sent-date range (ISO dates, inclusive).
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<PaginatedDto<StockTransferDto>>> List(
        [FromQuery] string? status = null, [FromQuery] string? warehouseId = null,
        [FromQuery] string? productId = null, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = Scoped();
        if (Enum.TryParse<TransferStatus>(status, out var st)) q = q.Where(t => t.Status == st);
        if (Guid.TryParse(warehouseId, out var wid)) q = q.Where(t => t.FromWarehouseId == wid || t.ToWarehouseId == wid);
        if (Guid.TryParse(productId, out var pid)) q = q.Where(t => t.Lines.Any(l => l.ProductId == pid));
        if (CompanyClock.ParseDay(from) is DateOnly f)
        {
            var start = CompanyClock.StartOf(f);
            q = q.Where(t => t.CreatedAt >= start);
        }
        if (CompanyClock.ParseDay(to) is DateOnly tDay)
        {
            var end = CompanyClock.StartOf(tDay.AddDays(1));
            q = q.Where(t => t.CreatedAt < end);
        }

        var total = await q.CountAsync();
        var rows = await WithDetails(q).OrderByDescending(t => t.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var access = await AccessAsync();
        return Ok(new PaginatedDto<StockTransferDto>(rows.Select(t => ToDto(t, access)).ToArray(), total, page, pageSize));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<StockTransferDto>> Get(Guid id)
    {
        var transfer = await WithDetails(Scoped()).FirstOrDefaultAsync(t => t.Id == id);
        if (transfer is null) return NotFound(new { message = "Transfer not found.", code = "not_found" });
        return Ok(ToDto(transfer, await AccessAsync()));
    }

    /// <summary>Send goods: out of the source warehouse, into transit (or straight in, if receipt is off).</summary>
    [HttpPost]
    [Authorize(Policy = Permissions.InventoryTransfer)]
    public async Task<ActionResult<StockTransferDto>> Create([FromBody] CreateTransferRequest req)
    {
        if (req.Lines is null || req.Lines.Length == 0)
            return BadRequest(new { message = "Add at least one item.", code = "no_lines" });
        if (req.Lines.Length > MaxLines)
            return BadRequest(new { message = $"At most {MaxLines} items per transfer.", code = "too_many_lines" });

        var (source, sourceError) = await _warehouses.ResolveAsync(User, req.FromWarehouseId);
        if (sourceError is not null) return BadRequest(new { message = sourceError.Message, code = sourceError.Code });
        var destination = Guid.TryParse(req.ToWarehouseId, out var toId)
            ? await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == toId && w.Kind == WarehouseKind.STORE)
            : null;
        if (destination is null)
            return BadRequest(new { message = "Choose where the goods are going.", code = "destination_not_found" });
        if (!destination.IsActive)
            return BadRequest(new { message = $"{Loc.Name(destination)} is closed.", code = "warehouse_inactive" });
        if (destination.Id == source!.Id)
            return BadRequest(new { message = "Source and destination must be different warehouses.", code = "same_warehouse" });

        var wanted = new Dictionary<Guid, int>();
        foreach (var line in req.Lines)
        {
            if (!Guid.TryParse(line.ProductId, out var pid))
                return BadRequest(new { message = "An item on the transfer was not found.", code = "product_not_found" });
            if (line.Quantity <= 0)
                return BadRequest(new { message = "Quantities must be positive.", code = "bad_qty" });
            if (!wanted.TryAdd(pid, line.Quantity))
                return BadRequest(new { message = "An item is listed twice.", code = "duplicate_line" });
        }

        var notes = req.Notes?.Trim();
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        Guid.TryParse(CurrentUser.Id(User), out var staffId);

        await using var tx = await _db.Database.BeginTransactionAsync();
        var products = await _inventory.LockProductsAsync(wanted.Keys);
        foreach (var (pid, qty) in wanted)
        {
            if (!products.TryGetValue(pid, out var product) || !product.IsActive)
                return BadRequest(new { message = "An item on the transfer was not found.", code = "product_not_found" });
            var available = _inventory.Available(pid, source.Id);
            if (qty > available)
                return BadRequest(new
                {
                    message = $"Not enough {Loc.Name(product)} in {Loc.Name(source)}: {available} left, {qty} requested.",
                    code = "insufficient_stock",
                });
        }

        var transit = await _warehouses.TransitAsync();
        var transfer = new StockTransfer
        {
            Number = await DocumentNumbers.NextTransferAsync(_db),
            FromWarehouseId = source.Id, ToWarehouseId = destination.Id,
            Notes = string.IsNullOrEmpty(notes) ? null : notes[..Math.Min(1000, notes.Length)],
            CreatedById = staffId,
        };
        foreach (var line in req.Lines)
        {
            var product = products[Guid.Parse(line.ProductId)];
            var unitCost = _inventory.Relocate(product, source, transit, line.Quantity, transfer.Id, transfer.Number);
            transfer.Lines.Add(new StockTransferLine
            {
                LineNo = transfer.Lines.Count + 1, ProductId = product.Id, ProductName = product.Name,
                Quantity = line.Quantity, UnitCost = unitCost,
            });
        }

        // Receipt switched off: the goods arrive the moment they are sent.
        if (!settings.TransfersRequireReceipt)
        {
            foreach (var line in transfer.Lines)
                _inventory.Relocate(products[line.ProductId], transit, destination, line.Quantity, transfer.Id,
                    transfer.Number, line.UnitCost);
            transfer.Status = TransferStatus.RECEIVED;
            transfer.ReceivedById = staffId;
            transfer.ReceivedAt = DateTime.UtcNow;
        }

        _db.StockTransfers.Add(transfer);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync("create", transfer, source.BranchId);
        return Created($"/api/transfers/{transfer.Id}", await LoadDtoAsync(transfer.Id));
    }

    /// <summary>The destination confirms the goods arrived: from transit into the destination warehouse.</summary>
    [HttpPost("{id:guid}/receive")]
    [Authorize(Policy = Permissions.InventoryTransfer)]
    public Task<ActionResult<StockTransferDto>> Receive(Guid id) => FinishAsync(id, receive: true);

    /// <summary>Call a transfer back before it is received: from transit back into the source.</summary>
    [HttpPost("{id:guid}/cancel")]
    [Authorize(Policy = Permissions.InventoryTransfer)]
    public Task<ActionResult<StockTransferDto>> Cancel(Guid id) => FinishAsync(id, receive: false);

    private async Task<ActionResult<StockTransferDto>> FinishAsync(Guid id, bool receive)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();

        // Lock the permit so receive and cancel can't both win.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"StockTransfers\" WHERE \"Id\" = {id} FOR UPDATE");
        var transfer = await _db.StockTransfers.Include(t => t.Lines)
            .Include(t => t.FromWarehouse).Include(t => t.ToWarehouse)
            .FirstOrDefaultAsync(t => t.Id == id);
        if (transfer is null) return NotFound(new { message = "Transfer not found.", code = "not_found" });

        // Receiving is done at the destination; cancelling at the source.
        var side = receive ? transfer.ToWarehouseId : transfer.FromWarehouseId;
        if (!await _warehouses.Visible(User).AnyAsync(w => w.Id == side))
            return NotFound(new { message = "Transfer not found.", code = "not_found" });
        if (transfer.Status != TransferStatus.SENT)
            return BadRequest(new
            {
                message = $"{transfer.Number} is already {transfer.Status.ToString().ToLowerInvariant()}.",
                code = "not_in_transit",
            });

        var target = receive ? transfer.ToWarehouse! : transfer.FromWarehouse!;
        var transit = await _warehouses.TransitAsync();
        var products = await _inventory.LockProductsAsync(transfer.Lines.Select(l => l.ProductId));
        foreach (var line in transfer.Lines.OrderBy(l => l.LineNo))
            // The goods arrive (or come back) at exactly the cost they left with.
            _inventory.Relocate(products[line.ProductId], transit, target, line.Quantity, transfer.Id, transfer.Number,
                line.UnitCost, receive ? null : "Cancelled");

        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        if (receive)
        {
            transfer.Status = TransferStatus.RECEIVED;
            transfer.ReceivedById = staffId;
            transfer.ReceivedAt = DateTime.UtcNow;
        }
        else
        {
            transfer.Status = TransferStatus.CANCELLED;
            transfer.CancelledById = staffId;
            transfer.CancelledAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        await AuditAsync(receive ? "receive" : "cancel", transfer, target.BranchId);
        return Ok(await LoadDtoAsync(transfer.Id));
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>Permits the user may see: all, or those with either end in a warehouse of theirs.</summary>
    private IQueryable<StockTransfer> Scoped()
    {
        var q = _db.StockTransfers.AsNoTracking();
        if (Unlimited()) return q;
        var mine = _warehouses.Visible(User).Where(w => w.Kind == WarehouseKind.STORE).Select(w => w.Id);
        return q.Where(t => mine.Contains(t.FromWarehouseId) || mine.Contains(t.ToWarehouseId));
    }

    /// <summary>Sees every branch and every warehouse.</summary>
    private bool Unlimited() => Access.AllBranches(User) && Access.Warehouses(User) is null;

    private static IQueryable<StockTransfer> WithDetails(IQueryable<StockTransfer> q) => q
        .Include(t => t.Lines)
        .Include(t => t.FromWarehouse).ThenInclude(w => w!.Branch)
        .Include(t => t.ToWarehouse).ThenInclude(w => w!.Branch)
        .Include(t => t.CreatedBy).Include(t => t.ReceivedBy).Include(t => t.CancelledBy);

    private async Task<StockTransferDto> LoadDtoAsync(Guid id)
    {
        _db.ChangeTracker.Clear();
        var transfer = await WithDetails(_db.StockTransfers.AsNoTracking()).FirstAsync(t => t.Id == id);
        return ToDto(transfer, await AccessAsync());
    }

    /// <summary>Warehouses the user may act on (null = every warehouse), for CanReceive/CanCancel.</summary>
    private async Task<HashSet<Guid>?> AccessAsync()
    {
        if (!User.HasClaim("permission", Permissions.InventoryEdit)) return new HashSet<Guid>();
        if (Unlimited()) return null;
        return (await _warehouses.Visible(User).Select(w => w.Id).ToListAsync()).ToHashSet();
    }

    /// <summary>A transfer; its cost value only for people who may see costs.</summary>
    private StockTransferDto ToDto(StockTransfer t, HashSet<Guid>? access)
    {
        bool May(Guid warehouseId) => access is null || access.Contains(warehouseId);
        var inTransit = t.Status == TransferStatus.SENT;
        var lines = t.Lines.OrderBy(l => l.LineNo)
            .Select(l => new StockTransferLineDto(l.Id.ToString(), l.ProductId.ToString(), l.ProductName,
                l.Quantity, l.UnitCost, (long)l.Quantity * l.UnitCost))
            .ToArray();
        return Costs.Guard(User, new StockTransferDto(
            t.Id.ToString(), t.Number, t.Status.ToString(),
            t.FromWarehouseId.ToString(), Loc.Name(t.FromWarehouse), Loc.Name(t.FromWarehouse?.Branch),
            t.ToWarehouseId.ToString(), Loc.Name(t.ToWarehouse), Loc.Name(t.ToWarehouse?.Branch),
            t.CreatedAt.ToString("o"), t.CreatedBy?.FullName ?? "",
            t.ReceivedAt?.ToString("o"), t.ReceivedBy?.FullName, t.CancelledAt?.ToString("o"), t.CancelledBy?.FullName,
            t.Notes, lines.Sum(l => l.Quantity), lines.Sum(l => l.Value), lines,
            inTransit && May(t.ToWarehouseId), inTransit && May(t.FromWarehouseId)));
    }

    private Task AuditAsync(string action, StockTransfer t, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "stock_transfer",
            branchId.ToString(), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), t.Id.ToString());
}
