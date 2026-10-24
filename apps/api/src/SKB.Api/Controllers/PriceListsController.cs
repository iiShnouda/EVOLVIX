using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Price lists (قوائم الأسعار) and quantity discounts (خصم الكميات), DOMAIN.md §2.2, and the prices
/// an invoice's lines would get (the invoice screen asks as they change; the invoice itself checks
/// the same way, see <see cref="SpecialPrices"/>). Looking and each change (add, edit, prices,
/// customers, delete; quantity discounts) are permissions of their own.
/// </summary>
[ApiController]
[Route("api")]
public sealed class PriceListsController : ControllerBase
{
    private const int MaxItems = 5000;
    private const int MaxSteps = 10;
    /// <summary>A quantity discount is at most 90%.</summary>
    private const int MaxBreakBp = 9000;

    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly InventoryService _inventory;
    private readonly WarehouseService _warehouses;

    public PriceListsController(AppDbContext db, AuditService audit, InventoryService inventory, WarehouseService warehouses)
    {
        _db = db;
        _audit = audit;
        _inventory = inventory;
        _warehouses = warehouses;
    }

    // ------------------------------------------------------------------ lists

    [HttpGet("price-lists")]
    [Authorize(Policy = Lookups.PriceLists)]
    public async Task<ActionResult<PriceListDto[]>> Lists([FromQuery] string? side = null)
    {
        var q = _db.PriceLists.AsNoTracking();
        if (Enum.TryParse<PriceSide>(side, true, out var s)) q = q.Where(l => l.Side == s);
        var lists = await q.OrderBy(l => l.Side).ThenByDescending(l => l.IsActive).ThenBy(l => l.Name).ToListAsync();
        return Ok((await ToDtosAsync(lists)).ToArray());
    }

    [HttpGet("price-lists/{id:guid}")]
    [Authorize(Policy = Lookups.PriceLists)]
    public async Task<ActionResult<PriceListDetailDto>> Get(Guid id)
    {
        var list = await _db.PriceLists.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id);
        if (list is null) return NotFound(new { message = "Price list not found.", code = "not_found" });
        return Ok(await DetailAsync(list));
    }

    [HttpPost("price-lists")]
    [Authorize(Policy = Permissions.PriceListsCreate)]
    public async Task<ActionResult<PriceListDetailDto>> Create([FromBody] SavePriceListRequest req)
    {
        // Price lists are for customers only (owner, 2026-10-21); purchase lists made before still work.
        var list = new PriceList { Side = PriceSide.SALE };
        var error = await ApplyAsync(list, req with { Side = null }, creating: true);
        if (error is not null) return error;
        _db.PriceLists.Add(list);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "price_list", list.Id);
        return Created($"/api/price-lists/{list.Id}", await DetailAsync(list));
    }

    [HttpPut("price-lists/{id:guid}")]
    [Authorize(Policy = Permissions.PriceListsEdit)]
    public async Task<ActionResult<PriceListDetailDto>> Update(Guid id, [FromBody] SavePriceListRequest req)
    {
        var list = await _db.PriceLists.FirstOrDefaultAsync(l => l.Id == id);
        if (list is null) return NotFound(new { message = "Price list not found.", code = "not_found" });
        if (req.Side is not null && !string.Equals(req.Side, list.Side.ToString(), StringComparison.OrdinalIgnoreCase))
            return Bad("side_fixed", "A list stays on its side; make a new one for the other.");
        var error = await ApplyAsync(list, req, creating: false);
        if (error is not null) return error;
        list.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("update", "price_list", list.Id);
        return Ok(await DetailAsync(list));
    }

    /// <summary>Delete a list; the parties that had it go back to their price level.</summary>
    [HttpDelete("price-lists/{id:guid}")]
    [Authorize(Policy = Permissions.PriceListsDelete)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var list = await _db.PriceLists.FirstOrDefaultAsync(l => l.Id == id);
        if (list is null) return NotFound(new { message = "Price list not found.", code = "not_found" });
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Parties.Where(p => p.SalesPriceListId == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.SalesPriceListId, (Guid?)null));
        await _db.Parties.Where(p => p.PurchasePriceListId == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.PurchasePriceListId, (Guid?)null));
        _db.PriceLists.Remove(list);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("delete", "price_list", id);
        return NoContent();
    }

    /// <summary>Replace a list's prices: each an item or a whole model, one unit, a price.</summary>
    [HttpPut("price-lists/{id:guid}/items")]
    [Authorize(Policy = Permissions.PriceListsPrices)]
    public async Task<ActionResult<PriceListDetailDto>> SetItems(Guid id, [FromBody] SetPriceListItemsRequest req)
    {
        var list = await _db.PriceLists.FirstOrDefaultAsync(l => l.Id == id);
        if (list is null) return NotFound(new { message = "Price list not found.", code = "not_found" });
        var asked = req.Items ?? Array.Empty<PriceListItemRequest>();
        if (asked.Length > MaxItems) return Bad("too_many", $"A list holds at most {MaxItems:N0} prices.");

        var parsed = new List<(Guid? Product, Guid? Model, Guid Unit, long Price)>();
        foreach (var i in asked)
        {
            Guid? product = Guid.TryParse(i.ProductId, out var p) ? p : null;
            Guid? model = Guid.TryParse(i.ModelId, out var m) ? m : null;
            if ((product is null) == (model is null)) return Bad("product_not_found", "Each price is for one item or one model.");
            if (!Guid.TryParse(i.UnitId, out var unit)) return Bad("unit_not_found", "Choose the unit of each price.");
            if (i.Price < 0 || i.Price > InvoiceLines.MaxPrice) return Bad("bad_price", "A price can't be negative.");
            if (parsed.Any(x => x.Product == product && x.Model == model && x.Unit == unit))
                return Bad("duplicate_item", "An item's unit is on the list twice.");
            parsed.Add((product, model, unit, i.Price));
        }

        // Each unit must be one the item (or model) comes in.
        var productIds = parsed.Where(x => x.Product != null).Select(x => x.Product!.Value).Distinct().ToList();
        var modelIds = parsed.Where(x => x.Model != null).Select(x => x.Model!.Value).Distinct().ToList();
        var itemUnits = (await _db.ItemUnits.AsNoTracking().Where(u => productIds.Contains(u.ProductId))
            .Select(u => new { u.ProductId, u.UnitId }).ToListAsync()).Select(u => (u.ProductId, u.UnitId)).ToHashSet();
        var modelUnits = (await _db.ModelUnits.AsNoTracking().Where(u => modelIds.Contains(u.ModelId))
            .Select(u => new { u.ModelId, u.UnitId }).ToListAsync()).Select(u => (u.ModelId, u.UnitId)).ToHashSet();
        foreach (var x in parsed)
        {
            var ok = x.Product is Guid pid ? itemUnits.Contains((pid, x.Unit)) : modelUnits.Contains((x.Model!.Value, x.Unit));
            if (!ok) return Bad("unit_not_found", "An item doesn't come in the unit priced.");
        }

        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.PriceListItems.Where(i => i.ListId == list.Id).ExecuteDeleteAsync();
        foreach (var x in parsed)
            _db.PriceListItems.Add(new PriceListItem { ListId = list.Id, ProductId = x.Product, ModelId = x.Model, UnitId = x.Unit, Price = x.Price });
        list.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("items", "price_list", list.Id);
        _db.ChangeTracker.Clear();
        return Ok(await DetailAsync(await _db.PriceLists.AsNoTracking().FirstAsync(l => l.Id == id)));
    }

    /// <summary>The customers a sales list is given to (owner, 2026-10-21): those named get it, the others it had lose it.</summary>
    [HttpPut("price-lists/{id:guid}/parties")]
    [Authorize(Policy = Permissions.PriceListsCustomers)]
    public async Task<ActionResult<PriceListDetailDto>> SetParties(Guid id, [FromBody] SetPriceListPartiesRequest req)
    {
        var list = await _db.PriceLists.FirstOrDefaultAsync(l => l.Id == id);
        if (list is null) return NotFound(new { message = "Price list not found.", code = "not_found" });
        if (list.Side != PriceSide.SALE) return Bad("bad_side", "Only a sales list is given to customers.");
        var ids = (req.PartyIds ?? Array.Empty<string>()).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Distinct().ToList();
        if (ids.Contains(Guid.Empty)) return Bad("party_not_found", "Customer not found.");
        if (ids.Count > MaxItems) return Bad("too_many", $"At most {MaxItems:N0} customers.");
        var found = await _db.Parties.Where(p => ids.Contains(p.Id) && p.Types.Contains("CUSTOMER")).CountAsync();
        if (found != ids.Count) return Bad("party_not_found", "Choose customers only.");
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Parties.Where(p => p.SalesPriceListId == id && !ids.Contains(p.Id))
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.SalesPriceListId, (Guid?)null));
        await _db.Parties.Where(p => ids.Contains(p.Id))
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.SalesPriceListId, (Guid?)id));
        await tx.CommitAsync();
        await AuditAsync("parties", "price_list", id);
        return Ok(await DetailAsync(await _db.PriceLists.AsNoTracking().FirstAsync(l => l.Id == id)));
    }

    // ------------------------------------------------------------------ quantity discounts

    [HttpGet("quantity-breaks")]
    [AnyPermission(Permissions.QuantityBreaksView, Permissions.QuantityBreaksEdit)]
    public async Task<ActionResult<QuantityBreakDto[]>> Breaks([FromQuery] string? productId = null)
    {
        var q = _db.QuantityBreaks.AsNoTracking().Include(b => b.Product).Include(b => b.Model).AsQueryable();
        if (Guid.TryParse(productId, out var pid))
        {
            var model = await _db.Products.Where(p => p.Id == pid).Select(p => p.ModelId).FirstOrDefaultAsync();
            q = q.Where(b => b.ProductId == pid || (model != null && b.ModelId == model));
        }
        var rows = await q.ToListAsync();
        return Ok((await ToBreakDtosAsync(rows)).ToArray());
    }

    /// <summary>
    /// An item's (or a whole model's) quantity discount steps: from a quantity (in base units) a
    /// percent off; a larger quantity gets a larger discount. They replace what it had.
    /// </summary>
    [HttpPut("quantity-breaks")]
    [Authorize(Policy = Permissions.QuantityBreaksEdit)]
    public async Task<ActionResult<QuantityBreakDto[]>> SetBreaks([FromBody] SetQuantityBreaksRequest req)
    {
        Guid? product = Guid.TryParse(req.ProductId, out var p) ? p : null;
        Guid? model = Guid.TryParse(req.ModelId, out var m) ? m : null;
        if ((product is null) == (model is null)) return Bad("product_not_found", "Choose an item or a model.");
        if (product is Guid pid && !await _db.Products.AnyAsync(x => x.Id == pid))
            return Bad("product_not_found", "Item not found.");
        if (model is Guid mid && !await _db.ProductModels.AnyAsync(x => x.Id == mid))
            return Bad("product_not_found", "Model not found.");

        var steps = (req.Steps ?? Array.Empty<QuantityBreakStepRequest>()).ToList();
        if (steps.Count > MaxSteps) return Bad("bad_steps", $"At most {MaxSteps} steps.");
        // Every step of an item is by quantity, or every one by money (owner, 2026-10-21).
        var byAmount = steps.Count > 0 && steps[0].MinAmount > 0;
        var parsed = new List<(long Min, int Bp)>();
        foreach (var s in steps)
        {
            var bp = (int)decimal.Round(s.Percent * 100m, MidpointRounding.AwayFromZero);
            if (byAmount != (s.MinAmount > 0)) return Bad("bad_steps", "Make every step by quantity or every step by amount.");
            if (byAmount && s.MinAmount > InvoiceLines.MaxPrice)
                return Bad("bad_amount", "The amount is too large.");
            if (!byAmount && (s.MinQuantity < 2 || s.MinQuantity > InvoiceLines.MaxQuantity))
                return Bad("bad_quantity", "A step starts at 2 or more.");
            if (bp <= 0 || bp > MaxBreakBp || s.Percent * 100m != bp)
                return Bad("bad_percent", "A discount is above 0% and at most 90%, to two decimals.");
            parsed.Add((byAmount ? s.MinAmount : s.MinQuantity, bp));
        }
        parsed = parsed.OrderBy(x => x.Min).ToList();
        for (var i = 1; i < parsed.Count; i++)
            if (parsed[i].Min == parsed[i - 1].Min || parsed[i].Bp <= parsed[i - 1].Bp)
                return Bad("bad_steps", "Each step is a larger quantity with a larger discount.");

        await using (var tx = await _db.Database.BeginTransactionAsync())
        {
            await _db.QuantityBreaks.Where(b => b.ProductId == product && b.ModelId == model).ExecuteDeleteAsync();
            foreach (var (min, bp) in parsed)
                _db.QuantityBreaks.Add(new QuantityBreak
                {
                    ProductId = product, ModelId = model, PercentBp = bp,
                    MinQuantity = byAmount ? 0 : (int)min, MinAmount = byAmount ? min : 0,
                });
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        await AuditAsync("quantity_breaks", product is not null ? "product" : "model", (product ?? model)!.Value);
        var rows = await _db.QuantityBreaks.AsNoTracking().Include(b => b.Product).Include(b => b.Model)
            .Where(b => b.ProductId == product && b.ModelId == model).ToListAsync();
        return Ok((await ToBreakDtosAsync(rows)).ToArray());
    }

    // ------------------------------------------------------------------ pricing an invoice

    /// <summary>
    /// The price and discount each line of a new invoice would get for a party: their price list,
    /// the price level, quantity discounts — exactly what the invoice accepts without a permission to
    /// change prices. <paramref name="side"/> is "sale" or "purchase".
    /// </summary>
    [HttpPost("pricing/{side}")]
    [Authorize]
    public async Task<ActionResult<PricingDto>> Price(string side, [FromBody] PricingRequest req)
    {
        var isSale = side.Equals("sale", StringComparison.OrdinalIgnoreCase);
        if (!isSale && !side.Equals("purchase", StringComparison.OrdinalIgnoreCase))
            return NotFound(new { message = "Not found.", code = "not_found" });
        bool Can(string permission) => User.HasClaim("permission", permission);
        if (isSale
                ? !User.HasAny(Permissions.SalesCreate, Permissions.SalesQuote, Permissions.SalesOrder, Permissions.SalesEdit)
                : !Can(Permissions.PurchasesCreate))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        var priceSide = isSale ? PriceSide.SALE : PriceSide.PURCHASE;

        var asked = req.Lines ?? Array.Empty<PricingLineRequest>();
        if (asked.Length > InvoiceLines.MaxLines) return Bad("too_many_lines", $"At most {InvoiceLines.MaxLines} lines.");
        Party? party = null;
        if (Guid.TryParse(req.PartyId, out var partyId))
            party = await _db.Parties.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partyId && p.IsActive);

        var ids = new List<(PricingLineRequest Req, Guid ProductId, Guid? UnitId)>();
        foreach (var l in asked)
        {
            var shape = InvoiceLines.CheckShape(l.ProductId, l.UnitId, l.Quantity, 0, 0);
            if (shape.Error is not null) return Bad(shape.Error.Code, shape.Error.Message);
            ids.Add((l, shape.ProductId, shape.UnitId));
        }
        var products = await _db.Products.AsNoTracking().Where(p => ids.Select(x => x.ProductId).Contains(p.Id) && p.IsActive)
            .ToDictionaryAsync(p => p.Id);
        if (ids.Any(x => !products.ContainsKey(x.ProductId)))
            return Bad("product_not_found", "A product on the invoice was not found.");
        var book = await PriceBook.LoadAsync(_db, products.Keys);
        var (level, levelError) = InvoiceLines.ResolveLevel(book, req.PriceLevelId,
            isSale ? party?.SalesPriceLevelId : party?.PurchasePriceLevelId, priceSide,
            Can(isSale ? Permissions.SalesChoosePriceLevel : Permissions.PurchasesChoosePriceLevel));
        if (levelError is not null) return InvoiceLines.Refuse(this, levelError);

        // Cost (for an item with no price) is where the goods leave from or arrive into.
        var cache = new Dictionary<string, Warehouse>();
        var costs = new Dictionary<Guid, Dictionary<Guid, long>>();
        var lines = new List<SpecialPrices.LineAsk>();
        foreach (var (l, pid, unitId) in ids)
        {
            var product = products[pid];
            var (unit, baseQty, unitError) = InvoiceLines.ResolveUnit(book, product, unitId, l.Quantity);
            if (unitError is not null) return Bad(unitError.Code, unitError.Message);
            var (warehouse, whError) = await _warehouses.ResolveAsync(User, l.WarehouseId ?? req.WarehouseId, cache);
            if (whError is not null) return Bad(whError.Code, whError.Message);
            if (!costs.TryGetValue(warehouse!.Id, out var here))
                costs[warehouse.Id] = here = await _inventory.PeekCostsAsync(products.Values, warehouse);
            lines.Add(new SpecialPrices.LineAsk(product, unit!, l.Quantity, baseQty, l.IsBonus, here[pid]));
        }
        var markup = await _db.CompanySettings.Select(s => s.DefaultMarkupPercent).FirstOrDefaultAsync();
        var special = await SpecialPrices.LoadAsync(_db, priceSide,
            isSale ? party?.SalesPriceListId : party?.PurchasePriceListId, products.Values);
        var listed = special.Price(book, level, priceSide, lines, markup);
        var priced = listed;
        // A sale may be priced at the customer's last price or at cost (owner, 2026-10-01).
        var basis = PriceBasis.Parse(req.PriceBasis);
        if (basis is null) return Bad("bad_price_basis", "Unknown price basis.");
        var last = isSale && party is not null
            ? await PriceBasis.LastPricesAsync(_db, party.Id, products.Keys)
            : new Dictionary<(Guid Product, Guid? Unit), long>();
        // Each line may ask for its own basis (owner, 2026-10-01), else the one asked for all.
        var bases = (req.Lines ?? Array.Empty<PricingLineRequest>())
            .Select(l => PriceBasis.Parse(l.PriceBasis) is { } b && !string.IsNullOrWhiteSpace(l.PriceBasis) ? b : basis)
            .ToList();
        if (isSale && bases.Count == lines.Count && bases.Any(b => b != PriceBasis.List))
        {
            if (!Can(Permissions.SalesPriceBasis))
                return StatusCode(403, new { message = "Pricing at the last price or at cost needs permission.", code = "price_basis_not_allowed" });
            // Selling at the supply price shows it: only for whoever may see costs (owner, 2026-10-02).
            if (bases.Contains(PriceBasis.Cost) && !Can(Permissions.CostsView))
                return StatusCode(403, new { message = "Selling at the supply price needs permission to see costs.", code = "cost_basis_not_allowed" });
            priced = PriceBasis.Apply(bases, listed, lines, last);
        }
        var seeCost = Can(Permissions.CostsView);
        return Ok(new PricingDto(level?.Id.ToString(), priced.Select((x, i) => new PricedLineDto(
            x.UnitPrice, x.Discount, x.Source, x.ListName, x.BreakBp, listed[i].UnitPrice,
            seeCost ? lines[i].BaseCost * lines[i].Unit.Factor : null,
            last.TryGetValue((lines[i].Product.Id, lines[i].Unit.UnitId), out var lp) ? lp : null)).ToArray()));
    }

    // ------------------------------------------------------------------ helpers

    private async Task<ActionResult?> ApplyAsync(PriceList list, SavePriceListRequest req, bool creating)
    {
        if (req.Name is not null || creating)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Enter the list's name.");
            if (await _db.PriceLists.AnyAsync(l => l.Id != list.Id && l.Name.ToLower() == name.ToLower()))
                return Bad("duplicate_name", $"There is already a list called {name}.");
            list.Name = name;
        }
        if (req.ForEveryone is bool everyone) list.ForEveryone = everyone;
        if (req.IsActive is bool active) list.IsActive = active;
        if (req.Notes is not null) list.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim()[..Math.Min(500, req.Notes.Trim().Length)];
        if (req.ValidFrom is not null)
        {
            if (req.ValidFrom == "") list.ValidFrom = null;
            else if (CompanyClock.ParseDay(req.ValidFrom) is DateOnly d) list.ValidFrom = CompanyClock.AsDate(d);
            else return Bad("bad_date", "Enter the first day as a date.");
        }
        if (req.ValidTo is not null)
        {
            if (req.ValidTo == "") list.ValidTo = null;
            else if (CompanyClock.ParseDay(req.ValidTo) is DateOnly d) list.ValidTo = CompanyClock.AsDate(d);
            else return Bad("bad_date", "Enter the last day as a date.");
        }
        if (req.DepartmentId is not null)
        {
            if (req.DepartmentId == "") list.DepartmentId = null;
            else if (Guid.TryParse(req.DepartmentId, out var did) && await _db.Departments.AnyAsync(d => d.Id == did)) list.DepartmentId = did;
            else return Bad("department_not_found", "Department not found.");
            if (list.DepartmentId is null) list.GroupId = null;
        }
        if (req.GroupId is not null)
        {
            if (req.GroupId == "") list.GroupId = null;
            else if (Guid.TryParse(req.GroupId, out var gid)
                     && await _db.Categories.FirstOrDefaultAsync(c => c.Id == gid && !c.IsRoot) is { } group
                     && group.DepartmentId != null && group.DepartmentId == list.DepartmentId)
                list.GroupId = gid;
            else return Bad("group_not_found", "Choose a sub-group of the list's department.");
        }
        if (req.Percent is decimal percent)
        {
            var bp = (int)decimal.Round(percent * 100m, MidpointRounding.AwayFromZero);
            if (bp < 0 || bp > MaxBreakBp || percent * 100m != bp)
                return Bad("bad_percent", "A discount is 0% to 90%, to two decimals.");
            list.PercentBp = bp;
        }
        if (req.MinAmount is long min)
        {
            if (min < 0 || min > InvoiceLines.MaxPrice) return Bad("bad_amount", "Enter the amount as a positive number.");
            list.MinAmount = min;
        }
        if (list.ValidFrom is DateTime from && list.ValidTo is DateTime to && to < from)
            return Bad("bad_range", "The last day is before the first.");
        return null;
    }

    private async Task<List<PriceListDto>> ToDtosAsync(List<PriceList> lists)
    {
        var ids = lists.Select(l => l.Id).ToList();
        var items = await _db.PriceListItems.Where(i => ids.Contains(i.ListId)).GroupBy(i => i.ListId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var sales = await _db.Parties.Where(p => p.SalesPriceListId != null && ids.Contains(p.SalesPriceListId.Value))
            .GroupBy(p => p.SalesPriceListId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var purchases = await _db.Parties.Where(p => p.PurchasePriceListId != null && ids.Contains(p.PurchasePriceListId.Value))
            .GroupBy(p => p.PurchasePriceListId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var parties = sales.Concat(purchases).GroupBy(x => x.Key).ToDictionary(g => g.Key, g => g.Sum(x => x.Count));
        var today = CompanyClock.TodayDate;
        return lists.Select(l => new PriceListDto(
            l.Id.ToString(), Loc.Name(l), l.Side.ToString(), l.ForEveryone, l.ValidFrom?.ToString("yyyy-MM-dd"),
            l.ValidTo?.ToString("yyyy-MM-dd"), l.IsActive, l.Notes, items.GetValueOrDefault(l.Id),
            parties.GetValueOrDefault(l.Id),
            l.IsActive && (l.ValidFrom == null || l.ValidFrom <= today) && (l.ValidTo == null || l.ValidTo >= today),
            l.DepartmentId?.ToString(), l.GroupId?.ToString(), l.PercentBp, l.MinAmount)).ToList();
    }

    private async Task<PriceListDetailDto> DetailAsync(PriceList list)
    {
        var items = await _db.PriceListItems.AsNoTracking().Include(i => i.Product).Include(i => i.Model)
            .Include(i => i.Unit).Where(i => i.ListId == list.Id).ToListAsync();
        var productIds = items.Where(i => i.ProductId != null).Select(i => i.ProductId!.Value).ToList();
        var modelIds = items.Where(i => i.ModelId != null).Select(i => i.ModelId!.Value).ToList();
        var book = await PriceBook.LoadAsync(_db, productIds, modelIds);
        var level = book.DefaultLevel(list.Side);
        var modelUnits = (await _db.ModelUnits.AsNoTracking().Where(u => modelIds.Contains(u.ModelId)).ToListAsync())
            .GroupBy(u => u.ModelId).ToDictionary(g => g.Key, g => g.Select(u => (u.UnitId, u.Factor)).ToList());
        var dtos = items.Select(i =>
        {
            int factor;
            long? levelPrice = null;
            if (i.ProductId is Guid pid)
            {
                factor = book.UnitOf(pid, i.UnitId)?.Factor ?? 1;
                if (level is not null) levelPrice = book.Effective(pid, i.UnitId, level.Id).Price;
            }
            else
            {
                var units = modelUnits.GetValueOrDefault(i.ModelId!.Value) ?? new();
                factor = units.FirstOrDefault(u => u.UnitId == i.UnitId).Factor;
                if (level is not null) levelPrice = book.ModelEffective(i.ModelId!.Value, units, i.UnitId, level.Id).Price;
            }
            return new PriceListItemDto(i.Id.ToString(), i.ProductId?.ToString(), i.ModelId?.ToString(),
                i.Product is not null ? Loc.Name(i.Product) : Loc.Name(i.Model), i.Product?.Sku ?? i.Model?.Code ?? "",
                i.UnitId.ToString(), Loc.Name(i.Unit), Math.Max(1, factor), i.Price, levelPrice);
        }).OrderBy(x => x.Name).ThenBy(x => x.Factor).ToArray();
        var parties = await _db.Parties.AsNoTracking()
            .Where(p => list.Side == PriceSide.SALE ? p.SalesPriceListId == list.Id : p.PurchasePriceListId == list.Id)
            .OrderBy(p => p.Name).Select(p => new { p.Id, p.Name, p.Code }).ToListAsync();
        return new PriceListDetailDto((await ToDtosAsync(new List<PriceList> { list }))[0], dtos,
            parties.Select(p => new PriceListPartyDto(p.Id.ToString(), p.Name, p.Code.ToString())).ToArray());
    }

    private async Task<List<QuantityBreakDto>> ToBreakDtosAsync(List<QuantityBreak> rows)
    {
        var productIds = rows.Where(b => b.ProductId != null).Select(b => b.ProductId!.Value).ToList();
        var modelIds = rows.Where(b => b.ModelId != null).Select(b => b.ModelId!.Value).ToList();
        var itemBase = await _db.ItemUnits.AsNoTracking().Include(u => u.Unit)
            .Where(u => productIds.Contains(u.ProductId) && u.Factor == 1).ToDictionaryAsync(u => u.ProductId, u => Loc.Name(u.Unit));
        var modelBase = await _db.ModelUnits.AsNoTracking().Include(u => u.Unit)
            .Where(u => modelIds.Contains(u.ModelId) && u.Factor == 1).ToDictionaryAsync(u => u.ModelId, u => Loc.Name(u.Unit));
        return rows.Select(b => new QuantityBreakDto(b.Id.ToString(), b.ProductId?.ToString(), b.ModelId?.ToString(),
                b.Product is not null ? Loc.Name(b.Product) : Loc.Name(b.Model), b.Product?.Sku ?? b.Model?.Code ?? "",
                b.ProductId is Guid pid ? itemBase.GetValueOrDefault(pid, "") : modelBase.GetValueOrDefault(b.ModelId!.Value, ""),
                b.MinQuantity, b.PercentBp, b.MinAmount))
            .OrderBy(b => b.Name).ThenBy(b => b.MinQuantity).ThenBy(b => b.MinAmount).ToList();
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, string resource, Guid id) =>
        _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), action, resource, CurrentUser.BranchId(User),
            Request.HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), id.ToString());
}
