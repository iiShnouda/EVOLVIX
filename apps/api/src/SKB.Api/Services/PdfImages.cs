using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace SKB.Api.Services;

/// <summary>
/// The scanned page inside a PDF (owner, 2026-11-16: a supplier's invoice can come as a PDF). A PDF
/// made by a scanner or a phone's scanning app holds each page as one picture; this finds the largest
/// such picture and hands it over as a JPEG or PNG, so it is read like a photo of the invoice. It reads
/// only the file's bytes (no library, nothing run or drawn): a JPEG picture is taken as it is, an
/// 8-bit grey or colour picture is rewritten as a PNG. A PDF made of text (typed by a program) has no
/// such picture: null, and the person is asked for a photo instead.
/// </summary>
public static partial class PdfImages
{
    private const long MaxPixels = 40_000_000;
    private const int MinSide = 300;

    public static bool IsPdf(byte[] b) => b.Length > 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-';

    [GeneratedRegex(@"/Subtype\s*/Image")]
    private static partial Regex ImageTag();

    /// <summary>The largest page picture as JPEG or PNG bytes, or null when there is none it can read.</summary>
    public static byte[]? LargestImage(byte[] pdf)
    {
        // Latin-1 keeps one character per byte, so positions in the text are positions in the file.
        var text = Encoding.Latin1.GetString(pdf);
        if (text.Contains("/Encrypt")) return null;
        byte[]? best = null;
        long bestArea = 0;
        foreach (Match m in ImageTag().Matches(text))
        {
            try
            {
                var objAt = text.LastIndexOf(" obj", m.Index, StringComparison.Ordinal);
                var streamAt = text.IndexOf("stream", m.Index, StringComparison.Ordinal);
                if (objAt < 0 || streamAt < 0) continue;
                var dict = text[objAt..streamAt];
                var start = streamAt + 6;
                if (start < text.Length && text[start] == '\r') start++;
                if (start < text.Length && text[start] == '\n') start++;
                var end = text.IndexOf("endstream", start, StringComparison.Ordinal);
                if (end < 0) continue;
                var length = Int(dict, "Length");
                var data = length is int n && n > 0 && start + n <= end ? pdf.AsSpan(start, n).ToArray() : pdf.AsSpan(start, end - start).ToArray();
                var w = Int(dict, "Width") ?? 0;
                var h = Int(dict, "Height") ?? 0;
                long area = (long)w * h;
                if (w < MinSide || h < MinSide || area > MaxPixels || area <= bestArea) continue;
                var image = Decode(dict, data, w, h);
                if (image is null) continue;
                best = image;
                bestArea = area;
            }
            catch (Exception e) when (e is InvalidDataException or ArgumentException or IndexOutOfRangeException or OverflowException)
            {
                // A picture it can't read is passed over.
            }
        }
        return best;
    }

    private static byte[]? Decode(string dict, byte[] data, int w, int h)
    {
        var filters = Regex.Matches(Between(dict, "/Filter"), @"/(\w+)").Select(f => f.Groups[1].Value).ToList();
        if (filters.Count > 0 && filters[0] == "FlateDecode")
        {
            data = Inflate(data, (long)w * h * 4 + h + 1024);
            filters.RemoveAt(0);
        }
        if (filters.Count == 1 && filters[0] == "DCTDecode") return data.Length > 3 && data[0] == 0xFF && data[1] == 0xD8 ? data : null;
        if (filters.Count != 0 || (Int(dict, "BitsPerComponent") ?? 8) != 8) return null;
        var predictor = Int(dict, "Predictor") ?? 1;
        var colors = dict.Contains("/DeviceRGB") ? 3 : dict.Contains("/DeviceGray") ? 1 : 0;
        var row = predictor >= 10 ? data.Length / h - 1 : data.Length / h;
        if (colors == 0) colors = row == w * 3 ? 3 : row == w ? 1 : 0;
        if (colors == 0 || row != w * colors) return null;
        // PNG rows start with a filter byte; a PDF's PNG predictor rows already do.
        byte[] rows;
        if (predictor >= 10) rows = data[..((row + 1) * h)];
        else
        {
            rows = new byte[(row + 1) * h];
            for (var y = 0; y < h; y++) Buffer.BlockCopy(data, y * row, rows, y * (row + 1) + 1, row);
        }
        return Png(w, h, colors == 3 ? (byte)2 : (byte)0, rows);
    }

    private static byte[] Inflate(byte[] data, long max)
    {
        using var z = new ZLibStream(new MemoryStream(data), CompressionMode.Decompress);
        using var o = new MemoryStream();
        var buffer = new byte[81920];
        int n;
        while ((n = z.Read(buffer)) > 0)
        {
            if (o.Length + n > max) throw new InvalidDataException("Picture too large.");
            o.Write(buffer, 0, n);
        }
        return o.ToArray();
    }

    private static byte[] Png(int w, int h, byte colorType, byte[] rows)
    {
        var o = new MemoryStream();
        o.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        var ihdr = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr, w);
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4), h);
        ihdr[8] = 8;
        ihdr[9] = colorType;
        Chunk(o, "IHDR", ihdr);
        var z = new MemoryStream();
        using (var zs = new ZLibStream(z, CompressionLevel.Fastest, leaveOpen: true)) zs.Write(rows);
        Chunk(o, "IDAT", z.ToArray());
        Chunk(o, "IEND", Array.Empty<byte>());
        return o.ToArray();
    }

    private static void Chunk(Stream o, string type, byte[] body)
    {
        var head = new byte[8];
        BinaryPrimitives.WriteInt32BigEndian(head, body.Length);
        Encoding.ASCII.GetBytes(type, head.AsSpan(4));
        o.Write(head);
        o.Write(body);
        var crc = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crc, Crc(head.AsSpan(4), body));
        o.Write(crc);
    }

    private static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    private static uint Crc(ReadOnlySpan<byte> type, byte[] body)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in type) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        foreach (var b in body) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }

    /// <summary>A key's direct whole-number value in the dictionary (not one kept elsewhere: "12 0 R").</summary>
    private static int? Int(string dict, string key)
    {
        var m = Regex.Match(dict, $@"/{key}\s+(\d+)(?!\s+\d+\s+R)");
        return m.Success && int.TryParse(m.Groups[1].Value, out var v) ? v : null;
    }

    /// <summary>The value after a key: a name, or an array of names.</summary>
    private static string Between(string dict, string key)
    {
        var i = dict.IndexOf(key, StringComparison.Ordinal);
        if (i < 0) return "";
        i += key.Length;
        while (i < dict.Length && char.IsWhiteSpace(dict[i])) i++;
        if (i < dict.Length && dict[i] == '[')
        {
            var j = dict.IndexOf(']', i);
            return j < 0 ? "" : dict[i..(j + 1)];
        }
        var m = Regex.Match(dict[i..], @"^/\w+");
        return m.Success ? m.Value : "";
    }
}
