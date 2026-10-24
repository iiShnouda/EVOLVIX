using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// The public storefront catalog (owner, 2026-10-12: show the office's products on the KM Collection
/// site). This endpoint needs <c>settings:storefront</c>: the company server never faces the
/// public. The owner reads this scrubbed catalog and publishes it OUTWARD to the storefront host; the
/// site reads the published copy, so there is no inbound path to this server to attack. The catalog
/// carries only what is meant to be public — names, departments, colours, sizes, and in-stock or not
/// — never a cost, a price, a stock count, a supplier or a customer. Photos are fetched per item from
/// the authenticated products/{id}/image endpoint while publishing, so no image hole is opened either.
/// </summary>
[ApiController]
[Route("api/storefront")]
[Authorize(Policy = Permissions.SettingsStorefront)]
public sealed class StorefrontController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly StorefrontPublisher _publisher;

    public StorefrontController(AppDbContext db, StorefrontPublisher publisher)
    {
        _db = db;
        _publisher = publisher;
    }

    /// <summary>The scrubbed catalogue the owner publishes outward (and the publisher pushes).</summary>
    [HttpGet("catalog")]
    public async Task<ActionResult<StorefrontCatalogDto>> Catalog(CancellationToken ct) =>
        Ok(await StorefrontCatalog.BuildAsync(_db, ct));

    /// <summary>Whether auto-publishing is on, where it publishes, and when it last ran.</summary>
    [HttpGet("status")]
    public ActionResult<StorefrontPublisher.StatusView> Status() => Ok(_publisher.Status);

    /// <summary>Publish the catalogue now (it also publishes automatically when products change).</summary>
    [HttpPost("publish")]
    public async Task<ActionResult<StorefrontPublisher.StatusView>> Publish(CancellationToken ct)
    {
        if (!_publisher.Status.Enabled)
            return Conflict(new { message = "Publishing isn't set up on this server.", code = "storefront_off" });
        await _publisher.PublishAsync(ct);
        return Ok(_publisher.Status);
    }
}
