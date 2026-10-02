// How an invoice stands (owner, 2026-10-02): the customer's account is settled oldest first, so
// money, returns and discounts pay the old invoices before the new. A new invoice with nothing paid
// waits a day (DUE), then is unpaid (UNPAID); a cheque not collected yet makes it CREDIT (آجل); a
// small amount left can be taken off as a discount. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES
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
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `PayState ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 10000 }],
  }),
);
ok(
  'stock',
  await owner.post('/purchases/invoices', {
    partyId: (await owner.post('/parties', { name: `PSup ${tag}`, types: ['SUPPLIER'] })).data.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 100, unitCost: 5000 }],
  }),
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `PayCust ${tag}`, types: ['CUSTOMER'] }),
);
const sell = (qty, extra = {}) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: qty, unitPrice: 10000 }],
    ...extra,
  });
const state = async (id) => {
  const d = (await owner.get(`/sales/invoices/${id}`)).data;
  return [d.state, d.owed];
};
const receive = (amount, extra = {}) =>
  owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount }],
    ...extra,
  });

console.log("== the owner's example: 100 of 1,000 paid, 1,000 more, a 100 return, 1,000 paid");
const yesterday = addDays(companyToday(), -1);
const a = ok('invoice A (1,000) yesterday', await sell(1, { documentDate: yesterday }));
eq('a day old, nothing paid: unpaid', await state(a.id), ['UNPAID', 10000]);
const b0 = ok('a new invoice', await sell(1));
eq('new, nothing paid: waiting for payment', (await state(b0.id))[0], 'DUE');
ok('…called off', await owner.post(`/sales/invoices/${b0.id}/cancel`, { reason: 'test' }));
ok('100 paid', await receive(1000));
eq('A part paid', await state(a.id), ['PARTIAL', 9000]);
const b = ok('invoice B (1,000)', await sell(1));
eq('B waits for payment', await state(b.id), ['DUE', 10000]);
eq('A still part paid', (await state(a.id))[0], 'PARTIAL');
ok(
  'a 100 return',
  await owner.post('/sales/returns', {
    partyId: cust.id,
    warehouseId: wh.id,
    lines: [{ productId: item.id, unitId: piece.id, quantity: 1, unitPrice: 1000 }],
  }),
);
ok('1,000 paid', await receive(10000));
eq('the old invoice is paid', await state(a.id), ['PAID', 0]);
eq('the new one is part paid', await state(b.id), ['PARTIAL', 8000]);
const listed = (
  await owner.get(`/sales/invoices?search=${encodeURIComponent(cust.name)}&pageSize=50`)
).data.items;
eq(
  'the list says the same',
  listed.filter((d) => d.status !== 'CANCELLED').map((d) => [d.number, d.state, d.owed]),
  [
    [b.number, 'PARTIAL', 8000],
    [a.number, 'PAID', 0],
  ],
);
const partial = (
  await owner.get(`/sales/invoices?state=PARTIAL&search=${encodeURIComponent(cust.name)}`)
).data.items;
eq(
  'found by its state',
  partial.map((d) => d.id),
  [b.id],
);

console.log("== together, as on the day's combined invoice");
const day = ok("the customer's day", await owner.get(`/sales/customers/${cust.id}/invoices`));
eq('the day is part paid', day.state, 'PARTIAL');
check(
  'each invoice carries its state',
  day.invoices.every((i) => !!i.state),
  day.invoices.map((i) => i.state),
);

console.log('== a cheque not collected yet');
const cheque = ok(
  'a cheque for the rest',
  await owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    amount: 8000,
    serialNumber: `PS${tag}`,
    bankName: 'NBE',
    dueDate: addDays(companyToday(), 30),
    allocations: [{ documentId: b.id, amount: 8000 }],
  }),
);
if (cheque?.id) eq('B is settled by a cheque: deferred', await state(b.id), ['CREDIT', 0]);

console.log('== a small amount left taken off');
const c = ok('invoice C (1,000)', await sell(1));
ok('995 paid', await receive(9950));
eq('5 left on C', await state(c.id), ['PARTIAL', 50]);
eq(
  'sales staff may not discount',
  (await karim.post('/settle-discount', { partyId: cust.id, amount: 50 })).status,
  403,
);
eq(
  'not more than is left',
  (await owner.post('/settle-discount', { partyId: cust.id, amount: 51 })).data?.code,
  'over_balance',
);
const before = (await owner.get(`/parties/${cust.id}`)).data.balance;
const d = ok(
  'the 5 taken off',
  await owner.post('/settle-discount', { partyId: cust.id, amount: 50, notes: 'rounding' }),
);
check('a discount voucher', d.type === 'DISCOUNT' && /^DSC-/.test(d.number), d);
eq(
  'the account goes down by 5',
  (await owner.get(`/parties/${cust.id}`)).data.balance,
  before - 50,
);
eq('C is paid', await state(c.id), ['PAID', 0]);
eq(
  'nothing more to take off',
  (await owner.post('/settle-discount', { partyId: cust.id, amount: 1 })).data?.code,
  'nothing_owed',
);
ok('cancelled', await owner.post(`/vouchers/${d.id}/cancel`));
eq('5 back on the account', (await owner.get(`/parties/${cust.id}`)).data.balance, before);
eq('C part paid again', await state(c.id), ['PARTIAL', 50]);

console.log('== paid in full at the counter');
const cash = ok('a cash sale', await sell(1, { paidAmount: 10000, paidAccountId: box.id }));
eq('paid, whatever is still on the account', await state(cash.id), ['PAID', 0]);

console.log('== the statement: what each line is, where, and its document');
const span = `from=${addDays(companyToday(), -3)}&to=${companyToday()}`;
const st = ok('the statement', await owner.get(`/ledger/parties/${cust.id}/statement?${span}`));
const inv = st.lines.find((l) => l.documentId === a.id);
check(
  'an invoice line says what it is and where its goods went',
  inv?.documentKind === 'SALES_INVOICE' && inv?.warehouseName === wh.name,
  inv,
);
check(
  'a receipt line is a receipt',
  st.lines.some((l) => l.documentKind === 'RECEIPT'),
);
const onlyStore = ok(
  'one warehouse',
  await owner.get(`/ledger/parties/${cust.id}/statement?${span}&warehouseId=${wh.id}`),
);
check(
  'only documents with goods there',
  onlyStore.lines.length > 0 && onlyStore.lines.every((l) => l.warehouseName === wh.name),
  onlyStore.lines.map((l) => l.documentKind),
);
eq(
  'a bad department',
  (await owner.get(`/ledger/parties/${cust.id}/statement?${span}&departmentId=x`)).data?.code,
  'department_not_found',
);

console.log('== the account status filter');
const found = async (status) =>
  (
    (await owner.get(`/parties?status=${status}&search=${encodeURIComponent(cust.name)}`)).data
      .items ?? []
  ).map((x) => x.id);
const bal = (await owner.get(`/parties/${cust.id}`)).data.balance;
eq('owes us, as its balance says', (await found('OWES')).includes(cust.id), bal > 0);
eq('settled, as its balance says', (await found('SETTLED')).includes(cust.id), bal === 0);
eq('not closed', (await found('CLOSED')).includes(cust.id), false);

summary('paystates');
