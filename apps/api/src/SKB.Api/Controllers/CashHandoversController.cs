using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Cash sent up between boxes (owner, 2026-10-02): a warehouse's box hands its cash to the branch's
/// box, a branch's box to the company's main box. Whoever holds the box sends it; the money stays in
/// the box (held, not to be spent) until someone who holds the receiving box confirms it arrived —
/// then it moves as a transfer voucher. Either side may call it off before then. A manager who may
/// use both boxes can also just move the money (cash:transfer) without asking.
/// </summary>
[ApiController]
[Route("api")]
[Authorize]
public sealed class CashHandoversController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly MoneyService _money;
    private readonly AuditService _audit;
    private readonly LedgerService _ledger;
    private readonly NotificationService _notify;

    public CashHandoversController(AppDbContext db, MoneyService money, AuditService audit, LedgerService ledger,
        NotificationService notify)
    {
        _db = db;
        _money = money;
        _audit = audit;
        _ledger = ledger;
        _notify = notify;
    }

    private bool Can(string permission) => User.HasClaim("permission", permission);

    /// <summary>
    /// Cash sent from or to the boxes the person may use, newest first. <paramref name="status"/>:
    /// SENT (on its way), RECEIVED, CANCELLED; <paramref name="side"/>: "in" (to my boxes) or "out".
    /// </summary>
    [HttpGet("cash-handovers")]
    public async Task<ActionResult<CashHandoverDto[]>> List([FromQuery] string? status = null, [FromQuery] string? side = null)
    {
        if (!Can(Permissions.CashHandoverSend) && !Can(Permissions.CashHandoverReceive) && !Can(Permissions.ReceiptsView))
            return Forbid();
        var mine = _money.Visible(User).Select(a => a.Id);
        var q = Query();
        q = side switch
        {
            "in" => q.Where(h => mine.Contains(h.ToAccountId)),
            "out" => q.Where(h => mine.Contains(h.FromAccountId)),
            _ => q.Where(h => mine.Contains(h.ToAccountId) || mine.Contains(h.FromAccountId)),
        };
        if (Enum.TryParse<HandoverStatus>(status, true, out var st)) q = q.Where(h => h.Status == st);
        var rows = await q.OrderByDescending(h => h.SentAt).Take(500).ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(rows.Select(h => ToDto(h, currency)).ToArray());
    }

    /// <summary>
    /// The cash boxes the person may send cash up from, with where each one goes (a store keeper may
    /// not see the money pages, so this is their list).
    /// </summary>
    [HttpGet("cash-handovers/boxes")]
    [Authorize(Policy = Permissions.CashHandoverSend)]
    public async Task<ActionResult<MoneyAccountDto[]>> Boxes()
    {
        var rows = await _money.Visible(User).AsNoTracking().Include(a => a.Branch).Include(a => a.Custodian)
            .Include(a => a.Warehouse).Where(a => a.IsActive)
            .OrderBy(a => a.Branch!.CreatedAt).ThenBy(a => a.WarehouseId == null).ThenBy(a => a.Name).ToListAsync();
        var up = await _money.UpTargetsAsync();
        return Ok(rows.Select(a => (a, to: up(a))).Where(x => x.to is not null)
            .Select(x => MoneyController.ToDto(x.a, x.to)).ToArray());
    }

    /// <summary>Send a box's cash up to the next box (it stays held there until confirmed).</summary>
    [HttpPost("cash-handovers")]
    [Authorize(Policy = Permissions.CashHandoverSend)]
    public async Task<ActionResult<CashHandoverDto>> Send([FromBody] SendCashRequest req)
    {
        if (!Guid.TryParse(req.FromAccountId, out var fromId)) return Bad("account_not_found", "Choose the cash box.");
        if (req.Amount <= 0 || req.Amount > InvoiceLines.MaxPrice) return Bad("bad_amount", "Enter an amount above zero.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var locked = await _money.LockAsync(new[] { fromId });
        if (!locked.TryGetValue(fromId, out var from) || !from.IsActive || !MoneyService.CanUse(User, from))
            return Bad("account_not_found", "Money account not found.");
        var up = (await _money.UpTargetsAsync())(from);
        if (up is null) return Bad("nowhere_to_send", "This box has no box above it to send its cash to.");
        if (from.Balance - from.Held < req.Amount)
            return Bad("insufficient_funds",
                $"{Loc.Name(from)} has {(from.Balance - from.Held) / 100m:0.00} to send.");
        from.Held += req.Amount;
        var handover = new CashHandover
        {
            Number = await DocumentNumbers.NextHandoverAsync(_db), FromAccountId = from.Id, ToAccountId = up.Value.Id,
            Amount = req.Amount, Notes = Text(req.Notes, 500), SentById = Me(),
        };
        _db.CashHandovers.Add(handover);
        var to = await _db.MoneyAccounts.AsNoTracking().FirstAsync(a => a.Id == up.Value.Id);
        await _notify.CashSentAsync(handover, from, to, User);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("send", handover.Id, from.BranchId);
        return Created($"/api/cash-handovers/{handover.Id}", await DtoAsync(handover.Id));
    }

    /// <summary>The cash arrived: it moves from the sending box into this one as a transfer voucher.</summary>
    [HttpPost("cash-handovers/{id:guid}/receive")]
    [Authorize(Policy = Permissions.CashHandoverReceive)]
    public async Task<ActionResult<CashHandoverDto>> Receive(Guid id)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var handover = await LockAsync(id);
        if (handover is null) return NotFound(new { message = "Not found.", code = "not_found" });
        var accounts = await _money.LockAsync(new[] { handover.FromAccountId, handover.ToAccountId });
        var (from, to) = (accounts[handover.FromAccountId], accounts[handover.ToAccountId]);
        if (!MoneyService.CanUse(User, to)) return NotFound(new { message = "Not found.", code = "not_found" });
        if (handover.Status != HandoverStatus.SENT)
            return Bad("already_done", "This cash has already been confirmed or called off.");
        if (!to.IsActive) return Bad("account_closed", "The receiving box is closed.");

        from.Held -= handover.Amount;
        var voucher = new Voucher
        {
            Number = await DocumentNumbers.NextVoucherAsync(_db, VoucherType.TRANSFER), Type = VoucherType.TRANSFER,
            BranchId = from.BranchId, FromAccountId = from.Id, ToAccountId = to.Id, Amount = handover.Amount,
            Notes = Text($"{handover.Number}{(handover.Notes is null ? "" : " — " + handover.Notes)}", 500),
            CreatedById = Me(),
        };
        var error = _money.Move(from, -handover.Amount, MoneyMovementKind.TRANSFER_OUT, Me(), voucher.Number, voucherId: voucher.Id)
                    ?? _money.Move(to, handover.Amount, MoneyMovementKind.TRANSFER_IN, Me(), voucher.Number, voucherId: voucher.Id);
        if (error is not null) return Bad(error.Code, error.Message);
        await _ledger.PostVoucherAsync(voucher, null, accounts, null, Me());
        _db.Vouchers.Add(voucher);
        handover.Status = HandoverStatus.RECEIVED;
        handover.DoneById = Me();
        handover.DoneAt = DateTime.UtcNow;
        handover.VoucherId = voucher.Id;
        _notify.CashDone(handover, from, to, User);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("receive", handover.Id, to.BranchId);
        return Ok(await DtoAsync(handover.Id));
    }

    /// <summary>
    /// Call it off before it is confirmed: the sender (it never left) or the receiver (it never came).
    /// The held cash is free again in the sending box.
    /// </summary>
    [HttpPost("cash-handovers/{id:guid}/cancel")]
    public async Task<ActionResult<CashHandoverDto>> Cancel(Guid id, [FromBody] CancelHandoverRequest? req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var handover = await LockAsync(id);
        if (handover is null) return NotFound(new { message = "Not found.", code = "not_found" });
        var accounts = await _money.LockAsync(new[] { handover.FromAccountId, handover.ToAccountId });
        var (from, to) = (accounts[handover.FromAccountId], accounts[handover.ToAccountId]);
        var asSender = Can(Permissions.CashHandoverSend) && MoneyService.CanUse(User, from);
        var asReceiver = Can(Permissions.CashHandoverReceive) && MoneyService.CanUse(User, to);
        if (!asSender && !asReceiver)
        {
            if (MoneyService.CanUse(User, from) || MoneyService.CanUse(User, to))
                return StatusCode(403, new { message = "You may not call this off.", code = "forbidden" });
            return NotFound(new { message = "Not found.", code = "not_found" });
        }
        if (handover.Status != HandoverStatus.SENT)
            return Bad("already_done", "This cash has already been confirmed or called off.");

        from.Held = Math.Max(0, from.Held - handover.Amount);
        handover.Status = HandoverStatus.CANCELLED;
        handover.DoneById = Me();
        handover.DoneAt = DateTime.UtcNow;
        handover.Reason = Text(req?.Reason, 300);
        _notify.CashDone(handover, from, to, User);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", handover.Id, from.BranchId);
        return Ok(await DtoAsync(handover.Id));
    }

    // ------------------------------------------------------------------ helpers

    private IQueryable<CashHandover> Query() => _db.CashHandovers.AsNoTracking()
        .Include(h => h.FromAccount).ThenInclude(a => a!.Branch)
        .Include(h => h.ToAccount).ThenInclude(a => a!.Branch)
        .Include(h => h.SentBy).Include(h => h.DoneBy).Include(h => h.Voucher);

    /// <summary>The handover's row locked until the transaction ends, if the person may see it.</summary>
    private async Task<CashHandover?> LockAsync(Guid id)
    {
        var mine = _money.Visible(User).Select(a => a.Id);
        if (!await _db.CashHandovers.AnyAsync(h => h.Id == id && (mine.Contains(h.FromAccountId) || mine.Contains(h.ToAccountId))))
            return null;
        return await _db.CashHandovers.FromSqlInterpolated($"SELECT * FROM \"CashHandovers\" WHERE \"Id\" = {id} FOR UPDATE")
            .FirstOrDefaultAsync();
    }

    private async Task<CashHandoverDto> DtoAsync(Guid id) =>
        ToDto(await Query().FirstAsync(h => h.Id == id), await CurrencyAsync());

    private CashHandoverDto ToDto(CashHandover h, string currency)
    {
        var open = h.Status == HandoverStatus.SENT;
        var canReceive = open && Can(Permissions.CashHandoverReceive) && MoneyService.CanUse(User, h.ToAccount!);
        var canCancel = open && ((Can(Permissions.CashHandoverSend) && MoneyService.CanUse(User, h.FromAccount!))
                                 || canReceive);
        return new CashHandoverDto(h.Id.ToString(), h.Number, h.FromAccountId.ToString(), Loc.Name(h.FromAccount!),
            Loc.Name(h.FromAccount!.Branch), h.ToAccountId.ToString(), Loc.Name(h.ToAccount!), Loc.Name(h.ToAccount!.Branch),
            h.Amount, currency, h.Status.ToString(), h.Notes, h.SentBy?.FullName ?? "", h.SentAt.ToString("o"),
            h.DoneBy?.FullName, h.DoneAt?.ToString("o"), h.Reason, h.VoucherId?.ToString(), h.Voucher?.Number,
            canReceive, canCancel);
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.Select(x => x.Currency).FirstOrDefaultAsync() ?? "EGP";

    private static string? Text(string? value, int max)
    {
        var t = value?.Trim();
        return string.IsNullOrEmpty(t) ? null : t.Length > max ? t[..max] : t;
    }

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, Guid id, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "cash_handover", branchId.ToString(),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(),
            id.ToString());
}
