// A department's season, read from its name (owner, 2026-11-16): «رجالي صيفي» is summer's, «رجالي
// شتوي» winter's, «داخلي» (no season word) both. The dashboard, profit and loss, the assortment and
// the stock lists take season=SUMMER|WINTER: that season's departments plus the seasonless ones
// (and documents of no department); none = everything. A person's own departments still apply. The
// name rule is the same on the server and in @skb/shared. Runs in a new branch of its own.
import { createRequire } from 'node:module';
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const shared = createRequire(import.meta.url)('../../packages/shared/dist/index.js');
const tag = Date.now().toString(36).slice(-5);
const PASS = 'Str0ngPass!';
const owner = await login('owner@skb.local');
const today = companyToday();
const period = `from=${today}&to=${today}`;

console.log('== setup');
const A = ok('a branch', await owner.post('/branches', { name: `Season ${tag}` }));
const store = A.warehouses[0];
const dept = async (name) => ok(name, await owner.post('/departments', { name: `${name} ${tag}` }));
const summer = await dept('رجالي صيفي');
const winter = await dept('رجالي شتوي');
const inner = await dept('داخلي');
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `SSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = async (name, departmentId) =>
  ok(
    name,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      departmentId,
      supplierId: supplier.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
    }),
  );
const tee = await item('STee', summer.id);
const coat = await item('SCoat', winter.id);
const vest = await item('SVest', inner.id);
ok(
  'stock in',
  await owner.at(A.id).post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: store.id,
    taxPercent: 0,
    lines: [
      { productId: tee.id, quantity: 10, unitCost: 400 },
      { productId: coat.id, quantity: 10, unitCost: 500 },
      { productId: vest.id, quantity: 10, unitCost: 200 },
    ],
  }),
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `SCust ${tag}`, types: ['CUSTOMER'] }),
);
const sell = (departmentId, productId, quantity) =>
  owner.at(A.id).post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: store.id,
    departmentId,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId, quantity, unitPrice: 1000, warehouseId: store.id }],
  });
ok('summer sale: 2 tees', await sell(summer.id, tee.id, 2));
ok('winter sale: 3 coats', await sell(winter.id, coat.id, 3));
ok('underwear sale: 4 vests', await sell(inner.id, vest.id, 4));
// A sale of no department, where the company allows one: it counts in both seasons.
const required = (await owner.get('/settings')).data?.requireDepartment;
if (required)
  ok(
    'sales may leave out the department',
    await owner.put('/settings', { requireDepartment: false }),
  );
const loose = await sell(undefined, vest.id, 1);
if (required) ok('the rule back', await owner.put('/settings', { requireDepartment: true }));
const none = loose.status < 300 ? 1000 : 0;
check('a sale of no department', none, loose);

const kpi = (d, key) => d.kpis.find((k) => k.key === key)?.value;
const at = `&branchId=${A.id}`;
const sales = async (who, q) =>
  kpi(ok('dashboard', await who.get(`/dashboard?${period}${at}${q}`)), 'kpi.revenue');
const more = async (who, q) => ok('more', await who.get(`/dashboard/more?${period}${at}${q}`));
const pl = async (who, q) =>
  ok('profit and loss', await who.get(`/analytics/profit-loss?${period}${at}${q}`)).total.netSales;

console.log('== the dashboard');
eq('all seasons', await sales(owner, ''), 9000 + none);
eq('summer: summer + seasonless', await sales(owner, '&season=SUMMER'), 2000 + 4000 + none);
eq('winter: winter + seasonless', await sales(owner, '&season=winter'), 3000 + 4000 + none);
eq('anything else is every season', await sales(owner, '&season=spring'), 9000 + none);
eq(
  'a summer department in summer',
  await sales(owner, `&season=SUMMER&departmentId=${summer.id}`),
  2000,
);
eq(
  'a winter department in summer: nothing',
  await sales(owner, `&season=SUMMER&departmentId=${winter.id}`),
  0,
);
const ms = await more(owner, '&season=SUMMER');
eq('summer: the period’s sales', ms.month.sales, 6000 + none);
check(
  'summer: no coats among the best sellers',
  !ms.topItems.some((x) => x.id === coat.id) && ms.topItems.some((x) => x.id === tee.id),
  ms.topItems,
);
eq(
  'summer: the stock is of summer and seasonless items',
  ms.stockValue,
  8 * 400 + (6 - none / 1000) * 200,
);
eq('no cash or expenses for a season', [ms.accounts, ms.month.expenses], [null, null]);

console.log('== profit and loss');
eq('all seasons', await pl(owner, ''), 9000 + none);
eq('summer', await pl(owner, '&season=SUMMER'), 6000 + none);
eq('winter', await pl(owner, '&season=WINTER'), 7000 + none);

console.log('== the assortment');
const assort = async (q) =>
  ok('assortment', await owner.get(`/analytics/assortment?by=department&${period}${q}`)).rows.map(
    (r) => r.id,
  );
const sRows = await assort('&season=SUMMER');
check(
  'summer: summer and underwear, no winter',
  sRows.includes(summer.id) && sRows.includes(inner.id) && !sRows.includes(winter.id),
  sRows,
);
const wRows = await assort('&season=WINTER');
check(
  'winter: winter and underwear, no summer',
  wRows.includes(winter.id) && wRows.includes(inner.id) && !wRows.includes(summer.id),
  wRows,
);
const aRows = await assort('');
check(
  'all: the three',
  [summer, winter, inner].every((d) => aRows.includes(d.id)),
  aRows,
);

console.log('== the stock lists');
const ids = async (q) =>
  ok('stock', await owner.get(`/inventory/items?pageSize=200${q}`)).items.map((x) => x.id);
const wItems = await ids(`&branchId=${A.id}&season=WINTER`);
check(
  'winter items: coats and vests',
  wItems.includes(coat.id) && wItems.includes(vest.id) && !wItems.includes(tee.id),
  wItems,
);
const val = async (q) =>
  ok('valuation', await owner.get(`/inventory/valuation?branchId=${A.id}${q}`)).items.map(
    (x) => x.productId,
  );
const sVal = await val('&season=SUMMER');
check(
  'summer valuation: tees and vests',
  sVal.includes(tee.id) && sVal.includes(vest.id) && !sVal.includes(coat.id),
  sVal,
);

console.log('== a person of summer and underwear only');
const email = `dseason.${tag}@skb.local`;
const p = ok(
  'add them',
  await owner.post('/staff', {
    fullName: `Season ${tag}`,
    email,
    password: PASS,
    role: 'NONE',
    branchId: A.id,
  }),
);
ok(
  'their permissions',
  await owner.put(`/staff/${p.id}/permissions`, {
    granted: ['dashboard:kpi_sales', 'dashboard:month', 'reports:pl', 'profit:view'],
  }),
);
ok(
  'their access',
  await owner.put(`/staff/${p.id}/access`, {
    allBranches: false,
    branchIds: [A.id],
    warehouseIds: [],
    moneyAccountIds: [],
    departmentIds: [summer.id, inner.id],
  }),
);
const them = await login(email, PASS);
eq('theirs, every season', await sales(them, ''), 6000 + none);
eq('theirs in summer', await sales(them, '&season=SUMMER'), 6000 + none);
eq('theirs in winter: underwear only', await sales(them, '&season=WINTER'), 4000 + none);
eq('profit and loss in winter: underwear only', await pl(them, '&season=WINTER'), 4000 + none);
eq(
  'a winter department is still not theirs',
  (await them.get(`/dashboard?departmentId=${winter.id}`)).status,
  404,
);

console.log('== the name rule, server and web alike');
const samples = [
  ['رجالي صيفي', 'SUMMER'],
  ['رجالى صيفى', 'SUMMER'],
  ['حريمي الصيفي', 'SUMMER'],
  ['أطفال صيف', 'SUMMER'],
  ['بناتي صيفية', 'SUMMER'],
  ['Men Summer', 'SUMMER'],
  ['رجالي-صيفي', 'SUMMER'],
  ['رجالي شتوي', 'WINTER'],
  ['رجالى شتوى', 'WINTER'],
  ['حريمي الشتوي', 'WINTER'],
  ['أطفال شتاء', 'WINTER'],
  ['ولادي شتا', 'WINTER'],
  ['WINTER kids', 'WINTER'],
  ['داخلي', null],
  ['صيفي وشتوي', null],
  ['صيفيات', null],
  ['Summerland', null],
];
for (const [i, [name, want]] of samples.entries()) {
  eq(`web: ${name}`, shared.seasonOfDepartment(name), want);
  const d = ok(name, await owner.post('/departments', { name: `${name} r${tag}` }));
  const it = await item(`SRule${i}`, d.id);
  const seen = async (s) =>
    (await ids(`&season=${s}&departmentId=${d.id}`)).includes(it.id) ? s : null;
  const inSummer = await seen('SUMMER');
  const inWinter = await seen('WINTER');
  const server = inSummer && inWinter ? null : (inSummer ?? inWinter ?? 'NEITHER');
  eq(`server: ${name}`, server, want);
}

summary('deptseasons');
