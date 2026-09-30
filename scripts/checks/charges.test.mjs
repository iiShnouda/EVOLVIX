// Invoice charges (DOMAIN.md step 4): discounts, taxes and additions in order, bonus lines, the
// sales rep, their permissions, exact returns, purchase discounts in the average cost. Runs against BASE.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const levels = (await owner.get('/price-levels')).data;
const cust = levels.find((l) => l.side === 'SALE' && l.isDefault);
const parties = (await owner.get('/parties?pageSize=100')).data.items;
const c1 = parties.find((p) => p.types.includes('CUSTOMER'));
const supplier = parties.find((p) => p.types.includes('SUPPLIER'));
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const settings = (await owner.get('/settings')).data;
const staff = (await owner.get('/staff')).data;
const monaId = staff.find((s) => s.email === 'mona@skb.local').id;

// Three fresh items: A and B at cost 5.00 and 10.00, C given away as bonus.
const make = async (name, price) =>
  ok(`item ${name}`, await owner.post('/products', {
    name: `${name} ${tag}`, categoryId: cat.id, units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: cust.id, price }],
  }));
const A = await make('ChargeA', 1000), B = await make('ChargeB', 2000), C = await make('ChargeC', 300);
ok('stock in', await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0,
  lines: [{ productId: A.id, quantity: 100, unitCost: 500 }, { productId: B.id, quantity: 100, unitCost: 1000 },
    { productId: C.id, quantity: 100, unitCost: 200 }],
}));

console.log('== the charge chain');
const lines = [
  { productId: A.id, quantity: 10, unitPrice: 1000 },
  { productId: B.id, quantity: 5, unitPrice: 2000, discount: 500 },
  { productId: C.id, quantity: 2, unitPrice: 0, isBonus: true },
];
const charges = [
  { kind: 'DISCOUNT', percent: 10 },
  { kind: 'EXTRA_DISCOUNT', amount: 1000 },
  { kind: 'TAX', percent: 14 },
  { kind: 'ADDITION', amount: 5000, label: 'Delivery' },
];
const sale = (who, body) => who.post('/sales/invoices', { partyId: c1.id, warehouseId: wh.id, ...body });
const balBefore = (await owner.get(`/parties/${c1.id}`)).data.balance;
const inv = ok('sale with discounts, VAT, delivery fee and a bonus line', await sale(owner, { lines, charges, repId: monaId }));
eq('charge amounts', inv.charges.map((c) => [c.kind, c.amount]), [['DISCOUNT', 1950], ['EXTRA_DISCOUNT', 1000], ['TAX', 2317], ['ADDITION', 5000]]);
eq('rates kept', inv.charges.map((c) => c.rate), [10, null, 14, null]);
eq('totals', [inv.subtotal, inv.discountTotal, inv.taxTotal, inv.additionTotal, inv.grandTotal], [20000, 3450, 2317, 5000, 23867]);
eq('discount shared over paid lines', inv.lines.map((l) => l.docDiscount), [1513, 1437, 0]);
eq('bonus line flagged', inv.lines.map((l) => l.isBonus), [false, false, true]);
eq('profit = net − cost (tax, fee excluded)', inv.profitTotal, 16550 - (5000 + 5000 + 400));
eq('line profits add up', inv.lines.reduce((s, l) => s + l.lineProfit, 0), inv.profitTotal);
eq('rep on invoice', inv.repName, 'Mona Accountant');
eq('customer owes grand total', (await owner.get(`/parties/${c1.id}`)).data.balance - balBefore, 23867);
eq('bonus left stock', (await owner.get(`/products/${C.id}`)).data.stockOnHand, 98);
const detail = ok('read back', await owner.get(`/sales/invoices/${inv.id}`));
eq('detail keeps charges', detail.charges.length, 4);

console.log('== permissions');
const plain = { lines: [{ productId: A.id, quantity: 1, unitPrice: 1000 }] };
eq('sales: no discount', (await sale(karim, { ...plain, charges: [{ kind: 'DISCOUNT', percent: 5 }] })).data?.code, 'discount_not_allowed');
eq('sales: no delivery fee', (await sale(karim, { ...plain, charges: [{ kind: 'ADDITION', amount: 100 }] })).data?.code, 'additions_not_allowed');
eq('sales: no other tax rate', (await sale(karim, { ...plain, charges: [{ kind: 'TAX', percent: settings.defaultTaxPercent + 5 }] })).data?.code, 'tax_not_allowed');
eq('sales: no old-style tax change', (await sale(karim, { ...plain, taxPercent: settings.defaultTaxPercent + 5 })).data?.code, 'tax_not_allowed');
eq('sales: no bonus', (await sale(karim, { lines: [...plain.lines, { productId: C.id, quantity: 1, unitPrice: 0, isBonus: true }] })).data?.code, 'bonus_not_allowed');
const ks = ok('sales: plain sale with the company tax', await sale(karim, { ...plain, taxPercent: settings.defaultTaxPercent }));
eq('company tax applied', ks.taxTotal, Math.round(1000 * settings.defaultTaxPercent / 100));
ok('sales can list reps', await karim.get('/sales/reps'));
const ms = ok('accountant may give discounts', await sale(mona, { ...plain, charges: [{ kind: 'DISCOUNT', percent: 5 }] }));

console.log('== validation');
const bad = async (name, body, code) => eq(name, (await sale(owner, { ...plain, ...body })).data?.code, code);
await bad('unknown kind', { charges: [{ kind: 'TIP', amount: 1 }] }, 'bad_charge');
await bad('percent and amount', { charges: [{ kind: 'DISCOUNT', percent: 5, amount: 5 }] }, 'bad_charge');
await bad('neither', { charges: [{ kind: 'DISCOUNT' }] }, 'bad_charge');
await bad('percent over 100', { charges: [{ kind: 'TAX', percent: 101 }] }, 'bad_charge');
await bad('three decimals', { charges: [{ kind: 'DISCOUNT', percent: 1.234 }] }, 'bad_charge');
await bad('discount larger than invoice', { charges: [{ kind: 'DISCOUNT', amount: 1001 }] }, 'discount_too_big');
await bad('discount on bonus only', { lines: [{ productId: C.id, quantity: 1, unitPrice: 0, isBonus: true }], charges: [{ kind: 'DISCOUNT', amount: 1 }] }, 'discount_too_big');
await bad('priced bonus', { lines: [{ productId: C.id, quantity: 1, unitPrice: 5, isBonus: true }] }, 'bad_bonus');
await bad('unknown rep', { repId: '00000000-0000-0000-0000-000000000001' }, 'rep_not_found');
await bad('invoice discount below cost', { charges: [{ kind: 'DISCOUNT', percent: 60 }] }, 'below_cost');
const old = ok('old client: taxPercent only', await sale(owner, { ...plain, taxPercent: 14 }));
eq('old client tax becomes a charge', [old.charges.map((c) => c.kind), old.taxTotal], [['TAX'], 140]);

console.log('== returns take back discounts and tax exactly, not the fee');
const [la, lb, lc] = inv.lines;
const r1 = ok('return 3 of A', await owner.post(`/sales/invoices/${inv.id}/returns`, { lines: [{ lineId: la.id, quantity: 3 }] }));
eq('A share of invoice discount', r1.lines[0].docDiscount, Math.round(1513 * 3 / 10));
eq('return discount total', r1.discountTotal, Math.round(1513 * 3 / 10));
eq('return tax share', r1.taxTotal, Math.round(2317 * (3000 - 454) / 16550));
eq('return has no delivery fee', r1.additionTotal, 0);
const r2 = ok('return the rest', await owner.post(`/sales/invoices/${inv.id}/returns`, {
  lines: [{ lineId: la.id, quantity: 7 }, { lineId: lb.id, quantity: 5 }, { lineId: lc.id, quantity: 2 }],
}));
eq('discounts back exactly', r1.discountTotal + r2.discountTotal, 3450);
eq('tax back exactly', r1.taxTotal + r2.taxTotal, 2317);
eq('grand back = invoice − fee', r1.grandTotal + r2.grandTotal, 23867 - 5000);
eq('profit reversed exactly', r1.profitTotal + r2.profitTotal, inv.profitTotal);
eq('bonus came back into stock', (await owner.get(`/products/${C.id}`)).data.stockOnHand, 100);
eq('customer left owing the fee (+ the other sales)', (await owner.get(`/parties/${c1.id}`)).data.balance - balBefore, 5000 + ks.grandTotal + ms.grandTotal + old.grandTotal);
eq('returns keep the rep', [r1.repName, r2.repName], ['Mona Accountant', 'Mona Accountant']);

console.log('== purchases: supplier discount lowers the cost, bonus lowers the average');
const D = await make('ChargeD', 5000);
const pur = ok('buy 10 @ 1.00 − 10% + 2 free', await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id,
  lines: [{ productId: D.id, quantity: 10, unitCost: 100 }, { productId: D.id, quantity: 2, unitCost: 0, isBonus: true }],
  charges: [{ kind: 'DISCOUNT', percent: 10 }, { kind: 'TAX', percent: 14 }, { kind: 'ADDITION', amount: 300, label: 'Freight' }],
}));
eq('purchase totals', [pur.subtotal, pur.discountTotal, pur.taxTotal, pur.additionTotal, pur.grandTotal], [1000, 100, 126, 300, 1326]);
eq('goods cost after discount', pur.costTotal, 900);
eq('average = 900 / 12', (await owner.get(`/products/${D.id}`)).data.costPrice, 75);
const pr1 = ok('return the free goods', await owner.post(`/purchases/invoices/${pur.id}/returns`, { lines: [{ lineId: pur.lines[1].id, quantity: 2 }] }));
eq('free goods return costs nothing', [pr1.costTotal, pr1.grandTotal], [0, 0]);
eq('average back to 90', (await owner.get(`/products/${D.id}`)).data.costPrice, 90);
const pr2 = ok('return 5 bought', await owner.post(`/purchases/invoices/${pur.id}/returns`, { lines: [{ lineId: pur.lines[0].id, quantity: 5 }] }));
eq('cost backed out at the discounted price', pr2.costTotal, 450);
eq('money back: net + tax share', pr2.grandTotal, 450 + Math.round(126 * 450 / 900));
eq('inventory: sara may enter supplier discount', (await (await login('sara@skb.local')).post('/purchases/invoices', {
  partyId: supplier.id, lines: [{ productId: D.id, quantity: 1, unitCost: 100 }], charges: [{ kind: 'DISCOUNT', amount: 10 }],
})).status, 201);
eq('sales cannot enter purchases anyway', (await karim.post('/purchases/invoices', { partyId: supplier.id, lines: [] })).status, 403);

console.log('== reports');
const today = companyToday();
const byRep = ok('profit by rep', await owner.get(`/reports/profitability?from=${today}&to=${today}&by=rep`));
const monaRow = byRep.rows.find((r) => r.key === monaId);
check('rep row nets to zero after full return', monaRow && monaRow.revenue === 0 && monaRow.profit === 0, byRep.rows);
const byProduct = ok('profit by product', await owner.get(`/reports/profitability?from=${today}&to=${today}&by=product`));
const byCustomer = ok('profit by customer', await owner.get(`/reports/profitability?from=${today}&to=${today}&by=customer`));
eq('product revenue ties to customer revenue', byProduct.rows.reduce((s, r) => s + r.revenue, 0), byCustomer.rows.reduce((s, r) => s + r.revenue, 0));
eq('product profit ties to customer profit', byProduct.rows.reduce((s, r) => s + r.profit, 0), byCustomer.rows.reduce((s, r) => s + r.profit, 0));

process.exit(summary('charges') ? 1 : 0);
