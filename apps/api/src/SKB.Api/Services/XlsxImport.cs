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

    private static XDocument? Entry(ZipArchive zip, string path)
    {
        var entry = zip.GetEntry(path);
        if (entry is null) return null;
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
