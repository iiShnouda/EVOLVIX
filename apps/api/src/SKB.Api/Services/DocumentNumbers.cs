using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>Human document numbers per type and year, e.g. INV-2026-000123, SRT-2026-000004.</summary>
public static class DocumentNumbers
{
    public static string PrefixFor(DocumentType type, int year) => type switch
    {
        DocumentType.SALES_INVOICE => $"INV-{year}-",
        DocumentType.PURCHASE_INVOICE => $"PUR-{year}-",
        DocumentType.SALES_RETURN => $"SRT-{year}-",
        DocumentType.PURCHASE_RETURN => $"PRT-{year}-",
        _ => $"DOC-{year}-",
    };

    public static async Task<string> NextAsync(AppDbContext db, DocumentType type)
    {
        var prefix = PrefixFor(type, DateTime.UtcNow.Year);
        var last = await db.SalesDocuments.Where(d => d.Number.StartsWith(prefix))
            .OrderByDescending(d => d.Number).Select(d => d.Number).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }
}
