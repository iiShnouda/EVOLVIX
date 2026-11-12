using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Printing, saving as PDF and saving as Excel are each a permission of their own on every page
/// (owner, 2026-11-12). The files are made in the web app from what the person already sees, so the
/// app asks here first: the permission is checked and the output written in the activity log; a
/// refusal means nothing comes out. (A single invoice asks its own endpoint, which also names it.)
/// </summary>
[ApiController]
[Route("api/outputs")]
[Authorize]
public sealed class OutputsController : ControllerBase
{
    /// <summary>Each page's permission for each kind of output; a page without one has no such output.</summary>
    public static readonly IReadOnlyDictionary<string, (string? Print, string? Pdf, string? Excel)> Pages =
        new Dictionary<string, (string?, string?, string?)>
        {
            ["sales"] = (Permissions.SalesPrint, Permissions.SalesPdf, null),
            ["purchases"] = (Permissions.PurchasesPrint, Permissions.PurchasesPdf, null),
            ["inventory"] = (Permissions.InventoryPrint, Permissions.InventoryPdf, Permissions.InventoryExport),
            ["stocktake"] = (Permissions.StocktakePrint, Permissions.StocktakePdf, null),
            ["transfers"] = (Permissions.TransfersPrint, Permissions.TransfersPdf, null),
            ["labels"] = (Permissions.LabelsPrint, Permissions.LabelsPdf, null),
            ["parties"] = (Permissions.PartiesPrint, Permissions.PartiesPdf, null),
            ["statement"] = (Permissions.StatementPrint, Permissions.StatementPdf, Permissions.StatementExport),
            ["money"] = (Permissions.MoneyPrint, Permissions.MoneyPdf, Permissions.MoneyExport),
            ["ledger"] = (Permissions.LedgerPrint, Permissions.LedgerPdf, Permissions.LedgerExport),
            ["payroll"] = (Permissions.PayrollPrint, Permissions.PayrollPdf, Permissions.PayrollExport),
            ["reports"] = (Permissions.ReportsPrint, Permissions.ReportsPdf, Permissions.ReportsExport),
            ["audit"] = (Permissions.AuditPrint, Permissions.AuditPdf, Permissions.AuditExport),
        };

    private readonly AuditService _audit;
    public OutputsController(AuditService audit) => _audit = audit;

    /// <summary>May I print / save as PDF / save as Excel on this page? Noted when I may.</summary>
    [HttpPost]
    public async Task<IActionResult> Ask([FromBody] OutputRequest req)
    {
        if (req.Page is null || !Pages.TryGetValue(req.Page, out var page))
            return BadRequest(new { message = "Unknown page.", code = "bad_output" });
        var permission = req.Kind switch
        {
            "print" => page.Print,
            "pdf" => page.Pdf,
            "excel" => page.Excel,
            _ => null,
        };
        if (permission is null)
            return BadRequest(new { message = "Unknown kind of output.", code = "bad_output" });
        if (!User.HasClaim("permission", permission))
            return StatusCode(403, new { message = "Not allowed.", code = "forbidden" });
        await _audit.RecordAsync(CurrentUser.Id(User), CurrentUser.Name(User), req.Kind!, "output_" + req.Page,
            CurrentUser.BranchId(User), Request.HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(), null, req.Title);
        return NoContent();
    }
}
