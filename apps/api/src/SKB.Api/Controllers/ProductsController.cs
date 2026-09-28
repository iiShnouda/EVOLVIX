using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/products")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class ProductsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ProductsController(AppDbContext db) => _db = db;

    /// <summary>Product search for the invoice line picker (name / SKU / barcode).</summary>
    [HttpGet]
    public async Task<ActionResult<ProductDto[]>> List(
        [FromQuery] string? search = null, [FromQuery] bool inStockOnly = false, [FromQuery] int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 200);
        var q = _db.Products.Where(p => p.IsActive);
        if (inStockOnly) q = q.Where(p => p.StockOnHand > 0);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(p => p.Name.ToLower().Contains(s) || p.Sku.ToLower().Contains(s)
                || (p.NameAr != null && p.NameAr.ToLower().Contains(s))
                || (p.NameEn != null && p.NameEn.ToLower().Contains(s))
                || (p.Barcode != null && p.Barcode.ToLower().Contains(s)));
        }
        var rows = await q.OrderBy(p => p.Name).Take(limit).ToListAsync();
        return Ok(rows.Select(Mapper.ToProduct).ToArray());
    }
}
