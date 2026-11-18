using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Sales reps' commission (العمولة, owner 2026-11-18): the rules (a percent of net sales or of
/// collections, for a department or all, from a day), the report per rep for a period with each
/// invoice, return and collection behind it, and adding a month's commission to the payroll of the
/// employee the rep is. Each is a permission of its own; the report counts only the documents of the
/// person's branches and departments.
/// </summary>
[ApiController]
[Route("api/commission")]
[Authorize]
public sealed class CommissionController : ControllerBase
{
    private const int MaxDays = 366;
    private readonly AppDbContext _db;
    private readonly CommissionService _commission;
    private readonly AuditService _audit;

    public CommissionController(AppDbContext db, CommissionService commission, AuditService audit)
    {
        _db = db;
        _commission = commission;
        _audit = audit;
    }

    /// <summary>Who can be a rep (every sign-in, with the employee each is) and the departments to pick.</summary>
    [HttpGet("options")]
    [AnyPermission(Permissions.CommissionSetup, Permissions.ReportsCommission, Permissions.CommissionPayroll)]
    public async Task<ActionResult<CommissionOptionsDto>> Options()
    {
        var staff = await _db.Staff.AsNoTracking().OrderBy(s => s.Code).Select(s => new { s.Id, s.Code, s.FullName, s.IsActive })
            .ToListAsync();
        var employees = await EmployeesOfAsync(staff.Select(s => s.Id).ToList());
        var departments = await ScopedDepartments().AsNoTracking().Where(d => d.IsActive).ToListAsync();
        return Ok(new CommissionOptionsDto(
            staff.Select(s => new CommissionRepDto(s.Id.ToString(), s.Code, s.FullName,
                employees.GetValueOrDefault(s.Id)?.Id.ToString(), employees.GetValueOrDefault(s.Id)?.Name, s.IsActive)).ToArray(),
            departments.Select(d => new CommissionDepartmentDto(d.Id.ToString(), Loc.Name(d))).OrderBy(d => d.Name).ToArray()));
    }

    // ------------------------------------------------------------------ rules

    [HttpGet("rules")]
    [Authorize(Policy = Permissions.CommissionSetup)]
    public async Task<ActionResult<CommissionRuleDto[]>> Rules([FromQuery] string? repId = null)
    {
        var q = ScopedRules().AsNoTracking().Include(r => r.Staff).Include(r => r.Department).AsQueryable();
        if (Guid.TryParse(repId, out var rep)) q = q.Where(r => r.StaffId == rep);
        var rules = await q.ToListAsync();
        var employees = await EmployeesOfAsync(rules.Select(r => r.StaffId).Distinct().ToList());
        return Ok(rules.OrderBy(r => r.Staff!.Code).ThenBy(r => r.DepartmentId != null).ThenByDescending(r => r.StartDate)
            .Select(r => ToDto(r, employees.GetValueOrDefault(r.StaffId))).ToArray());
    }

    [HttpPost("rules")]
    [Authorize(Policy = Permissions.CommissionSetup)]
    public async Task<ActionResult<CommissionRuleDto>> CreateRule([FromBody] SaveCommissionRuleRequest req)
    {
        var rule = new CommissionRule { CreatedById = Me(), StartDate = CompanyClock.TodayDate };
        var error = await ApplyAsync(rule, req, creating: true);
        if (error is not null) return error;
        _db.CommissionRules.Add(rule);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "commission_rule", rule.Id);
        return Created($"/api/commission/rules/{rule.Id}", await RuleDtoAsync(rule.Id));
    }

    [HttpPut("rules/{id:guid}")]
    [Authorize(Policy = Permissions.CommissionSetup)]
    public async Task<ActionResult<CommissionRuleDto>> UpdateRule(Guid id, [FromBody] SaveCommissionRuleRequest req)
    {
        var rule = await ScopedRules().FirstOrDefaultAsync(r => r.Id == id);
        if (rule is null) return NotFound(new { message = "Rule not found.", code = "not_found" });
        var error = await ApplyAsync(rule, req, creating: false);
        if (error is not null) return error;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("update", "commission_rule", rule.Id);
        return Ok(await RuleDtoAsync(rule.Id));
    }

    [HttpDelete("rules/{id:guid}")]
    [Authorize(Policy = Permissions.CommissionSetup)]
    public async Task<IActionResult> DeleteRule(Guid id)
    {
        var rule = await ScopedRules().FirstOrDefaultAsync(r => r.Id == id);
        if (rule is null) return NotFound(new { message = "Rule not found.", code = "not_found" });
        _db.CommissionRules.Remove(rule);
        await _db.SaveChangesAsync();
        await AuditAsync("delete", "commission_rule", id);
        return NoContent();
    }

    private async Task<ActionResult?> ApplyAsync(CommissionRule rule, SaveCommissionRuleRequest req, bool creating)
    {
        if (req.RepId is not null || creating)
        {
            if (!Guid.TryParse(req.RepId, out var rep) || !await _db.Staff.AnyAsync(s => s.Id == rep))
                return Bad("rep_not_found", "Choose the sales rep.");
            rule.StaffId = rep;
        }
        if (req.Basis is not null || creating)
        {
            if (!Enum.TryParse<CommissionBasis>(req.Basis, true, out var basis) || !Enum.IsDefined(basis))
                return Bad("bad_basis", "On net sales or on collections.");
            rule.Basis = basis;
        }
        if (req.Percent is decimal percent || creating)
        {
            var p = req.Percent ?? -1;
            var bp = (int)decimal.Round(p * 100m, MidpointRounding.AwayFromZero);
            if (bp <= 0 || bp > 10000 || p * 100m != bp) return Bad("bad_percent", "A percent above 0 up to 100, to two decimals.");
            rule.PercentBp = bp;
        }
        if (req.DepartmentId is not null)
        {
            if (req.DepartmentId == "") rule.DepartmentId = null;
            else if (Guid.TryParse(req.DepartmentId, out var dept) && await ScopedDepartments().AnyAsync(d => d.Id == dept))
                rule.DepartmentId = dept;
            else return Bad("department_not_found", "Department not found.");
        }
        // A rule for every department reaches departments the person may not see: theirs to set only if they see all.
        if (rule.DepartmentId is null && Access.Departments(User) is not null)
            return Bad("department_not_found", "Choose one of your departments.");
        if (req.StartDate is not null)
        {
            if (CompanyClock.ParseDay(req.StartDate) is not DateOnly day || day.Year < 2000 || day > CompanyClock.Today.AddYears(2))
                return Bad("bad_date", "Enter the first day as a date.");
            rule.StartDate = CompanyClock.AsDate(day);
        }
        if (await _db.CommissionRules.AnyAsync(r => r.Id != rule.Id && r.StaffId == rule.StaffId
                                                    && r.DepartmentId == rule.DepartmentId && r.StartDate == rule.StartDate))
            return Bad("rule_exists", "This rep already has a rule for that department from that day.");
        return null;
    }

    // ------------------------------------------------------------------ report

    /// <summary>Each rep's sales, returns, net, collected and commission for the period (company days).</summary>
    [HttpGet("report")]
    [Authorize(Policy = Permissions.ReportsCommission)]
    public async Task<ActionResult<CommissionReportDto>> Report([FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? branchId = null)
    {
        var (period, error) = Period(from, to);
        if (error is not null) return error;
        var docs = ScopedDocs(branchId);
        if (docs is null) return Bad("branch_not_found", "Branch not found.");
        var items = await _commission.ItemsAsync(docs, period.From, period.To);
        var reps = items.Select(i => i.RepId).Distinct().ToList();
        var staff = await _db.Staff.AsNoTracking().Where(s => reps.Contains(s.Id))
            .Select(s => new { s.Id, s.Code, s.FullName }).ToDictionaryAsync(s => s.Id);
        var employees = await EmployeesOfAsync(reps);
        var added = new HashSet<Guid>();
        if (period.From.Day == 1 && period.To == period.From.AddMonths(1).AddDays(-1))
            added = (await _db.PayrollAdjustments.AsNoTracking()
                    .Where(a => a.CommissionRepId != null && reps.Contains(a.CommissionRepId.Value)
                                && a.Year == period.From.Year && a.Month == period.From.Month)
                    .Select(a => a.CommissionRepId!.Value).ToListAsync())
                .ToHashSet();
        var rows = items.GroupBy(i => i.RepId).Select(g =>
        {
            var s = staff.GetValueOrDefault(g.Key);
            var e = employees.GetValueOrDefault(g.Key);
            var sales = g.Where(i => i.Kind == CommissionService.Sale).Sum(i => i.Amount);
            var returns = -g.Where(i => i.Kind == CommissionService.Return).Sum(i => i.Amount);
            return new CommissionRowDto(g.Key.ToString(), s?.Code ?? 0, s?.FullName ?? "", e?.Id.ToString(), e?.Name, sales,
                returns, sales - returns, g.Where(i => i.Kind == CommissionService.Collection).Sum(i => i.Amount),
                g.Sum(i => i.Commission), g.Count(i => i.Kind == CommissionService.Sale), added.Contains(g.Key));
        }).OrderBy(r => r.RepCode).ToArray();
        return Ok(new CommissionReportDto(period.From.ToString("yyyy-MM-dd"), period.To.ToString("yyyy-MM-dd"), rows,
            await CurrencyAsync()));
    }

    /// <summary>The invoices, returns and collections behind one rep's commission.</summary>
    [HttpGet("report/{repId:guid}/items")]
    [Authorize(Policy = Permissions.ReportsCommission)]
    public async Task<ActionResult<CommissionItemDto[]>> Items(Guid repId, [FromQuery] string? from = null,
        [FromQuery] string? to = null, [FromQuery] string? branchId = null)
    {
        var (period, error) = Period(from, to);
        if (error is not null) return error;
        var docs = ScopedDocs(branchId);
        if (docs is null) return Bad("branch_not_found", "Branch not found.");
        var items = await _commission.ItemsAsync(docs, period.From, period.To, repId);
        var deptIds = items.Where(i => i.DepartmentId != null).Select(i => i.DepartmentId!.Value).Distinct().ToList();
        var depts = await _db.Departments.AsNoTracking().Where(d => deptIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id);
        return Ok(items.Select(i => new CommissionItemDto(i.Kind, i.DocumentId.ToString(), i.Number, i.Reference,
            CompanyClock.DayOf(i.Date).ToString("yyyy-MM-dd"),
            i.DepartmentId is Guid d && depts.TryGetValue(d, out var dept) ? Loc.Name(dept) : null, i.PartyName, i.Amount,
            i.PercentBp, i.Commission)).ToArray());
    }

    // ------------------------------------------------------------------ payroll

    /// <summary>
    /// Add a rep's commission for a month to that month's payroll, as a bonus of the employee the rep
    /// is — once per rep and month. It is the rep's whole commission for the month (every branch and
    /// department), worked out now.
    /// </summary>
    [HttpPost("payroll")]
    [Authorize(Policy = Permissions.CommissionPayroll)]
    public async Task<IActionResult> AddToPayroll([FromBody] CommissionPayrollRequest req)
    {
        if (req.Year is < 2000 or > 2100 || req.Month is < 1 or > 12) return Bad("bad_month", "Choose a month.");
        var first = new DateOnly(req.Year, req.Month, 1);
        if (first > CompanyClock.Today) return Bad("future_month", "That month hasn't started.");
        if (!Guid.TryParse(req.RepId, out var repId) || !await _db.Staff.AnyAsync(s => s.Id == repId))
            return Bad("rep_not_found", "Sales rep not found.");
        var employee = await _db.Employees.FirstOrDefaultAsync(e => e.StaffId == repId);
        if (employee is null) return Bad("not_linked", "This rep isn't an employee on the payroll: link their sign-in to an employee first.");
        if (!await _db.Employees.InBranches(User, e => e.BranchId).AnyAsync(e => e.Id == employee.Id))
            return Bad("employee_not_found", "Employee not found.");
        if (await _db.PayrollLines.AnyAsync(l => l.EmployeeId == employee.Id && l.Run!.Year == req.Year && l.Run.Month == req.Month
                                                 && (l.Run.Status == PayrollRunStatus.POSTED || l.Run.Status == PayrollRunStatus.PAID)))
            return Bad("month_posted", "That month's payroll is already posted.");
        if (await _db.PayrollAdjustments.AnyAsync(a => a.CommissionRepId == repId && a.Year == req.Year && a.Month == req.Month))
            return Bad("already_added", "This rep's commission for that month is already in the payroll.");
        var items = await _commission.ItemsAsync(_db.SalesDocuments, first, first.AddMonths(1).AddDays(-1), repId);
        var amount = items.Sum(i => i.Commission);
        if (amount <= 0) return Bad("nothing_due", "No commission is due for that month.");
        var adjustment = new PayrollAdjustment
        {
            EmployeeId = employee.Id, Year = req.Year, Month = req.Month, Kind = AdjustmentKind.BONUS, Amount = amount,
            Reason = $"Commission {req.Year}-{req.Month:00}", CommissionRepId = repId, CreatedById = Me(),
        };
        _db.PayrollAdjustments.Add(adjustment);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Bad("already_added", "This rep's commission for that month is already in the payroll.");
        }
        await AuditAsync("commission", "payroll_adjustment", adjustment.Id);
        return Ok(new { id = adjustment.Id.ToString(), employeeId = employee.Id.ToString(), employeeName = employee.Name, amount });
    }

    // ------------------------------------------------------------------ helpers

    private ((DateOnly From, DateOnly To) Period, ActionResult? Error) Period(string? from, string? to)
    {
        var today = CompanyClock.Today;
        var f = string.IsNullOrEmpty(from) ? new DateOnly(today.Year, today.Month, 1) : CompanyClock.ParseDay(from);
        var t = string.IsNullOrEmpty(to) ? today : CompanyClock.ParseDay(to);
        if (f is null || t is null) return (default, Bad("bad_date", "Enter the period as dates."));
        if (t < f) return (default, Bad("bad_range", "The last day is before the first."));
        if (t.Value.DayNumber - f.Value.DayNumber >= MaxDays) return (default, Bad("bad_range", "At most a year at a time."));
        return ((f.Value, t.Value), null);
    }

    /// <summary>Sales documents of the person's branches and departments (one branch, when asked); null for a branch not theirs.</summary>
    private IQueryable<SalesDocument>? ScopedDocs(string? branchId)
    {
        var q = _db.SalesDocuments.InBranches(User, d => d.BranchId).InDepartments(User);
        if (string.IsNullOrEmpty(branchId)) return q;
        if (!Guid.TryParse(branchId, out var b) || !Access.CanUseBranch(User, b)) return null;
        return q.Where(d => d.BranchId == b);
    }

    private IQueryable<Department> ScopedDepartments()
    {
        if (Access.Departments(User) is not { } mine) return _db.Departments;
        return _db.Departments.Where(d => mine.Contains(d.Id));
    }

    /// <summary>Rules of the person's departments (all, for those who see every department).</summary>
    private IQueryable<CommissionRule> ScopedRules()
    {
        if (Access.Departments(User) is not { } mine) return _db.CommissionRules;
        return _db.CommissionRules.Where(r => r.DepartmentId != null && mine.Contains(r.DepartmentId.Value));
    }

    private async Task<Dictionary<Guid, Employee>> EmployeesOfAsync(List<Guid> staffIds) =>
        (await _db.Employees.AsNoTracking().Where(e => e.StaffId != null && staffIds.Contains(e.StaffId.Value)).ToListAsync())
        .GroupBy(e => e.StaffId!.Value).ToDictionary(g => g.Key, g => g.First());

    private async Task<CommissionRuleDto> RuleDtoAsync(Guid id)
    {
        var r = await _db.CommissionRules.AsNoTracking().Include(x => x.Staff).Include(x => x.Department).FirstAsync(x => x.Id == id);
        return ToDto(r, (await EmployeesOfAsync(new() { r.StaffId })).GetValueOrDefault(r.StaffId));
    }

    private static CommissionRuleDto ToDto(CommissionRule r, Employee? e) => new(
        r.Id.ToString(), r.StaffId.ToString(), r.Staff?.Code ?? 0, r.Staff?.FullName ?? "", r.Basis.ToString(), r.PercentBp,
        r.DepartmentId?.ToString(), r.Department is null ? null : Loc.Name(r.Department), r.StartDate.ToString("yyyy-MM-dd"),
        e?.Id.ToString(), e?.Name);

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private Task AuditAsync(string action, string resource, Guid id) => _audit.RecordAsync(
        CurrentUser.Id(User), CurrentUser.Name(User), action, resource, CurrentUser.BranchId(User),
        HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), id.ToString());
}
