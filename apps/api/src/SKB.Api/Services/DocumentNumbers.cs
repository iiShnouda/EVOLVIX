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
        await LockAsync(db, prefix);
        var last = await db.SalesDocuments.Where(d => d.Number.StartsWith(prefix))
            .OrderByDescending(d => d.Number).Select(d => d.Number).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }

    /// <summary>Next stocktake reference, e.g. ADJ-2026-000007 (kept on the stock movements it posts).</summary>
    public static async Task<string> NextAdjustmentAsync(AppDbContext db)
    {
        var prefix = $"ADJ-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.StockMovements.Where(m => m.Reference != null && m.Reference.StartsWith(prefix))
            .OrderByDescending(m => m.Reference).Select(m => m.Reference).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }

    /// <summary>Next transfer permit number, e.g. TRF-2026-000003.</summary>
    public static async Task<string> NextTransferAsync(AppDbContext db)
    {
        var prefix = $"TRF-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.StockTransfers.Where(t => t.Number.StartsWith(prefix))
            .OrderByDescending(t => t.Number).Select(t => t.Number).FirstOrDefaultAsync();
        var seq = 1;
        if (last is not null && int.TryParse(last[prefix.Length..], out var n)) seq = n + 1;
        return $"{prefix}{seq:D6}";
    }

    /// <summary>
    /// Two documents of one type saved at the same moment would read the same last number. Inside
    /// a transaction, take a Postgres advisory lock on the prefix (released at commit/rollback) so
    /// they number one after the other.
    /// </summary>
    private static async Task LockAsync(AppDbContext db, string prefix)
    {
        if (db.Database.CurrentTransaction is null) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({prefix}))");
    }
}
