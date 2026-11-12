// The item card (owner, 2026-11-10): the opening balance always there — what came in and went out
// before the period, by the day each document is dated (one dated back counts on its day) — the
// opening of a day is the closing of the day before, opening + in − out = closing, the running
// balance worked out in date order, whose each movement is, what is available now and the last
// cost (costs:view). Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: sees sales, not purchases nor costs
const today = companyToday();
ok('no department rule', await owner.put('/settings', { requireDepartment: false }));

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const side = ok(
  'a second warehouse',
  await owner.post('/warehouses', { branchId: owner.user.branchId, name: `Card side ${tag}` }),
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `CardCust ${tag}`, types: ['CUSTOMER'] }),
);
const sup = ok(
  'a supplier',
  await owner.post('/parties', { name: `CardSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Carded ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);
const buy = (day, quantity, unitCost) =>
  owner.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity, unitCost }],
    documentDate: day,
  });

console.log('== a purchase three days ago, then one typed later but dated ten days ago');
const p3 = ok('10 bought three days ago', await buy(addDays(today, -3), 10, 1000));
ok('5 bought ten days ago, entered after it', await buy(addDays(today, -10), 5, 900));
const sale = ok(
  '4 sold today',
  await owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: 4, unitPrice: 2000 }],
  }),
);
ok(
  '2 sent to the second warehouse',
  await owner.post('/transfers', {
    fromWarehouseId: wh.id,
    toWarehouseId: side.id,
    lines: [{ productId: item.id, quantity: 2 }],
  }),
);

const card = async (who, from, to, w) =>
  ok(
    `card ${from}..${to}${w ? ' one warehouse' : ''}`,
    await who.get(
      `/inventory/items/${item.id}/card?from=${from}&to=${to}${w ? `&warehouseId=${w}` : ''}`,
    ),
  );
const c = await card(owner, addDays(today, -5), today);
eq('in before the period: the one dated back', c.inBefore, 5);
eq('nothing went out before', c.outBefore, 0);
eq('opening = in − out before', c.openingBalance, 5);
// The transfer goes out and in twice (through the goods-in-transit warehouse): no change in total.
eq('in and out in the period', [c.totalIn, c.totalOut], [14, 8]);
eq('closing = opening + in − out', c.closingBalance, c.openingBalance + c.totalIn - c.totalOut);
eq('the running balance in date order', c.movements.map((m) => m.balance).at(-1), c.closingBalance);
eq(
  '…starting from the opening',
  c.movements[0].balance,
  5 + c.movements[0].quantityIn - c.movements[0].quantityOut,
);
eq('available now', c.item.stockOnHand, 11);
eq('the last cost: the latest purchase', c.lastCost?.unitCost, 1000);
eq('…its invoice', c.lastCost?.documentId, p3.id);
const sold = c.movements.find((m) => m.type === 'SALE_OUT');
eq('a sale says whose', [sold?.partyCode, sold?.partyName], [cust.code, cust.name]);
const bought = c.movements.find((m) => m.type === 'PURCHASE_IN');
eq('a purchase says from which supplier', bought?.partyName, sup.name);
const out = c.movements.find((m) => m.type === 'TRANSFER_OUT' && m.warehouseId === wh.id);
check('a transfer says where to', out?.otherPlace === side.name, out);

const dayBefore = await card(owner, addDays(today, -4), addDays(today, -4));
const dayOf = await card(owner, addDays(today, -3), addDays(today, -3));
eq("a day's opening is the day before's closing", dayOf.openingBalance, dayBefore.closingBalance);
eq('…5 then, though typed after the 10', [dayBefore.closingBalance, dayOf.closingBalance], [5, 15]);
const empty = await card(owner, addDays(today, -6), addDays(today, -6));
eq(
  'a day with nothing still has its opening',
  [empty.openingBalance, empty.movements.length],
  [5, 0],
);

const one = await card(owner, addDays(today, -5), today, wh.id);
eq('one warehouse: closing there', one.closingBalance, 9);
eq('…its running balance ends there too', one.movements.at(-1).balance, 9);
const other = await card(owner, addDays(today, -5), today, side.id);
eq(
  'the other warehouse: opening 0, closing 2',
  [other.openingBalance, other.closingBalance],
  [0, 2],
);

const val = ok(
  'the valuation four days ago',
  await owner.get(`/inventory/valuation?asOf=${addDays(today, -4)}&productIds=${item.id}`),
);
eq(
  'counts the purchase dated back',
  val.items.filter((r) => r.productId === item.id).reduce((s, r) => s + r.quantity, 0),
  5,
);

console.log('== what a salesperson sees');
const k = await card(karim, addDays(today, -5), today);
eq('the customer of a sale', k.movements.find((m) => m.type === 'SALE_OUT')?.partyName, cust.name);
eq('not the supplier', k.movements.find((m) => m.type === 'PURCHASE_IN')?.partyName ?? null, null);
eq('no last cost without costs:view', k.lastCost ?? null, null);
eq(
  'no unit costs',
  k.movements.every((m) => m.unitCost === 0),
  true,
);
void sale;

process.exit(summary('itemcard') ? 1 : 0);
