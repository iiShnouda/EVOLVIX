using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/parties")]
[Authorize(Policy = Permissions.PartiesView)]
public sealed class PartiesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public PartiesController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedDto<PartyDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? type = null, [FromQuery] string? search = null, [FromQuery] bool? active = null,
        [FromQuery] int? code = null, [FromQuery] string? status = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.Parties.AsQueryable();
        if (!string.IsNullOrWhiteSpace(type))
        {
            var wanted = type.Trim().ToUpperInvariant();
            if (wanted == "FACTORY") wanted = nameof(PartyType.SUPPLIER); // a factory is a supplier
            q = q.Where(p => p.Types.Contains(wanted));
        }
        if (active is bool isActive) q = q.Where(p => p.IsActive == isActive);
        // How the account stands (owner, 2026-10-02): over or near the purchase limit (80%), they
        // owe us, we owe them, settled, or closed.
        switch (status?.Trim().ToUpperInvariant())
        {
            case "OVER_LIMIT": q = q.Where(p => p.IsActive && p.CreditLimit != null && p.Balance >= p.CreditLimit); break;
            case "NEAR_LIMIT":
                q = q.Where(p => p.IsActive && p.CreditLimit != null && p.Balance < p.CreditLimit
                                 && p.Balance * 5 >= p.CreditLimit * 4); break;
            case "OWES": q = q.Where(p => p.Balance > 0); break;
            case "CREDIT": q = q.Where(p => p.Balance < 0); break;
            case "SETTLED": q = q.Where(p => p.Balance == 0); break;
            case "CLOSED": q = q.Where(p => !p.IsActive); break;
        }
        // Exactly this code (كود), e.g. typed in an invoice's code box.
        if (code is int wantedCode) q = q.Where(p => p.Code == wantedCode);
        if (!string.IsNullOrWhiteSpace(search))
        {
            // By code, name, owner / contact name, or any of its phone numbers.
            var s = search.Trim().ToLower();
            var asCode = int.TryParse(s, out var n) ? n : -1;
            q = q.Where(p => p.Code == asCode || p.Name.ToLower().Contains(s)
                || (p.ContactName != null && p.ContactName.ToLower().Contains(s))
                || (p.Phone != null && p.Phone.Contains(s))
                || p.OtherPhones.Any(x => x.Contains(s)));
        }

        var total = await q.CountAsync();
        // By name; while searching, the exact code and names that start with what was typed come
        // first, so the box can complete the name with the best match (owner, 2026-10-19).
        var ordered = q.OrderBy(p => p.Name);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            var asCode = int.TryParse(s, out var n) ? n : -1;
            ordered = q.OrderByDescending(p => p.Code == asCode)
                .ThenByDescending(p => p.Name.ToLower().StartsWith(s))
                .ThenBy(p => p.Name);
        }
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new PaginatedDto<PartyDto>(rows.Select(p => Mapper.ToParty(p, User)).ToArray(), total, page, pageSize));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PartyDto>> GetOne(Guid id)
    {
        var party = await _db.Parties.FindAsync(id);
        if (party is null) return NotFound(new { message = "Party not found" });
        return Ok(Mapper.ToParty(party, User));
    }

    /// <summary>Whether this person may add parties of these types (each type has its own permission).</summary>
    private bool MayAdd(IEnumerable<string?>? types) =>
        (types ?? Array.Empty<string?>()).All(t => (t?.ToUpperInvariant()) switch
        {
            "CUSTOMER" => User.HasClaim("permission", Permissions.PartiesCreateCustomer),
            "SUPPLIER" or "FACTORY" => User.HasClaim("permission", Permissions.PartiesCreateSupplier),
            "CARRIER" => User.HasClaim("permission", Permissions.PartiesCreateCarrier),
            _ => true, // an unknown type is refused by the checks that follow
        });

    private ObjectResult TypeNotAllowed() =>
        StatusCode(403, new { message = "Adding this kind of party needs permission.", code = "party_type_not_allowed" });

    /// <summary>Add a customer, supplier (a factory is a supplier) or shipping company (a party can be several).</summary>
    [HttpPost]
    public async Task<ActionResult<PartyDto>> Create([FromBody] CreatePartyRequest req)
    {
        if (!MayAdd(req.Types)) return TypeNotAllowed();
        var party = new Party
        {
            Currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP",
        };
        var error = await ApplyAsync(party, new Fields(req.Name, req.Types, req.Phone, req.Email, req.TaxNumber,
            req.Address, req.OtherPhones, req.ContactName, req.ShippingAddress, req.Notes,
            req.DefaultCarrierId, req.IsCashCustomer, req.OtherPhoneLabels, req.ExtraAddress,
            req.ExtraAddressLabel, req.TempCarrierName, req.NationalId, req.PhoneLabel), isNew: true);
        if (error is not null) return error;
        _db.Parties.Add(party);
        await _db.SaveChangesAsync();
        if (party.Name.Length == 0)
        {
            // Kept in Arabic (the company's language), like the seasons the system adds.
            var kind = party.Types.FirstOrDefault() switch
            {
                nameof(PartyType.SUPPLIER) => "مورد",
                nameof(PartyType.CARRIER) => "شركة شحن",
                _ => "عميل",
            };
            party.Name = $"{kind} {party.Code}";
            await _db.SaveChangesAsync();
        }
        await AuditAsync("create", party.Id, $"{party.Code} · {party.Name}");
        return Created($"/api/parties/{party.Id}", Mapper.ToParty(party, User));
    }

    /// <summary>Edit a party. Closing one needs its balance at zero, so nothing owed is hidden.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.PartiesEdit)]
    public async Task<ActionResult<PartyDto>> Update(Guid id, [FromBody] UpdatePartyRequest req)
    {
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });
        // Making a customer a supplier too is adding a supplier: it needs that permission.
        if (!MayAdd(req.Types?.Where(t => !party.Types.Contains(t?.ToUpperInvariant() ?? "")))) return TypeNotAllowed();
        // Locked first, so "balance is zero" still holds when the account closes.
        await using var tx = await _db.Database.BeginTransactionAsync();
        await MoneyService.LockPartiesAsync(_db, party.Id);
        var fields = new Fields(req.Name, req.Types, req.Phone, req.Email, req.TaxNumber,
            req.Address, req.OtherPhones, req.ContactName, req.ShippingAddress, req.Notes,
            req.DefaultCarrierId, req.IsCashCustomer, req.OtherPhoneLabels, req.ExtraAddress,
            req.ExtraAddressLabel, req.TempCarrierName, req.NationalId, req.PhoneLabel);
        // Whoever can't see the contact details can't change them either (left as they are).
        if (!User.HasClaim("permission", Permissions.PartiesContact))
            fields = fields with
            {
                Phone = null, PhoneLabel = null, OtherPhones = null, OtherPhoneLabels = null, Email = null,
                TaxNumber = null, Address = null, ShippingAddress = null, ExtraAddress = null,
                ExtraAddressLabel = null, ContactName = null, NationalId = null,
            };
        var error = await ApplyAsync(party, fields, isNew: false);
        if (error is not null) return error;
        // The walk-in cash customer stays a cash customer, and stays open.
        if (party.IsSystem && (req.IsActive == false || !party.IsCashCustomer
                               || !party.Types.Contains(nameof(PartyType.CUSTOMER))))
            return BadRequest(new
            {
                message = "The cash customer account is always open and always a cash customer.",
                code = "system_party",
            });
        if (req.IsActive is bool active && active != party.IsActive && !User.HasClaim("permission", Permissions.PartiesClose))
            return StatusCode(403, new { message = "Closing or reopening an account needs permission.", code = "close_not_allowed" });
        if (req.IsActive == false && party.IsActive)
        {
            if (party.Balance != 0)
                return BadRequest(new
                {
                    message = "This party still has a balance. Settle it before closing the account.",
                    code = "has_balance",
                });
            party.IsActive = false;
        }
        else if (req.IsActive == true) party.IsActive = true;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("update", id);
        return Ok(Mapper.ToParty(party, User));
    }

    private sealed record Fields(
        string? Name, string[]? Types, string? Phone, string? Email, string? TaxNumber, string? Address,
        string[]? OtherPhones, string? ContactName, string? ShippingAddress, string? Notes,
        string? DefaultCarrierId = null, bool? IsCashCustomer = null, string[]? OtherPhoneLabels = null,
        string? ExtraAddress = null, string? ExtraAddressLabel = null, string? TempCarrierName = null,
        string? NationalId = null, string? PhoneLabel = null);

    private const int MaxOtherPhones = 5;

    /// <summary>Validate and set a party's fields; a null field is left as it is (on an edit).</summary>
    private async Task<ActionResult?> ApplyAsync(Party party, Fields f, bool isNew)
    {
        if (f.Name is not null || isNew)
        {
            var clean = Loc.Clean(f.Name);
            // Every field of a new account is optional (owner, 2026-10-22): one with no name is named
            // after its kind and code once it has one (see Create).
            if (clean is null && isNew) clean = "";
            else if (clean is null) return BadRequest(new { message = "Enter the name.", code = "bad_name" });
            if (clean.Length > 0)
            {
            var lower = clean.ToLower();
            if (await _db.Parties.AnyAsync(p => p.Id != party.Id && p.IsActive && p.Name.ToLower() == lower))
                return BadRequest(new { message = $"There is already a party called {clean}.", code = "duplicate_name" });
            }
            party.Name = clean;
        }
        if (f.Types is not null || isNew)
        {
            var parsed = new List<string>();
            foreach (var raw in f.Types ?? Array.Empty<string>())
            {
                // A factory is a supplier; older clients may still send "FACTORY".
                var t = string.Equals(raw?.Trim(), "FACTORY", StringComparison.OrdinalIgnoreCase)
                    ? nameof(PartyType.SUPPLIER) : raw;
                if (!Enum.TryParse<PartyType>(t, true, out var type) || !Enum.IsDefined(type))
                    return BadRequest(new { message = "Unknown party type.", code = "bad_type" });
                if (!parsed.Contains(type.ToString())) parsed.Add(type.ToString());
            }
            if (parsed.Count == 0)
                return BadRequest(new { message = "Choose customer, supplier or shipping company.", code = "bad_type" });
            // One kind per account (owner, 2026-10-19). Older accounts that are two kinds keep them
            // while they are left as they are.
            if (parsed.Count > 1 && (isNew || !parsed.ToHashSet().SetEquals(party.Types)))
                return BadRequest(new { message = "Choose one: customer, supplier or shipping company.", code = "one_type" });
            party.Types = parsed;
        }
        // Phones and the national ID as the company's country has them (owner, 2026-10-02).
        var country = await _db.CompanySettings.Select(x => x.Country).FirstOrDefaultAsync();
        if (f.Phone is not null)
        {
            if (IdRules.PhoneProblem(country, f.Phone) is { } bad)
                return BadRequest(new { message = IdRules.Message(bad), code = bad });
            party.Phone = Text(f.Phone, 40);
        }
        if (f.PhoneLabel is not null) party.PhoneLabel = Text(f.PhoneLabel, 60);
        if (f.OtherPhones is not null)
        {
            // Each extra phone may name whose it is (by position); a number is kept once.
            var (phones, labels, problem) = IdRules.PhoneList(country, party.Phone, f.OtherPhones, f.OtherPhoneLabels,
                MaxOtherPhones);
            if (problem == "too_many_phones")
                return BadRequest(new { message = $"Up to {MaxOtherPhones} more phone numbers.", code = "too_many_phones" });
            if (problem is not null) return BadRequest(new { message = IdRules.Message(problem), code = problem });
            party.OtherPhones = phones;
            party.OtherPhoneLabels = labels;
        }
        if (f.NationalId is not null)
        {
            if (IdRules.NationalIdProblem(country, f.NationalId) is { } bad)
                return BadRequest(new { message = IdRules.Message(bad), code = bad });
            party.NationalId = Text(f.NationalId, 30);
        }
        if (f.ExtraAddress is not null) party.ExtraAddress = Text(f.ExtraAddress, 300);
        if (f.ExtraAddressLabel is not null) party.ExtraAddressLabel = Text(f.ExtraAddressLabel, 60);
        if (f.TempCarrierName is not null) party.TempCarrierName = Text(f.TempCarrierName, 200);
        if (f.TaxNumber is not null) party.TaxNumber = Text(f.TaxNumber, 40);
        if (f.Address is not null) party.Address = Text(f.Address, 300);
        if (f.ShippingAddress is not null) party.ShippingAddress = Text(f.ShippingAddress, 300);
        if (f.ContactName is not null) party.ContactName = Text(f.ContactName, 200);
        if (f.Notes is not null) party.Notes = Text(f.Notes, 1000);
        if (f.DefaultCarrierId is not null)
        {
            if (f.DefaultCarrierId == "") party.DefaultCarrierId = null;
            else if (!Guid.TryParse(f.DefaultCarrierId, out var carrier)
                     || !await _db.Parties.AnyAsync(p => p.Id == carrier && p.IsActive && p.Types.Contains(nameof(PartyType.CARRIER))))
                return BadRequest(new { message = "Choose the shipping company.", code = "carrier_not_found" });
            else party.DefaultCarrierId = carrier;
        }
        if (f.IsCashCustomer is bool cash && cash != party.IsCashCustomer)
        {
            if (!User.HasClaim("permission", Permissions.PartiesCashCustomer))
                return StatusCode(403, new { message = "Marking a cash customer needs permission.", code = "cash_customer_not_allowed" });
            party.IsCashCustomer = cash;
        }
        if (f.Email is not null)
        {
            var e = Text(f.Email, 200)?.ToLowerInvariant();
            if (e is not null && !(System.Net.Mail.MailAddress.TryCreate(e, out var a) && a.Address == e))
                return BadRequest(new { message = "Enter a valid email.", code = "bad_email" });
            party.Email = e;
        }
        return null;
    }

    private static string? Text(string s, int max)
    {
        var t = s.Trim();
        return t.Length == 0 ? null : t[..Math.Min(max, t.Length)];
    }

    private Task AuditAsync(string action, Guid id, string? details = null) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString(), details);

    /// <summary>
    /// A customer's / supplier's own price level and price list: new invoices to them start at the
    /// level, and the list's prices replace it for its items. A null field is left as it is; "" goes
    /// back to the default level / no list. Needs <c>parties:set_price_level</c>.
    /// </summary>
    [HttpPut("{id:guid}/price-levels")]
    [Authorize(Policy = Permissions.PartiesSetPriceLevel)]
    public async Task<ActionResult<PartyDto>> SetPriceLevels(Guid id, [FromBody] SetPartyPriceLevelsRequest req)
    {
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });

        async Task<(Guid? Id, bool Ok)> Pick(string? raw, PriceSide side)
        {
            if (raw == "") return (null, true);
            if (!Guid.TryParse(raw, out var levelId)) return (null, false);
            var ok = await _db.PriceLevels.AnyAsync(l => l.Id == levelId && l.Side == side && l.IsActive);
            return (levelId, ok);
        }

        if (req.SalesPriceLevelId is not null)
        {
            var (level, ok) = await Pick(req.SalesPriceLevelId, PriceSide.SALE);
            if (!ok) return BadRequest(new { message = "Price level not found.", code = "price_level_not_found" });
            party.SalesPriceLevelId = level;
        }
        if (req.PurchasePriceLevelId is not null)
        {
            var (level, ok) = await Pick(req.PurchasePriceLevelId, PriceSide.PURCHASE);
            if (!ok) return BadRequest(new { message = "Price level not found.", code = "price_level_not_found" });
            party.PurchasePriceLevelId = level;
        }

        async Task<(Guid? Id, bool Ok)> PickList(string raw, PriceSide side)
        {
            if (raw == "") return (null, true);
            if (!Guid.TryParse(raw, out var listId)) return (null, false);
            return (listId, await _db.PriceLists.AnyAsync(l => l.Id == listId && l.Side == side));
        }
        if (req.SalesPriceListId is not null)
        {
            var (list, ok) = await PickList(req.SalesPriceListId, PriceSide.SALE);
            if (!ok) return BadRequest(new { message = "Price list not found.", code = "price_list_not_found" });
            party.SalesPriceListId = list;
        }
        if (req.PurchasePriceListId is not null)
        {
            var (list, ok) = await PickList(req.PurchasePriceListId, PriceSide.PURCHASE);
            if (!ok) return BadRequest(new { message = "Price list not found.", code = "price_list_not_found" });
            party.PurchasePriceListId = list;
        }
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "price_levels", "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
        return Ok(Mapper.ToParty(party, User));
    }

    private const int MaxIdCardBytes = 3 * 1024 * 1024;

    /// <summary>The image type of <paramref name="data"/> from its first bytes (JPEG, PNG or WebP); null = not a photo.</summary>
    private static string? ImageType(byte[] data) => Pictures.TypeOf(data);

    private static string? Side(string side) => side.ToUpperInvariant() switch
    {
        "FRONT" => "FRONT",
        "BACK" => "BACK",
        _ => null,
    };

    /// <summary>
    /// Keep a photo of a customer's or shipping company's ID card (front or back), replacing the one
    /// before. Only JPEG, PNG or WebP photos up to 3 MB; stored in the database, never on disk.
    /// </summary>
    [HttpPut("{id:guid}/id-card/{side}")]
    [Authorize(Policy = Permissions.PartiesIdCards)]
    [RequestSizeLimit(MaxIdCardBytes + 64 * 1024)]
    public async Task<ActionResult<PartyDto>> PutIdCard(Guid id, string side, IFormFile? file)
    {
        var which = Side(side);
        if (which is null) return NotFound(new { message = "Not found.", code = "not_found" });
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });
        if (file is null || file.Length == 0 || file.Length > MaxIdCardBytes)
            return BadRequest(new { message = "Choose a photo of up to 3 MB.", code = "bad_photo" });
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var data = buffer.ToArray();
        var type = ImageType(data);
        if (type is null) return BadRequest(new { message = "Only JPEG, PNG or WebP photos.", code = "bad_photo" });

        Guid.TryParse(CurrentUser.Id(User), out var staffId);
        var card = await _db.PartyIdCards.FirstOrDefaultAsync(c => c.PartyId == id && c.Side == which);
        if (card is null) _db.PartyIdCards.Add(card = new PartyIdCard { PartyId = id, Side = which });
        card.ContentType = type;
        card.Data = data;
        card.UploadedAt = DateTime.UtcNow;
        card.UploadedBy = staffId == Guid.Empty ? null : staffId;
        if (which == "FRONT") party.HasIdFront = true; else party.HasIdBack = true;
        await _db.SaveChangesAsync();
        await AuditAsync($"id_card_{which.ToLowerInvariant()}", id);
        return Ok(Mapper.ToParty(party, User));
    }

    /// <summary>The ID card photo, never cached anywhere.</summary>
    [HttpGet("{id:guid}/id-card/{side}")]
    [Authorize(Policy = Permissions.PartiesIdCards)]
    public async Task<IActionResult> GetIdCard(Guid id, string side)
    {
        var which = Side(side);
        var card = which is null ? null
            : await _db.PartyIdCards.AsNoTracking().FirstOrDefaultAsync(c => c.PartyId == id && c.Side == which);
        if (card is null) return NotFound(new { message = "Not found.", code = "not_found" });
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(card.Data, card.ContentType);
    }

    [HttpDelete("{id:guid}/id-card/{side}")]
    [Authorize(Policy = Permissions.PartiesIdCards)]
    public async Task<ActionResult<PartyDto>> DeleteIdCard(Guid id, string side)
    {
        var which = Side(side);
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (which is null || party is null) return NotFound(new { message = "Not found.", code = "not_found" });
        await _db.PartyIdCards.Where(c => c.PartyId == id && c.Side == which).ExecuteDeleteAsync();
        if (which == "FRONT") party.HasIdFront = false; else party.HasIdBack = false;
        await _db.SaveChangesAsync();
        await AuditAsync($"id_card_{which.ToLowerInvariant()}_removed", id);
        return Ok(Mapper.ToParty(party, User));
    }

    /// <summary>Set or clear (null) a customer's credit limit (حد الائتمان), in minor units.</summary>
    [HttpPut("{id:guid}/credit-limit")]
    [Authorize(Policy = Permissions.PartiesCreditLimit)]
    public async Task<ActionResult<PartyDto>> SetCreditLimit(Guid id, [FromBody] SetCreditLimitRequest req)
    {
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });
        if (req.CreditLimit is < 0 or > InvoiceLines.MaxPrice)
            return BadRequest(new { message = "Enter a credit limit of zero or more.", code = "bad_amount" });
        party.CreditLimit = req.CreditLimit;
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "credit_limit", "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
        return Ok(Mapper.ToParty(party, User));
    }
}
