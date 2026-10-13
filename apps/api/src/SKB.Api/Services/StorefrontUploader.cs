using System.Collections.Concurrent;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace SKB.Api.Services;

/// <summary>
/// Publishes the storefront catalogue OUTWARD to a public host (owner, 2026-10-13: Cloudflare R2 +
/// Pages). The company server only pushes; it never accepts anything back, so the public site cannot
/// be used to reach it. One implementation talks to R2 (S3-compatible); a memory one backs dev and
/// the tests. Nothing here carries anything private — the catalogue is already scrubbed.
/// </summary>
public interface IStorefrontUploader
{
    /// <summary>True when a real target is configured; false disables publishing.</summary>
    bool Enabled { get; }
    /// <summary>The public base URL the site reads from (for status display), or null.</summary>
    string? PublicBaseUrl { get; }
    Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct = default);
}

/// <summary>Records pushes in memory. Used in development and the tests (no real bucket needed).</summary>
public sealed class MemoryStorefrontUploader : IStorefrontUploader
{
    public bool Enabled => true;
    public string? PublicBaseUrl => "memory://storefront";
    public ConcurrentDictionary<string, (byte[] Data, string Type)> Files { get; } = new();

    public Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct = default)
    {
        Files[key] = (data, contentType);
        return Task.CompletedTask;
    }
}

/// <summary>Disabled: no target configured. Publishing is a no-op and the page says it's off.</summary>
public sealed class NullStorefrontUploader : IStorefrontUploader
{
    public bool Enabled => false;
    public string? PublicBaseUrl => null;
    public Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct = default) =>
        Task.CompletedTask;
}

/// <summary>
/// Pushes to a Cloudflare R2 bucket over its S3-compatible API (owner, 2026-10-13). Outbound HTTPS
/// only, to the one bucket. Configure with <c>Storefront:R2Endpoint</c> (https://&lt;account&gt;.r2.cloudflarestorage.com),
/// <c>R2Bucket</c>, <c>R2AccessKeyId</c>, <c>R2SecretKey</c>, and <c>PublicBaseUrl</c> (the bucket's
/// public or custom-domain URL the site reads from). The keys write only to this bucket.
/// </summary>
public sealed class R2StorefrontUploader : IStorefrontUploader, IDisposable
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public bool Enabled => true;
    public string? PublicBaseUrl { get; }

    public R2StorefrontUploader(string endpoint, string bucket, string accessKeyId, string secretKey, string? publicBaseUrl)
    {
        _bucket = bucket;
        PublicBaseUrl = publicBaseUrl?.TrimEnd('/');
        _s3 = new AmazonS3Client(new BasicAWSCredentials(accessKeyId, secretKey), new AmazonS3Config
        {
            ServiceURL = endpoint,
            // R2 has no regions; the SDK still wants one. Path-style keeps the bucket out of the host.
            AuthenticationRegion = "auto",
            ForcePathStyle = true,
        });
    }

    public async Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct = default)
    {
        using var stream = new MemoryStream(data);
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            DisablePayloadSigning = true, // R2 doesn't need the streaming payload signature.
        }, ct);
    }

    public void Dispose() => _s3.Dispose();
}
