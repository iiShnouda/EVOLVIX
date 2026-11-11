// The previous balance on a sales invoice (owner, 2026-11-10): what the customer owed just before
// it, from their account as it stands now — never the invoice itself, nothing that came after it;
// a changed invoice counts at its own date, a cancelled one for nothing. Only for whoever may see
// the customer's balance. Each line also carries the item's code. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
ok(
  'returns at once, no department rule',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.isDefault && a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId,
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Prev ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 10000 }],
  }),
);
ok(
  'stock',
  await owner.post('/purchases/invoices', {
    partyId: (await owner.post('/parties', { name: `PrevSup ${tag}`, types: ['SUPPLIER'] })).data
      .id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 100, unitCost: 5000 }],
  }),
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `PrevCust ${tag}`, types: ['CUSTOMER'] }),
);
const body = (qty, extra = {}) => ({
  partyId: cust.id,
  warehouseId: wh.id,
  taxPercent: 0,
  lines: [{ productId: item.id, quantity: qty, unitPrice: 10000 }],
  ...extra,
});
const sell = (qty, extra) => owner.post('/sales/invoices', body(qty, extra));
const prev = async (id, who = owner) =>
  (await who.get(`/sales/invoices/${id}`)).data.previousBalance;

console.log('== before each invoice');
const a = ok('invoice A (200)', await sell(2));
eq('nothing owed before the first', await prev(a.id), 0);
eq(
  'its lines carry the item code',
  (await owner.get(`/sales/invoices/${a.id}`)).data.lines[0].productCode,
  item.sku,
);
const b = ok(
  'invoice B (300), 100 paid at once',
  await sell(3, { paidAmount: 10000, paidAccountId: box.id }),
);
eq('A owed before B', await prev(b.id), 20000);
ok(
  '50 received',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 5000 }],
  }),
);
eq('money after B leaves its figure alone', await prev(b.id), 20000);
const c = ok('invoice C (100)', await sell(1));
eq('A + what is left of B − the receipt', await prev(c.id), 20000 + 20000 - 5000);

console.log('== a changed invoice');
ok('A becomes 400', await owner.put(`/sales/invoices/${a.id}`, body(4)));
eq('changing it never moves its own figure', await prev(a.id), 0);
eq('B sees A as it stands now, at its own date', await prev(b.id), 40000);
eq('…and so does C', await prev(c.id), 40000 + 20000 - 5000);

console.log('== a discount, a cancelled invoice, a return');
ok('10% off C', await owner.post(`/sales/invoices/${c.id}/discount`, { percent: 10 }));
eq('its own discount is not before it', await prev(c.id), 55000);
const d = ok('invoice D (100)', await sell(1));
eq('C after its discount counts for D', await prev(d.id), 55000 + 9000);
ok('D cancelled', await owner.post(`/sales/invoices/${d.id}/cancel`, { reason: 'test' }));
eq('a cancelled invoice has none', (await prev(d.id)) ?? null, null);
const e = ok('invoice E (100)', await sell(1));
eq('a cancelled invoice counts for nothing', await prev(e.id), 64000);
ok(
  'one piece of E comes back',
  await owner.post(`/sales/invoices/${e.id}/returns`, {
    lines: [{ lineId: e.lines[0].id, quantity: 1 }],
  }),
);
eq('a return on it is not before it', await prev(e.id), 64000);
const f = ok('invoice F (100)', await sell(1));
eq('the return counts for the next one', await prev(f.id), 64000);

console.log('== a back-dated invoice');
const g = ok(
  'invoice G (100) three days ago',
  await sell(1, { documentDate: addDays(companyToday(), -3) }),
);
eq('nothing was owed that day', await prev(g.id), 0);
eq('it now stands before A', await prev(a.id), 10000);

console.log("== the customer's invoices together, and who sees it");
const day = ok('the day', await owner.get(`/sales/customers/${cust.id}/invoices`));
eq(
  'each invoice of the day with its own figure',
  day.invoices.map((x) => [x.number, x.previousBalance]),
  [
    [a.number, 10000],
    [b.number, 50000],
    [c.number, 65000],
    [e.number, 74000],
    [f.number, 74000],
  ],
);
check(
  'lines carry codes there too',
  day.invoices.every((x) => x.lines.every((l) => l.productCode === item.sku)),
);
const email = `prev${tag}@skb.local`;
const PASS = 'ChangeMe!Staff123';
const person = ok(
  'someone who only lists invoices',
  await owner.post('/staff', {
    fullName: `Prev ${tag}`,
    email,
    password: PASS,
    role: 'NONE',
    branchId: owner.user.branchId,
  }),
);
ok(
  '…given sales:view',
  await owner.put(`/staff/${person.id}/permissions`, { granted: ['sales:view'], revoked: [] }),
);
const solo = await login(email, PASS);
const seen = ok('they open the invoice', await solo.get(`/sales/invoices/${f.id}`));
eq(
  'without the right to the balance there is no previous balance',
  seen.previousBalance ?? null,
  null,
);
ok(
  '…given the customers statement',
  await owner.put(`/staff/${person.id}/permissions`, {
    granted: ['sales:view', 'statement:customers'],
    revoked: [],
  }),
);
eq('with it, it shows', await prev(f.id, solo), 74000);
summary('previous');
