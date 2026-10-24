// Costs and profit (owner decision 2026-09-30): only the owner — and whoever the owner gives
// costs:view — sees what goods cost and what sales earn. The server leaves these numbers out for
// everyone else. Also: a discount on one line (a %, so much per piece, or an amount), which needs
// the discount permission (not the change-price one) and can't exceed the line. Runs against BASE.
import { login, check, eq, ok, summary, sellDiscounted } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: no purchases:view
const PASS = 'Str0ngPass!';

// Own people, so the other suites' people keep their permissions.
const person = async (role, name) => {
  const email = `${name}.${tag}@skb.local`;
  const staff = ok(
    `add ${role}`,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email,
      password: PASS,
      role,
      branchId: owner.user.branchId,
    }),
  );
  return { staff, email };
};
const accP = await person('ACCOUNTANT', 'acc');
const sellerP = await person('SALES', 'seller');
let acc = await login(accP.email, PASS);
let seller = await login(sellerP.email, PASS);

console.log('== who sees costs by default');
check('the owner', owner.user.permissions.includes('costs:view'));
check('not an accountant', !acc.user.permissions.includes('costs:view'));
check('not a sales person', !seller.user.permissions.includes('costs:view'));
const roles = (await owner.get('/roles')).data;
check(
  'the admin role (every permission)',
  roles.find((r) => r.role === 'ADMIN').permissions.includes('costs:view'),
);

// An item bought at 6.00 and sold at 10.00 (supplier price level 6.50).
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const levels = (await owner.get('/price-levels')).data;
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const suppLevel = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `CostSup ${tag}`, types: ['SUPPLIER'] }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `CostCust ${tag}`, types: ['CUSTOMER'] }),
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Costly ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [
      { unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 },
      { unitId: piece.id, priceLevelId: suppLevel.id, price: 650 },
    ],
  }),
);
ok(
  'bought at 6.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 20, unitCost: 600 }],
  }),
);
const sell = (who, lines, extra = {}) =>
  who.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines,
    ...extra,
  });
const sale = ok(
  'owner sells 2 at 10.00',
  await sell(owner, [{ productId: item.id, quantity: 2, unitPrice: 1000 }]),
);
eq('owner sees cost and profit', [sale.costTotal, sale.profitTotal], [1200, 800]);

console.log('== sales documents');
const seen = (await acc.get(`/sales/invoices/${sale.id}`)).data;
eq(
  'accountant: no cost or profit on the invoice',
  [
    seen.costTotal,
    seen.profitTotal,
    seen.lines[0].unitCost,
    seen.lines[0].lineCost,
    seen.lines[0].lineProfit,
  ],
  [0, 0, 0, 0, 0],
);
eq('but every amount', [seen.grandTotal, seen.lines[0].lineTotal], [sale.grandTotal, 2000]);
const accSale = ok(
  'accountant sells one',
  await sell(acc, [{ productId: item.id, quantity: 1, unitPrice: 1000 }]),
);
eq('the answer hides it', [accSale.costTotal, accSale.profitTotal], [0, 0]);
eq(
  'it is stored for the owner',
  (await owner.get(`/sales/invoices/${accSale.id}`)).data.profitTotal,
  400,
);

console.log('== items');
eq('owner: average cost', (await owner.get(`/products/${item.id}`)).data.costPrice, 600);
const accItem = (await acc.get(`/products/${item.id}`)).data;
eq('accountant: no average cost', accItem.costPrice, 0);
check(
  'accountant (purchases) still sees the supplier price',
  accItem.prices.some((c) => c.priceLevelId === suppLevel.id),
);
const karimItem = (await karim.get(`/products/${item.id}`)).data;
eq('sales: no average cost', karimItem.costPrice, 0);
check('sales: no supplier price', !karimItem.prices.some((c) => c.priceLevelId === suppLevel.id));
const karimRow = (await karim.get(`/products?search=${encodeURIComponent(`Costly ${tag}`)}`))
  .data[0];
check(
  'sales: none in the search either',
  karimRow &&
    karimRow.costPrice === 0 &&
    !karimRow.units[0].prices.some((p) => p.priceLevelId === suppLevel.id),
  karimRow,
);

console.log('== stock');
const invRow = async (who) =>
  (await who.get(`/inventory/items?search=${encodeURIComponent(item.sku)}`)).data;
const invAcc = await invRow(acc);
eq(
  'accountant: no cost or value in the list',
  [invAcc.items[0].avgCost, invAcc.items[0].stockValue, invAcc.totalValue],
  [0, 0, 0],
);
check('owner: the value', (await invRow(owner)).items[0].stockValue === 17 * 600);
const card = (await acc.get(`/inventory/items/${item.id}/card`)).data;
check(
  'accountant: the item card without costs',
  card.openingValue === 0 &&
    card.closingValue === 0 &&
    card.item.avgCost === 0 &&
    card.movements.every((m) => m.unitCost === 0 && m.avgCostAfter === 0) &&
    card.stock.every((s) => s.value === 0),
  card,
);
eq('but the quantities', card.closingBalance, 17);
check(
  'owner: the card values',
  (await owner.get(`/inventory/items/${item.id}/card`)).data.closingValue > 0,
);
const valAcc = await acc.get('/inventory/valuation');
eq('accountant: no valuation (a permission of its own)', valAcc.status, 403);
eq('owner: valuation', (await owner.get('/inventory/valuation')).status, 200);
check(
  'accountant: warehouses without value',
  (await acc.get('/warehouses')).data.every((w) => w.value === 0),
);
check(
  'owner: warehouse value',
  (await owner.get('/warehouses')).data.some((w) => w.value > 0),
);

console.log('== reports');
eq('accountant: no profitability', (await acc.get('/reports/profitability')).status, 403);
eq('owner: profitability', (await owner.get('/reports/profitability')).status, 200);
const perf = (await acc.get('/analytics/performance?by=rep')).data;
check(
  'accountant: performance without profit',
  perf.profit === 0 && perf.rows.every((r) => r.profit === 0),
  perf,
);
check(
  'owner: performance profit',
  (await owner.get('/analytics/performance?by=rep')).data.profit !== 0,
);
const moves = (await acc.get('/analytics/item-movement')).data;
check(
  'accountant: dead stock without value',
  moves.deadStock.every((d) => d.stockValue === 0),
);

console.log('== ledger');
for (const path of ['/ledger/trial-balance', '/ledger/income-statement', '/ledger/balance-sheet']) {
  eq(`accountant: ${path} refused`, (await acc.get(path)).status, 403);
  eq(`owner: ${path}`, (await owner.get(path)).status, 200);
}
const chart = (await owner.get('/ledger/accounts')).data;
const byKey = (k) => chart.find((a) => a.systemKey === k);
const hidden = new Set(
  chart
    .filter((a) =>
      ['INVENTORY', 'COGS', 'STOCK_GAIN', 'STOCK_LOSS', 'RETAINED_EARNINGS'].includes(a.systemKey),
    )
    .map((a) => a.id),
);
for (let grew = true; grew;) {
  grew = false;
  for (const a of chart)
    if (a.parentId && hidden.has(a.parentId) && !hidden.has(a.id))
      (hidden.add(a.id), (grew = true));
}
check(
  'owner: stock and cost of sales carry balances',
  byKey('INVENTORY').debit > 0 && byKey('COGS').debit > 0,
);
const accChart = (await acc.get('/ledger/accounts')).data;
check(
  'accountant: they show empty',
  accChart
    .filter((a) => hidden.has(a.id))
    .every((a) => a.debit === 0 && a.credit === 0 && a.balance === 0),
);
eq(
  'accountant: no statement of cost of sales',
  (await acc.get(`/ledger/accounts/${byKey('COGS').id}/statement`)).status,
  403,
);
const entries = (await acc.get('/ledger/entries?source=SALES_INVOICE&pageSize=100')).data.items;
check('accountant: entries still listed', entries.length > 0);
check(
  'accountant: no stock or cost lines in them',
  entries.every((e) => e.lines.every((l) => !hidden.has(l.accountId))),
);
check(
  'owner: the entries have them',
  (await owner.get('/ledger/entries?source=SALES_INVOICE&pageSize=100')).data.items.some((e) =>
    e.lines.some((l) => hidden.has(l.accountId)),
  ),
);
eq(
  'accountant: customer statement still there',
  (await acc.get(`/ledger/parties/${customer.id}/statement`)).status,
  200,
);

console.log('== the owner gives costs:view');
ok('grant', await owner.put(`/staff/${accP.staff.id}/permissions`, { granted: ['costs:view'] }));
acc = await login(accP.email, PASS);
check('now in the token', acc.user.permissions.includes('costs:view'));
// Profit is a permission of its own (owner, 2026-10-17): supply prices alone don't show it.
const costOnly = (await acc.get(`/sales/invoices/${sale.id}`)).data;
check('sees the cost', costOnly.costTotal > 0);
eq('but not the profit', costOnly.profitTotal, 0);
eq(
  'nor the trial balance (it holds the profit)',
  (await acc.get('/ledger/trial-balance')).status,
  403,
);
ok(
  'grant profit too',
  await owner.put(`/staff/${accP.staff.id}/permissions`, {
    granted: ['costs:view', 'profit:view'],
  }),
);
acc = await login(accP.email, PASS);
eq('sees the profit', (await acc.get(`/sales/invoices/${sale.id}`)).data.profitTotal, 800);
// The valuation and the trial balance are permissions of their own (owner, 2026-10-23).
eq('the valuation still needs its own', (await acc.get('/inventory/valuation')).status, 403);
eq('so does the trial balance', (await acc.get('/ledger/trial-balance')).status, 403);
ok(
  'give them',
  await owner.put(`/staff/${accP.staff.id}/permissions`, {
    granted: ['costs:view', 'profit:view', 'inventory:valuation', 'ledger:trial_balance'],
  }),
);
acc = await login(accP.email, PASS);
const valued = ok('and the valuation', await acc.get('/inventory/valuation'));
check(
  'with its values (supply prices)',
  valued.value !== null && valued.value !== undefined,
  valued.value,
);
eq('and the trial balance', (await acc.get('/ledger/trial-balance')).status, 200);

console.log('== a discount on one line');
// Given from the customer's invoices once the sale is made (owner, 2026-10-24); a refused one
// leaves the sale as it was made, cancelled here.
const sellGiven = (who, lines) =>
  sellDiscounted(who, who, { partyId: customer.id, warehouseId: wh.id, taxPercent: 0, lines });
const cancelMade = async (r) => {
  if (r.made) ok('cancelled', await owner.post(`/sales/invoices/${r.made.id}/cancel`, {}));
};
const disc = ok(
  'accountant: 10% off a line',
  await sellGiven(acc, [{ productId: item.id, quantity: 2, unitPrice: 1000, discount: 200 }]),
);
eq(
  'line after its discount',
  [disc.lines[0].discount, disc.lines[0].lineTotal, disc.grandTotal],
  [200, 1800, 1800],
);
let refused = await sellGiven(acc, [
  { productId: item.id, quantity: 1, unitPrice: 1000, discount: 1001 },
]);
eq('more than the line refused', refused.data?.code, 'bad_price');
await cancelMade(refused);
refused = await sellGiven(acc, [{ productId: item.id, quantity: 1, unitPrice: 1000, discount: 500 }]);
eq("a discount still can't go below cost", refused.data?.code, 'below_cost');
await cancelMade(refused);
const noDisc = await sellGiven(seller, [
  { productId: item.id, quantity: 1, unitPrice: 1000, discount: 100 },
]);
if (seller.user.permissions.includes('sales:discount_line'))
  check('sales has item discounts by role', noDisc.status === 200);
else eq('without the item-discount permission', noDisc.status, 403);
await cancelMade(noDisc);
ok(
  'owner lets the seller discount items',
  await owner.put(`/staff/${sellerP.staff.id}/permissions`, { granted: ['sales:discount_line'] }),
);
seller = await login(sellerP.email, PASS);
const perPiece = ok(
  'seller: 0.50 per piece on 4, at the list price',
  await sellGiven(seller, [{ productId: item.id, quantity: 4, unitPrice: 1000, discount: 4 * 50 }]),
);
eq('no price-change permission needed', perPiece.lines[0].lineTotal, 3800);
eq(
  'the price itself still locked',
  (await sell(seller, [{ productId: item.id, quantity: 1, unitPrice: 900 }])).data?.code,
  'price_not_allowed',
);

// The selling markups on cost would tell what items cost (owner, 2026-10-24).
console.log('== markups only for whoever sets prices or sees costs');
{
  const set = ok('the owner sees them', await owner.get('/settings'));
  check('…as set', set.defaultMarkupPercent > 0, set);
  const theirs = ok('a seller reads the settings', await karim.get('/settings'));
  eq('…without the markups', [theirs.defaultMarkupPercent, theirs.minMarkupPercent], [0, 0]);
  eq('…the rest as they are', [theirs.currency, theirs.defaultTaxPercent], [set.currency, set.defaultTaxPercent]);
}

process.exit(summary('costs') ? 1 : 0);
