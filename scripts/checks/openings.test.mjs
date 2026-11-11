// Opening balances (owner, 2026-11-10: "the opening balance must be 100% right everywhere"). With
// back-dated documents, a changed invoice, a cancelled one, a return, a discount after the fact,
// receipts, payments, a cheque and transfers between boxes: for many periods of every statement
// (customer, supplier, cash boxes, a ledger account) the balance before a period is the closing of
// the day before it, opening + movements = closing, the closing today is the account's balance,
// and a back-dated or changed document stands on its own day. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
ok('rules', await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }));
const today = companyToday();
const day = (n) => addDays(today, n);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const mkBox = async (name, openingBalance) =>
  ok(
    name,
    await owner.post('/money-accounts', {
      branchId: owner.user.branchId,
      name: `${name} ${tag}`,
      kind: 'CASH_BOX',
      openingBalance,
    }),
  );
const box = await mkBox('OBox', 500000);
const box2 = await mkBox('OBox2', 0);
const cust = ok(
  'customer',
  await owner.post('/parties', { name: `OCust ${tag}`, types: ['CUSTOMER'] }),
);
const sup = ok(
  'supplier',
  await owner.post('/parties', { name: `OSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `OItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
const sell = (qty, extra = {}) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: qty, unitPrice: 1000 }],
    ...extra,
  });
const receipt = (amount, extra = {}) =>
  owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount }],
    ...extra,
  });

console.log('== a year of dealings, typed out of order');
ok(
  'bought 400 days ago',
  await owner.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 500, unitCost: 400 }],
    documentDate: day(-400),
  }),
);
ok('receipt today', await receipt(5000));
ok('receipt 10 days ago', await receipt(2000, { documentDate: day(-10) }));
ok('receipt 370 days ago', await receipt(1000, { documentDate: day(-370) }));
const changed = ok('invoice 20 days ago', await sell(10, { documentDate: day(-20) }));
ok(
  'changed today to 12',
  await owner.put(`/sales/invoices/${changed.id}`, {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 12, unitPrice: 1000 }],
  }),
);
const gone = ok(
  'invoice 45 days ago, cash 30.00',
  await sell(8, { documentDate: day(-45), paidAmount: 3000, paidAccountId: box.id }),
);
ok('cancelled', await owner.post(`/sales/invoices/${gone.id}/cancel`, {}));
const back = ok('invoice 60 days ago', await sell(20, { documentDate: day(-60) }));
ok(
  '5 returned 50 days ago',
  await owner.post(`/sales/invoices/${back.id}/returns`, {
    lines: [{ lineId: back.lines[0].id, quantity: 5 }],
    documentDate: day(-50),
  }),
);
const cut = ok('invoice 5 days ago', await sell(30, { documentDate: day(-5) }));
ok(
  'a discount on it today',
  await owner.post(`/sales/invoices/${cut.id}/discount`, { kind: 'DISCOUNT', amount: 1500 }),
);
ok(
  'paid the supplier 100 days ago',
  await owner.post('/payments', {
    partyId: sup.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 40000 }],
    documentDate: day(-100),
  }),
);
ok(
  'moved to the second box 30 days ago',
  await owner.post('/cash-transfers', {
    fromAccountId: box.id,
    toAccountId: box2.id,
    amount: 70000,
    documentDate: day(-30),
  }),
);
ok(
  'and some back yesterday',
  await owner.post('/cash-transfers', {
    fromAccountId: box2.id,
    toAccountId: box.id,
    amount: 20000,
    documentDate: day(-1),
  }),
);
const voided = ok('a receipt 3 days ago', await receipt(900, { documentDate: day(-3) }));
ok('cancelled today', await owner.post(`/vouchers/${voided.id}/cancel`, {}));
ok(
  'a cheque from the customer',
  await owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: `O${tag}`,
    amount: 4000,
    dueDate: day(20),
  }),
);

console.log('== every statement, many periods');
const partySt = (id, from, to, more = '') =>
  owner.get(`/ledger/parties/${id}/statement?from=${from}&to=${to}${more}`);
const boxSt = (id, from, to) => owner.get(`/money-accounts/${id}/movements?from=${from}&to=${to}`);
const ledgerAccounts = (await owner.get('/ledger/accounts')).data;
const custLedger = ledgerAccounts.find((a) => a.partyId === cust.id);
const boxLedger = ledgerAccounts.find((a) => a.moneyAccountId === box.id);
const ledgerSt = (id, from, to) =>
  owner.get(`/ledger/accounts/${id}/statement?from=${from}&to=${to}`);
const shape = (d) =>
  d.movements
    ? {
        opening: d.opening,
        closing: d.closing,
        moved: d.totalIn - d.totalOut,
        last: d.movements.at(-1)?.balanceAfter,
        steps: d.movements.every(
          (m, i) => m.balanceAfter === (i ? d.movements[i - 1].balanceAfter : d.opening) + m.amount,
        ),
      }
    : {
        opening: d.opening,
        closing: d.closing,
        moved: d.totalDebit - d.totalCredit,
        last: d.lines.at(-1)?.balance,
        steps: d.lines.every(
          (l, i) => l.balance === (i ? d.lines[i - 1].balance : d.opening) + l.debit - l.credit,
        ),
      };
// Periods across days, months and years; some random.
const periods = [
  [-420, -366],
  [-365, -1],
  [-365, 0],
  [-100, -31],
  [-60, -46],
  [-45, -21],
  [-20, -11],
  [-10, -4],
  [-3, -1],
  [0, 0],
  [-1, 0],
  [-30, 0],
];
for (let i = 0; i < 12; i++) {
  const a = -Math.floor(Math.random() * 300);
  periods.push([a - Math.floor(Math.random() * 60), a]);
}
const subjects = [
  ['customer', (f, t) => partySt(cust.id, f, t)],
  ['supplier', (f, t) => partySt(sup.id, f, t)],
  ['customer in one branch', (f, t) => partySt(cust.id, f, t, `&branchId=${owner.user.branchId}`)],
  ['box', (f, t) => boxSt(box.id, f, t)],
  ['second box', (f, t) => boxSt(box2.id, f, t)],
  ["customer's ledger account", (f, t) => ledgerSt(custLedger.id, f, t)],
  ["box's ledger account", (f, t) => ledgerSt(boxLedger.id, f, t)],
];
for (const [name, get] of subjects) {
  let bad = [];
  for (const [a, b] of periods) {
    const cur = shape((await get(day(a), day(b))).data);
    const before = shape((await get(day(a - 7), day(a - 1))).data);
    const whole = shape((await get(day(a - 7), day(b))).data);
    if (cur.opening !== before.closing)
      bad.push(['opening ≠ closing of the day before', a, b, cur.opening, before.closing]);
    if (cur.opening + cur.moved !== cur.closing) bad.push(['opening + movements ≠ closing', a, b]);
    if (cur.last !== undefined && cur.last !== cur.closing) bad.push(['last line ≠ closing', a, b]);
    if (!cur.steps) bad.push(['a line does not follow the one before', a, b]);
    if (whole.opening !== before.opening || whole.closing !== cur.closing)
      bad.push(['two periods ≠ the whole', a, b]);
  }
  check(`${name}: ${periods.length} periods hold together`, bad.length === 0, bad.slice(0, 3));
}

console.log('== closing today = the balance');
const custNow = (await owner.get(`/parties/${cust.id}`)).data.balance;
const supNow = (await owner.get(`/parties/${sup.id}`)).data.balance;
eq('customer', (await partySt(cust.id, day(-400), today)).data.closing, custNow);
eq('customer, from long before', (await partySt(cust.id, day(-1500), today)).data.closing, custNow);
eq('supplier', (await partySt(sup.id, day(-420), today)).data.closing, supNow);
const boxes = (await owner.get('/money-accounts')).data;
for (const b of [box, box2]) {
  const now = boxes.find((x) => x.id === b.id).balance;
  eq(`${b.name}: closing today`, (await boxSt(b.id, day(-200), today)).data.closing, now);
  eq(`${b.name}: today alone`, (await boxSt(b.id, today, today)).data.closing, now);
}
eq(
  "customer's ledger account = the customer",
  (await ledgerSt(custLedger.id, day(-1500), today)).data.closing,
  custNow,
);
eq(
  "box's ledger account = the box",
  (await ledgerSt(boxLedger.id, day(-1500), today)).data.closing,
  boxes.find((x) => x.id === box.id).balance,
);

console.log('== each document on its own day');
let st = (await boxSt(box.id, day(-5), today)).data;
// Before: 500,000 opening is dated today; −40,000 paid, −70,000 moved, +1,000 and +2,000 received,
// +3,000 cash on the invoice cancelled today.
eq(
  'box: before the last 5 days, only what was dated before them',
  st.opening,
  1000 - 40000 - 70000 + 2000 + 3000,
);
eq(
  'box: a back-dated receipt is not in a later period',
  st.movements.some((m) => m.amount === 2000),
  false,
);
st = (await boxSt(box.id, day(-10), day(-10))).data;
eq(
  'box: it is on its day',
  st.movements.map((m) => m.amount),
  [2000],
);
let ps = (await partySt(cust.id, day(-25), day(-15))).data;
eq(
  'a changed invoice stays on its day, as it stands now',
  ps.lines.map((l) => [l.sourceType, l.debit]),
  [['SALES_INVOICE', 12000]],
);
ps = (await partySt(cust.id, day(-14), today)).data;
check(
  'and is in the balance before a later period, not in its lines',
  !ps.lines.some((l) => l.documentId === changed.id) &&
    ps.opening === (await partySt(cust.id, day(-25), day(-15))).data.closing,
  ps.opening,
);
ps = (await partySt(cust.id, day(-400), today)).data;
check('a cancelled invoice is on no line', !ps.lines.some((l) => l.documentId === gone.id));
eq(
  'the discount is on the day it was given',
  ps.lines
    .filter((l) => l.sourceType === 'SALES_DISCOUNT')
    .map((l) => [l.date.slice(0, 10) >= day(-1), l.credit]),
  [[true, 1500]],
);
check(
  'each line says who made it and when',
  ps.lines.every((l) => l.createdByName && /T\d\d:\d\d:\d\d/.test(l.date)),
);
const rc = ps.lines.find((l) => l.documentKind === 'RECEIPT');
check('a receipt line names its cash box', rc?.counterpart?.includes(box.name), rc?.counterpart);
st = (await boxSt(box.id, day(-400), today)).data;
const line = (kind) => st.movements.find((m) => m.kind === kind);
eq(
  'box: a receipt names the customer',
  [line('RECEIPT').counterpartKind, line('RECEIPT').counterpartName, line('RECEIPT').documentKind],
  ['CUSTOMER', cust.name, 'RECEIPT'],
);
eq(
  'box: a payment names the supplier',
  [line('PAYMENT').counterpartKind, line('PAYMENT').counterpartName],
  ['SUPPLIER', sup.name],
);
eq(
  'box: a transfer names the other box',
  [line('TRANSFER_OUT').counterpartKind, line('TRANSFER_OUT').counterpartName],
  ['ACCOUNT', box2.name],
);
eq(
  'box: cash on an invoice opens the invoice',
  [line('SALE_PAID').documentKind, line('SALE_PAID').documentId],
  ['SALES_INVOICE', gone.id],
);
check(
  'box: every line has its maker, branch and time',
  st.movements.every((m) => m.createdByName && m.branchName && m.createdAt),
);

process.exit(summary('openings') ? 1 : 0);
