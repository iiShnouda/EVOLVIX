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
/// Attendance (الحضور والانصراف): a day's sheet for every active employee, typed in or read from the
/// fingerprint device's export. Late and overtime minutes are worked out from each employee's
/// shift. A month whose payroll is posted can't change.
/// </summary>
[ApiController]
[Route("api/payroll/attendance")]
[Authorize(Policy = Permissions.PayrollView)]
public sealed class AttendanceController : ControllerBase
{
    private const int MaxImportChars = 2_000_000;
    private readonly AppDbContext _db;
    private readonly AuditService _audit;

    public AttendanceController(AppDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<AttendanceSheetDto>> Sheet([FromQuery] string? date = null, [FromQuery] string? branchId = null)
    {
        var day = ParseDay(date) ?? CompanyClock.TodayDate;
        var q = Scoped().AsNoTracking().Include(e => e.Shift).Include(e => e.Branch)
            .Where(e => e.IsActive && e.HireDate <= day);
        if (Guid.TryParse(branchId, out var b)) q = q.Where(e => e.BranchId == b);
        var employees = await q.OrderBy(e => e.Code).ToListAsync();
        var ids = employees.Select(e => e.Id).ToList();
        var records = await _db.AttendanceDays.AsNoTracking().Where(a => a.Date == day && ids.Contains(a.EmployeeId))
            .ToDictionaryAsync(a => a.EmployeeId);
        var locked = await LockedAsync(ids, day);
        return Ok(new AttendanceSheetDto(day.ToString("yyyy-MM-dd"), employees.Select(e =>
        {
            var shift = e.Shift ?? PayrollService.DefaultShift;
            records.TryGetValue(e.Id, out var r);
            return new AttendanceRowDto(e.Id.ToString(), e.Code, e.Name, Loc.Name(e.Branch),
                e.Shift is null ? null : Loc.Name(e.Shift), shift.DaysOff.Contains((int)day.DayOfWeek),
                r?.Status.ToString(), PayrollService.Clock(r?.CheckIn), PayrollService.Clock(r?.CheckOut),
                r?.LateMinutes ?? 0, r?.OvertimeMinutes ?? 0, r?.Source.ToString(), r?.Notes, locked.Contains(e.Id));
        }).ToArray()));
    }

    /// <summary>Save a day's sheet: each row sets (or, with no status, clears) one employee's day.</summary>
    [HttpPut]
    [Authorize(Policy = Permissions.AttendanceEdit)]
    public async Task<ActionResult<AttendanceSheetDto>> Save([FromBody] SaveAttendanceRequest req)
    {
        var day = ParseDay(req.Date);
        if (day is null || day > CompanyClock.TodayDate) return Bad("bad_date", "Choose a day up to today.");
        if (req.Rows is null || req.Rows.Length is 0 or > 1000) return Bad("no_rows", "Nothing to save.");
        var parsed = new List<(Guid Id, AttendanceStatus? Status, int? In, int? Out, string? Notes)>();
        foreach (var row in req.Rows)
        {
            if (!Guid.TryParse(row.EmployeeId, out var id)) return Bad("employee_not_found", "Employee not found.");
            AttendanceStatus? status = null;
            if (!string.IsNullOrWhiteSpace(row.Status))
            {
                if (!Enum.TryParse<AttendanceStatus>(row.Status, true, out var s)) return Bad("bad_status", "Unknown attendance status.");
                status = s;
            }
            if (!PayrollService.TryTime(row.CheckIn, out var inAt) || !PayrollService.TryTime(row.CheckOut, out var outAt))
                return Bad("bad_time", "Enter times like 08:55.");
            if (status != AttendanceStatus.PRESENT) (inAt, outAt) = (null, null);
            parsed.Add((id, status, inAt, outAt, Text(row.Notes, 200)));
        }
        var ids = parsed.Select(p => p.Id).Distinct().ToList();
        var employees = await Scoped().Include(e => e.Shift).Where(e => ids.Contains(e.Id) && e.IsActive).ToDictionaryAsync(e => e.Id);
        if (employees.Count != ids.Count) return Bad("employee_not_found", "Employee not found.");
        var locked = await LockedAsync(ids, day.Value);
        if (locked.Count > 0) return Bad("month_posted", "That month's payroll is already posted.");

        await using var tx = await _db.Database.BeginTransactionAsync();
        var existing = await _db.AttendanceDays.Where(a => a.Date == day && ids.Contains(a.EmployeeId)).ToDictionaryAsync(a => a.EmployeeId);
        foreach (var (id, status, inAt, outAt, notes) in parsed)
        {
            existing.TryGetValue(id, out var rec);
            if (status is null)
            {
                if (rec is not null) _db.AttendanceDays.Remove(rec);
                continue;
            }
            if (rec is null)
            {
                rec = new AttendanceDay { EmployeeId = id, Date = day.Value };
                _db.AttendanceDays.Add(rec);
                existing[id] = rec;
            }
            Set(rec, employees[id], status.Value, inAt, outAt, AttendanceSource.MANUAL);
            rec.Notes = notes;
        }
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("update", day.Value.ToString("yyyy-MM-dd"));
        return await Sheet(day.Value.ToString("yyyy-MM-dd"));
    }

    /// <summary>
    /// Read a fingerprint device's export: each employee's first punch of a day is the check-in, the
    /// last the check-out. Days of a posted month are skipped; unknown device numbers are listed.
    /// </summary>
    [HttpPost("import")]
    [Authorize(Policy = Permissions.AttendanceEdit)]
    public async Task<ActionResult<ImportAttendanceResultDto>> Import([FromBody] ImportAttendanceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Text)) return Bad("no_rows", "Nothing to read.");
        if (req.Text.Length > MaxImportChars) return Bad("too_big", "The file is too big; import a month at a time.");
        var (punches, skipped) = PayrollService.ParsePunches(req.Text);
        var userIds = punches.Select(p => p.UserId).Distinct().ToList();
        var employees = await Scoped().Include(e => e.Shift).Where(e => e.DeviceUserId != null && userIds.Contains(e.DeviceUserId) && e.IsActive)
            .ToDictionaryAsync(e => e.DeviceUserId!);
        var unknown = userIds.Where(u => !employees.ContainsKey(u)).OrderBy(u => u).ToArray();
        var days = punches.Where(p => employees.ContainsKey(p.UserId))
            .GroupBy(p => (Employee: employees[p.UserId], p.Day))
            .Select(g => (g.Key.Employee, g.Key.Day, In: g.Min(p => p.Minute), Out: g.Count() > 1 ? g.Max(p => p.Minute) : (int?)null))
            .ToList();
        if (days.Count == 0)
            return Ok(new ImportAttendanceResultDto(punches.Count, 0, skipped, 0, unknown));

        var ids = days.Select(d => d.Employee.Id).Distinct().ToList();
        var from = days.Min(d => d.Day);
        var to = days.Max(d => d.Day);
        var postedMonths = await _db.PayrollLines
            .Where(l => ids.Contains(l.EmployeeId) && (l.Run!.Status == PayrollRunStatus.POSTED || l.Run.Status == PayrollRunStatus.PAID))
            .Select(l => new { l.EmployeeId, l.Run!.Year, l.Run.Month }).ToListAsync();
        var posted = postedMonths.Select(x => (x.EmployeeId, x.Year, x.Month)).ToHashSet();

        await using var tx = await _db.Database.BeginTransactionAsync();
        var existing = await _db.AttendanceDays.Where(a => ids.Contains(a.EmployeeId) && a.Date >= from && a.Date <= to)
            .ToDictionaryAsync(a => (a.EmployeeId, a.Date));
        var saved = 0;
        var lockedDays = 0;
        foreach (var (employee, day, inAt, outAt) in days)
        {
            if (posted.Contains((employee.Id, day.Year, day.Month)))
            {
                lockedDays++;
                continue;
            }
            if (!existing.TryGetValue((employee.Id, day), out var rec))
            {
                rec = new AttendanceDay { EmployeeId = employee.Id, Date = day };
                _db.AttendanceDays.Add(rec);
            }
            Set(rec, employee, AttendanceStatus.PRESENT, inAt, outAt, AttendanceSource.DEVICE);
            saved++;
        }
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
        await AuditAsync("import", $"{from:yyyy-MM-dd}..{to:yyyy-MM-dd}");
        return Ok(new ImportAttendanceResultDto(punches.Count, saved, skipped, lockedDays, unknown));
    }

    // ------------------------------------------------------------------ helpers

    private void Set(AttendanceDay rec, Employee employee, AttendanceStatus status, int? inAt, int? outAt, AttendanceSource source)
    {
        var (late, overtime) = PayrollService.Measure(employee.Shift ?? PayrollService.DefaultShift, rec.Date, status, inAt, outAt);
        rec.Status = status;
        rec.CheckIn = inAt;
        rec.CheckOut = outAt;
        rec.LateMinutes = late;
        rec.OvertimeMinutes = overtime;
        rec.Source = source;
        rec.UpdatedById = Guid.TryParse(CurrentUser.Id(User), out var me) ? me : Guid.Empty;
        rec.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Of these employees, those whose month of <paramref name="day"/> is already posted.</summary>
    private async Task<HashSet<Guid>> LockedAsync(List<Guid> ids, DateTime day) =>
        (await _db.PayrollLines.Where(l => ids.Contains(l.EmployeeId) && l.Run!.Year == day.Year && l.Run.Month == day.Month
                                           && (l.Run.Status == PayrollRunStatus.POSTED || l.Run.Status == PayrollRunStatus.PAID))
            .Select(l => l.EmployeeId).ToListAsync()).ToHashSet();

    private IQueryable<Employee> Scoped() => _db.Employees.InBranches(User, e => e.BranchId);

    private static DateTime? ParseDay(string? s) =>
        DateOnly.TryParse(s, CultureInfo.InvariantCulture, out var d) ? d.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) : null;

    private static string? Text(string? s, int max)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t[..Math.Min(max, t.Length)];
    }

    private BadRequestObjectResult Bad(string code, string message) => BadRequest(new { message, code });

    private Task AuditAsync(string action, string what) => _audit.RecordAsync(
        CurrentUser.Id(User), CurrentUser.Name(User), action, "attendance", CurrentUser.BranchId(User),
        HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), what);
}
