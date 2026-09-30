// Payroll & attendance (DOMAIN.md step 9): shifts, employees, attendance (typed and from a
// fingerprint export) with late and overtime minutes, bonuses and deductions, advances, and the
// month's payroll: worked out to the piastre, posted to the ledger, recovered advances, paid from a
// cash box — with permissions, locks after posting and races. Runs in its own new branch, on the
// month before this one. Runs against BASE.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT: payroll but not employees:manage
const karim = await login('karim@skb.local'); // SALES: no payroll

// The month before this one (the company's months), and a few of its days.
const [thisYear, thisMonth] = companyToday().split('-').map(Number);
const Y = thisMonth === 1 ? thisYear - 1 : thisYear;
const M = thisMonth === 1 ? 12 : thisMonth - 1;
const daysIn = new Date(Date.UTC(Y, M, 0)).getUTCDate();
const iso = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dow = (d) => new Date(Date.UTC(Y, M - 1, d)).getUTCDay();
const workdays = [...Array(daysIn).keys()].map((i) => i + 1).filter((d) => dow(d) !== 5);
const [dAbsent, dLate, dOver, dDevice] = workdays;
const dFriday = [...Array(daysIn).keys()].map((i) => i + 1).find((d) => dow(d) === 5);

console.log('== permissions');
eq("sales staff can't see payroll", (await karim.get('/payroll/employees')).status, 403);
eq(
  "the accountant can't add employees",
  (await mona.post('/payroll/employees', { name: 'X' })).status,
  403,
);
ok(
  'rules back to the defaults',
  await owner.put('/payroll/settings', {
    dayBasis: 30,
    overtimePercent: 150,
    missingAttendanceIsAbsent: false,
  }),
);

console.log('== a branch, a cash box, a shift');
const branch = ok('branch', await owner.post('/branches', { name: `Payroll ${tag}` }));
const box = ok(
  'cash box with 20,000.00',
  await owner.post('/money-accounts', {
    branchId: branch.id,
    name: `PBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 2000000,
  }),
);
eq(
  'a shift starts and ends at different times',
  (await owner.post('/payroll/shifts', { name: 'x', start: '09:00', end: '09:00' })).data?.code,
  'bad_time',
);
eq(
  'at most six days off',
  (await owner.post('/payroll/shifts', { name: 'x', daysOff: [0, 1, 2, 3, 4, 5, 6] })).data?.code,
  'bad_days',
);
const shift = ok(
  'morning shift 09:00–17:00, 10 minutes grace, Friday off',
  await owner.post('/payroll/shifts', {
    name: `Morning ${tag}`,
    start: '09:00',
    end: '17:00',
    graceMinutes: 10,
    daysOff: [5],
  }),
);
eq('eight hours', shift.minutes, 480);

console.log('== employees');
const device = `d${tag}`;
eq(
  'a name is needed',
  (await owner.post('/payroll/employees', { branchId: branch.id })).data?.code,
  'bad_name',
);
const A = ok(
  'Ahmed: 6,000.00 a month, on the shift, on the device',
  await owner.post('/payroll/employees', {
    name: `Ahmed ${tag}`,
    branchId: branch.id,
    monthlySalary: 600000,
    shiftId: shift.id,
    deviceUserId: device,
    hireDate: `${Y - 1}-01-10`,
    jobTitle: 'Storekeeper',
  }),
);
check('coded', /^E-\d{4}$/.test(A.code), A.code);
eq(
  'one device number per employee',
  (
    await owner.post('/payroll/employees', {
      name: 'Dup',
      branchId: branch.id,
      deviceUserId: device,
    })
  ).data?.code,
  'device_id_taken',
);
const B = ok(
  'Basma: 3,000.00, started on the 16th',
  await owner.post('/payroll/employees', {
    name: `Basma ${tag}`,
    branchId: branch.id,
    monthlySalary: 300000,
    hireDate: iso(16),
  }),
);
const list = ok('list', await mona.get('/payroll/employees'));
check(
  'the accountant sees them',
  list.some((e) => e.id === A.id) && list.some((e) => e.id === B.id),
);

console.log('== attendance');
eq(
  "sales staff can't record attendance",
  (
    await karim.put('/payroll/attendance', {
      date: iso(dAbsent),
      rows: [{ employeeId: A.id, status: 'ABSENT' }],
    })
  ).status,
  403,
);
eq(
  'times look like 08:55',
  (
    await mona.put('/payroll/attendance', {
      date: iso(dLate),
      rows: [{ employeeId: A.id, status: 'PRESENT', checkIn: '9h' }],
    })
  ).data?.code,
  'bad_time',
);
const day = async (d, row) => {
  const sheet = ok(
    `day ${d}`,
    await mona.put('/payroll/attendance', { date: iso(d), rows: [{ employeeId: A.id, ...row }] }),
  );
  return sheet.rows.find((r) => r.employeeId === A.id);
};
eq('absent', (await day(dAbsent, { status: 'ABSENT' })).status, 'ABSENT');
const late = await day(dLate, { status: 'PRESENT', checkIn: '09:40', checkOut: '17:00' });
eq(
  '40 minutes late (past the 10 minutes grace)',
  [late.lateMinutes, late.overtimeMinutes],
  [40, 0],
);
const within = await day(dLate, { status: 'PRESENT', checkIn: '09:08', checkOut: '16:50' });
eq(
  'within the grace, but leaving 10 minutes early',
  [within.lateMinutes, within.overtimeMinutes],
  [10, 0],
);
await day(dLate, { status: 'PRESENT', checkIn: '09:40', checkOut: '17:00' });
const over = await day(dOver, { status: 'PRESENT', checkIn: '09:00', checkOut: '19:00' });
eq('two hours overtime', [over.lateMinutes, over.overtimeMinutes], [0, 120]);
const friday = await day(dFriday, { status: 'PRESENT', checkIn: '10:00', checkOut: '14:00' });
eq('a day off worked is all overtime', [friday.dayOff, friday.overtimeMinutes], [true, 240]);

const exportText = [
  'No.,Name,Time',
  `${device},Ahmed,${iso(dDevice)} 08:55:12`,
  `${device},Ahmed,${iso(dDevice)} 12:02:00`,
  `${device},Ahmed,${iso(dDevice)} 17:30:40`,
  `x${tag},Nobody,${iso(dDevice)} 09:00:00`,
  'garbage line',
].join('\n');
const imp = ok(
  'the fingerprint export',
  await mona.post('/payroll/attendance/import', { text: exportText }),
);
eq('punches read, one day saved', [imp.punches, imp.days], [4, 1]);
eq('skipped and unknown', [imp.skipped >= 2, imp.unknownIds], [true, [`x${tag}`]]);
const sheetW = ok(
  'that day',
  await mona.get(`/payroll/attendance?date=${iso(dDevice)}&branchId=${branch.id}`),
);
const w = sheetW.rows.find((r) => r.employeeId === A.id);
eq(
  'first punch in, last punch out',
  [w.status, w.checkIn, w.checkOut, w.source],
  ['PRESENT', '08:55', '17:30', 'DEVICE'],
);
eq('30 minutes overtime', w.overtimeMinutes, 30);
check(
  'only this branch asked for',
  sheetW.rows.every((r) => r.branchName === branch.name),
  sheetW.rows,
);

console.log('== bonuses, deductions, advances');
ok(
  'a 500.00 bonus',
  await mona.post('/payroll/adjustments', {
    employeeId: A.id,
    year: Y,
    month: M,
    kind: 'BONUS',
    amount: 50000,
    reason: 'Stocktake',
  }),
);
ok(
  'a 100.00 deduction',
  await mona.post('/payroll/adjustments', {
    employeeId: A.id,
    year: Y,
    month: M,
    kind: 'DEDUCTION',
    amount: 10000,
  }),
);
const tmp = ok(
  'another one',
  await mona.post('/payroll/adjustments', {
    employeeId: A.id,
    year: Y,
    month: M,
    kind: 'BONUS',
    amount: 1,
  }),
);
eq('taken back', (await mona.post(`/payroll/adjustments/${tmp.id}/cancel`)).status, 204);
eq(
  'an installment is at most the advance',
  (
    await mona.post('/payroll/advances', {
      employeeId: A.id,
      amount: 100000,
      installment: 200000,
      accountId: box.id,
    })
  ).data?.code,
  'bad_installment',
);
eq(
  'never more than the box holds',
  (await mona.post('/payroll/advances', { employeeId: A.id, amount: 5000000, accountId: box.id }))
    .data?.code,
  'insufficient_funds',
);
const adv = ok(
  'an advance of 1,000.00, 400.00 a month',
  await mona.post('/payroll/advances', {
    employeeId: A.id,
    amount: 100000,
    installment: 40000,
    accountId: box.id,
  }),
);
check('numbered', adv.number.startsWith('ADV-'), adv.number);
const boxNow = async () =>
  (await owner.get('/money-accounts')).data.find((a) => a.id === box.id).balance;
eq('paid out of the box', await boxNow(), 2000000 - 100000);
const emp = async (id) => (await owner.get('/payroll/employees')).data.find((e) => e.id === id);
eq('Ahmed owes it', (await emp(A.id)).advanceBalance, 100000);
const adv2 = ok(
  'a second advance',
  await mona.post('/payroll/advances', { employeeId: A.id, amount: 20000, accountId: box.id }),
);
ok('handed back untouched', await mona.post(`/payroll/advances/${adv2.id}/cancel`));
eq('the money is back', await boxNow(), 2000000 - 100000);
eq(
  "can't leave while owing",
  (await owner.put(`/payroll/employees/${A.id}`, { isActive: false })).data?.code,
  'advance_open',
);

console.log("== the month's payroll");
eq(
  "sales staff can't make one",
  (await karim.post('/payroll/runs', { year: Y, month: M, branchId: branch.id })).status,
  403,
);
eq(
  "next month hasn't started",
  (
    await mona.post('/payroll/runs', {
      year: thisYear + 1,
      month: 1,
      branchId: branch.id,
    })
  ).data?.code,
  'future_month',
);
let run = ok('draft', await mona.post('/payroll/runs', { year: Y, month: M, branchId: branch.id }));
eq('a draft for both', [run.status, run.lines.length], ['DRAFT', 2]);
eq(
  'one payroll per month',
  (await mona.post('/payroll/runs', { year: Y, month: M, branchId: branch.id })).data?.code,
  'run_exists',
);
const a1 = run.lines.find((l) => l.employeeId === A.id);
const perMinute = 600000 / 30 / 480;
const expectA = {
  absentDays: 1,
  lateMinutes: 40,
  overtimeMinutes: 390,
  basic: 600000,
  absenceDeduction: 20000,
  lateDeduction: Math.round(perMinute * 40),
  overtimePay: Math.round(perMinute * 390 * 1.5),
  bonuses: 50000,
  deductions: 10000,
  advanceRecovery: 40000,
};
eq("Ahmed's payslip", Object.fromEntries(Object.keys(expectA).map((k) => [k, a1[k]])), expectA);
const earnedA = 600000 + expectA.overtimePay + 50000 - 20000 - expectA.lateDeduction - 10000;
eq('earned and net', [a1.earned, a1.net], [earnedA, earnedA - 40000]);
const b1 = run.lines.find((l) => l.employeeId === B.id);
const employed = daysIn - 15;
eq(
  "Basma's month from the 16th",
  [b1.employedDays, b1.basic],
  [employed, Math.round((300000 * employed) / daysIn)],
);
eq('no attendance counts as present', [b1.absentDays, b1.earned], [0, b1.basic]);
eq(
  'run totals',
  [run.earned, run.recovered, run.net],
  [a1.earned + b1.earned, 40000, a1.net + b1.net],
);

ok(
  'the absent day was paid leave after all',
  await mona.put('/payroll/attendance', {
    date: iso(dAbsent),
    rows: [{ employeeId: A.id, status: 'LEAVE' }],
  }),
);
run = ok('recalculated', await mona.post(`/payroll/runs/${run.id}/recalculate`));
const a2 = run.lines.find((l) => l.employeeId === A.id);
eq('no absence now', [a2.absentDays, a2.earned], [0, earnedA + 20000]);

const posted = ok('post it', await mona.post(`/payroll/runs/${run.id}/post`));
eq('posted', posted.status, 'POSTED');
eq('final', (await mona.post(`/payroll/runs/${run.id}/recalculate`)).data?.code, 'not_draft');
const entries = ok(
  'its journal entry',
  await owner.get(`/ledger/entries?source=PAYROLL&from=${iso(1)}&to=${iso(daysIn)}&pageSize=100`),
);
const entry = entries.items.find((e) => e.number === run.number);
check('dated the last day of the month', entry && entry.date.slice(0, 10) === iso(daysIn), entry);
const line = (code) => entry.lines.filter((l) => l.accountCode === code);
eq(
  'Dr salaries · Cr advances · Cr salaries payable',
  [line('5107')[0]?.debit, line('1109')[0]?.credit, line('2104')[0]?.credit],
  [posted.earned, 40000, posted.net],
);
eq('400.00 of the advance recovered', (await emp(A.id)).advanceBalance, 60000);
const advNow = ok('advances', await mona.get(`/payroll/advances?employeeId=${A.id}`));
eq('600.00 left on it', advNow.find((x) => x.id === adv.id)?.remaining, 60000);
eq(
  'a posted month is closed to attendance',
  (
    await mona.put('/payroll/attendance', {
      date: iso(dLate),
      rows: [{ employeeId: A.id, status: 'ABSENT' }],
    })
  ).data?.code,
  'month_posted',
);
eq(
  '… and to bonuses',
  (
    await mona.post('/payroll/adjustments', {
      employeeId: A.id,
      year: Y,
      month: M,
      kind: 'BONUS',
      amount: 100,
    })
  ).data?.code,
  'month_posted',
);
const adj = ok('adjustments', await mona.get(`/payroll/adjustments?year=${Y}&month=${M}`));
check(
  'marked as posted',
  adj.filter((x) => x.employeeId === A.id).every((x) => x.posted),
  adj,
);
eq(
  'an advance partly recovered stays',
  (await mona.post(`/payroll/advances/${adv.id}/cancel`)).data?.code,
  'advance_used',
);

console.log('== paying');
eq(
  "sales staff can't pay",
  (await karim.post(`/payroll/runs/${run.id}/pay`, { accountId: box.id })).status,
  403,
);
const before = await boxNow();
const p1 = ok(
  'pay Basma first',
  await mona.post(`/payroll/runs/${run.id}/pay`, { accountId: box.id, employeeIds: [B.id] }),
);
eq('still owing Ahmed', [p1.status, p1.paid], ['POSTED', b1.net]);
eq('out of the box', before - (await boxNow()), b1.net);
const p2 = ok(
  'pay the rest',
  await mona.post(`/payroll/runs/${run.id}/pay`, { accountId: box.id }),
);
eq('all paid', [p2.status, p2.paid], ['PAID', p2.net]);
eq('the box paid everything', before - (await boxNow()), p2.net);
eq(
  'not twice',
  (await mona.post(`/payroll/runs/${run.id}/pay`, { accountId: box.id })).data?.code,
  'already_paid',
);

console.log('== races');
const M2 = M === 1 ? 12 : M - 1;
const Y2 = M === 1 ? Y - 1 : Y;
const run2 = ok(
  'the month before',
  await mona.post('/payroll/runs', { year: Y2, month: M2, branchId: branch.id }),
);
const race = await Promise.all([
  mona.post(`/payroll/runs/${run2.id}/post`),
  owner.post(`/payroll/runs/${run2.id}/post`),
]);
eq('posted once', race.map((r) => r.status).sort(), [200, 400]);
eq('recovered once more', (await emp(A.id)).advanceBalance, 20000);
const list2 = ok('runs', await mona.get('/payroll/runs'));
check(
  'both listed',
  [run.id, run2.id].every((id) => list2.some((r) => r.id === id)),
  list2.slice(0, 3),
);
const audit = ok('audited', await owner.get('/audit?resource=payroll_run'));
check(
  'made, posted and paid',
  ['create', 'post', 'pay'].every((x) => audit.items.some((e) => e.action === x)),
);

summary('payroll');
