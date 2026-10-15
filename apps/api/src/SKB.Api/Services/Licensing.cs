using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Licences (owner, 2026-10-15: "a buyer pays per user; I need a way to enforce it"). The vendor
/// issues a signed code naming the customer, this installation, how many users and until when. It is
/// signed with the vendor's private key (ECDSA P-256), and only the public key is built in here, so
/// a code can't be made up or edited — changing a single character breaks the signature.
/// <para>Code: <c>EVX1.&lt;payload&gt;.&lt;signature&gt;</c>, both base64url; the payload is JSON:
/// c = customer, i = install id (or "*" for any server — the vendor's own), u = most active users
/// (0 = no limit), e = expiry day (UTC, or null), t = when issued.</para>
/// </summary>
public static class Licensing
{
    /// <summary>The vendor's public key (SubjectPublicKeyInfo, base64). Its private half never goes in git.</summary>
    private const string PublicKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELKNJLK2VtvdkhCHdZ1/xDobEfdR1FrvCLPhoe3mSp4quBbmJQJzuDfXAkNs7hljeQkZqMsHcx9XB4jH/kgwQIg==";
    private const string Prefix = "EVX1.";

    /// <summary>Active users allowed with no licence (the owner and one more) — enough to try it out.</summary>
    public const int UnlicensedUsers = 2;
    /// <summary>After the end date, people other than the owner can still sign in this long.</summary>
    public static readonly TimeSpan Grace = TimeSpan.FromDays(7);
    /// <summary>The owner is warned this long before the end date.</summary>
    public static readonly TimeSpan WarnBefore = TimeSpan.FromDays(14);

    public sealed record Payload(string C, string I, int U, DateTime? E, DateTime T);

    public static string Sign(byte[] pkcs8, Payload payload)
    {
        using var key = ECDsa.Create();
        key.ImportPkcs8PrivateKey(pkcs8, out _);
        var body = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOpts);
        var sig = key.SignData(body, HashAlgorithmName.SHA256);
        return Prefix + B64(body) + "." + B64(sig);
    }

    /// <summary>The licence in a code if it is genuine and meant for this installation, else why not.</summary>
    public static (Payload? License, string? Error) Verify(string? code, Guid installId)
    {
        if (string.IsNullOrWhiteSpace(code)) return (null, "license_missing");
        var text = string.Concat(code.Where(c => !char.IsWhiteSpace(c)));
        if (!text.StartsWith(Prefix, StringComparison.Ordinal)) return (null, "license_invalid");
        var parts = text[Prefix.Length..].Split('.');
        if (parts.Length != 2) return (null, "license_invalid");
        try
        {
            var body = Unb64(parts[0]);
            var sig = Unb64(parts[1]);
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(PublicKey), out _);
            if (!key.VerifyData(body, sig, HashAlgorithmName.SHA256)) return (null, "license_invalid");
            var p = JsonSerializer.Deserialize<Payload>(body, JsonOpts);
            if (p is null || p.U < 0) return (null, "license_invalid");
            if (p.I != "*" && !(Guid.TryParse(p.I, out var forId) && forId == installId))
                return (null, "license_other_server");
            return (p, null);
        }
        catch (Exception e) when (e is FormatException or JsonException or CryptographicException)
        {
            return (null, "license_invalid");
        }
    }

    /// <summary>True when a private key (PKCS#8) is the vendor's — the half of the public key built in.</summary>
    public static bool IsVendorKey(byte[] pkcs8)
    {
        try
        {
            using var key = ECDsa.Create();
            key.ImportPkcs8PrivateKey(pkcs8, out _);
            return key.ExportSubjectPublicKeyInfo().AsSpan().SequenceEqual(Convert.FromBase64String(PublicKey));
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    /// <summary>A PEM private key ("-----BEGIN PRIVATE KEY-----") to its PKCS#8 bytes, or null.</summary>
    public static byte[]? ReadPem(string pem)
    {
        try
        {
            using var key = ECDsa.Create();
            key.ImportFromPem(pem);
            return key.ExportPkcs8PrivateKey();
        }
        catch (Exception e) when (e is ArgumentException or CryptographicException)
        {
            return null;
        }
    }

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] Unb64(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(t.PadRight(t.Length + (4 - t.Length % 4) % 4, '='));
    }
}

/// <summary>Where this company stands with its licence, and the rules that follow from it.</summary>
public sealed class LicenseService
{
    private readonly AppDbContext _db;
    private readonly IHostEnvironment _env;

    public LicenseService(AppDbContext db, IHostEnvironment env)
    {
        _db = db;
        _env = env;
    }

    /// <param name="State">none (no licence), valid, ending (within the warning time), grace (ended, in
    /// the grace days), expired (past grace), or invalid (the stored code doesn't check out).</param>
    /// <param name="MaxUsers">Most active users now; null = no limit.</param>
    public sealed record Status(string State, Guid InstallId, string? Customer, int? MaxUsers, int ActiveUsers,
        DateTime? ExpiresAt, bool CanIssue, string? Error);

    public async Task<Status> ReadAsync()
    {
        var s = await _db.CompanySettings.AsNoTracking()
            .Select(x => new { x.InstallId, x.LicenseCode, HasKey = x.LicenseSigningKey != null })
            .FirstOrDefaultAsync();
        var installId = s?.InstallId ?? Guid.Empty;
        var active = await _db.Staff.CountAsync(x => x.IsActive);
        var canIssue = s?.HasKey == true;
        // Development and the checks run without a licence and without a limit.
        if (s?.LicenseCode is null)
            return new Status("none", installId, null, _env.IsDevelopment() ? null : Licensing.UnlicensedUsers,
                active, null, canIssue, null);
        var (lic, error) = Licensing.Verify(s.LicenseCode, installId);
        if (lic is null)
            return new Status("invalid", installId, null, _env.IsDevelopment() ? null : Licensing.UnlicensedUsers,
                active, null, canIssue, error);
        var now = DateTime.UtcNow;
        var state = lic.E is not { } end ? "valid"
            : now > end + Licensing.Grace ? "expired"
            : now > end ? "grace"
            : end - now < Licensing.WarnBefore ? "ending"
            : "valid";
        return new Status(state, installId, lic.C, lic.U == 0 ? null : lic.U, active, lic.E, canIssue, null);
    }

    /// <summary>Why one more active user isn't allowed now, or null when it is.</summary>
    public async Task<(string Code, string Message)?> CannotAddUserAsync()
    {
        var st = await ReadAsync();
        if (st.State is "grace" or "expired")
            return ("license_expired", "The subscription has ended. Renew it to add users.");
        if (st.MaxUsers is int max && st.ActiveUsers >= max)
            return ("license_limit", $"The licence allows {max} active users. Buy more users to add another.");
        return null;
    }

    /// <summary>True when this person may not sign in because the subscription ended (the owner always may).</summary>
    public async Task<bool> SignInBlockedAsync(Staff staff) =>
        staff.Role != Role.OWNER && (await ReadAsync()).State == "expired";
}
