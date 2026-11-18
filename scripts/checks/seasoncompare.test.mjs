// Seasons and years in the analytics (owner, 2026-11-18): the year beside the season on "suppliers
// and departments", the same season across years, and what to buy again. Runs against BASE with its
// own suppliers, departments, seasons and items, so it can run again.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASS = 'Str0ngPass!';
const owner = await login('owner@skb.local');
const today = companyToday();
const [y, mo] = today.split('-').map(Number);
// The latest winter that has begun (named for the year it ends in), and whether it is still on.
const W = mo >= 10 ? y + 1 : y;
const winterOn = today <= `${W}-03-31`;

console.log('== setup');
const s1 = ok(
  'factory 1',
  await owner.post('/parties', { name: `SC1 ${tag}`, types: ['SUPPLIER'] }),
);
const s2 = ok(
  'factory 2',
  await owner.post('/parties', { name: `SC2 ${tag}`, types: ['SUPPLIER'] }),
);
const dept = ok('a department', await owner.post('/departments', { name: `SCDept ${tag}` }));
const dept2 = ok(
  'another department',
  await owner.post('/departments', { name: `SCOther ${tag}` }),
);
const seasons = (await owner.get('/seasons')).data;
const winterW = seasons.find((s) => s.kind === 'WINTER' && s.year === W);
const summerW = seasons.find((s) => s.kind === 'SUMMER' && s.year === W);
check(`the system's winter ${W} and summer ${W}`, winterW && summerW);
const w25 = ok(
  'a hand-made "Winter 2025"',
  await owner.post('/seasons', { name: `Winter 2025 ${tag}` }),
);
const w24 = ok(
  'a hand-made «شتوي 2024»',
  await owner.post('/seasons', { name: `شتوي 2024 ${tag}` }),
);
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const item = async (name, departmentId, supplierId, seasonId, extra = {}) =>
  ok(
    name,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      departmentId,
      supplierId,
      seasonId,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
      ...extra,
    }),
  );
const A = await item('SCA', dept.id, s1.id, winterW.id);
const B = await item('SCB', dept.id, s1.id, w25.id);
const C = await item('SCC', dept.id, s2.id, w24.id);
const E = await item('SCE', dept.id, s1.id, summerW.id);
const F = await item('SCF', dept.id, s1.id, undefined);
const G = await item('SCG', dept2.id, s1.id, winterW.id);
const H = await item('SCH', dept.id, s1.id, undefined, { reorderLevel: 5 });
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const buy = (supplier, lines) =>
  owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines,
  });
ok(
  'bought from factory 1',
  await buy(s1, [
    { productId: A.id, quantity: 10, unitCost: 400 },
    { productId: B.id, quantity: 4, unitCost: 300 },
    { productId: E.id, quantity: 2, unitCost: 300 },
    { productId: F.id, quantity: 5, unitCost: 200 },
    { productId: G.id, quantity: 3, unitCost: 300 },
    { productId: H.id, quantity: 2, unitCost: 100 },
  ]),
);
ok('bought from factory 2', await buy(s2, [{ productId: C.id, quantity: 3, unitCost: 300 }]));
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `SCCust ${tag}`, types: ['CUSTOMER'] }),
);
const sell = (departmentId, productId, quantity) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    departmentId,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId, quantity, unitPrice: 1000 }],
  });
const sa = ok('6 of A sold', await sell(dept.id, A.id, 6));
ok('4 of B', await sell(dept.id, B.id, 4));
ok('1 of C', await sell(dept.id, C.id, 1));
ok('2 of F (no season)', await sell(dept.id, F.id, 2));
ok('1 of G (the other department)', await sell(dept2.id, G.id, 1));
ok(
  'one A back',
  await owner.post(`/sales/invoices/${sa.id}/returns`, {
    lines: [{ lineId: sa.lines[0].id, quantity: 1 }],
  }),
);
const suppliers = `supplierIds=${s1.id},${s2.id}`;

console.log('== suppliers and departments: the season, and the year beside it');
const assort = async (q) =>
  ok(
    q,
    await owner.get(`/analytics/assortment?from=${today}&to=${today}&by=item&${suppliers}&${q}`),
  )
    .rows.map((r) => r.id)
    .sort();
const ids = (...xs) => xs.map((x) => x.id).sort();
eq('no year: every item', await assort(''), ids(A, B, C, E, F, G, H));
eq(
  'winter 2025: the hand-made one read by its name',
  await assort('season=WINTER&year=2025'),
  ids(B),
);
eq('2024, any season: the Arabic name read', await assort('year=2024'), ids(C));
eq(`winter ${W}`, await assort(`season=WINTER&year=${W}`), ids(A, G));
eq(`all of ${W}: summer and winter`, await assort(`year=${W}`), ids(A, E, G));
eq(`summer ${W}`, await assort(`season=SUMMER&year=${W}`), ids(E));
eq('summer 2025: none', await assort('season=SUMMER&year=2025'), []);
eq('an old link by season id still works', await assort(`seasonId=${w25.id}`), ids(B));

console.log('== the same season across years');
const cmp = (who, q) => who.get(`/analytics/season-compare?season=WINTER&${suppliers}&${q}`);
const all3 = ok('winter 2024, 2025 and now', await cmp(owner, `years=${W},2024,2025`));
eq('the years, oldest first', all3.years, [2024, 2025, W]);
check(
  '…every year the season has',
  [2024, 2025, W].every((x) => all3.available.includes(x)),
);
const [t24, t25, tW] = all3.total.years;
eq('2024: items, sold, net', [t24.items, t24.soldQty, t24.netSales], [1, 1, 1000]);
eq(
  '2025: items, sold, net, left at its end (none then)',
  [t25.items, t25.soldQty, t25.netSales, t25.stockQty],
  [1, 4, 4000, 0],
);
eq(
  `${W}: items, sold, back, sales, returns, net`,
  [tW.items, tW.soldQty, tW.returnedQty, tW.sales, tW.returns, tW.netSales],
  [2, 7, 1, 7000, 1000, 6000],
);
eq(`${W}: profit`, tW.profit, 5 * 600 + 700);
eq(`${W}: left at the season's end`, tW.stockQty, winterOn ? 5 + 2 : 0);
eq('items with no season left out, and said', all3.unplaced.netSales, 2000);
const byDept = all3.rows.map((r) => [r.id, r.years.map((c) => c.netSales)]);
eq(
  'by department',
  byDept.sort(),
  [
    [dept.id, [1000, 4000, 5000]],
    [dept2.id, [0, 0, 1000]],
  ].sort(),
);
const bySup = ok('by supplier', await cmp(owner, `years=2024,2025,${W}&by=supplier`));
eq(
  'factory 2 only in 2024',
  bySup.rows.find((r) => r.id === s2.id)?.years.map((c) => c.items),
  [1, 0, 0],
);
const inDept = ok(
  'a department’s items',
  await cmp(owner, `years=2024,2025,${W}&by=item&departmentId=${dept.id}`),
);
eq('its winter items', inDept.rows.map((r) => r.id).sort(), ids(A, B, C));
eq(
  '…the path',
  inDept.path.map((p) => p.id),
  [dept.id],
);
const dflt = ok('the last years by default', await cmp(owner, 'count=2'));
eq('…two, up to now', [dflt.years.length, dflt.years.at(-1)], [2, W]);

console.log('== what to buy again');
const sug = (who, q) => who.get(`/analytics/purchase-suggestions?${q}`);
const s1s = ok(
  'factory 1, 10 days, cover 20',
  await sug(owner, `days=10&target=20&supplierId=${s1.id}`),
);
eq(
  'one supplier',
  s1s.groups.map((g) => g.id),
  [s1.id],
);
const rows = s1s.groups[0].rows;
eq(
  'most urgent first: B (none left), A, F, then H (at its reorder level)',
  rows.map((r) => r.id),
  [B.id, A.id, F.id, H.id],
);
const rA = rows.find((r) => r.id === A.id);
eq(
  'A: stock, sold, a day, days left',
  [rA.stock, rA.soldQty, rA.dailyAverage, rA.daysLeft],
  [5, 5, 0.5, 10],
);
eq('A: 20 × 0.5 − 5', rA.suggested, 5);
eq('B: 20 × 0.4 − 0', rows.find((r) => r.id === B.id).suggested, 8);
eq('F: 20 × 0.2 − 3, rounded up', rows.find((r) => r.id === F.id).suggested, 1);
const rH = rows.find((r) => r.id === H.id);
eq(
  'H: nothing sold, at its reorder level',
  [rH.suggested, rH.daysLeft, rH.reorderLevel],
  [0, null, 5],
);
check('E (not selling, stock above its level) left out', !rows.some((r) => r.id === E.id));
eq('the supplier’s total', s1s.groups[0].suggested, 14);
check('…its value, at cost', rows.every((r) => r.value === r.suggested * r.cost) && rA.cost > 0);
const thirty = ok('30 days, cover 30', await sug(owner, `supplierId=${s1.id}`));
check('A has enough for 30 days', !thirty.groups[0].rows.some((r) => r.id === A.id));
const every = ok('every item', await sug(owner, `supplierId=${s1.id}&all=true`));
check(
  '…E too',
  every.groups[0].rows.some((r) => r.id === E.id),
);
const yr = ok(
  'winter 2025 only',
  await sug(owner, `days=10&target=20&supplierId=${s1.id}&season=WINTER&year=2025`),
);
eq(
  '…B',
  yr.groups.flatMap((g) => g.rows.map((r) => r.id)),
  [B.id],
);
const d2 = ok(
  'the other department',
  await sug(owner, `departmentId=${dept2.id}&all=true`),
);
eq(
  '…G only',
  d2.groups.flatMap((g) => g.rows.map((r) => r.id)),
  [G.id],
);

console.log('== who sees them');
const karim = await login('karim@skb.local');
eq('comparison: its own permission', (await cmp(karim, '')).status, 403);
eq('suggestions: their own permission', (await sug(karim, '')).status, 403);
const mona = await login('mona@skb.local');
eq('the accountant compares seasons', (await cmp(mona, `years=${W}`)).status, 200);
const sara = await login('sara@skb.local');
eq('the store keeper sees what to buy', (await sug(sara, 'days=10')).status, 200);
eq('…not the comparison', (await cmp(sara, '')).status, 403);
const email = `scother.${tag}@skb.local`;
const p = ok(
  'a person of the other department',
  await owner.post('/staff', {
    fullName: `SCOther ${tag}`,
    email,
    password: PASS,
    role: 'NONE',
    branchId: owner.user.branchId,
  }),
);
ok(
  '…with the two reports only',
  await owner.put(`/staff/${p.id}/permissions`, {
    granted: ['reports:season_compare', 'reports:purchase_suggestions'],
  }),
);
ok(
  '…of that department',
  await owner.put(`/staff/${p.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    departmentIds: [dept2.id],
  }),
);
const op = await login(email, PASS);
const theirs = ok('their comparison', await cmp(op, `years=2024,2025,${W}`));
eq(
  'only their department',
  theirs.rows.map((r) => r.id),
  [dept2.id],
);
eq(
  'no profit or costs',
  [theirs.total.years[2].profit, theirs.total.years[2].stockValue, theirs.hidden.sort()],
  [0, 0, ['costs', 'profit']],
);
eq('another department refused', (await cmp(op, `departmentId=${dept.id}`)).status, 404);
const theirSug = ok('their suggestions', await sug(op, `supplierId=${s1.id}&all=true`));
eq(
  'only their items',
  theirSug.groups.flatMap((g) => g.rows.map((r) => r.id)),
  [G.id],
);
eq(
  'no costs',
  [theirSug.groups[0].rows[0].cost, theirSug.value, theirSug.hidden],
  [0, 0, ['costs']],
);

process.exit(summary('seasoncompare') ? 1 : 0);
