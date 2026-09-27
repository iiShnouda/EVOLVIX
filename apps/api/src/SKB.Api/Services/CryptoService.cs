using System.Security.Cryptography;
using System.Text;

namespace SKB.Api.Services;

/// <summary>
/// AES-256-GCM at-rest encryption for session material, plus token generation/hashing.
/// Blob layout: [12-byte nonce][16-byte tag][ciphertext].
/// </summary>
public sealed class CryptoService
{
    private readonly byte[] _key;
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public CryptoService(IConfiguration config)
    {
        var hex = config["Security:SessionEncryptionKey"]
                  ?? throw new InvalidOperationException("Security:SessionEncryptionKey is required");
        _key = Convert.FromHexString(hex);
        if (_key.Length != 32)
            throw new InvalidOperationException("Security:SessionEncryptionKey must decode to 32 bytes (64 hex chars)");
    }

    public byte[] Encrypt(string plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagSize];
        using var gcm = new AesGcm(_key, TagSize);
        gcm.Encrypt(nonce, plain, cipher, tag);
        var blob = new byte[NonceSize + TagSize + cipher.Length];
        Buffer.BlockCopy(nonce, 0, blob, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, blob, NonceSize, TagSize);
        Buffer.BlockCopy(cipher, 0, blob, NonceSize + TagSize, cipher.Length);
        return blob;
    }

    public string Decrypt(byte[] blob)
    {
        var nonce = blob.AsSpan(0, NonceSize);
        var tag = blob.AsSpan(NonceSize, TagSize);
        var cipher = blob.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];
        using var gcm = new AesGcm(_key, TagSize);
        gcm.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    public static string GenerateOpaqueToken(int bytes = 48) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
