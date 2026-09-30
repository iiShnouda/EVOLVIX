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
        [FromQuery] string? type = null, [FromQuery] string? search = null, [FromQuery] bool? active = null)
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
        if (!string.IsNullOrWhiteSpace(search))
        {
            // By name, owner / contact name, or any of its phone numbers.
            var s = search.Trim().ToLower();
            q = q.Where(p => p.Name.ToLower().Contains(s)
                || (p.ContactName != null && p.ContactName.ToLower().Contains(s))
                || (p.Phone != null && p.Phone.Contains(s))
                || p.OtherPhones.Any(x => x.Contains(s)));
        }

        var total = await q.CountAsync();
        var rows = await q.OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new PaginatedDto<PartyDto>(rows.Select(Mapper.ToParty).ToArray(), total, page, pageSize));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PartyDto>> GetOne(Guid id)
    {
        var party = await _db.Parties.FindAsync(id);
        if (party is null) return NotFound(new { message = "Party not found" });
        return Ok(Mapper.ToParty(party));
    }

    /// <summary>Add a customer, supplier (a factory is a supplier) or shipping company (a party can be several).</summary>
    [HttpPost]
    [Authorize(Policy = Permissions.PartiesCreate)]
    public async Task<ActionResult<PartyDto>> Create([FromBody] CreatePartyRequest req)
    {
        var party = new Party
        {
            Currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP",
        };
        var error = await ApplyAsync(party, new Fields(req.Name, req.Types, req.Phone, req.Email, req.TaxNumber,
            req.Address, req.OtherPhones, req.ContactName, req.ShippingAddress, req.Notes), isNew: true);
        if (error is not null) return error;
        _db.Parties.Add(party);
        await _db.SaveChangesAsync();
        await AuditAsync("create", party.Id);
        return Created($"/api/parties/{party.Id}", Mapper.ToParty(party));
    }

    /// <summary>Edit a party. Closing one needs its balance at zero, so nothing owed is hidden.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.PartiesEdit)]
    public async Task<ActionResult<PartyDto>> Update(Guid id, [FromBody] UpdatePartyRequest req)
    {
        var party = await _db.Parties.FirstOrDefaultAsync(p => p.Id == id);
        if (party is null) return NotFound(new { message = "Party not found", code = "not_found" });
        // Locked first, so "balance is zero" still holds when the account closes.
        await using var tx = await _db.Database.BeginTransactionAsync();
        await MoneyService.LockPartiesAsync(_db, party.Id);
        var error = await ApplyAsync(party, new Fields(req.Name, req.Types, req.Phone, req.Email, req.TaxNumber,
            req.Address, req.OtherPhones, req.ContactName, req.ShippingAddress, req.Notes), isNew: false);
        if (error is not null) return error;
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
        return Ok(Mapper.ToParty(party));
    }

    private sealed record Fields(
        string? Name, string[]? Types, string? Phone, string? Email, string? TaxNumber, string? Address,
        string[]? OtherPhones, string? ContactName, string? ShippingAddress, string? Notes);

    private const int MaxOtherPhones = 5;

    /// <summary>Validate and set a party's fields; a null field is left as it is (on an edit).</summary>
    private async Task<ActionResult?> ApplyAsync(Party party, Fields f, bool isNew)
    {
        if (f.Name is not null || isNew)
        {
            var clean = Loc.Clean(f.Name);
            if (clean is null) return BadRequest(new { message = "Enter the name.", code = "bad_name" });
            var lower = clean.ToLower();
            if (await _db.Parties.AnyAsync(p => p.Id != party.Id && p.IsActive && p.Name.ToLower() == lower))
                return BadRequest(new { message = $"There is already a party called {clean}.", code = "duplicate_name" });
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
            party.Types = parsed;
        }
        if (f.Phone is not null) party.Phone = Text(f.Phone, 40);
        if (f.OtherPhones is not null)
        {
            var phones = f.OtherPhones.Select(p => Text(p ?? "", 40)).OfType<string>()
                .Where(p => p != party.Phone).Distinct().ToList();
            if (phones.Count > MaxOtherPhones)
                return BadRequest(new { message = $"Up to {MaxOtherPhones} more phone numbers.", code = "too_many_phones" });
            party.OtherPhones = phones;
        }
        if (f.TaxNumber is not null) party.TaxNumber = Text(f.TaxNumber, 40);
        if (f.Address is not null) party.Address = Text(f.Address, 300);
        if (f.ShippingAddress is not null) party.ShippingAddress = Text(f.ShippingAddress, 300);
        if (f.ContactName is not null) party.ContactName = Text(f.ContactName, 200);
        if (f.Notes is not null) party.Notes = Text(f.Notes, 1000);
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

    private Task AuditAsync(string action, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());

    /// <summary>
    /// A customer's / supplier's own price level: new invoices to them start at it. A null field is
    /// left as it is; "" goes back to the default level. Needs <c>parties:set_price_level</c>.
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
        await _db.SaveChangesAsync();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "price_levels", "party",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), id.ToString());
        return Ok(Mapper.ToParty(party));
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
        return Ok(Mapper.ToParty(party));
    }
}
