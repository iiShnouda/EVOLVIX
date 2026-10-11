// The dashboard's other widgets (owner, 2026-10-01): each part only for those who may see it.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES

const all = ok('owner sees everything', await owner.get('/dashboard/more'));
check(
  'today, month, rankings',
  all.today && all.month && Array.isArray(all.topCustomers) && Array.isArray(all.topItems),
  all,
);
check(
  'profit and stock value at cost',
  all.month.profit != null && all.stockValue != null,
  all.month,
);
check(
  'money, cheques, approvals',
  Array.isArray(all.accounts) && all.notesDue && all.awaitingApproval != null,
  all,
);
check('at most 8 branches', all.branches.length <= 8, all.branches.length);
eq('net sales today add up', all.today.sales >= -all.today.returns, true);

const sales = ok('sales staff', await karim.get('/dashboard/more'));
eq(
  'no profit or stock value for them',
  [sales.month?.profit ?? null, sales.stockValue],
  [null, null],
);
eq('no money accounts or cheques', [sales.accounts, sales.notesDue], [null, null]);
eq('no approvals count', sales.awaitingApproval, null);

console.log('== any period: a day, a month, a year, any dates (owner, 2026-10-02)');
const today = companyToday();
const day = ok('one day', await owner.get(`/dashboard?from=${today}&to=${today}`));
eq('one point for one day', day.trend.length, 1);
const dayMore = ok(
  'one day, the rest',
  await owner.get(`/dashboard/more?from=${today}&to=${today}`),
);
eq("the day's sales are the same either way", dayMore.month.sales, dayMore.today.sales);
const year = ok(
  'a year',
  await owner.get(`/dashboard?from=${today.slice(0, 4)}-01-01&to=${today.slice(0, 4)}-12-31`),
);
eq('a point for every month of the year', year.trend.length, 12);
eq('the year runs to December', year.trend.at(-1).date.slice(5, 7), '12');
eq('the year holds the day', year.kpis[0].value >= day.kpis[0].value, true);
const sum = year.trend.reduce((a, d) => a + d.sales, 0);
eq("the months add up to the year's revenue", sum, year.kpis[0].value);
eq(
  'end before start',
  (await owner.get(`/dashboard?from=${today}&to=${addDays(today, -1)}`)).data?.code,
  'bad_range',
);
eq(
  'more than ten years',
  (await owner.get('/dashboard/more?from=2000-01-01&to=2026-01-01')).data?.code,
  'bad_range',
);
const far = ok(
  'days with nothing',
  await owner.get('/dashboard/more?from=2001-01-01&to=2001-01-31'),
);
eq('nothing sold then', [far.month.sales, far.topItems.length], [0, 0]);

console.log('== branch, warehouse and department in the searches');
const branches = (await owner.get('/branches')).data;
const main = owner.user.branchId;
const all2 = ok('all items', await owner.get('/inventory/items'));
const inMain = ok('one branch', await owner.get(`/inventory/items?branchId=${main}`));
check(
  'a branch holds no more than everywhere',
  inMain.items.reduce((s, i) => s + Math.max(0, i.stockOnHand), 0) <=
    all2.items.reduce((s, i) => s + Math.max(0, i.stockOnHand), 0) || all2.items.length >= 500,
);
const dept = (await owner.get('/departments')).data.find((d) => d.isActive && d.itemCount > 0);
if (dept) {
  const ofDept = ok('one department', await owner.get(`/inventory/items?departmentId=${dept.id}`));
  check('only that department', ofDept.totalItems <= all2.totalItems && ofDept.totalItems > 0, [
    ofDept.totalItems,
    all2.totalItems,
  ]);
}
eq(
  "someone else's branch is refused",
  (
    await karim.get(
      `/inventory/items?branchId=${branches.find((b) => b.id !== karim.user.branchId)?.id}`,
    )
  ).status,
  404,
);
const vouchers = ok('vouchers of one branch', await owner.get(`/vouchers?branchId=${main}`));
const mainName = branches.find((b) => b.id === main).name;
check(
  'all from that branch',
  vouchers.items.every((v) => v.branchName === mainName),
  vouchers.items.slice(0, 2),
);

process.exit(summary('dashboard') ? 1 : 0);
