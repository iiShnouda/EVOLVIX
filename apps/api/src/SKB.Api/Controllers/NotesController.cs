using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Cheques and promissory notes (الأوراق المالية — DOMAIN.md §2.7).
/// <list type="bullet">
/// <item><b>Receivable</b> (أوراق قبض): taken from a customer (their account drops; it may settle
/// invoices) → deposited at a bank in a portfolio (حافظة) → collected into a money account; or
/// cashed straight away, endorsed to a supplier, bounced (the customer owes again) or given back.</item>
/// <item><b>Payable</b> (أوراق دفع): issued to a supplier (what we owe drops) → paid from a money
/// account, bounced or withdrawn.</item>
/// </list>
/// Every step is a <see cref="NoteEvent"/> and posts its journal entry (notes receivable, notes
/// under collection, notes payable). A bounce or cancellation takes back the invoices it settled.
/// Branch-scoped users see their branch's notes. Each step has its own permission.
/// </summary>
[ApiController]
[Route("api")]
[Authorize(Policy = Permissions.NotesView)]
public sealed class NotesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly MoneyService _money;
    private readonly LedgerService _ledger;
    private readonly AuditService _audit;

    public NotesController(AppDbContext db, MoneyService money, LedgerService ledger, AuditService audit)
    {
        _db = db;
        _money = money;
        _ledger = ledger;
        _audit = audit;
    }

    private static readonly NoteStatus[] Open = { NoteStatus.IN_HAND, NoteStatus.UNDER_COLLECTION, NoteStatus.ISSUED };
    private static readonly ShipmentStatus[] OnTheWay = { ShipmentStatus.CREATED, ShipmentStatus.PICKED_UP };

    // ------------------------------------------------------------------ lists

    /// <param name="search">Finds a paper by its number, our reference, its bank, its drawer or the
    /// party's name or code (owner, 2026-10-02: "find the cheque in my hand and tell me what to do").</param>
    [HttpGet("notes")]
    public async Task<ActionResult<PaginatedDto<NoteDto>>> List(
        [FromQuery] string? direction = null, [FromQuery] string? status = null, [FromQuery] string? partyId = null,
        [FromQuery] bool? open = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var q = Scoped();
        if (Text(search, 60) is { } term)
        {
            var low = term.ToLower();
            var code = int.TryParse(term, out var c) ? c : (int?)null;
            q = q.Where(n => n.SerialNumber.ToLower().Contains(low) || n.Ref.ToLower().Contains(low)
                             || (n.BankName != null && n.BankName.ToLower().Contains(low))
                             || (n.Drawer != null && n.Drawer.ToLower().Contains(low))
                             || n.Party!.Name.ToLower().Contains(low) || (code != null && n.Party.Code == code));
        }
        if (Enum.TryParse<NoteDirection>(direction, true, out var d)) q = q.Where(n => n.Direction == d);
        if (Enum.TryParse<NoteStatus>(status, true, out var st)) q = q.Where(n => n.Status == st);
        if (Guid.TryParse(partyId, out var p)) q = q.Where(n => n.PartyId == p || n.EndorsedToId == p);
        if (open == true) q = q.Where(n => Open.Contains(n.Status));
        var total = await q.CountAsync();
        var rows = await WithDetails(q).OrderBy(n => n.DueDate).ThenBy(n => n.Ref)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(new PaginatedDto<NoteDto>(rows.Select(n => ToDto(n, currency)).ToArray(), total, page, pageSize));
    }

    /// <summary>What is open and what falls due: overdue, and due in the next seven days.</summary>
    [HttpGet("notes/summary")]
    public async Task<ActionResult<NotesSummaryDto>> Summary()
    {
        var today = CompanyClock.TodayDate;
        var week = today.AddDays(7);
        var open = await Scoped().Where(n => Open.Contains(n.Status))
            .Select(n => new { n.Direction, n.Amount, n.DueDate }).ToListAsync();
        long Sum(NoteDirection d, Func<DateTime, bool> when) =>
            open.Where(n => n.Direction == d && when(n.DueDate)).Sum(n => n.Amount);
        return Ok(new NotesSummaryDto(
            Sum(NoteDirection.RECEIVABLE, _ => true), Sum(NoteDirection.RECEIVABLE, x => x < today),
            Sum(NoteDirection.RECEIVABLE, x => x >= today && x < week),
            Sum(NoteDirection.PAYABLE, _ => true), Sum(NoteDirection.PAYABLE, x => x < today),
            Sum(NoteDirection.PAYABLE, x => x >= today && x < week), await CurrencyAsync()));
    }

    [HttpGet("notes/{id:guid}")]
    public async Task<ActionResult<NoteDto>> Get(Guid id)
    {
        var n = await WithDetails(Scoped()).FirstOrDefaultAsync(x => x.Id == id);
        return n is null ? NotFound(new { message = "Note not found.", code = "not_found" }) : Ok(ToDto(n, await CurrencyAsync()));
    }

    [HttpGet("portfolios")]
    public async Task<ActionResult<PortfolioDto[]>> Portfolios()
    {
        var q = _db.Portfolios.AsNoTracking().Include(p => p.Account).Include(p => p.Branch).Include(p => p.CreatedBy)
            .Include(p => p.Notes).InBranches(User, p => p.BranchId);
        var rows = await q.OrderByDescending(p => p.CreatedAt).Take(200).AsSplitQuery().ToListAsync();
        var currency = await CurrencyAsync();
        return Ok(rows.Select(p => new PortfolioDto(p.Id.ToString(), p.Number, Loc.Name(p.Account), Loc.Name(p.Branch),
            p.CreatedAt.ToString("o"), p.CreatedBy?.FullName ?? "", p.Notes.Count, p.Notes.Sum(n => n.Amount),
            p.Notes.OrderBy(n => n.Ref).Select(n => n.Ref).ToArray(), currency)).ToArray());
    }

    // ------------------------------------------------------------------ receive / issue

    /// <summary>Take a cheque / promissory note from a party: their account drops; it may settle their sales invoices.</summary>
    [HttpPost("notes/receive")]
    [Authorize(Policy = Permissions.NotesReceive)]
    public Task<ActionResult<NoteDto>> Receive([FromBody] CreateNoteRequest req) => CreateAsync(NoteDirection.RECEIVABLE, req);

    /// <summary>Take several cheques at once (a series): all are saved, or none.</summary>
    [HttpPost("notes/receive-many")]
    [Authorize(Policy = Permissions.NotesReceive)]
    public Task<ActionResult<NoteDto[]>> ReceiveMany([FromBody] CreateNotesRequest req) => CreateManyAsync(NoteDirection.RECEIVABLE, req);

    /// <summary>Issue several cheques at once (a series): all are saved, or none.</summary>
    [HttpPost("notes/issue-many")]
    [Authorize(Policy = Permissions.NotesIssue)]
    public Task<ActionResult<NoteDto[]>> IssueMany([FromBody] CreateNotesRequest req) => CreateManyAsync(NoteDirection.PAYABLE, req);

    /// <summary>Issue our cheque / promissory note to a party: what we owe drops; it may settle purchase invoices.</summary>
    [HttpPost("notes/issue")]
    [Authorize(Policy = Permissions.NotesIssue)]
    public Task<ActionResult<NoteDto>> Issue([FromBody] CreateNoteRequest req) => CreateAsync(NoteDirection.PAYABLE, req);

    private async Task<ActionResult<NoteDto>> CreateAsync(NoteDirection direction, CreateNoteRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var (note, error) = await CreateOneAsync(direction, req);
        if (error is not null) return error;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync(direction == NoteDirection.RECEIVABLE ? "receive" : "issue", note!.Id, note.BranchId);
        return Created($"/api/notes/{note.Id}", ToDto(await ReloadAsync(note.Id), await CurrencyAsync()));
    }

    private async Task<ActionResult<NoteDto[]>> CreateManyAsync(NoteDirection direction, CreateNotesRequest req)
    {
        var list = req.Notes ?? Array.Empty<CreateNoteRequest>();
        if (list.Length == 0 || list.Length > 60) return Bad("no_notes", "Add between 1 and 60 cheques.");
        await using var tx = await _db.Database.BeginTransactionAsync();
        var made = new List<Note>();
        for (var i = 0; i < list.Length; i++)
        {
            var (note, error) = await CreateOneAsync(direction, list[i]);
            if (error is not null)
                return error is BadRequestObjectResult bad && bad.Value is not null
                    ? BadRequest(new { message = $"#{i + 1}: {bad.Value.GetType().GetProperty("message")?.GetValue(bad.Value)}",
                        code = bad.Value.GetType().GetProperty("code")?.GetValue(bad.Value), index = i })
                    : error;
            made.Add(note!);
            // Each one settles what the ones before it left owed.
            await _db.SaveChangesAsync();
        }
        await tx.CommitAsync();
        foreach (var n in made) await AuditAsync(direction == NoteDirection.RECEIVABLE ? "receive" : "issue", n.Id, n.BranchId);
        var currency = await CurrencyAsync();
        var result = new List<NoteDto>();
        foreach (var n in made) result.Add(ToDto(await ReloadAsync(n.Id), currency));
        return Created("/api/notes", result.ToArray());
    }

    /// <summary>One note checked and added (not saved): the caller holds the transaction.</summary>
    private async Task<(Note? Note, ActionResult? Error)> CreateOneAsync(NoteDirection direction, CreateNoteRequest req)
    {
        if (!Guid.TryParse(req.PartyId, out var partyId)) return (null, Bad("party_not_found", "Choose the customer or supplier."));
        if (!Enum.TryParse<NoteKind>(req.Kind, true, out var kind)) return (null, Bad("bad_kind", "Choose cheque or promissory note."));
        var serial = Text(req.SerialNumber, 40);
        if (serial is null) return (null, Bad("bad_serial", "Enter the cheque / note number."));
        if (req.Amount <= 0 || req.Amount > InvoiceLines.MaxPrice) return (null, Bad("bad_amount", "Enter an amount above zero."));
        if (!DateOnly.TryParse(req.DueDate, out var due)) return (null, Bad("bad_date", "Enter the due date."));

        var allocations = new List<(Guid DocumentId, long Amount)>();
        foreach (var a in req.Allocations ?? Array.Empty<AllocationRequest>())
        {
            if (!Guid.TryParse(a.DocumentId, out var docId) || allocations.Any(x => x.DocumentId == docId))
                return (null, Bad("invoice_not_found", "An invoice was not found."));
            if (a.Amount <= 0) return (null, Bad("bad_allocation", "Each invoice needs an amount above zero."));
            allocations.Add((docId, a.Amount));
        }
        if (allocations.Count > 100) return (null, Bad("bad_allocation", "At most 100 invoices on one note."));
        if (allocations.Sum(a => a.Amount) > req.Amount)
            return (null, Bad("over_allocated", "The invoices settled add up to more than the note."));

        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);
        if (party is null) return (null, Bad("party_not_found", "Choose the customer or supplier."));

        // Lock order: invoices, then the party.
        var docs = new Dictionary<Guid, SalesDocument>();
        if (allocations.Count > 0)
        {
            var docIds = allocations.Select(a => a.DocumentId).OrderBy(x => x).ToArray();
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({docIds}) ORDER BY \"Id\" FOR UPDATE");
            var docType = direction == NoteDirection.RECEIVABLE ? DocumentType.SALES_INVOICE : DocumentType.PURCHASE_INVOICE;
            var q = _db.SalesDocuments.Where(d => docIds.Contains(d.Id) && d.PartyId == partyId && d.Type == docType
                                                 && d.Status != DocumentStatus.CANCELLED).InBranches(User, d => d.BranchId);
            docs = await q.ToDictionaryAsync(d => d.Id);
            foreach (var d in docs.Values) await _db.Entry(d).ReloadAsync();
            if (docs.Count != docIds.Length) return (null, Bad("invoice_not_found", "An invoice was not found for this party."));
            var owed = await MoneyService.OutstandingAsync(_db, docs.Values.ToList());
            foreach (var (docId, amount) in allocations)
                if (amount > owed[docId])
                    return (null, Bad("over_outstanding", $"{docs[docId].Number}: only {owed[docId] / 100m:0.00} is still owed."));
            if (direction == NoteDirection.RECEIVABLE && await _db.ShipmentInvoices.AnyAsync(x =>
                    docIds.Contains(x.DocumentId) && x.CodShare > 0 && OnTheWay.Contains(x.Shipment!.Status)))
                return (null, Bad("on_cod_parcel", "An invoice is in a cash-on-delivery parcel: the shipping company collects it."));
        }
        await MoneyService.LockPartiesAsync(_db, partyId);

        var note = new Note
        {
            Ref = await DocumentNumbers.NextNoteAsync(_db, direction), Kind = kind, Direction = direction,
            Status = direction == NoteDirection.RECEIVABLE ? NoteStatus.IN_HAND : NoteStatus.ISSUED,
            SerialNumber = serial, BankName = Text(req.BankName, 100), Amount = req.Amount,
            DueDate = due.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), Drawer = Text(req.Drawer, 100),
            Guarantor = Text(req.Guarantor, 100), PartyId = partyId, BranchId = Access.Work(User),
            Remark = Text(req.Remark, 500), CreatedById = Me(),
            ReceivedOn = (DateOnly.TryParse(req.ReceivedOn, out var came) ? came : CompanyClock.Today)
                .ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
            BroughtBy = Text(req.BroughtBy, 100),
        };
        note.Events.Add(new NoteEvent { ToStatus = note.Status, PartyId = partyId, Remark = note.Remark, StaffId = Me() });
        foreach (var (docId, amount) in allocations)
        {
            var doc = docs[docId];
            doc.PaidAmount += amount;
            MoneyService.RefreshPaidStatus(doc);
            note.Allocations.Add(new NoteAllocation { DocumentId = docId, Amount = amount });
        }
        if (direction == NoteDirection.RECEIVABLE)
        {
            party.Balance -= note.Amount;
            _ledger.PostNote(note, "Note received", await _ledger.SystemAsync(LedgerKeys.NotesReceivable),
                await _ledger.ForPartyAsync(party, LedgerService.ReceivableRole(party)), Me());
        }
        else
        {
            party.Balance += note.Amount;
            _ledger.PostNote(note, "Note issued", await _ledger.ForPartyAsync(party, LedgerService.PayableRole(party)),
                await _ledger.SystemAsync(LedgerKeys.NotesPayable), Me());
        }
        _db.Notes.Add(note);
        return (note, null);
    }

    // ------------------------------------------------------------------ steps

    /// <summary>Lodge notes we hold at a bank for collection, as one portfolio (حافظة).</summary>
    [HttpPost("notes/deposit")]
    [Authorize(Policy = Permissions.NotesDeposit)]
    public async Task<ActionResult<PortfolioDto>> Deposit([FromBody] DepositNotesRequest req)
    {
        var ids = new List<Guid>();
        foreach (var raw in req.NoteIds ?? Array.Empty<string>())
        {
            if (!Guid.TryParse(raw, out var id) || ids.Contains(id)) return Bad("note_not_found", "A note was not found.");
            ids.Add(id);
        }
        if (ids.Count == 0 || ids.Count > 100) return Bad("no_notes", "Choose the notes to deposit.");
        if (!Guid.TryParse(req.AccountId, out var accountId)) return Bad("account_not_found", "Choose the bank account.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var ordered = ids.OrderBy(i => i).ToArray();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"Notes\" WHERE \"Id\" = ANY({ordered}) ORDER BY \"Id\" FOR UPDATE");
        var notes = await Scoped().Where(n => ids.Contains(n.Id)).ToListAsync();
        if (notes.Count != ids.Count) return Bad("note_not_found", "A note was not found.");
        if (notes.Any(n => n.Direction != NoteDirection.RECEIVABLE || n.Status != NoteStatus.IN_HAND))
            return Bad("bad_transition", "Only notes in hand can be deposited.");
        var account = await _money.Visible(User).FirstOrDefaultAsync(a => a.Id == accountId && a.IsActive);
        if (account is null || account.Kind != MoneyAccountKind.BANK) return Bad("account_not_found", "Choose an open bank account.");

        var portfolio = new Portfolio
        {
            Number = await DocumentNumbers.NextPortfolioAsync(_db), AccountId = accountId, BranchId = account.BranchId,
            CreatedById = Me(),
        };
        var receivable = await _ledger.SystemAsync(LedgerKeys.NotesReceivable);
        var underCollection = await _ledger.SystemAsync(LedgerKeys.NotesUnderCollection);
        foreach (var n in notes.OrderBy(n => n.Ref))
        {
            Step(n, NoteStatus.UNDER_COLLECTION, accountId, null, portfolio.Number);
            n.AccountId = accountId;
            n.Portfolio = portfolio;
            _ledger.PostNote(n, "Note deposited", underCollection, receivable, Me());
        }
        _db.Portfolios.Add(portfolio);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("deposit", portfolio.Id, portfolio.BranchId);
        var currency = await CurrencyAsync();
        return Created($"/api/portfolios/{portfolio.Id}", new PortfolioDto(portfolio.Id.ToString(), portfolio.Number,
            Loc.Name(account), "", portfolio.CreatedAt.ToString("o"), "", notes.Count, notes.Sum(n => n.Amount),
            notes.OrderBy(n => n.Ref).Select(n => n.Ref).ToArray(), currency));
    }

    /// <summary>A note we held was paid to us: the money lands in an account (by default the deposit bank).</summary>
    [HttpPost("notes/{id:guid}/collect")]
    [Authorize(Policy = Permissions.NotesCollect)]
    public Task<ActionResult<NoteDto>> Collect(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "collect", async n =>
        {
            if (n.Direction != NoteDirection.RECEIVABLE || n.Status is not (NoteStatus.IN_HAND or NoteStatus.UNDER_COLLECTION))
                return (NoteStatus.COLLECTED, "Only a note in hand or under collection can be collected.");
            var raw = !string.IsNullOrWhiteSpace(req?.AccountId) ? req!.AccountId : n.AccountId?.ToString();
            if (!Guid.TryParse(raw, out var accountId) || !await _money.Visible(User).AnyAsync(a => a.Id == accountId && a.IsActive))
                return (NoteStatus.COLLECTED, "account_not_found");
            var account = (await _money.LockAsync(new[] { accountId }))[accountId];
            _money.Move(account, n.Amount, MoneyMovementKind.NOTE_COLLECTED, Me(), n.Ref, partyId: n.PartyId,
                methodReference: n.SerialNumber);
            var from = await _ledger.SystemAsync(n.Status == NoteStatus.IN_HAND ? LedgerKeys.NotesReceivable : LedgerKeys.NotesUnderCollection);
            _ledger.PostNote(n, "Note collected", await _ledger.ForMoneyAsync(account), from, Me());
            n.AccountId = accountId;
            return (NoteStatus.COLLECTED, null);
        }, req?.Remark);

    /// <summary>A note we issued was paid from one of our accounts (which must hold it).</summary>
    [HttpPost("notes/{id:guid}/pay")]
    [Authorize(Policy = Permissions.NotesPay)]
    public Task<ActionResult<NoteDto>> Pay(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "pay", async n =>
        {
            if (n.Direction != NoteDirection.PAYABLE || n.Status != NoteStatus.ISSUED)
                return (NoteStatus.PAID, "Only an issued note can be paid.");
            if (!Guid.TryParse(req?.AccountId, out var accountId) || !await _money.Visible(User).AnyAsync(a => a.Id == accountId && a.IsActive))
                return (NoteStatus.PAID, "account_not_found");
            var account = (await _money.LockAsync(new[] { accountId }))[accountId];
            var error = _money.Move(account, -n.Amount, MoneyMovementKind.NOTE_PAID, Me(), n.Ref, partyId: n.PartyId,
                methodReference: n.SerialNumber);
            if (error is not null) return (NoteStatus.PAID, error.Code);
            _ledger.PostNote(n, "Note paid", await _ledger.SystemAsync(LedgerKeys.NotesPayable), await _ledger.ForMoneyAsync(account), Me());
            n.AccountId = accountId;
            return (NoteStatus.PAID, null);
        }, req?.Remark);

    /// <summary>A note bounced (مرتد): the party owes again (or is owed again) and its invoices are open again.</summary>
    [HttpPost("notes/{id:guid}/bounce")]
    [Authorize(Policy = Permissions.NotesBounce)]
    public Task<ActionResult<NoteDto>> Bounce(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "bounce", n => UndoAsync(n, NoteStatus.BOUNCED, "Note bounced",
            n.Status is NoteStatus.IN_HAND or NoteStatus.UNDER_COLLECTION or NoteStatus.ISSUED,
            "Only an open note can bounce."), req?.Remark);

    /// <summary>Give a note back (receivable, in hand) or withdraw it (payable, issued): as if it never came.</summary>
    [HttpPost("notes/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.NotesCancel)]
    public Task<ActionResult<NoteDto>> Cancel(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "cancel", n => UndoAsync(n, NoteStatus.CANCELLED, "Note cancelled",
            n.Status is NoteStatus.IN_HAND or NoteStatus.ISSUED, "Only a note in hand or issued can be cancelled."),
            req?.Remark);

    /// <summary>
    /// A paper lost or stolen (owner, 2026-10-02): as on a bounce, the party owes again (or is owed
    /// again) and its invoices are open again; the paper is kept on the list as lost.
    /// </summary>
    [HttpPost("notes/{id:guid}/lost")]
    [Authorize(Policy = Permissions.NotesLost)]
    public Task<ActionResult<NoteDto>> Lost(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "lost", n => UndoAsync(n, NoteStatus.LOST, "Note lost",
            n.Status is NoteStatus.IN_HAND or NoteStatus.UNDER_COLLECTION or NoteStatus.ISSUED,
            "Only an open note can be marked lost."), req?.Remark);

    // ------------------------------------------------------------------ photo

    private const int MaxPhotoBytes = 3 * 1024 * 1024;

    /// <summary>
    /// Keep the photo of a cheque or note (owner, 2026-10-02), replacing the one before: only JPEG,
    /// PNG or WebP up to 3 MB, read from its bytes; stored in the database, never on disk.
    /// </summary>
    [HttpPut("notes/{id:guid}/photo")]
    [RequestSizeLimit(MaxPhotoBytes + 64 * 1024)]
    public async Task<ActionResult<NoteDto>> PutPhoto(Guid id, IFormFile? file)
    {
        var note = await Scoped().FirstOrDefaultAsync(n => n.Id == id);
        if (note is null) return NotFound(new { message = "Note not found.", code = "not_found" });
        // Whoever may take (or issue) such papers keeps their photos.
        var may = note.Direction == NoteDirection.RECEIVABLE ? Permissions.NotesReceive : Permissions.NotesIssue;
        if (!User.HasClaim("permission", may)) return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        if (file is null || file.Length == 0 || file.Length > MaxPhotoBytes)
            return Bad("bad_photo", "Choose a photo of up to 3 MB.");
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var data = buffer.ToArray();
        var type = Pictures.TypeOf(data);
        if (type is null) return Bad("bad_photo", "Only JPEG, PNG or WebP photos.");
        var photo = await _db.NotePhotos.FirstOrDefaultAsync(x => x.NoteId == id);
        if (photo is null) _db.NotePhotos.Add(photo = new NotePhoto { NoteId = id });
        photo.ContentType = type;
        photo.Data = data;
        photo.UploadedAt = DateTime.UtcNow;
        photo.UploadedBy = Me();
        note.HasPhoto = true;
        await _db.SaveChangesAsync();
        await AuditAsync("photo", note.Id, note.BranchId);
        return Ok(ToDto(await ReloadAsync(note.Id), await CurrencyAsync()));
    }

    /// <summary>The paper's photo, never cached anywhere.</summary>
    [HttpGet("notes/{id:guid}/photo")]
    public async Task<IActionResult> GetPhoto(Guid id)
    {
        if (!await Scoped().AnyAsync(n => n.Id == id)) return NotFound(new { message = "Not found.", code = "not_found" });
        var photo = await _db.NotePhotos.AsNoTracking().FirstOrDefaultAsync(x => x.NoteId == id);
        if (photo is null) return NotFound(new { message = "Not found.", code = "not_found" });
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(photo.Data, photo.ContentType);
    }

    [HttpDelete("notes/{id:guid}/photo")]
    public async Task<ActionResult<NoteDto>> DeletePhoto(Guid id)
    {
        var note = await Scoped().FirstOrDefaultAsync(n => n.Id == id);
        if (note is null) return NotFound(new { message = "Note not found.", code = "not_found" });
        var may = note.Direction == NoteDirection.RECEIVABLE ? Permissions.NotesReceive : Permissions.NotesIssue;
        if (!User.HasClaim("permission", may)) return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        await _db.NotePhotos.Where(x => x.NoteId == id).ExecuteDeleteAsync();
        note.HasPhoto = false;
        await _db.SaveChangesAsync();
        await AuditAsync("photo_removed", note.Id, note.BranchId);
        return Ok(ToDto(await ReloadAsync(note.Id), await CurrencyAsync()));
    }

    /// <summary>Hand a note we hold to a supplier (تظهير): it pays what we owe them.</summary>
    [HttpPost("notes/{id:guid}/endorse")]
    [Authorize(Policy = Permissions.NotesEndorse)]
    public Task<ActionResult<NoteDto>> Endorse(Guid id, [FromBody] NoteStepRequest? req) =>
        StepAsync(id, "endorse", async n =>
        {
            if (n.Direction != NoteDirection.RECEIVABLE || n.Status != NoteStatus.IN_HAND)
                return (NoteStatus.ENDORSED, "Only a note in hand can be endorsed.");
            if (!Guid.TryParse(req?.PartyId, out var toId) || toId == n.PartyId)
                return (NoteStatus.ENDORSED, "party_not_found");
            var to = await _db.Parties.FirstOrDefaultAsync(p => p.Id == toId && p.IsActive);
            if (to is null) return (NoteStatus.ENDORSED, "party_not_found");
            await MoneyService.LockPartiesAsync(_db, toId);
            to.Balance += n.Amount;
            _ledger.PostNote(n, "Note endorsed", await _ledger.ForPartyAsync(to, LedgerService.PayableRole(to)),
                await _ledger.SystemAsync(LedgerKeys.NotesReceivable), Me());
            n.EndorsedToId = toId;
            return (NoteStatus.ENDORSED, null);
        }, req?.Remark, partyOf: n => n.EndorsedToId);

    /// <summary>
    /// A bounce or cancellation: the party's account goes back to before the note, the invoices it
    /// settled are owed again, and the note leaves notes receivable / under collection / payable.
    /// </summary>
    private async Task<(NoteStatus, string?)> UndoAsync(Note n, NoteStatus to, string step, bool allowed, string refusal)
    {
        if (!allowed) return (to, refusal);
        var docIds = n.Allocations.Select(a => a.DocumentId).OrderBy(x => x).ToArray();
        if (docIds.Length > 0)
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"SalesDocuments\" WHERE \"Id\" = ANY({docIds}) ORDER BY \"Id\" FOR UPDATE");
        var docs = await _db.SalesDocuments.Where(d => docIds.Contains(d.Id)).ToListAsync();
        foreach (var d in docs) await _db.Entry(d).ReloadAsync();
        await MoneyService.LockPartiesAsync(_db, n.PartyId);
        var party = await _db.Parties.FirstAsync(p => p.Id == n.PartyId);
        foreach (var a in n.Allocations)
        {
            var doc = docs.First(d => d.Id == a.DocumentId);
            doc.PaidAmount = Math.Max(0, doc.PaidAmount - a.Amount);
            MoneyService.RefreshPaidStatus(doc);
        }
        if (n.Direction == NoteDirection.RECEIVABLE)
        {
            party.Balance += n.Amount;
            var from = await _ledger.SystemAsync(n.Status == NoteStatus.UNDER_COLLECTION
                ? LedgerKeys.NotesUnderCollection : LedgerKeys.NotesReceivable);
            _ledger.PostNote(n, step, await _ledger.ForPartyAsync(party, LedgerService.ReceivableRole(party)), from, Me());
        }
        else
        {
            party.Balance -= n.Amount;
            _ledger.PostNote(n, step, await _ledger.SystemAsync(LedgerKeys.NotesPayable),
                await _ledger.ForPartyAsync(party, LedgerService.PayableRole(party)), Me());
        }
        return (to, null);
    }

    /// <summary>Lock a note, check and apply a step (which posts its entry), record the step, audit.</summary>
    private async Task<ActionResult<NoteDto>> StepAsync(Guid id, string action,
        Func<Note, Task<(NoteStatus To, string? Problem)>> apply, string? remark, Func<Note, Guid?>? partyOf = null)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Notes\" WHERE \"Id\" = {id} FOR UPDATE");
        var note = await Scoped().Include(n => n.Allocations).FirstOrDefaultAsync(n => n.Id == id);
        if (note is null) return NotFound(new { message = "Note not found.", code = "not_found" });
        var (to, problem) = await apply(note);
        if (problem is not null)
            return problem switch
            {
                "account_not_found" => Bad("account_not_found", "Choose an open money account."),
                "party_not_found" => Bad("party_not_found", "Choose the supplier it goes to."),
                "insufficient_funds" => Bad("insufficient_funds", "The account doesn't hold that much."),
                _ => Bad("bad_transition", problem),
            };
        Step(note, to, note.AccountId, partyOf?.Invoke(note), Text(remark, 500));
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync(action, note.Id, note.BranchId);
        return Ok(ToDto(await ReloadAsync(note.Id), await CurrencyAsync()));
    }

    private void Step(Note n, NoteStatus to, Guid? accountId, Guid? partyId, string? remark)
    {
        // Added on its own: a new child with its id already set, hung on a note that is already
        // tracked, would be taken for an existing row.
        _db.NoteEvents.Add(new NoteEvent
        {
            NoteId = n.Id, FromStatus = n.Status, ToStatus = to, AccountId = accountId, PartyId = partyId,
            Remark = remark, StaffId = Me(),
        });
        n.Status = to;
    }

    // ------------------------------------------------------------------ helpers

    private IQueryable<Note> Scoped() => _db.Notes.InBranches(User, n => n.BranchId);

    private static IQueryable<Note> WithDetails(IQueryable<Note> q) => q.AsNoTracking()
        .Include(n => n.Party).Include(n => n.EndorsedTo).Include(n => n.Branch).Include(n => n.Portfolio)
        .Include(n => n.Account).Include(n => n.CreatedBy)
        .Include(n => n.Allocations).ThenInclude(a => a.Document)
        .Include(n => n.Events).ThenInclude(e => e.Staff)
        .AsSplitQuery();

    private Task<Note> ReloadAsync(Guid id) => WithDetails(_db.Notes).FirstAsync(n => n.Id == id);

    private NoteDto ToDto(Note n, string currency)
    {
        var accounts = n.Events.Where(e => e.AccountId != null).Select(e => e.AccountId!.Value).ToHashSet();
        return new NoteDto(
            n.Id.ToString(), n.Ref, n.Kind.ToString(), n.Direction.ToString(), n.Status.ToString(), n.SerialNumber,
            n.BankName, n.Amount, n.DueDate.ToString("yyyy-MM-dd"),
            Open.Contains(n.Status) && n.DueDate < CompanyClock.TodayDate, n.Drawer, n.Guarantor,
            n.PartyId.ToString(), n.Party?.Name ?? "", n.EndorsedTo?.Name, Loc.Name(n.Branch), n.Portfolio?.Number,
            n.AccountId?.ToString(), n.Account is null ? null : Loc.Name(n.Account), n.Remark, n.CreatedAt.ToString("o"),
            n.CreatedBy?.FullName ?? "",
            n.Allocations.OrderBy(a => a.Document?.Number).Select(a => new NoteAllocationDto(
                a.DocumentId.ToString(), a.Document?.Number ?? "", a.Amount)).ToArray(),
            n.Events.OrderBy(e => e.CreatedAt).Select(e => new NoteEventDto(
                e.FromStatus?.ToString(), e.ToStatus.ToString(),
                e.AccountId == n.AccountId && n.Account is not null ? Loc.Name(n.Account) : null,
                e.PartyId == n.EndorsedToId ? n.EndorsedTo?.Name : e.PartyId == n.PartyId ? n.Party?.Name : null,
                e.Remark, e.Staff?.FullName ?? "", e.CreatedAt.ToString("o"))).ToArray(),
            currency, n.ReceivedOn?.ToString("yyyy-MM-dd"), n.BroughtBy, n.HasPhoto, n.Party?.Code);
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private static string? Text(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, Guid id, Guid branchId) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "note", branchId.ToString(),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), id.ToString());
}
