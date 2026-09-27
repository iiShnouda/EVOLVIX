using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/presence")]
[Authorize(Policy = Permissions.PresenceView)]
public sealed class PresenceController : ControllerBase
{
    private readonly PresenceTracker _tracker;
    public PresenceController(PresenceTracker tracker) => _tracker = tracker;

    [HttpGet]
    public ActionResult<IReadOnlyList<PresenceEntryDto>> List() => Ok(_tracker.List());
}
