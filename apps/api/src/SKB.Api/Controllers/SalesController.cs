using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

[ApiController]
[Route("api/sales")]
[Authorize(Policy = Permissions.SalesView)]
public sealed class SalesController : ControllerBase
{
    private readonly AppDbContext _db;
    public SalesController(AppDbContext db) => _db = db;

    [HttpGet("invoices")]
    public async Task<ActionResult<PaginatedDto<SalesSummaryDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null, [FromQuery] string? status = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.SalesDocuments.Where(d => d.Type == DocumentType.SALES_INVOICE);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<DocumentStatus>(status, out var st))
            q = q.Where(d => d.Status == st);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            q = q.Where(d => d.Number.ToLower().Contains(s) || d.Party!.Name.ToLower().Contains(s));
        }

        var total = await q.CountAsync();
        var rows = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff)
            .OrderByDescending(d => d.IssueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Ok(new PaginatedDto<SalesSummaryDto>(
            rows.Select(Mapper.ToSummary).ToArray(), total, page, pageSize));
    }

    [HttpGet("invoices/{id:guid}")]
    public async Task<ActionResult<SalesDetailDto>> GetOne(Guid id)
    {
        var q = _db.SalesDocuments.Where(d => d.Id == id);
        if (!CurrentUser.CanSeeAllBranches(User))
        {
            Guid.TryParse(CurrentUser.BranchId(User), out var branchId);
            q = q.Where(d => d.BranchId == branchId);
        }
        var doc = await q
            .Include(d => d.Branch).Include(d => d.Party).Include(d => d.Staff).Include(d => d.Lines)
            .FirstOrDefaultAsync();
        if (doc is null) return NotFound(new { message = "Document not found" });
        return Ok(Mapper.ToDetail(doc));
    }
}
