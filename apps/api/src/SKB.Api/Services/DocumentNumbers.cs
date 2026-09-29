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

    /// <summary>Next shipment (waybill) number, e.g. SHP-2026-000012.</summary>
    public static async Task<string> NextShipmentAsync(AppDbContext db)
    {
        var prefix = $"SHP-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.Shipments.Where(s => s.Number.StartsWith(prefix))
            .OrderByDescending(s => s.Number).Select(s => s.Number).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    /// <summary>Next carrier settlement number, e.g. CST-2026-000002.</summary>
    public static async Task<string> NextSettlementAsync(AppDbContext db)
    {
        var prefix = $"CST-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.CarrierSettlements.Where(s => s.Number.StartsWith(prefix))
            .OrderByDescending(s => s.Number).Select(s => s.Number).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    /// <summary>Next voucher number: RCV- (receipt), PAY- (payment), EXP- (expense), CTR- (cash transfer).</summary>
    public static async Task<string> NextVoucherAsync(AppDbContext db, VoucherType type)
    {
        var code = type switch
        {
            VoucherType.RECEIPT => "RCV",
            VoucherType.PAYMENT => "PAY",
            VoucherType.EXPENSE => "EXP",
            _ => "CTR",
        };
        var prefix = $"{code}-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.Vouchers.Where(v => v.Number.StartsWith(prefix))
            .OrderByDescending(v => v.Number).Select(v => v.Number).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    /// <summary>Next note reference: NR- (receivable) or NP- (payable), e.g. NR-2026-000012.</summary>
    public static async Task<string> NextNoteAsync(AppDbContext db, NoteDirection direction)
    {
        var prefix = $"{(direction == NoteDirection.RECEIVABLE ? "NR" : "NP")}-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.Notes.Where(n => n.Ref.StartsWith(prefix))
            .OrderByDescending(n => n.Ref).Select(n => n.Ref).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    /// <summary>Next deposit portfolio number, e.g. PF-2026-000003.</summary>
    public static async Task<string> NextPortfolioAsync(AppDbContext db)
    {
        var prefix = $"PF-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.Portfolios.Where(p => p.Number.StartsWith(prefix))
            .OrderByDescending(p => p.Number).Select(p => p.Number).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    /// <summary>Next manual journal entry number, e.g. JV-2026-000004.</summary>
    public static async Task<string> NextJournalAsync(AppDbContext db)
    {
        var prefix = $"JV-{DateTime.UtcNow.Year}-";
        await LockAsync(db, prefix);
        var last = await db.JournalEntries.Where(e => e.Number.StartsWith(prefix))
            .OrderByDescending(e => e.Number).Select(e => e.Number).FirstOrDefaultAsync();
        return Next(prefix, last);
    }

    private static string Next(string prefix, string? last)
    {
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
