using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/health")]
public sealed class HealthController : ControllerBase
{
    [AllowAnonymous]
    [HttpGet]
    public IActionResult Check()
    {
        // The deployed commit (Render sets RENDER_GIT_COMMIT), to confirm which build is live.
        var commit = Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT");
        return Ok(new
        {
            status = "ok",
            time = DateTime.UtcNow.ToString("o"),
            version = string.IsNullOrEmpty(commit) ? null : commit[..Math.Min(7, commit.Length)],
        });
    }
}
