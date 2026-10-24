// Price quotations (عروض الأسعار) and sales performance: a quotation is priced like an invoice but
// moves nothing; turning it into an invoice keeps its approved prices while it's valid, checks stock
// and closes it (once, even when two people try at once); cancelling; permissions; and performance
// by person and branch. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES: can quote and sell, can't change prices
const sara = await login('sara@skb.local'); // INVENTORY
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === karim.user.branchId,
);
const settings = (await owner.get('/settings')).data;
const tax = settings.defaultTaxPercent;
const taxCharge = tax > 0 ? [{ kind: 'TAX', percent: tax }] : [];

const cust = ok(
  'customer',
  await owner.post('/parties', { name: `QCust ${tag}`, types: ['CUSTOMER'] }),
);
const supp = ok(
  'supplier',
  await owner.post('/parties', { name: `QSupp ${tag}`, types: ['SUPPLIER'] }),
);
const mk = async (n) =>
  ok(
    `item ${n}`,
    await owner.post('/products', {
      name: `${n} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
    }),
  );
const a = await mk('QA'),
  b = await mk('QB');
ok(
  'stock: 20 of each',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: a.id, quantity: 20, unitCost: 1000 },
      { productId: b.id, quantity: 20, unitCost: 1000 },
    ],
  }),
);
const today = companyToday();
const stock = async (p) => (await owner.get(`/products/${p.id}`)).data.stockOnHand;
const balance = async () => (await owner.get(`/parties/${cust.id}`)).data.balance;
const Q = (who, body) =>
  who.post('/sales/quotations', {
    partyId: cust.id,
    warehouseId: wh.id,
    charges: taxCharge,
    ...body,
  });

console.log('== permissions');
eq(
  "store staff can't quote",
  (await Q(sara, { lines: [{ productId: a.id, quantity: 1, unitPrice: 2000 }] })).status,
  403,
);
eq(
  'a quotation keeps the price rules',
  (await Q(karim, { lines: [{ productId: a.id, quantity: 1, unitPrice: 1900 }] })).data?.code,
  'price_not_allowed',
);
// Discounts are given only on the customer's invoices (owner, 2026-10-24), not on a quotation.
eq(
  '… and has no discount',
  (
    await Q(owner, {
      lines: [{ productId: a.id, quantity: 1, unitPrice: 2000 }],
      charges: [{ kind: 'DISCOUNT', percent: 5 }, ...taxCharge],
    })
  ).data?.code,
  'discount_on_customer_invoices',
);

console.log('== a quotation moves nothing');
const [stockA, stockB, bal0] = [await stock(a), await stock(b), await balance()];
const q1 = ok(
  'owner quotes a special price',
  await Q(owner, {
    lines: [
      { productId: a.id, quantity: 5, unitPrice: 1800 },
      { productId: b.id, quantity: 2, unitPrice: 2000 },
    ],
    notes: 'valid two weeks',
  }),
);
eq(
  'a quotation, open',
  [q1.type, q1.status, q1.number.startsWith('QT-')],
  ['QUOTATION', 'PENDING', true],
);
const days = Math.round((new Date(q1.dueDate) - Date.now()) / 86400000);
check('valid for two weeks', days >= 13 && days <= 14, q1.dueDate);
eq('priced like an invoice', q1.subtotal, 5 * 1800 + 2 * 2000);
eq('no discount', q1.discountTotal, 0);
eq('no stock moved', [await stock(a), await stock(b)], [stockA, stockB]);
eq('no balance changed', await balance(), bal0);
eq('nothing paid', q1.paidAmount, 0);
const big = ok(
  'a quotation may promise more than is in stock',
  await Q(karim, { lines: [{ productId: a.id, quantity: 500, unitPrice: 2000 }] }),
);
const lists = ok(
  'quotations list',
  await owner.get(`/sales/quotations?search=${encodeURIComponent(tag)}`),
);
check(
  'listed',
  lists.items.some((d) => d.id === q1.id),
);
const inv = ok(
  'invoices list',
  await owner.get(`/sales/invoices?search=${encodeURIComponent(tag)}`),
);
check('not among invoices', !inv.items.some((d) => d.id === q1.id));
const dash = ok('dashboard', await owner.get('/dashboard'));
check('not among recent documents', !dash.recentDocuments.some((d) => d.type === 'QUOTATION'));

console.log('== it becomes an invoice');
const box = ok(
  'cash box',
  await owner.post('/money-accounts', {
    branchId: karim.user.branchId,
    name: `QBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 0,
  }),
);
const inv1 = ok(
  "sales staff turn the owner's quotation into an invoice (its prices hold)",
  await karim.post(`/sales/quotations/${q1.id}/convert`, {
    paidAmount: 1000,
    paidAccountId: box.id,
  }),
);
eq(
  'an invoice with the same lines and prices',
  [inv1.type, inv1.lines.map((l) => [l.productId, l.unitQuantity, l.unitPrice])],
  ['SALES_INVOICE', q1.lines.map((l) => [l.productId, l.unitQuantity, l.unitPrice])],
);
eq(
  'same totals',
  [inv1.subtotal, inv1.discountTotal, inv1.grandTotal],
  [q1.subtotal, q1.discountTotal, q1.grandTotal],
);
eq('from the quotation', inv1.sourceNumber, q1.number);
eq('paid now', inv1.paidAmount, 1000);
eq('stock left', [await stock(a), await stock(b)], [stockA - 5, stockB - 2]);
eq('the customer owes the rest', (await balance()) - bal0, inv1.grandTotal - 1000);
const q1b = ok('the quotation', await owner.get(`/sales/quotations/${q1.id}`));
eq('closed, naming its invoice', [q1b.status, q1b.invoiceNumber], ['CONFIRMED', inv1.number]);
eq(
  'only once',
  (await owner.post(`/sales/quotations/${q1.id}/convert`, {})).data?.code,
  'quote_closed',
);
eq(
  'stock is checked when it becomes an invoice',
  (await owner.post(`/sales/quotations/${big.id}/convert`, {})).data?.code,
  'insufficient_stock',
);
eq('… and it stays open', (await owner.get(`/sales/quotations/${big.id}`)).data?.status, 'PENDING');

const q2 = ok(
  'another quotation',
  await Q(karim, { lines: [{ productId: a.id, quantity: 1, unitPrice: 2000 }] }),
);
const race = await Promise.all([
  owner.post(`/sales/quotations/${q2.id}/convert`, {}),
  mona.post(`/sales/quotations/${q2.id}/convert`, {}),
]);
eq('two at once: one invoice', race.map((r) => r.status).sort(), [201, 400]);
eq('the other told', race.find((r) => r.status === 400)?.data?.code, 'quote_closed');

console.log('== an expired quotation');
const yesterday = addDays(today, -1);
eq(
  "a new quotation can't have run out already",
  (
    await Q(owner, {
      lines: [{ productId: a.id, quantity: 1, unitPrice: 1500 }],
      dueDate: yesterday,
    })
  ).data?.code,
  'bad_valid_until',
);
const old = ok(
  'a quotation at a special price, valid until today',
  await Q(owner, { lines: [{ productId: a.id, quantity: 1, unitPrice: 1500 }], dueDate: today }),
);
eq('valid until today', old.dueDate.slice(0, 10), today);
if (process.env.PGURL) {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.PGURL });
  await db.connect();
  await db.query(
    `update "SalesDocuments" set "DueDate" = now() - interval '1 day' where "Id" = $1`,
    [old.id],
  );
  await db.end();
  eq(
    'once it has run out, its price no longer holds for sales staff',
    (await karim.post(`/sales/quotations/${old.id}/convert`, {})).data?.code,
    'price_not_allowed',
  );
  ok(
    'someone allowed to set prices can still use it',
    await owner.post(`/sales/quotations/${old.id}/convert`, {}),
  );
} else {
  console.log('  (PGURL not set: an expired quotation not checked)');
}

console.log('== cancelling');
eq("store staff can't cancel", (await sara.post(`/sales/quotations/${big.id}/cancel`)).status, 403);
const cancelled = ok('cancel', await karim.post(`/sales/quotations/${big.id}/cancel`));
eq('cancelled', cancelled.status, 'CANCELLED');
eq(
  'not twice',
  (await karim.post(`/sales/quotations/${big.id}/cancel`)).data?.code,
  'quote_closed',
);
eq(
  'no invoice from it',
  (await owner.post(`/sales/quotations/${big.id}/convert`, {})).data?.code,
  'quote_closed',
);
const audit = ok('audited', await owner.get('/audit?resource=quotation'));
check(
  'made, converted and cancelled',
  ['create', 'convert', 'cancel'].every((x) => audit.items.some((e) => e.action === x)),
  audit.items.slice(0, 5),
);

console.log('== sales performance');
eq("sales staff can't see it", (await karim.get('/analytics/performance')).status, 403);
const byRep = ok('by person', await owner.get(`/analytics/performance?from=${today}&to=${today}`));
const byBranch = ok(
  'by branch',
  await owner.get(`/analytics/performance?from=${today}&to=${today}&by=branch`),
);
eq(
  'rows add up',
  byRep.netSales,
  byRep.rows.reduce((s, r) => s + r.netSales, 0),
);
eq('both ways the same', [byBranch.netSales, byBranch.invoices], [byRep.netSales, byRep.invoices]);
const k = byRep.rows.find((r) => r.id === karim.user.id);
check(
  'the invoice karim made counts for karim',
  k && k.invoices >= 1 && k.netSales >= inv1.subtotal - inv1.discountTotal,
  k,
);
check('his quotations counted', k && k.quotes >= 2, k);
const o = byRep.rows.find((r) => r.id === owner.user.id);
check('quotations won counted', o && o.quotesWon >= 1, o);
check(
  'shares add to about 100%',
  // Each share is rounded to 0.1%, so many people today can drift by up to 0.05% each.
  Math.abs(byRep.rows.reduce((s, r) => s + r.share, 0) - 100) <
    Math.max(1, byRep.rows.length * 0.05) || byRep.netSales <= 0,
);
const before = byRep.rows.find((r) => r.id === karim.user.id)?.netSales ?? 0;
ok(
  'a return of 1 piece of that invoice',
  await owner.post(`/sales/invoices/${inv1.id}/returns`, {
    lines: [{ lineId: inv1.lines[1].id, quantity: 1 }],
  }),
);
const after = ok(
  'after the return',
  await owner.get(`/analytics/performance?from=${today}&to=${today}`),
);
check(
  "a return counts against the sale's seller",
  (after.rows.find((r) => r.id === karim.user.id)?.netSales ?? 0) < before,
  after.rows,
);

summary('quotes');
