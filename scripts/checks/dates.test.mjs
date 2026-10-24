// Documents dated on an earlier day (owner, 2026-10-02): a supplier's invoice entered late, money
// moved yesterday and written today. Everything lands on that day; when it was really entered is
// kept; it needs documents:backdate; never the future, never a locked period. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays, dayIn } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT: may date back
const karim = await login('karim@skb.local'); // SALES: may not
const today = companyToday();
const yesterday = addDays(today, -1);
ok(
  'returns at once, no department rule',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.isDefault && a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId,
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `DateCust ${tag}`, types: ['CUSTOMER'] }),
);
const sup = ok(
  'a supplier',
  await owner.post('/parties', { name: `DateSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Dated ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);

console.log('== a supplier invoice entered three days late');
const buy = (who, day) =>
  who.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 1000 }],
    documentDate: day,
  });
eq('not in the future', (await buy(owner, addDays(today, 1))).data?.code, 'future_date');
eq('a bad day', (await buy(owner, '2026-13-40')).data?.code, 'bad_date');
// Past years stay open (owner, 2026-10-24): a document may go back more than a year.
ok('two years back', await buy(owner, addDays(today, -730)));
const p = ok('dated three days ago', await buy(owner, addDays(today, -3)));
eq('its day', dayIn(p.issueDate), addDays(today, -3));
check(
  'when it was really entered is kept',
  p.enteredAt && dayIn(p.enteredAt) === today,
  p.enteredAt,
);
const card = ok(
  'the item card that day',
  await owner.get(
    `/inventory/items/${item.id}/card?from=${addDays(today, -3)}&to=${addDays(today, -3)}`,
  ),
);
eq('the goods came in that day', card.totalIn, 10);
const plain = ok('one dated today', await buy(owner, today));
check('today is not marked', !plain.enteredAt);

console.log('== a sale and money written the next day');
const sale = (who, day) =>
  who.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: 2, unitPrice: 2000 }],
    documentDate: day,
  });
eq(
  'sales staff may not date back',
  (await sale(karim, yesterday)).data?.code,
  'backdate_not_allowed',
);
const s = ok('the accountant may', await sale(mona, yesterday));
eq('the sale is yesterday', dayIn(s.issueDate), yesterday);
const r = ok(
  'the money received yesterday',
  await mona.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 4000 }],
    allocations: [{ documentId: s.id, amount: 4000 }],
    documentDate: yesterday,
  }),
);
eq('the receipt is yesterday', dayIn(r.createdAt), yesterday);
check('…entered today', r.enteredAt && dayIn(r.enteredAt) === today, r.enteredAt);
const st = ok(
  "the box's statement yesterday",
  await owner.get(`/money-accounts/${box.id}/movements?from=${yesterday}&to=${yesterday}`),
);
check('the money moved yesterday', JSON.stringify(st).includes(r.number), st);
eq(
  "sales staff can't date money back",
  (
    await karim.post('/receipts', {
      partyId: cust.id,
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
      documentDate: yesterday,
    })
  ).status,
  403,
);

console.log('== never in a locked period');
const lock = (await owner.get('/ledger/lock')).data?.lockDate ?? null;
ok('lock up to two days ago', await owner.put('/ledger/lock', { lockDate: addDays(today, -2) }));
eq(
  'a sale in the locked days refused',
  (await sale(owner, addDays(today, -2))).data?.code,
  'period_locked',
);
ok('…the day after is fine', await sale(owner, yesterday));
ok('the lock as it was', await owner.put('/ledger/lock', { lockDate: lock }));

summary('dates');
