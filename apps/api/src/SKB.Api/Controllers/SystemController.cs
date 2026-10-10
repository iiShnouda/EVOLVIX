using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The owner's server monitor (<c>system:monitor</c>, the owner's alone): how loaded the machine is,
/// read-only. There is deliberately no way to run a command or see a file from the app.
/// </summary>
[ApiController]
[Route("api/system")]
[Authorize(Policy = Permissions.SystemMonitor)]
public sealed class SystemController : ControllerBase
{
    [HttpGet("monitor")]
    public async Task<ActionResult<SystemMonitorDto>> Monitor([FromServices] SystemMonitor monitor, CancellationToken ct) =>
        Ok(await monitor.ReadAsync(ct));
}
