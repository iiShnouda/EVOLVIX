// Owner requests 2026-11-10 on the sales list and the invoice screen: a document searched by its
// number is found whatever the period; changing an invoice counts the goods it already took as
// there; on a sale, what the goods cost goes with the profit. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
ok(
  'rules for the checks',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const cat = ok('a category', await owner.post('/categories', { name: `ScrCat ${tag}` }));
const make = async (name) =>
  ok(
    `item ${name}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
    }),
  );
const a = await make('ScrA');
const b = await make('ScrB');
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `ScrSup ${tag}`, types: ['SUPPLIER'] }),
);
ok(
  'bought 5 of A and 5 of B',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: a.id, quantity: 5, unitCost: 500 },
      { productId: b.id, quantity: 5, unitCost: 500 },
    ],
  }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `ScrCust ${tag}`, types: ['CUSTOMER'] }),
);
const line = (p, quantity) => ({ productId: p.id, quantity, unitPrice: 1000 });
const sale = (lines, extra = {}) => ({ partyId: customer.id, warehouseId: wh.id, lines, ...extra });

console.log('== a number is found whatever the period');
const today = companyToday();
const old = ok(
  'an invoice dated ten days ago',
  await owner.post('/sales/invoices', sale([line(b, 1)], { documentDate: addDays(today, -10) })),
);
const listed = async (scope, q) =>
  ((await owner.get(`/${scope}/invoices?pageSize=200&${q}`)).data?.items ?? []).map((d) => d.id);
check(
  'not in today’s list',
  !(await listed('sales', `from=${today}&to=${today}`)).includes(old.id),
);
check(
  'found by its number with today chosen',
  (await listed('sales', `from=${today}&to=${today}&number=${old.number}`)).includes(old.id),
);
check(
  '…by part of it too',
  (await listed('sales', `from=${today}&to=${today}&number=${old.number.slice(-4)}`)).includes(
    old.id,
  ),
);
check(
  'the customer’s name alone keeps the period',
  !(
    await listed('sales', `from=${today}&to=${today}&party=${encodeURIComponent(`ScrCust ${tag}`)}`)
  ).includes(old.id),
);
const oldBuy = ok(
  'a purchase dated ten days ago',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    documentDate: addDays(today, -10),
    lines: [{ productId: b.id, quantity: 1, unitCost: 500 }],
  }),
);
check(
  'purchases: not in today’s list',
  !(await listed('purchases', `from=${today}&to=${today}`)).includes(oldBuy.id),
);
check(
  'purchases: found by its number',
  (await listed('purchases', `from=${today}&to=${today}&number=${oldBuy.number}`)).includes(
    oldBuy.id,
  ),
);
// Still only what the person may see.
const PASS = 'Str0ngPass!';
const branch = ok('another branch', await owner.post('/branches', { name: `ScrBr ${tag}` }));
ok(
  'a seller of that branch only',
  await owner.post('/staff', {
    fullName: `Scr Rep ${tag}`,
    email: `scr.${tag}@skb.local`,
    password: PASS,
    role: 'SALES',
    branchId: branch.id,
  }),
);
const rep = await login(`scr.${tag}@skb.local`, PASS);
const theirs = await rep.get(`/sales/invoices?number=${old.number}`);
eq(
  'another branch’s invoice is not found by number',
  [theirs.status, (theirs.data?.items ?? []).length],
  [200, 0],
);

console.log('== changing an invoice counts what it already took');
const inv = ok('sold all 5 of A', await owner.post('/sales/invoices', sale([line(a, 5)])));
eq('none left', (await owner.get(`/products/${a.id}`)).data.stockOnHand, 0);
const more = await owner.put(`/sales/invoices/${inv.id}`, sale([line(a, 5), line(b, 2)]));
ok('another item added, A unchanged', more);
eq(
  '…5 of A and 2 of B',
  more.data?.lines?.map((l) => l.quantity),
  [5, 2],
);
eq('still none of A left', (await owner.get(`/products/${a.id}`)).data.stockOnHand, 0);
eq(
  'more of A than it took is refused',
  (await owner.put(`/sales/invoices/${inv.id}`, sale([line(a, 6), line(b, 2)]))).data?.code,
  'insufficient_stock',
);
ok(
  'less of A is fine',
  await owner.put(`/sales/invoices/${inv.id}`, sale([line(a, 3), line(b, 2)])),
);
eq('2 of A back', (await owner.get(`/products/${a.id}`)).data.stockOnHand, 2);

console.log('== on a sale, cost goes with the profit');
const person = async (name, permissions) => {
  const s = ok(
    `${name}`,
    await owner.post('/staff', {
      fullName: `Scr ${name} ${tag}`,
      email: `scr.${name}.${tag}@skb.local`,
      password: PASS,
      role: 'SALES',
      branchId: owner.user.branchId,
    }),
  );
  ok(
    `…with ${permissions.join(', ')}`,
    await owner.put(`/staff/${s.id}/permissions`, { granted: permissions, revoked: [] }),
  );
  return login(`scr.${name}.${tag}@skb.local`, PASS);
};
const ask = { partyId: customer.id, warehouseId: wh.id, lines: [{ productId: b.id, quantity: 1 }] };
const costOnly = await person('costs', ['costs:view']);
const both = await person('both', ['costs:view', 'profit:view']);
eq(
  'supply prices alone: no cost on the sale’s prices',
  (await costOnly.post('/pricing/sale', ask)).data?.lines?.[0]?.unitCost ?? null,
  null,
);
eq(
  'with the profit permission: the cost',
  (await both.post('/pricing/sale', ask)).data?.lines?.[0]?.unitCost,
  500,
);
eq('the owner sees it', (await owner.post('/pricing/sale', ask)).data?.lines?.[0]?.unitCost, 500);

process.exit(summary('salesscreen') ? 1 : 0);
