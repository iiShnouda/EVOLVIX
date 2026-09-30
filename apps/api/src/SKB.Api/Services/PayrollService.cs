using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SKB.Api.Data;
using SKB.Api.Domain;

namespace SKB.Api.Services;

/// <summary>
/// Payroll & attendance (DOMAIN.md §2.9).
/// <list type="bullet">
/// <item>Attendance: a day's late and overtime minutes come from the employee's shift.</item>
/// <item>A month's run: salary for the days employed, less absence (a day's pay each) and lateness
/// (by the minute), plus overtime (by the minute, at the overtime percent) and bonuses, less
/// deductions — never below zero — then advances recovered out of what's left.</item>
/// <item>Posting puts it in the ledger in one entry: Dr salaries (earned) · Cr employee advances
/// (recovered) · Cr salaries payable (net). Paying moves money: Dr salaries payable · Cr the account.</item>
/// <item>An advance: Dr employee advances · Cr the account it's paid from.</item>
/// </list>
/// A day's pay is the monthly salary ÷ <c>PayrollDayBasis</c> (30); a minute's is a day's ÷ the
/// shift's minutes.
/// </summary>
public sealed partial class PayrollService
{
    /// <summary>Used for employees without a shift: 09:00–17:00, 15 minutes' grace, Friday off.</summary>
    public static readonly Shift DefaultShift = new() { Name = "", StartMinute = 540, EndMinute = 1020, GraceMinutes = 15, DaysOff = new() { 5 } };

    private readonly AppDbContext _db;
    private readonly LedgerService _ledger;
    private readonly MoneyService _money;

    public PayrollService(AppDbContext db, LedgerService ledger, MoneyService money)
    {
        _db = db;
        _ledger = ledger;
        _money = money;
    }

    public sealed record PayrollError(string Code, string Message);

    // ------------------------------------------------------------------ attendance

    public static int ShiftMinutes(Shift s)
    {
        var m = s.EndMinute - s.StartMinute;
        return m <= 0 ? m + 1440 : m;
    }

    /// <summary>Late (arriving after the grace, plus leaving early) and overtime minutes of a day.</summary>
    public static (int Late, int Overtime) Measure(Shift shift, DateTime date, AttendanceStatus status, int? checkIn, int? checkOut)
    {
        if (status != AttendanceStatus.PRESENT || checkIn is not int inAt) return (0, 0);
        int? outAt = checkOut is int o ? (o < inAt ? o + 1440 : o) : null;
        if (shift.DaysOff.Contains((int)date.DayOfWeek))
            return (0, outAt is int x ? x - inAt : 0); // a day off worked is all overtime
        var start = shift.StartMinute;
        var end = start + ShiftMinutes(shift);
        var late = inAt > start + shift.GraceMinutes ? inAt - start : 0;
        var early = outAt is int e1 && e1 < end ? end - e1 : 0;
        var overtime = outAt is int e2 && e2 > end ? e2 - end : 0;
        return (late + early, overtime);
    }

    /// <summary>"HH:mm" → minutes after midnight; null for empty; false when it isn't a time.</summary>
    public static bool TryTime(string? s, out int? minutes)
    {
        minutes = null;
        if (string.IsNullOrWhiteSpace(s)) return true;
        if (!TimeOnly.TryParseExact(s.Trim(), new[] { "H:mm", "HH:mm", "H:mm:ss", "HH:mm:ss" }, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var t)) return false;
        minutes = t.Hour * 60 + t.Minute;
        return true;
    }

    public static string? Clock(int? minutes) => minutes is int m ? $"{m / 60 % 24:00}:{m % 60:00}" : null;

    [GeneratedRegex(@"(?<d>\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})[ T]+(?<t>\d{1,2}:\d{2}(:\d{2})?)")]
    private static partial Regex Punch();

    /// <summary>
    /// A fingerprint device's attendance export: one punch per line, the employee's device user
    /// number first, then a date and time (2026-09-30 08:57[:12], or 30/09/2026 08:57). Commas,
    /// semicolons or tabs between. Header lines and anything else are skipped and counted.
    /// </summary>
    public static (List<(string UserId, DateTime Day, int Minute)> Punches, int Skipped) ParsePunches(string text)
    {
        var punches = new List<(string, DateTime, int)>();
        var skipped = 0;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            var m = Punch().Match(line);
            var id = line.Split(new[] { ',', ';', '\t', ' ' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim('"');
            if (!m.Success || string.IsNullOrEmpty(id) || id.Length > 40 || !id.All(char.IsLetterOrDigit))
            {
                skipped++;
                continue;
            }
            var d = m.Groups["d"].Value.Replace('/', '-').Replace('.', '-');
            var formats = new[] { "yyyy-M-d", "d-M-yyyy" };
            if (!DateTime.TryParseExact(d, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
                || !TryTime(m.Groups["t"].Value, out var minute) || minute is null)
            {
                skipped++;
                continue;
            }
            punches.Add((id, DateTime.SpecifyKind(day.Date, DateTimeKind.Utc), minute.Value));
        }
        return (punches, skipped);
    }

    // ------------------------------------------------------------------ runs

    public static (DateTime Start, DateTime End) MonthRange(int year, int month)
    {
        var start = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        return (start, start.AddMonths(1));
    }

    /// <summary>Work out every line of a draft run afresh from attendance, adjustments and advances.</summary>
    public async Task<List<PayrollLine>> ComputeAsync(PayrollRun run)
    {
        var (start, end) = MonthRange(run.Year, run.Month);
        var daysInMonth = (end - start).Days;
        var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync() ?? new CompanySettings();
        var basis = Math.Max(1, settings.PayrollDayBasis);
        var today = CompanyClock.TodayDate;

        var employees = await _db.Employees.AsNoTracking().Include(e => e.Shift)
            .Where(e => e.IsActive && e.HireDate < end && (run.BranchId == null || e.BranchId == run.BranchId))
            .OrderBy(e => e.Code).ToListAsync();
        var ids = employees.Select(e => e.Id).ToList();
        var days = await _db.AttendanceDays.AsNoTracking()
            .Where(a => ids.Contains(a.EmployeeId) && a.Date >= start && a.Date < end)
            .ToDictionaryAsync(a => (a.EmployeeId, a.Date));
        var adjustments = await _db.PayrollAdjustments.AsNoTracking()
            .Where(a => ids.Contains(a.EmployeeId) && a.Year == run.Year && a.Month == run.Month && a.RunId == null)
            .ToListAsync();
        var advances = await _db.EmployeeAdvances.AsNoTracking()
            .Where(a => ids.Contains(a.EmployeeId) && a.Status == AdvanceStatus.OPEN).ToListAsync();

        _db.PayrollLines.RemoveRange(await _db.PayrollLines.Where(l => l.RunId == run.Id).ToListAsync());
        run.Lines.Clear();
        var lines = new List<PayrollLine>();
        foreach (var e in employees)
        {
            var shift = e.Shift ?? DefaultShift;
            var from = e.HireDate.Date > start ? DateTime.SpecifyKind(e.HireDate.Date, DateTimeKind.Utc) : start;
            var employed = Math.Max(0, (end - from).Days);
            var basic = (long)Math.Round((decimal)e.MonthlySalary * employed / daysInMonth, MidpointRounding.AwayFromZero);
            var daily = (decimal)e.MonthlySalary / basis;
            var perMinute = daily / ShiftMinutes(shift);

            int work = 0, absent = 0, late = 0, overtime = 0;
            for (var d = from; d < end; d = d.AddDays(1))
            {
                var dayOff = shift.DaysOff.Contains((int)d.DayOfWeek);
                days.TryGetValue((e.Id, d), out var rec);
                if (!dayOff) work++;
                if (rec is null)
                {
                    if (!dayOff && settings.MissingAttendanceIsAbsent && d < today) absent++;
                    continue;
                }
                switch (rec.Status)
                {
                    case AttendanceStatus.ABSENT or AttendanceStatus.UNPAID_LEAVE when !dayOff:
                        absent++;
                        break;
                    case AttendanceStatus.PRESENT:
                        late += rec.LateMinutes;
                        overtime += rec.OvertimeMinutes;
                        break;
                }
            }
            long Money(decimal v) => (long)Math.Round(v, MidpointRounding.AwayFromZero);
            var absence = Money(daily * absent);
            var lateness = Money(perMinute * late);
            var overtimePay = Money(perMinute * overtime * settings.OvertimePercent / 100m);
            var mine = adjustments.Where(a => a.EmployeeId == e.Id).ToList();
            var bonuses = mine.Where(a => a.Kind == AdjustmentKind.BONUS).Sum(a => a.Amount);
            var deductions = mine.Where(a => a.Kind == AdjustmentKind.DEDUCTION).Sum(a => a.Amount);
            var earned = Math.Max(0, basic + overtimePay + bonuses - absence - lateness - deductions);
            var due = advances.Where(a => a.EmployeeId == e.Id).Sum(a => Math.Min(a.Installment, a.Remaining));
            var recovery = Math.Min(earned, due);
            var line = new PayrollLine
            {
                RunId = run.Id, EmployeeId = e.Id, EmployeeName = e.Name, MonthlySalary = e.MonthlySalary,
                EmployedDays = employed, WorkDays = work, AbsentDays = absent, LateMinutes = late,
                OvertimeMinutes = overtime, Basic = basic, OvertimePay = overtimePay, Bonuses = bonuses,
                AbsenceDeduction = absence, LateDeduction = lateness, Deductions = deductions, Earned = earned,
                AdvanceRecovery = recovery, Net = earned - recovery,
            };
            _db.PayrollLines.Add(line); // the run's Lines pick it up (EF fixes up the navigation)
            if (!run.Lines.Contains(line)) run.Lines.Add(line);
            lines.Add(line);
        }
        run.Earned = lines.Sum(l => l.Earned);
        run.Recovered = lines.Sum(l => l.AdvanceRecovery);
        run.Net = lines.Sum(l => l.Net);
        return lines;
    }

    /// <summary>
    /// Post a draft (locked by the caller, inside its transaction): recompute it with the employees'
    /// rows locked, recover the advances oldest first, close the month's adjustments, and post the
    /// journal entry dated the month's last day (or today, for the current month).
    /// </summary>
    public async Task<PayrollError?> PostAsync(PayrollRun run, Guid staffId)
    {
        var (start, end) = MonthRange(run.Year, run.Month);
        var date = end.AddDays(-1).AddHours(12);
        if (date > DateTime.UtcNow) date = DateTime.UtcNow;
        var lockDate = await _db.CompanySettings.Select(s => s.LockDate).FirstOrDefaultAsync();
        if (lockDate is DateTime locked && CompanyClock.DayOf(date) <= DateOnly.FromDateTime(locked))
            return new("period_locked", "That month is in a locked period.");
        if (start > CompanyClock.TodayDate)
            return new("future_month", "A month that hasn't started can't be posted.");

        var employeeIds = await _db.Employees
            .Where(e => e.IsActive && e.HireDate < end && (run.BranchId == null || e.BranchId == run.BranchId))
            .Select(e => e.Id).OrderBy(i => i).ToArrayAsync();
        if (employeeIds.Length > 0)
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM \"Employees\" WHERE \"Id\" = ANY({employeeIds}) ORDER BY \"Id\" FOR UPDATE");
        var computed = await ComputeAsync(run);
        if (computed.Count == 0) return new("no_employees", "No employees to pay for that month.");

        // Advances, oldest first.
        var ids = computed.Where(l => l.AdvanceRecovery > 0).Select(l => l.EmployeeId).ToList();
        var advances = await _db.EmployeeAdvances.Where(a => ids.Contains(a.EmployeeId) && a.Status == AdvanceStatus.OPEN)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Number).ToListAsync();
        var employees = await _db.Employees.Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
        foreach (var line in computed.Where(l => l.AdvanceRecovery > 0))
        {
            var left = line.AdvanceRecovery;
            foreach (var a in advances.Where(a => a.EmployeeId == line.EmployeeId))
            {
                if (left == 0) break;
                var take = Math.Min(left, Math.Min(a.Installment, a.Remaining));
                a.Remaining -= take;
                if (a.Remaining == 0) a.Status = AdvanceStatus.SETTLED;
                left -= take;
            }
            employees[line.EmployeeId].AdvanceBalance -= line.AdvanceRecovery;
        }
        var lineEmployees = computed.Select(l => l.EmployeeId).ToList();
        foreach (var adj in await _db.PayrollAdjustments.Where(a => lineEmployees.Contains(a.EmployeeId)
                     && a.Year == run.Year && a.Month == run.Month && a.RunId == null).ToListAsync())
            adj.RunId = run.Id;

        var draft = _ledger.Begin("PAYROLL", run.Id, run.Number, $"Payroll {run.Year}-{run.Month:00}", run.BranchId, staffId, date);
        draft.Debit(await _ledger.SystemAsync(LedgerKeys.Salaries), run.Earned)
            .Credit(await _ledger.SystemAsync(LedgerKeys.EmployeeAdvances), run.Recovered)
            .Credit(await _ledger.SystemAsync(LedgerKeys.SalariesPayable), run.Net);
        _ledger.Post(draft);
        run.Status = run.Net == 0 ? PayrollRunStatus.PAID : PayrollRunStatus.POSTED;
        run.PostedAt = DateTime.UtcNow;
        run.PostedById = staffId;
        return null;
    }

    /// <summary>Pay what's still owed on the chosen lines (all when none are named) from one account.</summary>
    public async Task<PayrollError?> PayAsync(PayrollRun run, MoneyAccount account, IReadOnlyCollection<Guid>? employeeIds,
        Guid staffId)
    {
        var lines = run.Lines.Where(l => l.PaidAmount < l.Net && (employeeIds is null || employeeIds.Contains(l.EmployeeId))).ToList();
        var total = lines.Sum(l => l.Net - l.PaidAmount);
        if (total == 0) return new("nothing_to_pay", "Everyone chosen is already paid.");
        var error = _money.Move(account, -total, MoneyMovementKind.SALARY_PAID, staffId, run.Number,
            notes: $"{lines.Count} × {run.Year}-{run.Month:00}");
        if (error is not null) return new(error.Code, error.Message);
        foreach (var l in lines)
        {
            l.PaidAmount = l.Net;
            l.PaidAt = DateTime.UtcNow;
            l.PaidAccountId = account.Id;
        }
        run.Paid += total;
        if (run.Lines.All(l => l.PaidAmount >= l.Net)) run.Status = PayrollRunStatus.PAID;
        var draft = _ledger.Begin("SALARY_PAYMENT", run.Id, run.Number, $"Salaries paid {run.Year}-{run.Month:00}",
            account.BranchId, staffId);
        draft.Debit(await _ledger.SystemAsync(LedgerKeys.SalariesPayable), total)
            .Credit(await _ledger.ForMoneyAsync(account), total);
        _ledger.Post(draft);
        return null;
    }

    /// <summary>Pay an advance (the employee's row locked by the caller) from a locked money account.</summary>
    public async Task<PayrollError?> GiveAdvanceAsync(EmployeeAdvance advance, Employee employee, MoneyAccount account, Guid staffId)
    {
        var error = _money.Move(account, -advance.Amount, MoneyMovementKind.ADVANCE_PAID, staffId, advance.Number,
            notes: employee.Name);
        if (error is not null) return new(error.Code, error.Message);
        employee.AdvanceBalance += advance.Amount;
        var draft = _ledger.Begin("ADVANCE", advance.Id, advance.Number, $"Advance {employee.Name}", employee.BranchId, staffId);
        draft.Debit(await _ledger.SystemAsync(LedgerKeys.EmployeeAdvances), advance.Amount)
            .Credit(await _ledger.ForMoneyAsync(account), advance.Amount);
        _ledger.Post(draft);
        return null;
    }

    /// <summary>An advance handed back untouched: the money returns to its account.</summary>
    public async Task CancelAdvanceAsync(EmployeeAdvance advance, Employee employee, MoneyAccount account, Guid staffId)
    {
        _money.Move(account, advance.Amount, MoneyMovementKind.ADVANCE_CANCELLED, staffId, advance.Number, notes: employee.Name);
        employee.AdvanceBalance -= advance.Amount;
        advance.Remaining = 0;
        advance.Status = AdvanceStatus.CANCELLED;
        advance.CancelledAt = DateTime.UtcNow;
        var draft = _ledger.Begin("ADVANCE_CANCEL", advance.Id, advance.Number, $"Advance returned {employee.Name}",
            employee.BranchId, staffId);
        draft.Debit(await _ledger.ForMoneyAsync(account), advance.Amount)
            .Credit(await _ledger.SystemAsync(LedgerKeys.EmployeeAdvances), advance.Amount);
        _ledger.Post(draft);
    }
}
