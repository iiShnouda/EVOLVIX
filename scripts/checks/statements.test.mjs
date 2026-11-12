// Financial statements and analytics (DOMAIN.md step 8): the income statement and balance sheet
// derived from the ledger (and moving exactly with new documents), net monthly sales, top
// customers / suppliers, top-moving items and dead stock, and their permissions. Runs against BASE.
import { BASE, login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const sara = await login('sara@skb.local'); // INVENTORY
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const year = `${companyToday().slice(0, 4)}-01-01`;
const IS = async () =>
  ok('income statement', await owner.get(`/ledger/income-statement?from=${year}`));
const BS = async () => ok('balance sheet', await owner.get('/ledger/balance-sheet'));

console.log('== permissions');
eq('sales staff: no statements', (await karim.get('/ledger/income-statement')).status, 403);
eq('sales staff: no analytics', (await karim.get('/analytics/monthly')).status, 403);
eq('store staff: no analytics', (await sara.get('/analytics/top-parties')).status, 403);
eq(
  'accountant: no balance sheet without its permission',
  (await mona.get('/ledger/balance-sheet')).status,
  403,
);
ok('accountant sees analytics', await mona.get('/analytics/item-movement'));

console.log('== statements hold together');
let is0 = await IS();
eq('gross = revenue − cost', is0.grossProfit, is0.revenue - is0.cogs);
eq('net = gross − expenses', is0.netProfit, is0.grossProfit - is0.expenses);
eq(
  'rows add up',
  [
    is0.rows.filter((r) => r.section === 'REVENUE').reduce((s, r) => s + r.amount, 0),
    is0.rows.filter((r) => r.section === 'EXPENSE').reduce((s, r) => s + r.amount, 0),
  ],
  [is0.revenue, is0.expenses],
);
let bs0 = await BS();
eq('assets = liabilities + equity', bs0.assets, bs0.liabilities + bs0.equity);
const allTime = ok(
  'income since the start',
  await owner.get('/ledger/income-statement?from=2022-01-01'),
);
// Closed years moved their profit into retained earnings, so it's no longer "to date".
const closedProfit = (await owner.get('/ledger/closed-years')).data.reduce(
  (s, c) => s + c.netProfit,
  0,
);
eq(
  'profit to date = income since the start, less closed years',
  bs0.profitToDate,
  allTime.netProfit - closedProfit,
);
const tb = ok('trial balance', await owner.get(`/ledger/trial-balance?from=${year}`));
const tbRevenue = tb.rows
  .filter((r) => r.type === 'REVENUE')
  .reduce((s, r) => s + r.periodCredit - r.periodDebit, 0);
eq('revenue = trial balance revenue', is0.revenue, tbRevenue);
check(
  'groups named',
  bs0.rows.filter((r) => r.section === 'ASSET').every((r) => r.groupName),
  bs0.rows.slice(0, 3),
);

console.log('== a sale, a purchase and an expense move them exactly');
const cust = ok(
  'customer',
  await owner.post('/parties', { name: `SCust ${tag}`, types: ['CUSTOMER'] }),
);
const supp = ok(
  'supplier',
  await owner.post('/parties', { name: `SSupp ${tag}`, types: ['SUPPLIER'] }),
);
const box = ok(
  'box',
  await owner.post('/money-accounts', {
    branchId: owner.user.branchId,
    name: `SBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 50000,
  }),
);
const mk = async (n) =>
  ok(
    `item ${n}`,
    await owner.post('/products', {
      name: `${n} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1500 }],
    }),
  );
const fast = await mk('Fast'),
  idle = await mk('Idle');
is0 = await IS();
bs0 = await BS();
ok(
  'buy both',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: fast.id, quantity: 50, unitCost: 1000 },
      { productId: idle.id, quantity: 7, unitCost: 800 },
    ],
  }),
);
const sale = ok(
  'sell 20 (cash 10.00)',
  await owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 14,
    paidAmount: 1000,
    paidAccountId: box.id,
    lines: [{ productId: fast.id, quantity: 20, unitPrice: 1500 }],
  }),
);
const cats = (await owner.get('/expense-categories')).data;
ok(
  'rent 50.00',
  await owner.post('/expenses', {
    categoryId: cats[0].id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 5000 }],
  }),
);
const is1 = await IS();
eq('revenue up by the net sale', is1.revenue - is0.revenue, 30000);
eq('cost of sales up by its cost', is1.cogs - is0.cogs, sale.costTotal);
eq('expenses up by the rent', is1.expenses - is0.expenses, 5000);
eq(
  'net profit moves by sale profit − rent',
  is1.netProfit - is0.netProfit,
  30000 - sale.costTotal - 5000,
);
const bs1 = await BS();
eq('still balances', bs1.assets, bs1.liabilities + bs1.equity);
eq(
  'profit to date moved the same',
  bs1.profitToDate - bs0.profitToDate,
  is1.netProfit - is0.netProfit,
);
const vat = (b) => b.rows.find((r) => r.code === '2102')?.amount ?? 0;
eq('VAT owed shows as a liability', vat(bs1) - vat(bs0), 4200);
const early = ok(
  'balance sheet on an early day',
  await owner.get('/ledger/balance-sheet?asOf=2022-01-01'),
);
eq('nothing before go-live', [early.assets, early.liabilities, early.equity], [0, 0, 0]);

console.log('== analytics');
const monthly = ok('monthly', await owner.get('/analytics/monthly?months=3'));
eq(
  'three months, oldest first',
  [monthly.length, monthly[2].month],
  [3, companyToday().slice(0, 7)],
);
check(
  'this month includes the sale',
  monthly[2].netSales >= 30000 && monthly[2].invoices >= 1,
  monthly[2],
);
eq(
  'net = sales − returns',
  monthly.every((m) => m.netSales === m.sales - m.returns),
  true,
);
ok(
  'return 5 of them',
  await owner.post(`/sales/invoices/${sale.id}/returns`, {
    lines: [{ lineId: sale.lines[0].id, quantity: 5 }],
  }),
);
const monthly2 = ok('monthly after', await owner.get('/analytics/monthly?months=1'));
eq('the return comes off the month', monthly2[0].netSales - monthly[2].netSales, -7500);
const top = ok('top customers', await owner.get('/analytics/top-parties?limit=50'));
const mine = top.find((p) => p.partyId === cust.id);
eq('our customer, net of the return', [mine?.net, mine?.documents], [22500, 1]);
check(
  'sorted by net',
  top.every((p, i) => i === 0 || top[i - 1].net >= p.net),
);
const tops = ok('top suppliers', await owner.get('/analytics/top-parties?side=suppliers&limit=50'));
// Listed with its net, unless 50 bigger suppliers fill the list (a test database that has run many times).
const ourSupplier = tops.find((p) => p.partyId === supp.id);
check(
  'our supplier',
  ourSupplier ? ourSupplier.net === 55600 : tops.length === 50 && tops.at(-1).net >= 55600,
  ourSupplier?.net,
);
const mv = ok('item movement', await owner.get('/analytics/item-movement?limit=100'));
const f = mv.topMovers.find((m) => m.productId === fast.id);
// Listed with its figures, unless 100 faster items fill the list (a test database that has run many times).
check(
  'fast item: 15 out net, 50 in, value net of the return',
  f
    ? f.quantityOut === 15 && f.quantityIn === 50 && f.salesValue === 22500
    : mv.topMovers.length === 100 && mv.topMovers.at(-1).quantityOut >= 15,
  [f?.quantityOut, f?.quantityIn, f?.salesValue],
);
const d = mv.deadStock.find((x) => x.productId === idle.id);
eq(
  'idle item is dead stock, valued at cost',
  [d?.stock, d?.stockValue, d?.lastSale],
  [7, 5600, null],
);
check('a sold item is not dead', !mv.deadStock.some((x) => x.productId === fast.id));
console.log('== every statement line says what it is (owner, 2026-11-12)');
const today = companyToday();
const cs = ok(
  'customer statement',
  await owner.get(`/ledger/parties/${cust.id}/statement?from=${today}&to=${today}`),
);
const inv = cs.lines.find((l) => l.documentId === sale.id && l.debit > 0);
eq(
  'invoice line: number, kind, document',
  [inv?.documentNumber, inv?.documentKind, inv?.sourceType],
  [sale.number, 'SALES_INVOICE', 'SALES_INVOICE'],
);
check('invoice line: entry number', inv?.entrySerial > 0, inv?.entrySerial);
check('invoice line: branch and warehouse', !!inv?.branchName && inv?.warehouseName === wh.name, [
  inv?.branchName,
  inv?.warehouseName,
]);
check('invoice line: from / to and who made it', !!inv?.counterpart && !!inv?.createdByName, [
  inv?.counterpart,
  inv?.createdByName,
]);
check(
  'invoice line: rep and department fields are sent',
  'repName' in (inv ?? {}) && 'departmentName' in (inv ?? {}),
);
eq('invoice line: the customer', [inv?.partyId, inv?.partyTypes], [cust.id, ['CUSTOMER']]);
const paid = cs.lines.find((l) => l.documentId === sale.id && l.credit > 0);
check(
  'paid on the spot: from / to is the box',
  (paid?.counterpart ?? '').includes(`SBox ${tag}`),
  paid?.counterpart,
);
check(
  'closing = opening + debit − credit',
  cs.closing === cs.opening + cs.totalDebit - cs.totalCredit,
);

const custAccount = (await owner.get('/ledger/accounts')).data.find((a) => a.partyId === cust.id);
const as = ok(
  'the same account from the chart',
  await owner.get(`/ledger/accounts/${custAccount.id}/statement?from=${today}&to=${today}`),
);
const asInv = as.lines.find((l) => l.documentId === sale.id && l.debit > 0);
eq(
  'chart statement line: document, kind, customer, warehouse',
  [asInv?.documentNumber, asInv?.documentKind, asInv?.partyId, asInv?.warehouseName],
  [sale.number, 'SALES_INVOICE', cust.id, wh.name],
);

const bx = ok('box statement', await owner.get(`/money-accounts/${box.id}/movements`));
const got = bx.movements.find((m) => m.documentId === sale.id);
eq(
  'box line: document kind, customer, warehouse',
  [got?.documentKind, got?.partyId, got?.partyTypes, got?.warehouseName],
  ['SALES_INVOICE', cust.id, ['CUSTOMER'], wh.name],
);
check('box line: entry number', got?.entrySerial > 0, got?.entrySerial);
const rent = bx.movements.find((m) => m.documentKind === 'EXPENSE');
check(
  'box expense line: entry number, no customer',
  rent?.entrySerial > 0 && rent?.partyId == null,
  [rent?.entrySerial, rent?.partyId],
);

const ws = ok(
  'warehouse statement',
  await owner.get(`/inventory/warehouses/${wh.id}/statement?from=${today}&to=${today}`),
);
const out = ws.lines.find((l) => l.documentId === sale.id);
eq(
  'warehouse line: document kind and customer',
  [out?.documentKind, out?.partyId, out?.partyTypes],
  ['SALES_INVOICE', cust.id, ['CUSTOMER']],
);
check('warehouse line: value for whoever sees costs', out?.value != null, out?.value);

// What depends on a permission still does.
eq(
  'sales staff: no customer statement',
  (await karim.get(`/ledger/parties/${cust.id}/statement`)).status,
  403,
);
eq(
  'store staff: no box statement',
  (await sara.get(`/money-accounts/${box.id}/movements`)).status,
  403,
);
const monaCs = await mona.get(`/ledger/parties/${cust.id}/statement?from=${today}&to=${today}`);
if (monaCs.status === 200) {
  const l = monaCs.data.lines.find((x) => x.documentId === sale.id && x.debit > 0);
  check(
    'accountant: the line carries no cost account',
    !/تكلفة|Cost of goods/i.test(l?.counterpart ?? ''),
    l?.counterpart,
  );
} else eq('accountant: customer statement by permission', monaCs.status, 403);

eq('signed out', (await fetch(`${BASE}/analytics/monthly`)).status, 401);

process.exit(summary('statements') ? 1 : 0);
