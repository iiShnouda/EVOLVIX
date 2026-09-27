using SKB.Api.Data;

namespace SKB.Api.Services;

public sealed class AuditService
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuditService> _logger;

    public AuditService(AppDbContext db, ILogger<AuditService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task RecordAsync(string actorId, string actorName, string action, string resource,
        string? branchId = null, string? ip = null, string? userAgent = null, string? resourceId = null)
    {
        try
        {
            _db.AuditEntries.Add(new AuditEntry
            {
                ActorId = actorId,
                ActorName = actorName,
                Action = action,
                Resource = resource,
                ResourceId = resourceId,
                BranchId = branchId,
                Ip = ip,
                UserAgent = userAgent,
            });
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write audit entry for {Action}", action);
        }
    }
}
