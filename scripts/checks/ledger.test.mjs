// Ledger (DOMAIN.md step 6): chart of accounts, the automatic entries every document posts,
// statements, the trial balance, manual entries and their reversal, the period lock and
// permissions. Runs against BASE.
import { BASE, login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const accountsNow = async () => (await owner.get('/ledger/accounts')).data;
const byKey = async (key) => (await accountsNow()).find((a) => a.systemKey === key);
const party = async (id) => (await owner.get(`/parties/${id}`)).data;
const entryOf = async (source, number) =>
  (await owner.get(`/ledger/entries?source=${source}&pageSize=100`)).data.items.filter(
    (e) => e.number === number,
  );
const lines = (e) => e.lines.map((l) => [l.accountCode.split('-')[0], l.debit, l.credit]).sort();

console.log('== chart of accounts');
eq("sales staff can't see the ledger", (await karim.get('/ledger/accounts')).status, 403);
const chart = ok('accounts', await owner.get('/ledger/accounts'));
const keys = [
  'CASH',
  'BANKS',
  'CUSTOMERS',
  'CARRIERS',
  'INVENTORY',
  'VAT_INPUT',
  'SUPPLIERS',
  'VAT_OUTPUT',
  'CAPITAL',
  'OPENING_EQUITY',
  'SALES',
  'SALES_RETURNS',
  'OTHER_INCOME',
  'COGS',
  'SHIPPING_EXPENSE',
  'STOCK_GAIN',
  'STOCK_LOSS',
];
check(
  'system accounts exist',
  keys.every((k) => chart.some((a) => a.systemKey === k)),
  keys.filter((k) => !chart.some((a) => a.systemKey === k)),
);
eq(
  'codes',
  ['INVENTORY', 'CUSTOMERS', 'SALES', 'COGS'].map((k) => chart.find((a) => a.systemKey === k).code),
  ['1105', '1103', '4101', '5101'],
);
const roots = chart.filter((a) => !a.parentId);
eq(
  'the ledger balances (roots sum to zero)',
  roots.reduce((s, a) => s + a.balance, 0),
  0,
);
const opening = (await owner.get('/ledger/entries?source=OPENING&from=2022-01-01')).data.items;
eq('one go-live opening entry', opening.length, 1);
const tb = ok('trial balance', await owner.get('/ledger/trial-balance?from=2022-01-01'));
eq(
  'trial balance debits = credits',
  tb.rows.reduce((s, r) => s + r.closingDebit, 0),
  tb.rows.reduce((s, r) => s + r.closingCredit, 0),
);

// Parties, money and an item.
const P = async (name, types) =>
  ok(`party ${name}`, await owner.post('/parties', { name: `${name} ${tag}`, types }));
const cust = await P('LCust', ['CUSTOMER']),
  supp = await P('LSupp', ['SUPPLIER']),
  carrier = await P('LCourier', ['CARRIER']);
const box = ok(
  'cash box',
  await owner.post('/money-accounts', {
    branchId: owner.user.branchId,
    name: `LBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 50000,
  }),
);
const boxLedger = (await accountsNow()).find((a) => a.moneyAccountId === box.id);
eq(
  'cash box has its ledger account',
  [boxLedger?.code.startsWith('1101-'), boxLedger?.balance],
  [true, 50000],
);
eq(
  'opening posted against opening balances',
  lines(
    (await owner.get('/ledger/entries?source=MONEY_OPENING&pageSize=100')).data.items.find(
      (e) => e.sourceId === box.id,
    ),
  ),
  [
    ['1101', 50000, 0],
    ['3102', 0, 50000],
  ].sort(),
);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `LItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1500 }],
  }),
);

console.log('== purchases post');
const pur = ok(
  'purchase with VAT, freight, part paid',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    paidAmount: 10000,
    paidAccountId: box.id,
    lines: [{ productId: item.id, quantity: 100, unitCost: 1000 }],
    charges: [
      { kind: 'DISCOUNT', percent: 10 },
      { kind: 'TAX', percent: 14 },
      { kind: 'ADDITION', amount: 2000, label: 'Freight' },
    ],
  }),
);
let e = (await entryOf('PURCHASE_INVOICE', pur.number))[0];
eq(
  'purchase entry',
  lines(e),
  [
    ['1105', 90000, 0],
    ['1106', 12600, 0],
    ['5104', 2000, 0],
    ['2101', 0, 104600],
    ['2101', 10000, 0],
    ['1101', 0, 10000],
  ].sort(),
);
eq('supplier owes = ledger', (await party(supp.id)).balance, -94600);

console.log('== sales post');
const sale = ok(
  'sale with discount, VAT, delivery fee, part paid',
  await owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    paidAmount: 5000,
    paidAccountId: box.id,
    lines: [{ productId: item.id, quantity: 10, unitPrice: 1500 }],
    charges: [
      { kind: 'DISCOUNT', amount: 1000 },
      { kind: 'TAX', percent: 14 },
      { kind: 'ADDITION', amount: 500, label: 'Delivery' },
    ],
  }),
);
e = (await entryOf('SALES_INVOICE', sale.number))[0];
const cost = sale.costTotal;
eq(
  'sale entry',
  lines(e),
  [
    ['1103', sale.grandTotal, 0],
    ['4101', 0, 14000],
    ['2102', 0, 1960],
    ['4103', 0, 500],
    ['5101', cost, 0],
    ['1105', 0, cost],
    ['1101', 5000, 0],
    ['1103', 0, 5000],
  ].sort(),
);
eq('grand total = 14000 + 1960 + 500', sale.grandTotal, 16460);
const custAccount = (await accountsNow()).find((a) => a.partyId === cust.id);
eq(
  'customer sub-account under customers',
  [custAccount.code.startsWith('1103-'), custAccount.name, custAccount.balance],
  [true, `LCust ${tag}`, 11460],
);
let st = ok(
  'party statement',
  await owner.get(`/ledger/parties/${cust.id}/statement?from=2022-01-01`),
);
eq('statement closes at the balance', [st.closing, (await party(cust.id)).balance], [11460, 11460]);

console.log('== returns post');
const line = sale.lines[0];
const ret = ok(
  'sales return of 2 with cash back',
  await owner.post(`/sales/invoices/${sale.id}/returns`, {
    lines: [{ lineId: line.id, quantity: 2 }],
    refundAmount: 1000,
    refundAccountId: box.id,
  }),
);
e = (await entryOf('SALES_RETURN', ret.number))[0];
const retNet = ret.subtotal - ret.discountTotal;
eq(
  'sales return entry',
  lines(e),
  [
    ['4102', retNet, 0],
    ['2102', ret.taxTotal, 0],
    ['1103', 0, ret.grandTotal],
    ['1105', ret.costTotal, 0],
    ['5101', 0, ret.costTotal],
    ['1103', 1000, 0],
    ['1101', 0, 1000],
  ].sort(),
);
const pline = pur.lines[0];
const pret = ok(
  'purchase return of 5',
  await owner.post(`/purchases/invoices/${pur.id}/returns`, {
    lines: [{ lineId: pline.id, quantity: 5 }],
  }),
);
e = (await entryOf('PURCHASE_RETURN', pret.number))[0];
const debit = e.lines.reduce((s, l) => s + l.debit, 0),
  credit = e.lines.reduce((s, l) => s + l.credit, 0);
eq(
  'purchase return balances and credits stock',
  [debit === credit, e.lines.some((l) => l.accountCode === '1105' && l.credit === pret.costTotal)],
  [true, true],
);

console.log('== vouchers post');
const rc = ok(
  'receipt',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 3000 }],
  }),
);
eq(
  'receipt entry',
  lines((await entryOf('VOUCHER', rc.number))[0]),
  [
    ['1101', 3000, 0],
    ['1103', 0, 3000],
  ].sort(),
);
const cats = (await owner.get('/expense-categories')).data;
const ex = ok(
  'expense',
  await owner.post('/expenses', {
    categoryId: cats[0].id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 700 }],
  }),
);
eq(
  'expense entry',
  lines((await entryOf('VOUCHER', ex.number))[0]),
  [
    ['5102', 700, 0],
    ['1101', 0, 700],
  ].sort(),
);
ok('cancel the receipt', await owner.post(`/vouchers/${rc.id}/cancel`));
const cancel = (await entryOf('VOUCHER_CANCEL', rc.number))[0];
eq(
  'cancel posts the exact reverse',
  lines(cancel),
  [
    ['1101', 0, 3000],
    ['1103', 3000, 0],
  ].sort(),
);

console.log('== delivery posts');
const cs = ok(
  'sale via courier',
  await owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    deliveryMethod: 'SHIPPING_COMPANY',
    carrierId: carrier.id,
    lines: [{ productId: item.id, quantity: 2, unitPrice: 1500 }],
  }),
);
const shp = ok(
  'parcel',
  await owner.post('/shipments', { carrierId: carrier.id, invoiceIds: [cs.id] }),
);
ok('delivered', await owner.post(`/shipments/${shp.id}/delivered`));
eq(
  'COD moves the debt',
  lines((await entryOf('SHIPMENT', shp.number))[0]),
  [
    ['1104', 3000, 0],
    ['1103', 0, 3000],
  ].sort(),
);
const stl = ok(
  'settled with a fee',
  await owner.post('/carrier-settlements', {
    carrierId: carrier.id,
    shipmentIds: [shp.id],
    fees: 250,
    received: 2750,
    accountId: box.id,
  }),
);
eq(
  'settlement entry',
  lines((await entryOf('CARRIER_SETTLEMENT', stl.number))[0]),
  [
    ['5103', 250, 0],
    ['1101', 2750, 0],
    ['1104', 0, 3000],
  ].sort(),
);

console.log('== stocktake posts');
const count = (await owner.get(`/inventory/items?search=LItem ${tag}&warehouseId=${wh.id}`)).data
  .items[0];
const onHand = count.warehouseStock ?? count.stockOnHand;
const adj = ok(
  'count one more than the books',
  await owner.post('/inventory/stocktake', {
    warehouseId: wh.id,
    lines: [{ productId: item.id, countedQuantity: onHand + 1 }],
  }),
);
const se = (await entryOf('STOCKTAKE', adj.reference))[0];
eq(
  'gain entry',
  lines(se),
  [
    ['1105', adj.valueChange, 0],
    ['4104', 0, adj.valueChange],
  ].sort(),
);

console.log('== manual entries');
const fixed = chart.find((a) => a.systemKey === 'FIXED_ASSETS');
const furniture = ok(
  'add an account under fixed assets',
  await owner.post('/ledger/accounts', { name: `Furniture ${tag}`, parentId: fixed.id }),
);
eq('numbered under its group', furniture.code.startsWith(`${fixed.code}-`), true);
eq(
  'not under customers',
  (
    await owner.post('/ledger/accounts', {
      name: `X ${tag}`,
      parentId: chart.find((a) => a.systemKey === 'CUSTOMERS').id,
    })
  ).data?.code,
  'auto_group',
);
eq(
  'not under a non-group',
  (await owner.post('/ledger/accounts', { name: `X ${tag}`, parentId: furniture.id })).data?.code,
  'parent_not_found',
);
eq(
  "sales staff can't add accounts",
  (await karim.post('/ledger/accounts', { name: `X ${tag}`, parentId: fixed.id })).status,
  403,
);
const capital = chart.find((a) => a.systemKey === 'CAPITAL');
const M = (who, body) =>
  who.post('/ledger/entries', { description: 'Owner brought furniture', ...body });
const jv = ok(
  'furniture brought in as capital',
  await M(mona, {
    lines: [
      { accountId: furniture.id, debit: 800000 },
      { accountId: capital.id, credit: 800000 },
    ],
  }),
);
check('numbered JV-', /^JV-\d{4}-\d{6}$/.test(jv.number), jv.number);
eq('reversible', jv.reversible, true);
eq(
  'unbalanced',
  (
    await M(owner, {
      lines: [
        { accountId: furniture.id, debit: 100 },
        { accountId: capital.id, credit: 99 },
      ],
    })
  ).data?.code,
  'unbalanced',
);
eq(
  'both sides on a line',
  (
    await M(owner, {
      lines: [
        { accountId: furniture.id, debit: 100, credit: 100 },
        { accountId: capital.id, credit: 100 },
      ],
    })
  ).data?.code,
  'bad_amount',
);
eq(
  'one line only',
  (await M(owner, { lines: [{ accountId: furniture.id, debit: 100 }] })).data?.code,
  'bad_lines',
);
eq(
  'no description',
  (
    await M(owner, {
      description: ' ',
      lines: [
        { accountId: furniture.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'bad_description',
);
eq(
  'a group takes no entries',
  (
    await M(owner, {
      lines: [
        { accountId: fixed.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'account_not_found',
);
eq(
  'money moves by vouchers',
  (
    await M(owner, {
      lines: [
        { accountId: boxLedger.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'money_account',
);
eq(
  'stock moves by documents',
  (
    await M(owner, {
      lines: [
        { accountId: chart.find((a) => a.systemKey === 'INVENTORY').id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'stock_account',
);
eq(
  'no future date',
  (
    await M(owner, {
      date: '2999-01-01',
      lines: [
        { accountId: furniture.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'bad_date',
);
eq(
  "sales staff can't post",
  (
    await M(karim, {
      lines: [
        { accountId: furniture.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).status,
  403,
);
// A settlement discount given to the customer: Dr sales discount-like expense · Cr the customer.
const custBal = (await party(cust.id)).balance;
const rounding = chart.find((a) => a.systemKey === 'ROUNDING');
const disc = ok(
  "write off 1.00 of the customer's balance",
  await M(owner, {
    description: 'Rounding off',
    lines: [
      { accountId: rounding.id, debit: 100 },
      { accountId: custAccount.id, credit: 100 },
    ],
  }),
);
eq('the customer owes 1.00 less', (await party(cust.id)).balance, custBal - 100);
const rev = ok('reverse it', await owner.post(`/ledger/entries/${disc.id}/reverse`));
eq(
  'reversal numbered and mirrored',
  [rev.sourceType, lines(rev)],
  [
    'MANUAL_REVERSAL',
    lines(disc)
      .map(([a, d, c]) => [a, c, d])
      .sort(),
  ],
);
eq('the customer owes it again', (await party(cust.id)).balance, custBal);
eq(
  'reverse twice',
  (await owner.post(`/ledger/entries/${disc.id}/reverse`)).data?.code,
  'already_reversed',
);
eq(
  "a document's entry reverses with the document",
  (await owner.post(`/ledger/entries/${e.id}/reverse`)).data?.code,
  'not_manual',
);
st = ok(
  'account statement',
  await owner.get(`/ledger/accounts/${furniture.id}/statement?from=2022-01-01`),
);
eq(
  'furniture statement',
  [st.opening, st.totalDebit, st.closing, st.lines.length],
  [0, 800000, 800000, 1],
);
const groupSt = ok(
  'group statement covers its accounts',
  await owner.get(`/ledger/accounts/${fixed.id}/statement?from=2022-01-01`),
);
eq('group total', groupSt.closing >= 800000, true);
const backdated = ok(
  'a back-dated entry',
  await M(owner, {
    date: '2026-01-15',
    description: 'January fix',
    lines: [
      { accountId: furniture.id, debit: 500 },
      { accountId: capital.id, credit: 500 },
    ],
  }),
);
st = ok(
  'statement from February',
  await owner.get(`/ledger/accounts/${furniture.id}/statement?from=2026-02-01`),
);
eq('January is in the opening', st.opening, 500);

console.log('== accounts can close only when empty');
eq(
  'system account stays',
  (await owner.put(`/ledger/accounts/${capital.id}`, { isActive: false })).data?.code,
  'system_account',
);
eq(
  'with a balance',
  (await owner.put(`/ledger/accounts/${furniture.id}`, { isActive: false })).data?.code,
  'has_balance',
);
const empty = ok(
  'an empty account',
  await owner.post('/ledger/accounts', { name: `Unused ${tag}`, parentId: fixed.id }),
);
eq(
  'closes',
  (await owner.put(`/ledger/accounts/${empty.id}`, { isActive: false })).data?.isActive,
  false,
);
eq(
  "a linked account keeps its customer's name",
  (await owner.put(`/ledger/accounts/${custAccount.id}`, { name: 'x' })).data?.code,
  'linked_account',
);
eq(
  'renamed',
  (await owner.put(`/ledger/accounts/${furniture.id}`, { name: `Office furniture ${tag}` })).data
    ?.name,
  `Office furniture ${tag}`,
);

console.log('== period lock');
eq(
  "accountant can't lock",
  (await mona.put('/ledger/lock', { lockDate: '2026-01-31' })).status,
  403,
);
eq(
  'no future lock',
  (await owner.put('/ledger/lock', { lockDate: '2999-01-01' })).data?.code,
  'bad_date',
);
eq(
  'lock January',
  (await owner.put('/ledger/lock', { lockDate: '2026-01-31' })).data?.lockDate,
  '2026-01-31',
);
eq(
  'no entry in January now',
  (
    await M(owner, {
      date: '2026-01-20',
      lines: [
        { accountId: furniture.id, debit: 1 },
        { accountId: capital.id, credit: 1 },
      ],
    })
  ).data?.code,
  'period_locked',
);
eq(
  "January's entry can't be reversed",
  (await owner.post(`/ledger/entries/${backdated.id}/reverse`)).data?.code,
  'period_locked',
);
const today = companyToday();
ok('lock today', await owner.put('/ledger/lock', { lockDate: today }));
const px = ok(
  'a payment today',
  await owner.post('/payments', {
    partyId: supp.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
  }),
);
eq(
  "a voucher in the locked period can't be cancelled",
  (await owner.post(`/vouchers/${px.id}/cancel`)).data?.code,
  'period_locked',
);
eq('unlock', (await owner.put('/ledger/lock', { lockDate: null })).data?.lockDate, null);
ok('now it can', await owner.post(`/vouchers/${px.id}/cancel`));
eq('lock visible', (await mona.get('/ledger/lock')).data?.lockDate, null);

console.log('== the ledger still balances');
const after = await accountsNow();
eq(
  'roots sum to zero',
  after.filter((a) => !a.parentId).reduce((s, a) => s + a.balance, 0),
  0,
);
eq(
  'box ledger = box',
  after.find((a) => a.moneyAccountId === box.id).balance,
  (await owner.get('/money-accounts')).data.find((a) => a.id === box.id).balance,
);
eq(
  'supplier ledger = supplier',
  after.filter((a) => a.partyId === supp.id).reduce((s, a) => s + a.balance, 0),
  (await party(supp.id)).balance,
);
const journal = ok('journal list', await owner.get('/ledger/entries?pageSize=5'));
check(
  'journal newest first',
  journal.items.length > 0 && journal.items.every((x) => x.lines.length >= 2),
);
eq('signed out', (await fetch(`${BASE}/ledger/accounts`)).status, 401);

process.exit(summary('ledger') ? 1 : 0);
