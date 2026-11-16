using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Bringing data in from Excel (owner, 2026-10-14; 2026-11-16: "data recovery can be from … an Excel
/// file"): items, customers, suppliers, and the opening balances of customers, suppliers, cash boxes
/// and stock. Each kind is a permission of its own (the owner's alone by default).
/// <para>
/// The server makes each kind's template (headers in Arabic or English; either is read back, in any
/// order), checks every row of an upload and answers with what it would do and each row's problems
/// (<c>preview</c>, nothing saved), then imports a file only when every row is right, all in one
/// transaction (all or nothing), through the same rules as the screens, and audited. Nothing of the
/// file is kept. Money is read as amounts and stored in minor units; names are cleaned with
/// <see cref="Loc.Clean"/>; cash boxes and warehouses are only those the person may use.
/// </para>
/// </summary>
[ApiController]
[Route("api/imports")]
public sealed class ImportController : ControllerBase
{
    private const long MaxBytes = 10 * 1024 * 1024;
    private const int MaxRows = 10_000;
    private const int SampleRows = 300;

    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly StorefrontPublisher _storefront;
    private readonly MoneyService _money;
    private readonly WarehouseService _warehouses;
    private readonly InventoryService _inventory;
    private readonly LedgerService _ledger;

    public ImportController(AppDbContext db, AuditService audit, StorefrontPublisher storefront, MoneyService money,
        WarehouseService warehouses, InventoryService inventory, LedgerService ledger)
    {
        _db = db;
        _audit = audit;
        _storefront = storefront;
        _money = money;
        _warehouses = warehouses;
        _inventory = inventory;
        _ledger = ledger;
    }

    // ------------------------------------------------------------------ the kinds and their columns

    private sealed record Col(string Key, string En, string Ar, bool Required, params string[] Aliases);

    private static readonly Dictionary<string, Col[]> Kinds = new()
    {
        ["items"] = new Col[]
        {
            new("code", "Code", "الكود", false, "sku", "item code", "كود", "كود الصنف"),
            new("name", "Name", "اسم الصنف", true, "item", "product", "الاسم", "اسم", "الصنف", "المنتج"),
            new("department", "Department", "القسم", true, "dept", "قسم"),
            new("group", "Group", "المجموعة", false, "مجموعة", "category", "الفئة"),
            new("unit", "Unit", "الوحدة", false, "وحدة"),
            new("price", "Sale price", "سعر البيع", false, "price", "السعر", "البيع"),
            new("supply", "Supply price", "سعر التوريد", false, "cost", "cost price", "التكلفة", "سعر الشراء", "التوريد"),
            new("supplier", "Supplier", "المورد", false, "مورد", "المصنع"),
            new("barcode", "Barcode", "الباركود", false, "باركود"),
            new("reorder", "Reorder level", "حد الطلب", false, "reorder", "أقل كمية", "اقل كمية"),
        },
        ["customers"] = PartyColumns(customers: true),
        ["suppliers"] = PartyColumns(customers: false),
        ["opening_customers"] = OpeningPartyColumns("Customer", "العميل"),
        ["opening_suppliers"] = OpeningPartyColumns("Supplier", "المورد"),
        ["opening_money"] = new Col[]
        {
            new("account", "Cash box or bank", "الخزينة أو البنك", true, "account", "cash box", "الخزينة", "الحساب", "البنك"),
            new("amount", "Balance", "الرصيد", true, "amount", "المبلغ"),
        },
        ["opening_stock"] = new Col[]
        {
            new("item", "Item (code, barcode or name)", "الصنف (كود أو باركود أو اسم)", true, "item", "code", "الصنف", "الكود", "كود"),
            new("warehouse", "Warehouse", "المخزن", true, "store", "مخزن"),
            new("quantity", "Quantity", "الكمية", true, "qty", "كمية", "العدد"),
            new("cost", "Unit cost", "تكلفة الوحدة", true, "cost", "التكلفة", "سعر الشراء"),
        },
    };

    private static Col[] PartyColumns(bool customers) => new Col[]
    {
        new("code", "Code", "الكود", false, "كود", "رقم"),
        new("name", "Name", "الاسم", true, "اسم", customers ? "العميل" : "المورد", customers ? "customer" : "supplier"),
        new("phone", "Phone", "الهاتف", false, "mobile", "tel", "التليفون", "تليفون", "الموبايل", "موبايل"),
        new("phone2", "Other phones", "هواتف أخرى", false, "phone 2", "هاتف آخر", "تليفون 2"),
        new("address", "Address", "العنوان", false, "عنوان"),
        new("credit", "Credit limit", "حد الائتمان", false, "credit", "limit", "الائتمان"),
        new("contact", "Contact person", "المسؤول", false, "contact", "المسئول", "صاحب المصنع"),
        new("notes", "Notes", "ملاحظات", false, "note", "ملاحظة"),
    };

    private static Col[] OpeningPartyColumns(string en, string ar) => new Col[]
    {
        new("party", $"{en} (code or name)", $"{ar} (الكود أو الاسم)", true, en.ToLowerInvariant(), ar, "code", "name", "الكود", "الاسم"),
        new("amount", "Balance", "الرصيد", true, "amount", "المبلغ"),
    };

    private bool May(string kind) => Permissions.Imports.TryGetValue(kind, out var p) && User.Has(p);

    /// <summary>The kinds this person may import, with their columns.</summary>
    [HttpGet]
    [AnyPermission(Permissions.ImportItems, Permissions.ImportCustomers, Permissions.ImportSuppliers,
        Permissions.ImportOpeningCustomers, Permissions.ImportOpeningSuppliers, Permissions.ImportOpeningMoney,
        Permissions.ImportOpeningStock)]
    public ActionResult<ImportKindDto[]> List() => Ok(Kinds.Where(k => May(k.Key))
        .Select(k => new ImportKindDto(k.Key, k.Value.Select(c => new ImportColumnDto(c.Key, c.En, c.Ar, c.Required)).ToArray()))
        .ToArray());

    /// <summary>The kind's template: its headers (Arabic or English), and for cash boxes their names.</summary>
    [HttpGet("{kind}/template")]
    [AnyPermission(Permissions.ImportItems, Permissions.ImportCustomers, Permissions.ImportSuppliers,
        Permissions.ImportOpeningCustomers, Permissions.ImportOpeningSuppliers, Permissions.ImportOpeningMoney,
        Permissions.ImportOpeningStock)]
    public async Task<IActionResult> Template(string kind, [FromQuery] string? lang = null)
    {
        if (!Kinds.TryGetValue(kind, out var cols)) return NotFound(new { message = "Unknown kind.", code = "not_found" });
        if (!May(kind)) return Forbidden();
        var ar = lang != "en";
        var rows = new List<IReadOnlyList<string>> { cols.Select(c => ar ? c.Ar : c.En).ToList() };
        if (kind == "opening_money")
            foreach (var name in await _money.Visible(User).Where(a => a.IsActive && a.LastSeq == 0).OrderBy(a => a.Name)
                         .Select(a => a.Name).ToListAsync())
                rows.Add(new[] { name, "" });
        var bytes = XlsxImport.Write(ar ? "بيانات" : "Data", rows, ar);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{kind}.xlsx");
    }

    /// <summary>Check a file: what it would add or skip, and every row's problems. Nothing is saved.</summary>
    [HttpPost("{kind}/preview")]
    [AnyPermission(Permissions.ImportItems, Permissions.ImportCustomers, Permissions.ImportSuppliers,
        Permissions.ImportOpeningCustomers, Permissions.ImportOpeningSuppliers, Permissions.ImportOpeningMoney,
        Permissions.ImportOpeningStock)]
    [RequestSizeLimit(MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Preview(string kind, IFormFile? file)
    {
        var (plan, error) = await PlanAsync(kind, file);
        if (error is not null) return error;
        return Ok(plan!.Dto(kind));
    }

    /// <summary>Import a file: only when every row is right, all in one go.</summary>
    [HttpPost("{kind}")]
    [AnyPermission(Permissions.ImportItems, Permissions.ImportCustomers, Permissions.ImportSuppliers,
        Permissions.ImportOpeningCustomers, Permissions.ImportOpeningSuppliers, Permissions.ImportOpeningMoney,
        Permissions.ImportOpeningStock)]
    [RequestSizeLimit(MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Import(string kind, IFormFile? file)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var (plan, error) = await PlanAsync(kind, file);
        if (error is not null) return error;
        if (plan!.Errors.Count > 0)
            return UnprocessableEntity(new { message = "Some rows have problems; nothing was imported.", code = "import_has_errors",
                preview = plan.Dto(kind) });
        int added;
        try
        {
            added = plan.Apply is null ? 0 : await plan.Apply();
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        catch (ImportConflictException)
        {
            return Conflict(new { message = "The data changed while importing; nothing was imported.", code = "import_conflict" });
        }
        if (kind == "items" && added > 0) _storefront.MarkDirty();
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "import", $"import_{kind}",
            CurrentUser.BranchId(User), HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(),
            file!.FileName.Length > 120 ? file.FileName[..120] : file.FileName,
            $"{kind}: added {added}, skipped {plan.Skipped.Count}");
        return Ok(new ImportDoneDto(kind, added, plan.Skipped.Count));
    }

    private ObjectResult Forbidden() => StatusCode(403, new { message = "Not allowed.", code = "forbidden" });

    // ------------------------------------------------------------------ reading the file

    private sealed class Plan
    {
        public readonly List<ImportErrorDto> Errors = new();
        public readonly HashSet<int> Skipped = new();
        public readonly List<ImportRowDto> Sample = new();
        public int Rows;
        public Func<Task<int>>? Apply;

        public void Err(int row, string? col, string code, string? value = null) =>
            Errors.Add(new ImportErrorDto(row, col, code, value is { Length: > 80 } ? value[..80] : value));

        public ImportPreviewDto Dto(string kind)
        {
            var bad = Errors.Select(e => e.Row).Where(r => r > 0).ToHashSet();
            var rows = Sample.Select(r => r with { Status = bad.Contains(r.Row) ? "error" : Skipped.Contains(r.Row) ? "skip" : "new" })
                .ToArray();
            var ready = Errors.Count > 0 && bad.Count == 0 ? 0 : Rows - bad.Count - Skipped.Count(s => !bad.Contains(s));
            return new ImportPreviewDto(kind, Rows, Math.Max(0, ready), Skipped.Count, Errors.Take(1000).ToArray(), Errors.Count, rows);
        }
    }

    private sealed record Row(int No, IReadOnlyList<string> Cells, Dictionary<string, int> Map)
    {
        public string? this[string key] => Map.TryGetValue(key, out var j) && j < Cells.Count && !string.IsNullOrWhiteSpace(Cells[j])
            ? Cells[j].Trim() : null;
    }

    private async Task<(Plan? Plan, IActionResult? Error)> PlanAsync(string kind, IFormFile? file)
    {
        if (!Kinds.TryGetValue(kind, out var cols)) return (null, NotFound(new { message = "Unknown kind.", code = "not_found" }));
        if (!May(kind)) return (null, Forbidden());
        if (file is null || file.Length == 0) return (null, BadRequest(new { message = "Choose a file to import.", code = "no_file" }));
        if (file.Length > MaxBytes) return (null, BadRequest(new { message = "The file is larger than 10 MB.", code = "file_too_big" }));
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var workbook = XlsxImport.Read(ms.ToArray());
        if (workbook is null)
            return (null, BadRequest(new { message = "This isn't a readable Excel (.xlsx) file.", code = "bad_file" }));

        var plan = new Plan();
        var sheet = workbook.Sheets.FirstOrDefault(s => s.Rows.Any(r => !Blank(r)));
        if (sheet is null) { plan.Err(0, null, "empty"); return (plan, null); }
        var headerAt = 0;
        while (Blank(sheet.Rows[headerAt])) headerAt++;
        var map = MapColumns(sheet.Rows[headerAt], cols);
        foreach (var c in cols.Where(c => c.Required && !map.ContainsKey(c.Key))) plan.Err(0, c.Key, "missing_column");
        var rows = new List<Row>();
        for (var i = headerAt + 1; i < sheet.Rows.Count; i++)
            if (!Blank(sheet.Rows[i])) rows.Add(new Row(i + 1, sheet.Rows[i], map));
        plan.Rows = rows.Count;
        if (rows.Count == 0 && plan.Errors.Count == 0) plan.Err(0, null, "empty");
        if (rows.Count > MaxRows) plan.Err(0, null, "too_many_rows", MaxRows.ToString());
        if (plan.Errors.Count > 0) return (plan, null);
        foreach (var r in rows.Take(SampleRows))
            plan.Sample.Add(new ImportRowDto(r.No, "new", cols.Select(c => r[c.Key] ?? "").ToArray()));

        switch (kind)
        {
            case "items": await PlanItemsAsync(plan, rows); break;
            case "customers": await PlanPartiesAsync(plan, rows, PartyType.CUSTOMER); break;
            case "suppliers": await PlanPartiesAsync(plan, rows, PartyType.SUPPLIER); break;
            case "opening_customers": await PlanOpeningPartiesAsync(plan, rows, PartyType.CUSTOMER); break;
            case "opening_suppliers": await PlanOpeningPartiesAsync(plan, rows, PartyType.SUPPLIER); break;
            case "opening_money": await PlanOpeningMoneyAsync(plan, rows); break;
            case "opening_stock": await PlanOpeningStockAsync(plan, rows); break;
        }
        return (plan, null);
    }

    // ------------------------------------------------------------------ items

    private sealed record ItemRow(int No, string Name, string? Code, string Department, string? Group, string? Unit, long? Price,
        long? Supply, string? Supplier, string? Barcode, int? Reorder);

    private async Task PlanItemsAsync(Plan plan, List<Row> rows)
    {
        var names = (await _db.Products.AsNoTracking().Where(p => p.IsActive).Select(p => p.Name).ToListAsync())
            .Select(Lower).ToHashSet();
        var codes = (await _db.Products.AsNoTracking().Select(p => p.Sku).ToListAsync()).Select(Upper).ToHashSet();
        var barcodes = (await _db.ItemUnits.AsNoTracking().Where(u => u.Barcode != null).Select(u => u.Barcode!).ToListAsync())
            .ToHashSet();
        var inFile = new HashSet<string>();
        var ready = new List<ItemRow>();
        foreach (var r in rows)
        {
            var before = plan.Errors.Count;
            var name = Required(plan, r, "name");
            var department = Required(plan, r, "department");
            string? code = null;
            if (r["code"] is { } rawCode)
            {
                code = Catalog.CleanCode(rawCode, 40);
                if (code is null) plan.Err(r.No, "code", "bad_code", rawCode);
                else if (codes.Contains(Upper(code))) plan.Err(r.No, "code", "code_used", code);
                else if (!inFile.Add("code:" + Upper(code))) plan.Err(r.No, "code", "duplicate", code);
            }
            var price = Amount(plan, r, "price");
            var supply = Amount(plan, r, "supply");
            var reorder = Whole(plan, r, "reorder", allowZero: true);
            var barcode = Catalog.CleanBarcode(r["barcode"]);
            if (barcode is not null)
            {
                if (barcodes.Contains(barcode)) plan.Err(r.No, "barcode", "barcode_used", barcode);
                else if (!inFile.Add("barcode:" + barcode)) plan.Err(r.No, "barcode", "duplicate", barcode);
            }
            if (name is not null && !inFile.Add("name:" + Lower(name))) plan.Err(r.No, "name", "duplicate", name);
            if (plan.Errors.Count > before) continue;
            if (names.Contains(Lower(name!))) { plan.Skipped.Add(r.No); continue; }
            ready.Add(new ItemRow(r.No, name!, code, department!, Loc.Clean(r["group"]), Loc.Clean(r["unit"]), price, supply,
                Loc.Clean(r["supplier"]), barcode, reorder));
        }
        plan.Apply = () => ApplyItemsAsync(ready);
    }

    private async Task<int> ApplyItemsAsync(List<ItemRow> rows)
    {
        var currency = await CurrencyAsync();
        var saleLevel = await _db.PriceLevels.Where(l => l.Side == PriceSide.SALE && l.IsActive)
            .OrderByDescending(l => l.IsDefault).Select(l => (Guid?)l.Id).FirstOrDefaultAsync();
        var supplyLevel = await _db.PriceLevels.Where(l => l.Side == PriceSide.PURCHASE && l.IsActive)
            .OrderByDescending(l => l.IsDefault).Select(l => (Guid?)l.Id).FirstOrDefaultAsync();
        var departments = new Dictionary<string, Department>();
        var groups = new Dictionary<(Guid, string), Category>();
        var units = new Dictionary<string, Unit>();
        var suppliers = new Dictionary<string, Guid>();
        var barcodes = new HashSet<string>(rows.Where(r => r.Barcode is not null).Select(r => r.Barcode!));
        Unit? anyUnit = null;
        var created = new List<Guid>();
        foreach (var r in rows)
        {
            var deptKey = Lower(r.Department);
            var department = departments.GetValueOrDefault(deptKey)
                             ?? await _db.Departments.FirstOrDefaultAsync(d => d.Name.ToLower() == deptKey);
            if (department is null)
            {
                department = new Department { Name = r.Department };
                _db.Departments.Add(department);
            }
            departments[deptKey] = department;
            var root = await Catalog.RootOfAsync(_db, department);
            var categoryId = root;
            var path = new List<Category>();
            if (r.Group is { } groupName)
            {
                var key = (department.Id, Lower(groupName));
                var group = groups.GetValueOrDefault(key)
                            ?? await _db.Categories.FirstOrDefaultAsync(c =>
                                c.DepartmentId == department.Id && !c.IsRoot && c.Name.ToLower() == key.Item2);
                if (group is null)
                {
                    group = new Category { Name = groupName, DepartmentId = department.Id, ParentId = root };
                    _db.Categories.Add(group);
                }
                groups[key] = group;
                categoryId = group.Id;
                path.Add(group);
            }
            Guid? supplierId = null;
            if (r.Supplier is { } supplierName)
            {
                var supplierKey = Lower(supplierName);
                if (!suppliers.TryGetValue(supplierKey, out var sid))
                {
                    var found = await _db.Parties.Where(p => p.Name.ToLower() == supplierKey
                                                              && p.Types.Contains(nameof(PartyType.SUPPLIER)))
                        .Select(p => (Guid?)p.Id).FirstOrDefaultAsync();
                    if (found is null)
                    {
                        var party = new Party { Name = supplierName, Currency = currency, Types = new() { nameof(PartyType.SUPPLIER) } };
                        _db.Parties.Add(party);
                        await _db.SaveChangesAsync();
                        found = party.Id;
                    }
                    sid = found.Value;
                    suppliers[supplierKey] = sid;
                }
                supplierId = sid;
            }
            Unit unit;
            if (r.Unit is { } unitName)
            {
                var unitKey = Lower(unitName);
                unit = units.GetValueOrDefault(unitKey)
                       ?? await _db.Units.FirstOrDefaultAsync(u => u.Name.ToLower() == unitKey)
                       ?? _db.Units.Add(new Unit { Name = unitName, Pieces = 1 }).Entity;
                units[unitKey] = unit;
            }
            else
            {
                anyUnit ??= await _db.Units.OrderBy(u => u.CreatedAt).FirstOrDefaultAsync()
                            ?? _db.Units.Add(new Unit { Name = "قطعة", Pieces = 1 }).Entity;
                unit = anyUnit;
            }
            await _db.SaveChangesAsync();

            var product = new Product
            {
                Name = r.Name, Currency = currency, CategoryId = categoryId, SupplierId = supplierId,
                ReorderLevel = r.Reorder ?? 0, SalePrice = r.Price ?? 0,
            };
            product.Sku = r.Code ?? await Catalog.NextCodeForAsync(_db, department, path, supplierId);
            _db.Products.Add(product);
            _db.ItemUnits.Add(new ItemUnit
            {
                ProductId = product.Id, UnitId = unit.Id, Factor = 1, Barcode = r.Barcode ?? await Catalog.NextBarcodeAsync(_db, barcodes),
            });
            if (r.Price is > 0 && saleLevel is Guid sale)
                _db.ItemPrices.Add(new ItemPrice { ProductId = product.Id, UnitId = unit.Id, PriceLevelId = sale, Price = r.Price.Value });
            if (r.Supply is > 0 && supplyLevel is Guid supply)
                _db.ItemPrices.Add(new ItemPrice { ProductId = product.Id, UnitId = unit.Id, PriceLevelId = supply, Price = r.Supply.Value });
            created.Add(product.Id);
            // Each item saved before the next, whose code is drawn from what is stored.
            await _db.SaveChangesAsync();
        }
        await PriceBook.SyncListPricesAsync(_db, created);
        return created.Count;
    }

    // ------------------------------------------------------------------ customers and suppliers

    private sealed record PartyRow(int No, int? Code, string Name, string? Phone, List<string> Others, string? Address, long? Credit,
        string? Contact, string? Notes);

    private async Task PlanPartiesAsync(Plan plan, List<Row> rows, PartyType type)
    {
        var existing = await _db.Parties.AsNoTracking().Select(p => new { p.Code, p.Name, p.Types }).ToListAsync();
        var codes = existing.Select(p => p.Code).ToHashSet();
        var named = existing.GroupBy(p => Lower(p.Name)).ToDictionary(g => g.Key, g => g.Any(p => p.Types.Contains(type.ToString())));
        var inFile = new HashSet<string>();
        var ready = new List<PartyRow>();
        foreach (var r in rows)
        {
            var before = plan.Errors.Count;
            var name = Required(plan, r, "name");
            int? code = null;
            if (r["code"] is { } rawCode)
            {
                if (Catalog.ParseAmount(rawCode) is not long c || c % 100 != 0 || c / 100 is < 1 or > int.MaxValue)
                    plan.Err(r.No, "code", "bad_code", rawCode);
                else if (codes.Contains((int)(c / 100))) plan.Err(r.No, "code", "code_used", rawCode);
                else if (!inFile.Add("code:" + c / 100)) plan.Err(r.No, "code", "duplicate", rawCode);
                else code = (int)(c / 100);
            }
            var credit = Amount(plan, r, "credit");
            if (name is not null && !inFile.Add("name:" + Lower(name))) plan.Err(r.No, "name", "duplicate", name);
            if (name is not null && named.TryGetValue(Lower(name), out var sameKind) && !sameKind)
                plan.Err(r.No, "name", "exists_other_kind", name);
            if (plan.Errors.Count > before) continue;
            if (named.ContainsKey(Lower(name!))) { plan.Skipped.Add(r.No); continue; }
            var others = (r["phone2"] ?? "").Split(new[] { ',', '،', ';', '/' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(p => Clip(p, 40)!).Take(5).ToList();
            ready.Add(new PartyRow(r.No, code, name!, Clip(r["phone"], 40), others, Clip(r["address"], 400), credit,
                Clip(r["contact"], 120), Clip(r["notes"], 1000)));
        }
        plan.Apply = async () =>
        {
            var currency = await CurrencyAsync();
            // Rows with their own code first, then the counter moves past them for the rest.
            foreach (var group in ready.GroupBy(p => p.Code is null).OrderBy(g => g.Key))
            {
                foreach (var p in group)
                {
                    var party = new Party
                    {
                        Name = p.Name, Currency = currency, Types = new() { type.ToString() }, Phone = p.Phone,
                        OtherPhones = p.Others, OtherPhoneLabels = p.Others.Select(_ => "").ToList(), Address = p.Address,
                        ContactName = p.Contact, Notes = p.Notes, CreditLimit = p.Credit is > 0 ? p.Credit : null,
                    };
                    if (p.Code is int c) party.Code = c;
                    _db.Parties.Add(party);
                }
                await _db.SaveChangesAsync();
                if (!group.Key)
                    await _db.Database.ExecuteSqlRawAsync("""
                        SELECT setval('"PartyCodes"', GREATEST((SELECT COALESCE(max("Code"), 1) FROM "Parties"),
                                                               (SELECT last_value FROM "PartyCodes")))
                        """);
            }
            return ready.Count;
        };
    }

    // ------------------------------------------------------------------ opening balances

    private async Task PlanOpeningPartiesAsync(Plan plan, List<Row> rows, PartyType type)
    {
        var parties = await _db.Parties.AsNoTracking().Where(p => p.IsActive && p.Types.Contains(type.ToString()))
            .Select(p => new { p.Id, p.Code, p.Name }).ToListAsync();
        var opened = (await _db.JournalEntries.AsNoTracking().Where(e => e.SourceType == "PARTY_OPENING" && e.SourceId != null)
            .Select(e => e.SourceId!.Value).ToListAsync()).ToHashSet();
        var seen = new HashSet<Guid>();
        var ready = new List<(Guid Id, long Amount)>();
        foreach (var r in rows)
        {
            var before = plan.Errors.Count;
            var raw = Required(plan, r, "party");
            var amount = Signed(plan, r, "amount");
            if (raw is null || plan.Errors.Count > before) continue;
            var matches = int.TryParse(Digits(raw), out var code) && parties.Any(p => p.Code == code)
                ? parties.Where(p => p.Code == code).ToList()
                : parties.Where(p => Lower(p.Name) == Lower(raw)).ToList();
            if (matches.Count == 0) { plan.Err(r.No, "party", "unknown_party", raw); continue; }
            if (matches.Count > 1) { plan.Err(r.No, "party", "ambiguous", raw); continue; }
            var id = matches[0].Id;
            if (!seen.Add(id)) { plan.Err(r.No, "party", "duplicate", raw); continue; }
            if (opened.Contains(id)) { plan.Err(r.No, "party", "already_opened", raw); continue; }
            if (amount == 0) { plan.Skipped.Add(r.No); continue; }
            ready.Add((id, amount!.Value));
        }
        plan.Apply = async () =>
        {
            var ids = ready.Select(x => x.Id).OrderBy(x => x).ToArray();
            if (ids.Length == 0) return 0;
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"Parties\" WHERE \"Id\" = ANY({ids}) ORDER BY \"Id\" FOR UPDATE");
            if (await _db.JournalEntries.AnyAsync(e => e.SourceType == "PARTY_OPENING" && e.SourceId != null && ids.Contains(e.SourceId.Value)))
                throw new ImportConflictException();
            var locked = await _db.Parties.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
            var equity = await _ledger.SystemAsync(LedgerKeys.OpeningEquity);
            foreach (var (id, amount) in ready)
            {
                var party = locked[id];
                await _db.Entry(party).ReloadAsync(); // the balance as of the lock
                // A customer's balance is what they owe us; a supplier's opening is what we owe them.
                var delta = type == PartyType.CUSTOMER ? amount : -amount;
                party.Balance += delta;
                var role = type == PartyType.CUSTOMER ? LedgerService.PartyRole.Customer : LedgerService.PartyRole.Supplier;
                _ledger.Post(_ledger.Begin("PARTY_OPENING", party.Id, "OPENING", $"Opening balance — {party.Name}", null, Me())
                    .Debit(await _ledger.ForPartyAsync(party, role), delta).Credit(equity, delta));
            }
            return ready.Count;
        };
    }

    private async Task PlanOpeningMoneyAsync(Plan plan, List<Row> rows)
    {
        var accounts = await _money.Visible(User).AsNoTracking().Where(a => a.IsActive)
            .Select(a => new { a.Id, a.Name, a.LastSeq }).ToListAsync();
        var seen = new HashSet<Guid>();
        var ready = new List<(Guid Id, long Amount)>();
        foreach (var r in rows)
        {
            var before = plan.Errors.Count;
            var raw = Required(plan, r, "account");
            var amount = Amount(plan, r, "amount", required: true);
            if (raw is null || plan.Errors.Count > before) continue;
            var matches = accounts.Where(a => Lower(a.Name) == Lower(raw)).ToList();
            if (matches.Count == 0) { plan.Err(r.No, "account", "unknown_account", raw); continue; }
            if (matches.Count > 1) { plan.Err(r.No, "account", "ambiguous", raw); continue; }
            if (!seen.Add(matches[0].Id)) { plan.Err(r.No, "account", "duplicate", raw); continue; }
            if (matches[0].LastSeq != 0) { plan.Err(r.No, "account", "has_movements", raw); continue; }
            if (amount == 0) { plan.Skipped.Add(r.No); continue; }
            ready.Add((matches[0].Id, amount!.Value));
        }
        plan.Apply = async () =>
        {
            var locked = await _money.LockAsync(ready.Select(x => x.Id));
            foreach (var (id, amount) in ready)
            {
                var account = locked[id];
                // Checked again under the lock: money may have moved since the file was read.
                if (account.LastSeq != 0) throw new ImportConflictException();
                _money.Move(account, amount, MoneyMovementKind.OPENING, Me(), null, notes: "Opening balance");
                await _ledger.PostMoneyOpeningAsync(account, amount, Me());
            }
            return ready.Count;
        };
    }

    private sealed record StockRow(Guid Product, Guid Warehouse, Guid Branch, int Quantity, long Value);

    private async Task PlanOpeningStockAsync(Plan plan, List<Row> rows)
    {
        var warehouses = await _warehouses.Visible(User).AsNoTracking()
            .Where(w => w.IsActive && w.Kind == WarehouseKind.STORE).Select(w => new { w.Id, w.Name, w.Code, w.BranchId }).ToListAsync();
        var products = await _db.Products.AsNoTracking().Where(p => p.IsActive).Select(p => new { p.Id, p.Sku, p.Name }).ToListAsync();
        var bySku = products.GroupBy(p => Upper(p.Sku)).ToDictionary(g => g.Key, g => g.First().Id);
        var byBarcode = (await _db.ItemUnits.AsNoTracking().Where(u => u.Barcode != null && u.Product!.IsActive)
                .Select(u => new { u.Barcode, u.ProductId, u.Factor }).ToListAsync())
            .GroupBy(u => u.Barcode!).ToDictionary(g => g.Key, g => (g.First().ProductId, g.First().Factor));
        var moved = (await _db.StockMovements.AsNoTracking().Select(m => new { m.ProductId, m.WarehouseId }).Distinct().ToListAsync())
            .Select(m => (m.ProductId, m.WarehouseId)).ToHashSet();
        var seen = new HashSet<(Guid, Guid)>();
        var ready = new List<StockRow>();
        foreach (var r in rows)
        {
            var before = plan.Errors.Count;
            var item = Required(plan, r, "item");
            var store = Required(plan, r, "warehouse");
            var qty = Whole(plan, r, "quantity", allowZero: false, required: true);
            var cost = Amount(plan, r, "cost", required: true);
            if (plan.Errors.Count > before) continue;
            Guid? product = null;
            var factor = 1;
            if (bySku.TryGetValue(Upper(item!), out var p)) product = p;
            else if (byBarcode.TryGetValue(item!, out var b)) (product, factor) = (b.ProductId, Math.Max(1, (int)b.Factor));
            else
            {
                var named = products.Where(x => Lower(x.Name) == Lower(item!)).ToList();
                if (named.Count > 1) { plan.Err(r.No, "item", "ambiguous", item); continue; }
                product = named.FirstOrDefault()?.Id;
            }
            if (product is null) { plan.Err(r.No, "item", "unknown_item", item); continue; }
            var whs = warehouses.Where(w => Lower(w.Name) == Lower(store!) || Upper(w.Code) == Upper(store!)).ToList();
            if (whs.Count == 0) { plan.Err(r.No, "warehouse", "unknown_warehouse", store); continue; }
            if (whs.Count > 1) { plan.Err(r.No, "warehouse", "ambiguous", store); continue; }
            var w = whs[0];
            if (!seen.Add((product.Value, w.Id))) { plan.Err(r.No, "item", "duplicate", item); continue; }
            if (moved.Contains((product.Value, w.Id))) { plan.Err(r.No, "item", "has_movements", item); continue; }
            var baseQty = (long)qty!.Value * factor;
            if (baseQty > 1_000_000) { plan.Err(r.No, "quantity", "bad_number", r["quantity"]); continue; }
            ready.Add(new StockRow(product.Value, w.Id, w.BranchId, (int)baseQty, qty.Value * cost!.Value));
        }
        plan.Apply = async () =>
        {
            if (ready.Count == 0) return 0;
            var productIds = ready.Select(x => x.Product).Distinct().ToList();
            var storeIds = ready.Select(x => x.Warehouse).Distinct().ToList();
            var locked = await _inventory.LockProductsAsync(productIds);
            var stores = await _db.Warehouses.Where(w => storeIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id);
            var moves = (await _db.StockMovements.Where(m => productIds.Contains(m.ProductId))
                .Select(m => new { m.ProductId, m.WarehouseId }).ToListAsync()).Select(m => (m.ProductId, m.WarehouseId)).ToHashSet();
            foreach (var x in ready)
            {
                if (moves.Contains((x.Product, x.Warehouse))) throw new ImportConflictException();
                _inventory.ReceiveValue(locked[x.Product], stores[x.Warehouse], x.Quantity, x.Value, StockMovementType.OPENING, null, "OPENING");
            }
            var inventory = await _ledger.SystemAsync(LedgerKeys.Inventory);
            var equity = await _ledger.SystemAsync(LedgerKeys.OpeningEquity);
            foreach (var branch in ready.GroupBy(x => x.Branch))
            {
                var value = branch.Sum(x => x.Value);
                _ledger.Post(_ledger.Begin("STOCK_OPENING", null, "OPENING", "Opening stock", branch.Key, Me())
                    .Debit(inventory, value).Credit(equity, value));
            }
            return ready.Count;
        };
    }

    // ------------------------------------------------------------------ cells

    private static string? Required(Plan plan, Row r, string key)
    {
        var v = Loc.Clean(r[key]);
        if (v is null) plan.Err(r.No, key, "required");
        return v;
    }

    /// <summary>An amount (minor units, 0 or more); null when the cell is empty.</summary>
    private static long? Amount(Plan plan, Row r, string key, bool required = false)
    {
        var raw = r[key];
        if (raw is null)
        {
            if (required) plan.Err(r.No, key, "required");
            return null;
        }
        var v = Catalog.ParseAmount(raw);
        if (v is null || v > InvoiceLines.MaxPrice) { plan.Err(r.No, key, "bad_amount", raw); return null; }
        return v;
    }

    /// <summary>An amount that may be below zero (a customer we owe, a supplier who owes us).</summary>
    private static long? Signed(Plan plan, Row r, string key)
    {
        var raw = r[key];
        if (raw is null) { plan.Err(r.No, key, "required"); return null; }
        var t = raw.Trim();
        var negative = t.StartsWith('-') || t.StartsWith('−') || (t.StartsWith('(') && t.EndsWith(')'));
        var v = Catalog.ParseAmount(t.Trim('-', '−', '(', ')', ' '));
        if (v is null || v > InvoiceLines.MaxPrice) { plan.Err(r.No, key, "bad_amount", raw); return null; }
        return negative ? -v : v;
    }

    /// <summary>A whole number; null when the cell is empty.</summary>
    private static int? Whole(Plan plan, Row r, string key, bool allowZero, bool required = false)
    {
        var raw = r[key];
        if (raw is null)
        {
            if (required) plan.Err(r.No, key, "required");
            return null;
        }
        var v = Catalog.ParseAmount(raw);
        if (v is not long n || n % 100 != 0 || n / 100 > 1_000_000 || (!allowZero && n == 0))
        {
            plan.Err(r.No, key, "bad_number", raw);
            return null;
        }
        return (int)(n / 100);
    }

    private static Dictionary<string, int> MapColumns(IReadOnlyList<string> header, Col[] cols)
    {
        var map = new Dictionary<string, int>();
        for (var j = 0; j < header.Count; j++)
        {
            var h = Normalize(header[j]);
            if (h.Length == 0) continue;
            // Its own headers first (either language), then the other names it's known by.
            var col = cols.FirstOrDefault(c => !map.ContainsKey(c.Key) && (Normalize(c.En) == h || Normalize(c.Ar) == h))
                      ?? cols.FirstOrDefault(c => !map.ContainsKey(c.Key) && c.Aliases.Any(a => Normalize(a) == h));
            if (col is not null) map[col.Key] = j;
        }
        return map;
    }

    /// <summary>Lower case, no spaces, tatweel or diacritics, for loose matching of headers.</summary>
    private static string Normalize(string s)
    {
        var t = (s ?? "").Trim().ToLowerInvariant().Replace(" ", "").Replace("ـ", "").Replace("_", "");
        return new string(t.Where(c => c is < 'ً' or > 'ْ').ToArray());
    }

    private static bool Blank(IReadOnlyList<string> row) => row.All(string.IsNullOrWhiteSpace);
    private static string Lower(string s) => s.Trim().ToLowerInvariant();
    private static string Upper(string s) => s.Trim().ToUpperInvariant();

    private static string? Clip(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private static string Digits(string s) => new(s.Trim().Select(ch => ch is >= '٠' and <= '٩' ? (char)('0' + (ch - '٠')) : ch).ToArray());

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
}

/// <summary>Something changed between reading the file and saving it (e.g. money moved): nothing is saved.</summary>
public sealed class ImportConflictException : Exception;
