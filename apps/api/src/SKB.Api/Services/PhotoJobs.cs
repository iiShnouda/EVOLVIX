using System.Collections.Concurrent;

namespace SKB.Api.Services;

/// <summary>
/// Photo reads that run on after the request that started them (owner, 2026-10-19: a slow server took
/// longer than the connection would wait, and the read was lost). The page starts a read, then asks
/// for it every few seconds; each read belongs to the person who started it and is forgotten an hour
/// after it began. Held in this server's memory only.
/// </summary>
public sealed class PhotoJobs
{
    private static readonly TimeSpan Keep = TimeSpan.FromHours(1);
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<PhotoJobs> _log;
    private readonly ConcurrentDictionary<Guid, Job> _jobs = new();

    public PhotoJobs(IServiceScopeFactory scopes, ILogger<PhotoJobs> log)
    {
        _scopes = scopes;
        _log = log;
    }

    public sealed class Job
    {
        public required string Owner { get; init; }
        public DateTime Started { get; } = DateTime.UtcNow;
        public Task<object>? Work { get; set; }
    }

    /// <summary>Whether this person already has a read going (one at a time: the model reads one photo at a time).</summary>
    public bool Busy(string owner) =>
        _jobs.Values.Any(j => j.Owner == owner && j.Work is { IsCompleted: false });

    /// <summary>Start a read with its own services (the request's are gone once it answers).</summary>
    public Guid Start(string owner, Func<IServiceProvider, CancellationToken, Task<object>> read)
    {
        foreach (var (id, old) in _jobs)
            if (DateTime.UtcNow - old.Started > Keep) _jobs.TryRemove(id, out _);
        var key = Guid.NewGuid();
        var job = new Job { Owner = owner };
        _jobs[key] = job;
        job.Work = Task.Run(async () =>
        {
            using var scope = _scopes.CreateScope();
            try
            {
                return await read(scope.ServiceProvider, CancellationToken.None);
            }
            catch (Exception e)
            {
                _log.LogWarning(e, "Reading a photo failed");
                throw;
            }
        });
        return key;
    }

    /// <summary>The read, only for the person who started it.</summary>
    public Job? Find(Guid id, string owner) =>
        _jobs.TryGetValue(id, out var job) && job.Owner == owner ? job : null;
}
