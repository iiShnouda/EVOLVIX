using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Load items, customers and suppliers in bulk from an Excel file the owner uploads (owner,
/// 2026-10-14). The owner's alone (<see cref="Permissions.DataImport"/>). The template and the demo
/// file are built on the device (the web app's xlsx writer); the server only reads an upload, so it
/// takes no file in and keeps none — it parses the workbook in memory, creates the rows through the
/// same rules as the normal screens (audited), and answers with what was added, skipped or wrong.
/// Each sheet and column is matched by name in Arabic or English, so order doesn't matter.
/// </summary>
[ApiController]
[Route("api/import")]
[Authorize(Policy = Permissions.DataImport)]
public sealed class ImportController : ControllerBase
{
    private const long MaxBytes = 10 * 1024 * 1024;

    private readonly AppDbContext _db;
    private readonly AuditService _audit;
    private readonly StorefrontPublisher _storefront;

    public ImportController(AppDbContext db, AuditService audit, StorefrontPublisher storefront)
    {
        _db = db;
        _audit = audit;
        _storefront = storefront;
    }

    [HttpPost]
    public async Task<ActionResult<ImportResultDto>> Upload(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Choose a file to import.", code = "no_file" });
        if (file.Length > MaxBytes)
            return BadRequest(new { message = "The file is larger than 10 MB.", code = "file_too_big" });

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var workbook = XlsxImport.Read(ms.ToArray());
        if (workbook is null)
            return BadRequest(new { message = "This isn't a readable Excel (.xlsx) file.", code = "bad_file" });

        var groups = new List<ImportGroupDto>();
        var unknown = new List<string>();
        var createdProducts = new List<Guid>();

        await using var tx = await _db.Database.BeginTransactionAsync();
        foreach (var sheet in workbook.Sheets)
        {
            var kind = KindOf(sheet.Name);
            if (kind is null) { if (sheet.Rows.Count > 0) unknown.Add(sheet.Name); continue; }
            var group = kind switch
            {
                "items" => await ImportItemsAsync(sheet, createdProducts),
                "customers" => await ImportPartiesAsync(sheet, PartyType.CUSTOMER),
                _ => await ImportPartiesAsync(sheet, PartyType.SUPPLIER),
            };
            groups.Add(group);
        }

        if (createdProducts.Count > 0)
        {
            await PriceBook.SyncListPricesAsync(_db, createdProducts);
            await _db.SaveChangesAsync();
        }
        await tx.CommitAsync();

        if (createdProducts.Count > 0) _storefront.MarkDirty();
        var added = groups.Sum(g => g.Added);
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), "data.import", "import",
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            details: string.Join("; ", groups.Select(g => $"{g.Kind}:{g.Added}")));

        return Ok(new ImportResultDto(groups.ToArray(), unknown.ToArray()));
    }

    // ---- items --------------------------------------------------------------------------------

    private async Task<ImportGroupDto> ImportItemsAsync(XlsxImport.Sheet sheet, List<Guid> created)
    {
        var (header, dataRows) = SplitHeader(sheet);
        var col = MapColumns(header, ItemColumns);
        var issues = new List<ImportIssueDto>();
        int added = 0, skipped = 0;
        if (!col.ContainsKey("name"))
            return new ImportGroupDto("items", 0, 0, new[] { new ImportIssueDto(sheet.Name, 1, "No 'Name' column was found.") });

        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        var saleLevelId = await _db.PriceLevels.Where(l => l.Side == PriceSide.SALE && l.IsActive)
            .OrderByDescending(l => l.IsDefault).Select(l => (Guid?)l.Id).FirstOrDefaultAsync();
        var branchId = Access.Work(User);

        // Caches so repeated names reuse the same department/unit and re-imports stay tidy.
        var deptByName = new Dictionary<string, Department>(StringComparer.OrdinalIgnoreCase);
        var unitByName = new Dictionary<string, Unit>(StringComparer.OrdinalIgnoreCase);
        var existingNames = (await _db.Products.AsNoTracking().Where(p => p.IsActive).Select(p => p.Name).ToListAsync())
            .Select(n => n.ToLowerInvariant()).ToHashSet();
        var usedBarcodes = new HashSet<string>();
        Unit? defaultUnit = null;

        for (var i = 0; i < dataRows.Count; i++)
        {
            var row = dataRows[i];
            var rowNo = RowNumber(sheet, i);
            var name = Loc.Clean(Cell(row, col, "name"));
            if (name is null) { if (!Blank(row)) issues.Add(new(sheet.Name, rowNo, "The item needs a name.")); continue; }
            if (!existingNames.Add(name.ToLowerInvariant())) { skipped++; continue; }

            var deptName = Loc.Clean(Cell(row, col, "department"));
            if (deptName is null) { issues.Add(new(sheet.Name, rowNo, $"'{name}' has no department.")); existingNames.Remove(name.ToLowerInvariant()); continue; }
            var department = await DepartmentAsync(deptName, deptByName);
            var categoryId = await Catalog.RootOfAsync(_db, department);

            var product = new Product { Name = name, Currency = currency, CategoryId = categoryId };

            var reorder = Catalog.ParseAmount(Cell(row, col, "reorder"));
            if (reorder is long r) product.ReorderLevel = (int)Math.Min(int.MaxValue, r / 100);

            var supplierName = Loc.Clean(Cell(row, col, "supplier"));
            if (supplierName is not null)
                product.SupplierId = (await SupplierAsync(supplierName)).Id;

            product.Sku = await Catalog.NextCodeForAsync(_db, branchId, null, department, Array.Empty<Category>());

            var cost = Catalog.ParseAmount(Cell(row, col, "cost"));
            if (cost is long c) product.CostPrice = c;
            var price = Catalog.ParseAmount(Cell(row, col, "price"));
            if (price is long p) product.SalePrice = p;

            var unit = await UnitAsync(Loc.Clean(Cell(row, col, "unit")), unitByName, () => defaultUnit, u => defaultUnit = u);
            var barcode = Catalog.CleanBarcode(Cell(row, col, "barcode"));
            if (barcode is not null)
            {
                if (!usedBarcodes.Add(barcode)
                    || await _db.ItemUnits.AnyAsync(u => u.Barcode == barcode))
                {
                    issues.Add(new(sheet.Name, rowNo, $"Barcode {barcode} is already used."));
                    existingNames.Remove(name.ToLowerInvariant());
                    continue;
                }
            }
            else
            {
                barcode = await Catalog.NextBarcodeAsync(_db, usedBarcodes);
            }

            _db.Products.Add(product);
            _db.ItemUnits.Add(new ItemUnit { ProductId = product.Id, UnitId = unit.Id, Factor = 1, Barcode = barcode });
            if (price is long sale && sale > 0 && saleLevelId is Guid level)
                _db.ItemPrices.Add(new ItemPrice { ProductId = product.Id, UnitId = unit.Id, PriceLevelId = level, Price = sale });
            created.Add(product.Id);
            added++;

            // Save each item so the next row's code/SKU sees it (codes are drawn from what's stored).
            await _db.SaveChangesAsync();
        }
        return new ImportGroupDto("items", added, skipped, issues.ToArray());
    }

    private async Task<Department> DepartmentAsync(string name, Dictionary<string, Department> cache)
    {
        if (cache.TryGetValue(name, out var hit)) return hit;
        var lower = name.ToLowerInvariant();
        var found = _db.Departments.Local.FirstOrDefault(d => d.Name.ToLowerInvariant() == lower)
            ?? await _db.Departments.FirstOrDefaultAsync(d => d.Name.ToLower() == lower);
        if (found is null)
        {
            found = new Department { Name = name };
            _db.Departments.Add(found);
            await _db.SaveChangesAsync();
        }
        cache[name] = found;
        return found;
    }

    private async Task<(bool Ok, Guid? Id)> SupplierAsync(string name)
    {
        var lower = name.ToLowerInvariant();
        var found = _db.Parties.Local.FirstOrDefault(p => p.Name.ToLowerInvariant() == lower && p.Types.Contains(nameof(PartyType.SUPPLIER)))
            ?? await _db.Parties.FirstOrDefaultAsync(p => p.Name.ToLower() == lower && p.Types.Contains(nameof(PartyType.SUPPLIER)));
        if (found is null)
        {
            found = new Party { Name = name, Types = new List<string> { nameof(PartyType.SUPPLIER) },
                Currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP" };
            _db.Parties.Add(found);
            await _db.SaveChangesAsync();
        }
        return (true, found.Id);
    }

    private async Task<Unit> UnitAsync(string? name, Dictionary<string, Unit> cache, Func<Unit?> getDefault, Action<Unit> setDefault)
    {
        if (name is not null)
        {
            if (cache.TryGetValue(name, out var hit)) return hit;
            var lower = name.ToLowerInvariant();
            var found = _db.Units.Local.FirstOrDefault(u => u.Name.ToLowerInvariant() == lower)
                ?? await _db.Units.FirstOrDefaultAsync(u => u.Name.ToLower() == lower);
            if (found is null)
            {
                found = new Unit { Name = name, Pieces = 1 };
                _db.Units.Add(found);
                await _db.SaveChangesAsync();
            }
            cache[name] = found;
            return found;
        }
        // No unit named: reuse an existing one (or make a "piece") so every item still has a base unit.
        var current = getDefault();
        if (current is not null) return current;
        var any = await _db.Units.OrderBy(u => u.CreatedAt).FirstOrDefaultAsync();
        if (any is null)
        {
            any = new Unit { Name = "قطعة", Pieces = 1 };
            _db.Units.Add(any);
            await _db.SaveChangesAsync();
        }
        setDefault(any);
        return any;
    }

    // ---- parties ------------------------------------------------------------------------------

    private async Task<ImportGroupDto> ImportPartiesAsync(XlsxImport.Sheet sheet, PartyType type)
    {
        var kind = type == PartyType.CUSTOMER ? "customers" : "suppliers";
        var (header, dataRows) = SplitHeader(sheet);
        var col = MapColumns(header, PartyColumns);
        var issues = new List<ImportIssueDto>();
        int added = 0, skipped = 0;
        if (!col.ContainsKey("name"))
            return new ImportGroupDto(kind, 0, 0, new[] { new ImportIssueDto(sheet.Name, 1, "No 'Name' column was found.") });

        var currency = await _db.CompanySettings.Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";
        var names = (await _db.Parties.AsNoTracking().Where(p => p.IsActive).Select(p => p.Name).ToListAsync())
            .Select(n => n.ToLowerInvariant()).ToHashSet();

        for (var i = 0; i < dataRows.Count; i++)
        {
            var row = dataRows[i];
            var rowNo = RowNumber(sheet, i);
            var name = Loc.Clean(Cell(row, col, "name"));
            if (name is null) { if (!Blank(row)) issues.Add(new(sheet.Name, rowNo, "This row has no name.")); continue; }
            if (!names.Add(name.ToLowerInvariant())) { skipped++; continue; }

            var party = new Party { Name = name, Currency = currency, Types = new List<string> { type.ToString() } };
            var phone = Clean(Cell(row, col, "phone"), 40);
            if (phone is not null) party.Phone = phone;
            var address = Clean(Cell(row, col, "address"), 400);
            if (address is not null) party.Address = address;
            var notes = Clean(Cell(row, col, "notes"), 1000);
            if (notes is not null) party.Notes = notes;
            if (type == PartyType.SUPPLIER)
            {
                var contact = Clean(Cell(row, col, "contact"), 120);
                if (contact is not null) party.ContactName = contact;
            }
            else
            {
                var limit = Catalog.ParseAmount(Cell(row, col, "credit"));
                if (limit is long l && l > 0) party.CreditLimit = l;
            }
            _db.Parties.Add(party);
            added++;
            if (added % 200 == 0) await _db.SaveChangesAsync();
        }
        await _db.SaveChangesAsync();
        return new ImportGroupDto(kind, added, skipped, issues.ToArray());
    }

    // ---- sheet / column matching --------------------------------------------------------------

    private static readonly Dictionary<string, string[]> ItemColumns = new()
    {
        ["name"] = new[] { "name", "item", "product", "الاسم", "اسم", "اسم الصنف", "الصنف", "المنتج", "البضاعة" },
        ["department"] = new[] { "department", "dept", "القسم", "قسم" },
        ["unit"] = new[] { "unit", "الوحدة", "وحدة" },
        ["barcode"] = new[] { "barcode", "الباركود", "باركود" },
        ["price"] = new[] { "price", "sale price", "saleprice", "السعر", "سعر", "سعر البيع", "البيع" },
        ["cost"] = new[] { "cost", "cost price", "costprice", "التكلفة", "تكلفة", "سعر الشراء", "الشراء" },
        ["supplier"] = new[] { "supplier", "المورد", "مورد", "المصنع", "المصدر" },
        ["reorder"] = new[] { "reorder", "reorder level", "حد الطلب", "حد الطلب", "اقل كمية", "أقل كمية" },
    };

    private static readonly Dictionary<string, string[]> PartyColumns = new()
    {
        ["name"] = new[] { "name", "اسم", "الاسم", "العميل", "المورد", "الزبون" },
        ["phone"] = new[] { "phone", "mobile", "tel", "الهاتف", "التليفون", "تليفون", "الموبايل", "موبايل", "رقم", "الرقم" },
        ["address"] = new[] { "address", "العنوان", "عنوان" },
        ["credit"] = new[] { "credit", "credit limit", "limit", "حد الائتمان", "الائتمان", "الحد", "حد" },
        ["contact"] = new[] { "contact", "contact name", "المسؤول", "صاحب المصنع", "الشخص", "المندوب", "المسئول" },
        ["notes"] = new[] { "notes", "note", "ملاحظات", "ملاحظة", "بيان" },
    };

    private static readonly (string Kind, string[] Names)[] SheetNames =
    {
        ("items", new[] { "items", "products", "item", "product", "أصناف", "الأصناف", "اصناف", "الاصناف", "منتجات", "المنتجات", "بضاعة", "البضاعة", "صنف" }),
        ("customers", new[] { "customers", "customer", "clients", "عملاء", "العملاء", "زبائن", "الزبائن", "عميل" }),
        ("suppliers", new[] { "suppliers", "supplier", "vendors", "موردين", "الموردين", "موردون", "المورد", "مورد" }),
    };

    private static string? KindOf(string sheetName)
    {
        var n = Normalize(sheetName);
        foreach (var (kind, names) in SheetNames)
            if (names.Any(x => Normalize(x) == n || n.Contains(Normalize(x)) || Normalize(x).Contains(n)))
                return kind;
        return null;
    }

    /// <summary>Lower case, no spaces, Arabic "ال" and tatweel/diacritics dropped, for loose matching.</summary>
    private static string Normalize(string s)
    {
        var t = (s ?? "").Trim().ToLowerInvariant().Replace(" ", "").Replace("ـ", "");
        t = new string(t.Where(c => c is < 'ً' or > 'ْ').ToArray());
        return t;
    }

    private static (IReadOnlyList<string> Header, IReadOnlyList<IReadOnlyList<string>> Rows) SplitHeader(XlsxImport.Sheet sheet)
    {
        // The header is the first non-empty row; everything after it is data.
        for (var i = 0; i < sheet.Rows.Count; i++)
            if (!Blank(sheet.Rows[i]))
                return (sheet.Rows[i], sheet.Rows.Skip(i + 1).ToList());
        return (Array.Empty<string>(), Array.Empty<IReadOnlyList<string>>());
    }

    private static Dictionary<string, int> MapColumns(IReadOnlyList<string> header, Dictionary<string, string[]> spec)
    {
        var map = new Dictionary<string, int>();
        for (var j = 0; j < header.Count; j++)
        {
            var h = Normalize(header[j]);
            if (h.Length == 0) continue;
            foreach (var (field, names) in spec)
            {
                if (map.ContainsKey(field)) continue;
                if (names.Any(x => Normalize(x) == h)) { map[field] = j; break; }
            }
        }
        return map;
    }

    private static string? Cell(IReadOnlyList<string> row, Dictionary<string, int> col, string field) =>
        col.TryGetValue(field, out var j) && j < row.Count ? row[j] : null;

    private static bool Blank(IReadOnlyList<string> row) => row.All(string.IsNullOrWhiteSpace);

    /// <summary>The sheet's own 1-based row number for the i-th data row, for a helpful message.</summary>
    private static int RowNumber(XlsxImport.Sheet sheet, int dataIndex)
    {
        var headerAt = 0;
        for (var i = 0; i < sheet.Rows.Count; i++)
            if (!Blank(sheet.Rows[i])) { headerAt = i; break; }
        return headerAt + 2 + dataIndex;
    }

    private static string? Clean(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }
}
