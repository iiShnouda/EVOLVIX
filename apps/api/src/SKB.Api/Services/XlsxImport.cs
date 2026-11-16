using System.IO.Compression;
using System.Xml.Linq;

namespace SKB.Api.Services;

/// <summary>
/// A tiny read-only .xlsx parser (owner, 2026-10-14: the owner uploads a real Excel file to load
/// items, customers and suppliers). It opens the workbook zip with the framework's own
/// <see cref="ZipArchive"/> and reads the cells with LINQ-to-XML — no third-party library. It returns
/// each sheet as rows of text; numbers and shared strings are read, formulas are taken as their last
/// stored value. Only what the importer needs; it never evaluates anything in the file.
/// </summary>
public static class XlsxImport
{
    private static readonly XNamespace Main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Pkg = "http://schemas.openxmlformats.org/package/2006/relationships";

    public const int MaxRows = 20_000;
    private const long MaxPartBytes = 64L * 1024 * 1024;

    public sealed record Workbook(IReadOnlyList<Sheet> Sheets);
    /// <summary>One sheet: its name and its rows, each row a list of cell texts (missing cells are "").</summary>
    public sealed record Sheet(string Name, IReadOnlyList<IReadOnlyList<string>> Rows);

    /// <summary>Parse an uploaded .xlsx. Returns null when the bytes aren't a readable workbook.</summary>
    public static Workbook? Read(byte[] bytes)
    {
        try
        {
            using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);

            var shared = ReadSharedStrings(zip);
            var workbook = Entry(zip, "xl/workbook.xml");
            if (workbook is null) return null;
            var rels = ReadRels(zip);

            var sheets = new List<Sheet>();
            foreach (var s in workbook.Root!.Element(Main + "sheets")?.Elements(Main + "sheet") ?? Enumerable.Empty<XElement>())
            {
                var name = (string?)s.Attribute("name") ?? $"Sheet{sheets.Count + 1}";
                var rid = (string?)s.Attribute(Rel + "id");
                var target = rid is not null && rels.TryGetValue(rid, out var t) ? t : null;
                var path = NormalizeSheetPath(target);
                var doc = path is not null ? Entry(zip, path) : null;
                if (doc is null) continue;
                sheets.Add(new Sheet(name, ReadRows(doc, shared)));
            }
            return new Workbook(sheets);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// A one-sheet workbook of text cells (an import's template, owner 2026-11-16): the first row in
    /// bold, right-to-left for Arabic. Written with the framework's zip and XML only.
    /// </summary>
    public static byte[] Write(string sheetName, IReadOnlyList<IReadOnlyList<string>> rows, bool rightToLeft)
    {
        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Put(string path, XDocument doc)
            {
                using var w = zip.CreateEntry(path, CompressionLevel.Optimal).Open();
                doc.Save(w, SaveOptions.DisableFormatting);
            }
            XNamespace ct = "http://schemas.openxmlformats.org/package/2006/content-types";
            Put("[Content_Types].xml", new XDocument(new XElement(ct + "Types",
                new XElement(ct + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(ct + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                new XElement(ct + "Override", new XAttribute("PartName", "/xl/workbook.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                new XElement(ct + "Override", new XAttribute("PartName", "/xl/worksheets/sheet1.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")),
                new XElement(ct + "Override", new XAttribute("PartName", "/xl/styles.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")))));
            Put("_rels/.rels", new XDocument(new XElement(Pkg + "Relationships",
                new XElement(Pkg + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Target", "xl/workbook.xml"),
                    new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument")))));
            Put("xl/_rels/workbook.xml.rels", new XDocument(new XElement(Pkg + "Relationships",
                new XElement(Pkg + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Target", "worksheets/sheet1.xml"),
                    new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet")),
                new XElement(Pkg + "Relationship", new XAttribute("Id", "rId2"), new XAttribute("Target", "styles.xml"),
                    new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles")))));
            var name = new string(sheetName.Where(c => !"[]:*?/\\".Contains(c)).ToArray());
            Put("xl/workbook.xml", new XDocument(new XElement(Main + "workbook", new XAttribute(XNamespace.Xmlns + "r", Rel),
                new XElement(Main + "sheets", new XElement(Main + "sheet", new XAttribute("name", name.Length is 0 or > 31 ? "Sheet1" : name),
                    new XAttribute("sheetId", 1), new XAttribute(Rel + "id", "rId1"))))));
            Put("xl/styles.xml", new XDocument(new XElement(Main + "styleSheet",
                new XElement(Main + "fonts", new XAttribute("count", 2),
                    new XElement(Main + "font", new XElement(Main + "sz", new XAttribute("val", 11))),
                    new XElement(Main + "font", new XElement(Main + "b"), new XElement(Main + "sz", new XAttribute("val", 11)))),
                new XElement(Main + "fills", new XAttribute("count", 1), new XElement(Main + "fill", new XElement(Main + "patternFill", new XAttribute("patternType", "none")))),
                new XElement(Main + "borders", new XAttribute("count", 1), new XElement(Main + "border")),
                new XElement(Main + "cellStyleXfs", new XAttribute("count", 1), new XElement(Main + "xf")),
                new XElement(Main + "cellXfs", new XAttribute("count", 2),
                    new XElement(Main + "xf", new XAttribute("fontId", 0)),
                    new XElement(Main + "xf", new XAttribute("fontId", 1), new XAttribute("applyFont", 1))))));
            var width = rows.Count == 0 ? 1 : rows.Max(r => r.Count);
            Put("xl/worksheets/sheet1.xml", new XDocument(new XElement(Main + "worksheet",
                new XElement(Main + "sheetViews", new XElement(Main + "sheetView", new XAttribute("workbookViewId", 0),
                    rightToLeft ? new XAttribute("rightToLeft", 1) : null)),
                new XElement(Main + "cols", new XElement(Main + "col", new XAttribute("min", 1), new XAttribute("max", Math.Max(1, width)),
                    new XAttribute("width", 20), new XAttribute("customWidth", 1))),
                new XElement(Main + "sheetData", rows.Select((row, i) => new XElement(Main + "row", new XAttribute("r", i + 1),
                    row.Select((text, j) => new XElement(Main + "c", new XAttribute("r", ColumnName(j) + (i + 1)),
                        new XAttribute("t", "inlineStr"), i == 0 ? new XAttribute("s", 1) : null,
                        new XElement(Main + "is", new XElement(Main + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), text))))))))));
        }
        return ms.ToArray();
    }

    /// <summary>A 0-based column as its letters: 0 → A, 26 → AA.</summary>
    private static string ColumnName(int index)
    {
        var s = "";
        for (var n = index + 1; n > 0; n = (n - 1) / 26) s = (char)('A' + (n - 1) % 26) + s;
        return s;
    }

    private static XDocument? Entry(ZipArchive zip, string path)
    {
        var entry = zip.GetEntry(path);
        if (entry is null) return null;
        // A part that unpacks to more than this is not a real sheet of business data.
        if (entry.Length > MaxPartBytes) throw new InvalidDataException("Workbook part too large.");
        using var stream = entry.Open();
        return XDocument.Load(stream);
    }

    private static List<string> ReadSharedStrings(ZipArchive zip)
    {
        var doc = Entry(zip, "xl/sharedStrings.xml");
        var list = new List<string>();
        if (doc?.Root is null) return list;
        foreach (var si in doc.Root.Elements(Main + "si"))
            list.Add(TextOf(si));
        return list;
    }

    private static Dictionary<string, string> ReadRels(ZipArchive zip)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var doc = Entry(zip, "xl/_rels/workbook.xml.rels");
        if (doc?.Root is null) return map;
        foreach (var r in doc.Root.Elements(Pkg + "Relationship"))
        {
            var id = (string?)r.Attribute("Id");
            var target = (string?)r.Attribute("Target");
            if (id is not null && target is not null) map[id] = target;
        }
        return map;
    }

    /// <summary>A relationship target to a path inside the zip (handles "worksheets/x.xml", leading "/", "../").</summary>
    private static string? NormalizeSheetPath(string? target)
    {
        if (string.IsNullOrEmpty(target)) return null;
        if (target.StartsWith('/')) return target.TrimStart('/');
        if (target.StartsWith("../")) return target[3..];
        return "xl/" + target;
    }

    private static IReadOnlyList<IReadOnlyList<string>> ReadRows(XDocument doc, List<string> shared)
    {
        var rows = new List<IReadOnlyList<string>>();
        var data = doc.Root?.Element(Main + "sheetData");
        if (data is null) return rows;
        foreach (var row in data.Elements(Main + "row"))
        {
            if (rows.Count >= MaxRows) break;
            var cells = new List<string>();
            foreach (var c in row.Elements(Main + "c"))
            {
                var col = ColumnIndex((string?)c.Attribute("r"));
                while (cells.Count < col) cells.Add("");
                cells.Add(CellText(c, shared));
            }
            rows.Add(cells);
        }
        return rows;
    }

    private static string CellText(XElement c, List<string> shared)
    {
        var type = (string?)c.Attribute("t");
        if (type == "inlineStr") return TextOf(c.Element(Main + "is"));
        var v = c.Element(Main + "v");
        if (type == "s")
            return v is not null && int.TryParse(v.Value, out var i) && i >= 0 && i < shared.Count ? shared[i] : "";
        if (type == "str") return v?.Value?.Trim() ?? "";
        return v?.Value?.Trim() ?? "";
    }

    /// <summary>All the text of an <c>&lt;si&gt;</c> or <c>&lt;is&gt;</c>, joining rich-text runs.</summary>
    private static string TextOf(XElement? el)
    {
        if (el is null) return "";
        // Plain <t>, or runs <r><t>…</t></r>.
        var direct = el.Element(Main + "t");
        if (direct is not null && !el.Elements(Main + "r").Any()) return direct.Value;
        return string.Concat(el.Elements(Main + "r").Select(r => r.Element(Main + "t")?.Value ?? "")).Trim();
    }

    /// <summary>The 0-based column from a cell reference like "C5" → 2; 0 when there's none.</summary>
    private static int ColumnIndex(string? reference)
    {
        if (string.IsNullOrEmpty(reference)) return 0;
        var n = 0;
        foreach (var ch in reference)
        {
            if (ch is >= 'A' and <= 'Z') n = n * 26 + (ch - 'A' + 1);
            else if (ch is >= 'a' and <= 'z') n = n * 26 + (ch - 'a' + 1);
            else break;
        }
        return Math.Max(0, n - 1);
    }
}
