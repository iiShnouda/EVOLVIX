using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;
using SKB.Api.Models;
using SKB.Api.Services;

namespace SKB.Api.Controllers;

/// <summary>
/// Payroll (الرواتب, DOMAIN.md §2.9): employees, shifts and the payroll rules; bonuses and
/// deductions; advances; and the month's payroll run — made as a draft, posted to the ledger, then
/// paid. Salaries are private: everything needs <c>payroll:view</c>, and each change its own
/// permission. Branch-scoped people see and pay their branch only.
/// </summary>
[ApiController]
[Route("api/payroll")]
[Authorize(Policy = Permissions.PayrollView)]
public sealed class PayrollController : ControllerBase
{
    private const long MaxAmount = 100_000_000_00; // 100 million
    private readonly AppDbContext _db;
    private readonly PayrollService _payroll;
    private readonly MoneyService _money;
    private readonly AuditService _audit;

    public PayrollController(AppDbContext db, PayrollService payroll, MoneyService money, AuditService audit)
    {
        _db = db;
        _payroll = payroll;
        _money = money;
        _audit = audit;
    }

    // ------------------------------------------------------------------ employees

    [HttpGet("employees")]
    public async Task<ActionResult<EmployeeDto[]>> Employees([FromQuery] bool? active = null)
    {
        var q = ScopedEmployees().AsNoTracking().Include(e => e.Branch).Include(e => e.Shift).Include(e => e.Staff).AsQueryable();
        if (active is bool a) q = q.Where(e => e.IsActive == a);
        return Ok((await q.OrderBy(e => e.Code).ToListAsync()).Select(ToDto).ToArray());
    }

    [HttpPost("employees")]
    [Authorize(Policy = Permissions.EmployeesManage)]
    public async Task<ActionResult<EmployeeDto>> CreateEmployee([FromBody] SaveEmployeeRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var e = new Employee
        {
            Code = await DocumentNumbers.NextEmployeeCodeAsync(_db),
            HireDate = DateTime.UtcNow.Date,
            BranchId = Guid.TryParse(CurrentUser.BranchId(User), out var b) ? b : Guid.Empty,
        };
        if (Loc.Clean(req.Name) is null) return Bad("bad_name", "Enter the employee's name.");
        var error = await ApplyAsync(e, req);
        if (error is not null) return error;
        _db.Employees.Add(e);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "employee", e.Id);
        return Created($"/api/payroll/employees/{e.Id}", await EmployeeDtoAsync(e.Id));
    }

    [HttpPut("employees/{id:guid}")]
    [Authorize(Policy = Permissions.EmployeesManage)]
    public async Task<ActionResult<EmployeeDto>> UpdateEmployee(Guid id, [FromBody] SaveEmployeeRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Employees\" WHERE \"Id\" = {id} FOR UPDATE");
        var e = await ScopedEmployees().FirstOrDefaultAsync(x => x.Id == id);
        if (e is null) return NotFound(new { message = "Employee not found.", code = "not_found" });
        var error = await ApplyAsync(e, req);
        if (error is not null) return error;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("update", "employee", e.Id);
        return Ok(await EmployeeDtoAsync(e.Id));
    }

    private async Task<ActionResult?> ApplyAsync(Employee e, SaveEmployeeRequest req)
    {
        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Enter the employee's name.");
            e.Name = name;
        }
        if (req.BranchId is not null)
        {
            if (!Guid.TryParse(req.BranchId, out var branch) || !await _db.Branches.AnyAsync(x => x.Id == branch)
                || (Scope() is Guid s && s != branch))
                return Bad("branch_not_found", "Branch not found.");
            e.BranchId = branch;
        }
        if (Scope() is Guid mine && e.BranchId != mine) e.BranchId = mine;
        if (!await _db.Branches.AnyAsync(x => x.Id == e.BranchId)) return Bad("branch_not_found", "Branch not found.");
        if (req.JobTitle is not null) e.JobTitle = Text(req.JobTitle, 100);
        if (req.Phone is not null) e.Phone = Text(req.Phone, 40);
        if (req.NationalId is not null) e.NationalId = Text(req.NationalId, 30);
        if (req.HireDate is not null)
        {
            if (!DateOnly.TryParse(req.HireDate, CultureInfo.InvariantCulture, out var hire) || hire.Year < 1950
                || hire > DateOnly.FromDateTime(DateTime.UtcNow).AddYears(1))
                return Bad("bad_date", "Enter a valid hiring date.");
            e.HireDate = hire.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        }
        if (req.MonthlySalary is long salary)
        {
            if (salary is < 0 or > MaxAmount) return Bad("bad_amount", "Enter a valid salary.");
            e.MonthlySalary = salary;
        }
        if (req.ShiftId is not null)
        {
            if (req.ShiftId == "") e.ShiftId = null;
            else if (!Guid.TryParse(req.ShiftId, out var shift) || !await _db.Shifts.AnyAsync(x => x.Id == shift && x.IsActive))
                return Bad("shift_not_found", "Shift not found.");
            else e.ShiftId = shift;
        }
        if (req.DeviceUserId is not null)
        {
            var device = req.DeviceUserId.Trim();
            if (device.Length == 0) e.DeviceUserId = null;
            else if (device.Length > 40 || !device.All(char.IsLetterOrDigit))
                return Bad("bad_device_id", "The device user number is letters and digits only.");
            else if (await _db.Employees.AnyAsync(x => x.DeviceUserId == device && x.Id != e.Id))
                return Bad("device_id_taken", "Another employee has that device user number.");
            else e.DeviceUserId = device;
        }
        if (req.StaffId is not null)
        {
            if (req.StaffId == "") e.StaffId = null;
            else if (!Guid.TryParse(req.StaffId, out var staff) || !await _db.Staff.AnyAsync(x => x.Id == staff))
                return Bad("staff_not_found", "That sign-in wasn't found.");
            else if (await _db.Employees.AnyAsync(x => x.StaffId == staff && x.Id != e.Id))
                return Bad("staff_taken", "That sign-in already belongs to another employee.");
            else e.StaffId = staff;
        }
        if (req.IsActive is bool active)
        {
            if (!active && e.AdvanceBalance > 0)
                return Bad("advance_open", "Recover or cancel this employee's advances first.");
            e.IsActive = active;
        }
        return null;
    }

    // ------------------------------------------------------------------ shifts and rules

    [HttpGet("shifts")]
    public async Task<ActionResult<ShiftDto[]>> Shifts() =>
        Ok((await _db.Shifts.AsNoTracking().OrderBy(s => s.StartMinute).ThenBy(s => s.Name).ToListAsync()).Select(ToDto).ToArray());

    [HttpPost("shifts")]
    [Authorize(Policy = Permissions.EmployeesManage)]
    public async Task<ActionResult<ShiftDto>> CreateShift([FromBody] SaveShiftRequest req)
    {
        var shift = new Shift();
        if (Loc.Clean(req.Name) is null) return Bad("bad_name", "Name the shift.");
        var error = Apply(shift, req);
        if (error is not null) return error;
        _db.Shifts.Add(shift);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "shift", shift.Id);
        return Created($"/api/payroll/shifts/{shift.Id}", ToDto(shift));
    }

    [HttpPut("shifts/{id:guid}")]
    [Authorize(Policy = Permissions.EmployeesManage)]
    public async Task<ActionResult<ShiftDto>> UpdateShift(Guid id, [FromBody] SaveShiftRequest req)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return NotFound(new { message = "Shift not found.", code = "not_found" });
        var error = Apply(shift, req);
        if (error is not null) return error;
        if (!shift.IsActive && await _db.Employees.AnyAsync(e => e.ShiftId == id && e.IsActive))
            return Bad("shift_in_use", "Move its employees to another shift first.");
        await _db.SaveChangesAsync();
        await AuditAsync("update", "shift", shift.Id);
        return Ok(ToDto(shift));
    }

    private ActionResult? Apply(Shift s, SaveShiftRequest req)
    {
        if (req.Name is not null)
        {
            var name = Loc.Clean(req.Name);
            if (name is null) return Bad("bad_name", "Name the shift.");
            s.Name = name;
        }
        if (req.Start is not null)
        {
            if (!PayrollService.TryTime(req.Start, out var m) || m is null) return Bad("bad_time", "Enter times like 09:00.");
            s.StartMinute = m.Value;
        }
        if (req.End is not null)
        {
            if (!PayrollService.TryTime(req.End, out var m) || m is null) return Bad("bad_time", "Enter times like 09:00.");
            s.EndMinute = m.Value;
        }
        if (s.StartMinute == s.EndMinute) return Bad("bad_time", "A shift can't start and end at the same time.");
        if (req.GraceMinutes is int grace)
        {
            if (grace is < 0 or > 240) return Bad("bad_grace", "Grace is 0 to 240 minutes.");
            s.GraceMinutes = grace;
        }
        if (req.DaysOff is not null)
        {
            var days = req.DaysOff.Distinct().OrderBy(d => d).ToList();
            if (days.Any(d => d is < 0 or > 6) || days.Count > 6) return Bad("bad_days", "Choose up to six days off.");
            s.DaysOff = days;
        }
        if (req.IsActive is bool active) s.IsActive = active;
        return null;
    }

    [HttpGet("settings")]
    public async Task<ActionResult<PayrollSettingsDto>> Settings()
    {
        var s = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        return Ok(new PayrollSettingsDto(s.PayrollDayBasis, s.OvertimePercent, s.MissingAttendanceIsAbsent));
    }

    [HttpPut("settings")]
    [Authorize(Policy = Permissions.EmployeesManage)]
    public async Task<ActionResult<PayrollSettingsDto>> SaveSettings([FromBody] PayrollSettingsDto req)
    {
        if (req.DayBasis is < 20 or > 31) return Bad("bad_day_basis", "A day's pay is the salary ÷ 20 to 31.");
        if (req.OvertimePercent is < 0 or > 500) return Bad("bad_overtime", "Overtime is 0% to 500% of the normal rate.");
        var s = await _db.CompanySettings.FirstAsync();
        s.PayrollDayBasis = req.DayBasis;
        s.OvertimePercent = req.OvertimePercent;
        s.MissingAttendanceIsAbsent = req.MissingAttendanceIsAbsent;
        s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await AuditAsync("update", "payroll_settings", s.Id);
        return Ok(req);
    }

    // ------------------------------------------------------------------ bonuses and deductions

    [HttpGet("adjustments")]
    public async Task<ActionResult<AdjustmentDto[]>> Adjustments([FromQuery] int year, [FromQuery] int month)
    {
        var ids = ScopedEmployees().Select(e => e.Id);
        var rows = await _db.PayrollAdjustments.AsNoTracking().Include(a => a.Employee).Include(a => a.CreatedBy)
            .Where(a => a.Year == year && a.Month == month && ids.Contains(a.EmployeeId))
            .OrderByDescending(a => a.CreatedAt).ToListAsync();
        return Ok(rows.Select(ToDto).ToArray());
    }

    [HttpPost("adjustments")]
    [Authorize(Policy = Permissions.PayrollAdjust)]
    public async Task<ActionResult<AdjustmentDto>> CreateAdjustment([FromBody] CreateAdjustmentRequest req)
    {
        if (!Enum.TryParse<AdjustmentKind>(req.Kind, true, out var kind)) return Bad("bad_kind", "A bonus or a deduction.");
        if (req.Amount is <= 0 or > MaxAmount) return Bad("bad_amount", "Enter an amount above zero.");
        if (req.Year is < 2000 or > 2100 || req.Month is < 1 or > 12) return Bad("bad_month", "Choose a month.");
        if (!Guid.TryParse(req.EmployeeId, out var employeeId)
            || await ScopedEmployees().FirstOrDefaultAsync(e => e.Id == employeeId && e.IsActive) is not { } employee)
            return Bad("employee_not_found", "Employee not found.");
        if (await MonthPostedAsync(employee.Id, req.Year, req.Month))
            return Bad("month_posted", "That month's payroll is already posted.");
        var a = new PayrollAdjustment
        {
            EmployeeId = employee.Id, Year = req.Year, Month = req.Month, Kind = kind, Amount = req.Amount,
            Reason = Text(req.Reason, 200) ?? "", CreatedById = Me(),
        };
        _db.PayrollAdjustments.Add(a);
        await _db.SaveChangesAsync();
        await AuditAsync("create", "payroll_adjustment", a.Id);
        await _db.Entry(a).Reference(x => x.Employee).LoadAsync();
        await _db.Entry(a).Reference(x => x.CreatedBy).LoadAsync();
        return Created($"/api/payroll/adjustments/{a.Id}", ToDto(a));
    }

    /// <summary>Take back a bonus or deduction not yet in a posted payroll.</summary>
    [HttpPost("adjustments/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.PayrollAdjust)]
    public async Task<IActionResult> CancelAdjustment(Guid id)
    {
        var ids = ScopedEmployees().Select(e => e.Id);
        var a = await _db.PayrollAdjustments.FirstOrDefaultAsync(x => x.Id == id && ids.Contains(x.EmployeeId));
        if (a is null) return NotFound(new { message = "Not found.", code = "not_found" });
        if (a.RunId is not null || await MonthPostedAsync(a.EmployeeId, a.Year, a.Month))
            return Bad("month_posted", "That month's payroll is already posted.");
        _db.PayrollAdjustments.Remove(a);
        await _db.SaveChangesAsync();
        await AuditAsync("cancel", "payroll_adjustment", a.Id);
        return NoContent();
    }

    // ------------------------------------------------------------------ advances

    [HttpGet("advances")]
    public async Task<ActionResult<AdvanceDto[]>> Advances([FromQuery] string? employeeId = null, [FromQuery] bool open = false)
    {
        var ids = ScopedEmployees().Select(e => e.Id);
        var q = _db.EmployeeAdvances.AsNoTracking().Include(a => a.Employee).Include(a => a.Account).Include(a => a.CreatedBy)
            .Where(a => ids.Contains(a.EmployeeId));
        if (Guid.TryParse(employeeId, out var emp)) q = q.Where(a => a.EmployeeId == emp);
        if (open) q = q.Where(a => a.Status == AdvanceStatus.OPEN);
        return Ok((await q.OrderByDescending(a => a.CreatedAt).Take(500).ToListAsync()).Select(ToDto).ToArray());
    }

    /// <summary>An advance on salary (سلفة), paid now from a money account and recovered from payroll.</summary>
    [HttpPost("advances")]
    [Authorize(Policy = Permissions.PayrollAdvance)]
    public async Task<ActionResult<AdvanceDto>> CreateAdvance([FromBody] CreateAdvanceRequest req)
    {
        if (req.Amount is <= 0 or > MaxAmount) return Bad("bad_amount", "Enter an amount above zero.");
        var installment = req.Installment ?? req.Amount;
        if (installment <= 0 || installment > req.Amount)
            return Bad("bad_installment", "The monthly installment is above zero and at most the advance.");
        if (!Guid.TryParse(req.EmployeeId, out var employeeId)) return Bad("employee_not_found", "Employee not found.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Employees\" WHERE \"Id\" = {employeeId} FOR UPDATE");
        var employee = await ScopedEmployees().FirstOrDefaultAsync(e => e.Id == employeeId && e.IsActive);
        if (employee is null) return Bad("employee_not_found", "Employee not found.");
        var (account, moneyError) = await _money.ForDocumentAsync(req.AccountId, employee.BranchId, Scope());
        if (moneyError is not null) return Bad(moneyError.Code, moneyError.Message);
        var advance = new EmployeeAdvance
        {
            Number = await DocumentNumbers.NextAdvanceAsync(_db), EmployeeId = employee.Id, Amount = req.Amount,
            Installment = installment, Remaining = req.Amount, AccountId = account!.Id, Notes = Text(req.Notes, 300),
            CreatedById = Me(),
        };
        var error = await _payroll.GiveAdvanceAsync(advance, employee, account, Me());
        if (error is not null) return Bad(error.Code, error.Message);
        _db.EmployeeAdvances.Add(advance);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "advance", advance.Id);
        return Created($"/api/payroll/advances/{advance.Id}", await AdvanceDtoAsync(advance.Id));
    }

    /// <summary>An advance handed back before anything was recovered: the money goes back.</summary>
    [HttpPost("advances/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.PayrollAdvance)]
    public async Task<ActionResult<AdvanceDto>> CancelAdvance(Guid id)
    {
        var ids = ScopedEmployees().Select(e => e.Id);
        var peek = await _db.EmployeeAdvances.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id && ids.Contains(a.EmployeeId));
        if (peek is null) return NotFound(new { message = "Advance not found.", code = "not_found" });
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Employees\" WHERE \"Id\" = {peek.EmployeeId} FOR UPDATE");
        var advance = await _db.EmployeeAdvances.FirstAsync(a => a.Id == id);
        if (advance.Status != AdvanceStatus.OPEN || advance.Remaining != advance.Amount)
            return Bad("advance_used", "Part of this advance was already recovered; it can't be cancelled.");
        var employee = await _db.Employees.FirstAsync(e => e.Id == advance.EmployeeId);
        var account = (await _money.LockAsync(new[] { advance.AccountId }))[advance.AccountId];
        await _payroll.CancelAdvanceAsync(advance, employee, account, Me());
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("cancel", "advance", advance.Id);
        return Ok(await AdvanceDtoAsync(advance.Id));
    }

    // ------------------------------------------------------------------ payroll runs

    [HttpGet("runs")]
    public async Task<ActionResult<PayrollRunDto[]>> Runs([FromQuery] int? year = null)
    {
        var q = ScopedRuns().AsNoTracking().Include(r => r.Branch).Include(r => r.CreatedBy).Include(r => r.PostedBy)
            .Where(r => r.Status != PayrollRunStatus.CANCELLED);
        if (year is int y) q = q.Where(r => r.Year == y);
        var runs = await q.OrderByDescending(r => r.Year).ThenByDescending(r => r.Month).ThenBy(r => r.Number).ToListAsync();
        var counts = await _db.PayrollLines.Where(l => runs.Select(r => r.Id).Contains(l.RunId))
            .GroupBy(l => l.RunId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);
        var currency = await CurrencyAsync();
        return Ok(runs.Select(r => ToDto(r, counts.GetValueOrDefault(r.Id), Array.Empty<PayrollLineDto>(), currency)).ToArray());
    }

    [HttpGet("runs/{id:guid}")]
    public async Task<ActionResult<PayrollRunDto>> Run(Guid id)
    {
        var dto = await RunDtoAsync(id);
        return dto is null ? NotFound(new { message = "Payroll not found.", code = "not_found" }) : Ok(dto);
    }

    /// <summary>Make a month's payroll as a draft (whole company, or one branch).</summary>
    [HttpPost("runs")]
    [Authorize(Policy = Permissions.PayrollPost)]
    public async Task<ActionResult<PayrollRunDto>> CreateRun([FromBody] CreatePayrollRunRequest req)
    {
        if (req.Year is < 2000 or > 2100 || req.Month is < 1 or > 12) return Bad("bad_month", "Choose a month.");
        if (PayrollService.MonthRange(req.Year, req.Month).Start > DateTime.UtcNow)
            return Bad("future_month", "A month that hasn't started can't be paid yet.");
        Guid? branch = null;
        if (!string.IsNullOrWhiteSpace(req.BranchId))
        {
            if (!Guid.TryParse(req.BranchId, out var b) || !await _db.Branches.AnyAsync(x => x.Id == b))
                return Bad("branch_not_found", "Branch not found.");
            branch = b;
        }
        if (Scope() is Guid mine)
        {
            if (branch is not null && branch != mine) return Bad("branch_not_found", "Branch not found.");
            branch = mine;
        }
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('payroll-runs'))");
        var existing = await _db.PayrollRuns.Where(r => r.Year == req.Year && r.Month == req.Month
                                                        && r.Status != PayrollRunStatus.CANCELLED)
            .Select(r => r.BranchId).ToListAsync();
        if (existing.Any(b => b == null || branch == null || b == branch))
            return Bad("run_exists", "That month already has a payroll for these employees.");
        var run = new PayrollRun
        {
            Number = await DocumentNumbers.NextPayrollRunAsync(_db), Year = req.Year, Month = req.Month, BranchId = branch,
            CreatedById = Me(),
        };
        _db.PayrollRuns.Add(run);
        await _payroll.ComputeAsync(run);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("create", "payroll_run", run.Id);
        return Created($"/api/payroll/runs/{run.Id}", await RunDtoAsync(run.Id));
    }

    /// <summary>Work a draft out again (after attendance, bonuses or salaries changed).</summary>
    [HttpPost("runs/{id:guid}/recalculate")]
    [Authorize(Policy = Permissions.PayrollPost)]
    public Task<ActionResult<PayrollRunDto>> Recalculate(Guid id) => WithDraftAsync(id, "recalculate", async run =>
    {
        await _payroll.ComputeAsync(run);
        return null;
    });

    /// <summary>Post the draft: it goes into the ledger, advances are recovered, and it's final.</summary>
    [HttpPost("runs/{id:guid}/post")]
    [Authorize(Policy = Permissions.PayrollPost)]
    public Task<ActionResult<PayrollRunDto>> Post(Guid id) => WithDraftAsync(id, "post", run => _payroll.PostAsync(run, Me()));

    [HttpPost("runs/{id:guid}/cancel")]
    [Authorize(Policy = Permissions.PayrollPost)]
    public Task<ActionResult<PayrollRunDto>> CancelRun(Guid id) => WithDraftAsync(id, "cancel", run =>
    {
        run.Status = PayrollRunStatus.CANCELLED;
        return Task.FromResult<PayrollService.PayrollError?>(null);
    });

    /// <summary>Pay the posted payroll (everyone still unpaid, or the ones named) from one money account.</summary>
    [HttpPost("runs/{id:guid}/pay")]
    [Authorize(Policy = Permissions.PayrollPay)]
    public async Task<ActionResult<PayrollRunDto>> Pay(Guid id, [FromBody] PayPayrollRequest req)
    {
        if (!await ScopedRuns().AnyAsync(r => r.Id == id)) return NotFound(new { message = "Payroll not found.", code = "not_found" });
        HashSet<Guid>? only = null;
        if (req.EmployeeIds is { Length: > 0 })
        {
            only = new HashSet<Guid>();
            foreach (var s in req.EmployeeIds)
                if (Guid.TryParse(s, out var g)) only.Add(g);
                else return Bad("employee_not_found", "Employee not found.");
        }
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"PayrollRuns\" WHERE \"Id\" = {id} FOR UPDATE");
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstAsync(r => r.Id == id);
        if (run.Status != PayrollRunStatus.POSTED)
            return Bad(run.Status == PayrollRunStatus.PAID ? "already_paid" : "not_posted",
                run.Status == PayrollRunStatus.PAID ? "This payroll is already paid." : "Post the payroll before paying it.");
        var (account, moneyError) = await _money.ForDocumentAsync(req.AccountId,
            run.BranchId ?? (Guid.TryParse(CurrentUser.BranchId(User), out var b) ? b : Guid.Empty), Scope());
        if (moneyError is not null) return Bad(moneyError.Code, moneyError.Message);
        var error = await _payroll.PayAsync(run, account!, only, Me());
        if (error is not null) return Bad(error.Code, error.Message);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("pay", "payroll_run", run.Id);
        return Ok(await RunDtoAsync(run.Id));
    }

    private async Task<ActionResult<PayrollRunDto>> WithDraftAsync(Guid id, string action,
        Func<PayrollRun, Task<PayrollService.PayrollError?>> work)
    {
        if (!await ScopedRuns().AnyAsync(r => r.Id == id)) return NotFound(new { message = "Payroll not found.", code = "not_found" });
        await using var tx = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"PayrollRuns\" WHERE \"Id\" = {id} FOR UPDATE");
        var run = await _db.PayrollRuns.Include(r => r.Lines).FirstAsync(r => r.Id == id);
        if (run.Status != PayrollRunStatus.DRAFT)
            return Bad("not_draft", "This payroll is already posted or cancelled.");
        var error = await work(run);
        if (error is not null) return Bad(error.Code, error.Message);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync(action, "payroll_run", run.Id);
        return Ok(await RunDtoAsync(run.Id));
    }

    // ------------------------------------------------------------------ helpers

    private Guid? Scope() => MoneyService.ScopeOf(User);

    private IQueryable<Employee> ScopedEmployees() =>
        Scope() is Guid b ? _db.Employees.Where(e => e.BranchId == b) : _db.Employees;

    private IQueryable<PayrollRun> ScopedRuns() =>
        Scope() is Guid b ? _db.PayrollRuns.Where(r => r.BranchId == b) : _db.PayrollRuns;

    /// <summary>Whether a posted (or paid) payroll already covers this employee's month.</summary>
    private Task<bool> MonthPostedAsync(Guid employeeId, int year, int month) =>
        _db.PayrollLines.AnyAsync(l => l.EmployeeId == employeeId && l.Run!.Year == year && l.Run.Month == month
                                       && (l.Run.Status == PayrollRunStatus.POSTED || l.Run.Status == PayrollRunStatus.PAID));

    private Guid Me() => Guid.TryParse(CurrentUser.Id(User), out var id) ? id : Guid.Empty;

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private static string? Text(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private async Task<string> CurrencyAsync() =>
        await _db.CompanySettings.AsNoTracking().Select(s => s.Currency).FirstOrDefaultAsync() ?? "EGP";

    private Task AuditAsync(string action, string resource, Guid id) => _audit.RecordAsync(
        CurrentUser.Id(User), CurrentUser.Name(User), action, resource, CurrentUser.BranchId(User),
        HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), id.ToString());

    private async Task<EmployeeDto> EmployeeDtoAsync(Guid id) =>
        ToDto(await _db.Employees.AsNoTracking().Include(e => e.Branch).Include(e => e.Shift).Include(e => e.Staff)
            .FirstAsync(e => e.Id == id));

    private async Task<AdvanceDto> AdvanceDtoAsync(Guid id) =>
        ToDto(await _db.EmployeeAdvances.AsNoTracking().Include(a => a.Employee).Include(a => a.Account)
            .Include(a => a.CreatedBy).FirstAsync(a => a.Id == id));

    private async Task<PayrollRunDto?> RunDtoAsync(Guid id)
    {
        var run = await ScopedRuns().AsNoTracking().Include(r => r.Branch).Include(r => r.CreatedBy).Include(r => r.PostedBy)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (run is null) return null;
        var lines = await _db.PayrollLines.AsNoTracking().Include(l => l.Employee).Where(l => l.RunId == id)
            .OrderBy(l => l.Employee!.Code).ToListAsync();
        return ToDto(run, lines.Count, lines.Select(l => new PayrollLineDto(
            l.Id.ToString(), l.EmployeeId.ToString(), l.Employee?.Code ?? "", l.EmployeeName, l.MonthlySalary, l.EmployedDays,
            l.WorkDays, l.AbsentDays, l.LateMinutes, l.OvertimeMinutes, l.Basic, l.OvertimePay, l.Bonuses,
            l.AbsenceDeduction, l.LateDeduction, l.Deductions, l.Earned, l.AdvanceRecovery, l.Net, l.PaidAmount,
            l.PaidAt?.ToString("o"))).ToArray(), await CurrencyAsync());
    }

    private static PayrollRunDto ToDto(PayrollRun r, int employees, PayrollLineDto[] lines, string currency) => new(
        r.Id.ToString(), r.Number, r.Year, r.Month, r.BranchId?.ToString(), r.Branch is null ? null : Loc.Name(r.Branch),
        r.Status.ToString(), r.Earned, r.Recovered, r.Net, r.Paid, employees, r.CreatedBy?.FullName ?? "",
        r.CreatedAt.ToString("o"), r.PostedAt?.ToString("o"), r.PostedBy?.FullName, lines, currency);

    private static EmployeeDto ToDto(Employee e) => new(
        e.Id.ToString(), e.Code, e.Name, e.BranchId.ToString(), Loc.Name(e.Branch), e.JobTitle, e.Phone, e.NationalId,
        e.HireDate.ToString("yyyy-MM-dd"), e.MonthlySalary, e.ShiftId?.ToString(), e.Shift is null ? null : Loc.Name(e.Shift),
        e.DeviceUserId, e.StaffId?.ToString(), e.Staff?.FullName, e.AdvanceBalance, e.IsActive);

    private static ShiftDto ToDto(Shift s) => new(
        s.Id.ToString(), Loc.Name(s), PayrollService.Clock(s.StartMinute)!, PayrollService.Clock(s.EndMinute)!, s.GraceMinutes,
        s.DaysOff.ToArray(), s.IsActive, PayrollService.ShiftMinutes(s));

    private static AdjustmentDto ToDto(PayrollAdjustment a) => new(
        a.Id.ToString(), a.EmployeeId.ToString(), a.Employee?.Name ?? "", a.Year, a.Month, a.Kind.ToString(), a.Amount,
        a.Reason, a.RunId is not null, a.CreatedBy?.FullName ?? "", a.CreatedAt.ToString("o"));

    private static AdvanceDto ToDto(EmployeeAdvance a) => new(
        a.Id.ToString(), a.Number, a.EmployeeId.ToString(), a.Employee?.Name ?? "", a.Amount, a.Installment, a.Remaining,
        a.Status.ToString(), a.Account is null ? "" : Loc.Name(a.Account), a.Notes, a.CreatedBy?.FullName ?? "",
        a.CreatedAt.ToString("o"));
}
