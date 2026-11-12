// Items by supplier and by department (owner, 2026-11-11: "what each supplier supplies and to which
// department; only the knitwear factories' goods, or only men's, and the departments' analysis").
// Runs against BASE with its own suppliers, departments and items, so it can run again.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASS = 'Str0ngPass!';
const owner = await login('owner@skb.local');
const today = companyToday();
const period = `from=${today}&to=${today}`;

console.log('== setup');
const knit1 = ok(
  'knitwear factory 1',
  await owner.post('/parties', { name: `Knit1 ${tag}`, types: ['SUPPLIER'] }),
);
const knit2 = ok(
  'knitwear factory 2',
  await owner.post('/parties', { name: `Knit2 ${tag}`, types: ['SUPPLIER'] }),
);
const other = ok(
  'another factory',
  await owner.post('/parties', { name: `Other ${tag}`, types: ['SUPPLIER'] }),
);
const men = ok('men’s', await owner.post('/departments', { name: `AMen ${tag}` }));
const women = ok('women’s', await owner.post('/departments', { name: `AWomen ${tag}` }));
const shirts = ok(
  'shirts under men’s',
  await owner.post('/groups', { name: `Shirts ${tag}`, departmentId: men.id }),
);
const polos = ok(
  'polos under shirts',
  await owner.post('/groups', { name: `Polos ${tag}`, departmentId: men.id, parentId: shirts.id }),
);
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const item = async (name, departmentId, groupId, supplierId) =>
  ok(
    name,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      departmentId,
      groupId,
      supplierId,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
    }),
  );
const shirt = await item('AShirt', men.id, shirts.id, knit1.id);
const polo = await item('APolo', men.id, polos.id, knit2.id);
const belt = await item('ABelt', men.id, undefined, knit1.id);
const dress = await item('ADress', women.id, undefined, other.id);
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
  'shirts and belts from knit 1',
  await buy(knit1, [
    { productId: shirt.id, quantity: 10, unitCost: 400 },
    { productId: belt.id, quantity: 5, unitCost: 200 },
  ]),
);
ok('polos from knit 2', await buy(knit2, [{ productId: polo.id, quantity: 8, unitCost: 500 }]));
ok(
  'dresses from the other',
  await buy(other, [{ productId: dress.id, quantity: 6, unitCost: 700 }]),
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `ACust ${tag}`, types: ['CUSTOMER'] }),
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
const s1 = ok('3 shirts sold', await sell(men.id, shirt.id, 3));
ok('2 polos sold', await sell(men.id, polo.id, 2));
ok('1 dress sold', await sell(women.id, dress.id, 1));
ok(
  'a shirt back',
  await owner.post(`/sales/invoices/${s1.id}/returns`, {
    lines: [{ lineId: s1.lines[0].id, quantity: 1 }],
  }),
);

const get = (who, q) => who.get(`/analytics/assortment?${period}&${q}`);
const row = (d, id) => d.rows.find((r) => r.id === id);

console.log('== by supplier: only the knitwear factories');
const knit = ok(
  'two suppliers',
  await get(owner, `by=supplier&supplierIds=${knit1.id},${knit2.id}`),
);
eq('just them', knit.rows.map((r) => r.id).sort(), [knit1.id, knit2.id].sort());
const k1 = row(knit, knit1.id);
eq(
  'knit 1: items, sold, back, net',
  [k1.items, k1.soldQty, k1.returnedQty, k1.netSales],
  [2, 3, 1, 2000],
);
eq('…what it supplies, by department', k1.detail, men.name);
eq(
  '…bought, and in stock (the shirt back included)',
  [k1.purchasedQty, k1.purchases, k1.stockQty, k1.stockValue],
  [15, 5000, 8 + 5, 8 * 400 + 5 * 200],
);
eq('…profit', k1.profit, 2000 - 800);
eq('the total of the two', [knit.total.netSales, knit.total.items], [2000 + 2000, 3]);
const items = ok('drilled to knit 1’s items', await get(owner, `by=item&supplierIds=${knit1.id}`));
eq('its items', items.rows.map((r) => r.id).sort(), [shirt.id, belt.id].sort());
eq('an item says where it sits', row(items, shirt.id).detail, `${men.name} › ${shirts.name}`);

console.log('== by department, a level at a time');
const top = ok(
  'departments',
  await get(owner, `by=department&supplierIds=${knit1.id},${knit2.id},${other.id}`),
);
eq('men’s and women’s', [row(top, men.id)?.netSales, row(top, women.id)?.netSales], [4000, 1000]);
eq('men’s opens', row(top, men.id).hasChildren, true);
const inMen = ok('men’s groups', await get(owner, `by=department&departmentId=${men.id}`));
eq(
  'shirts (with polos) and what sits straight in men’s',
  [row(inMen, shirts.id)?.netSales, inMen.rows.find((r) => r.kind === 'DIRECT')?.items],
  [4000, 1],
);
eq('shirts open', row(inMen, shirts.id).hasChildren, true);
eq(
  'the path',
  inMen.path.map((p) => p.id),
  [men.id],
);
const inShirts = ok('shirts’ groups', await get(owner, `by=department&groupId=${shirts.id}`));
eq(
  'polos, and shirts straight in',
  [row(inShirts, polos.id)?.netSales, inShirts.rows.find((r) => r.kind === 'DIRECT')?.netSales],
  [2000, 2000],
);
eq(
  'the path down',
  inShirts.path.map((p) => p.id),
  [men.id, shirts.id],
);
eq(
  'only men’s by supplier',
  ok('men’s suppliers', await get(owner, `by=supplier&departmentId=${men.id}`))
    .rows.map((r) => r.id)
    .sort(),
  [knit1.id, knit2.id].sort(),
);
eq(
  'a group of another department refused',
  (await get(owner, `by=department&departmentId=${women.id}&groupId=${shirts.id}`)).status,
  404,
);

console.log('== who sees it');
const karim = await login('karim@skb.local');
eq('its own permission', (await get(karim, 'by=supplier')).status, 403);
const email = `amen.${tag}@skb.local`;
const p = ok(
  'a men’s person',
  await owner.post('/staff', {
    fullName: `AMen ${tag}`,
    email,
    password: PASS,
    role: 'NONE',
    branchId: owner.user.branchId,
  }),
);
ok(
  '…with the report only',
  await owner.put(`/staff/${p.id}/permissions`, { granted: ['reports:assortment'] }),
);
ok(
  '…of men’s',
  await owner.put(`/staff/${p.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    departmentIds: [men.id],
  }),
);
const mp = await login(email, PASS);
const theirs = ok(
  'their departments',
  await get(mp, `by=department&supplierIds=${knit1.id},${knit2.id},${other.id}`),
);
eq(
  'no women’s',
  theirs.rows.map((r) => r.id),
  [men.id],
);
eq('women’s refused', (await get(mp, `by=department&departmentId=${women.id}`)).status, 404);
const k1p = row(
  ok('knit 1 for them', await get(mp, `by=supplier&supplierIds=${knit1.id}`)),
  knit1.id,
);
eq(
  'no profit, cost or purchase prices',
  [k1p.profit, k1p.stockValue, k1p.purchases, k1p.netSales],
  [0, 0, 0, 2000],
);
eq('…and it says so', theirs.hidden.sort(), ['costs', 'profit', 'purchases']);

process.exit(summary('assortment') ? 1 : 0);
