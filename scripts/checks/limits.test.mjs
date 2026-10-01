// Purchase limits, the walk-in cash customer and the accountant's checkout (owner, 2026-10-02):
// a sale over the customer's limit always waits for the accountant, whoever makes it; a change to a
// posted invoice that crosses the limit is saved but waits too (changed + waiting + its payment state);
// a receipt that brings the customer back within the limit accepts what waits by itself and says so;
// goods come back on an invoice only after Settings → hours; a return typed without the invoice counts
// against the customer's invoice lines; the accountant gives a discount on one invoice or shares one
// over several, and sees a customer's invoices of the day together with what was owed before them;
// selling at the supply price needs costs:view; the cash customer (code 0) is always there.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const acc = await login('mona@skb.local');
const PASS = 'Str0ngPass!';

ok(
  'returns at once while setting up',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId && a.isActive,
);
const cat = (await owner.get('/categories')).data[0];
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `LimSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `Lamp ${tag}`,
    categoryId: cat?.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
  }),
);
ok(
  '40 bought at 6.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 40, unitCost: 600 }],
  }),
);
const customer = async (name, limit) => {
  const c = ok(
    `customer ${name}`,
    await owner.post('/parties', { name: `${name} ${tag}`, types: ['CUSTOMER'], address: 'Cairo' }),
  );
  if (limit != null)
    ok(`limit ${limit}`, await acc.put(`/parties/${c.id}/credit-limit`, { creditLimit: limit }));
  return c;
};
const sale = (who, partyId, quantity, extra = {}) =>
  who.post('/sales/invoices', {
    partyId,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity, unitPrice: 1000 }],
    ...extra,
  });
const receipt = (partyId, amount) =>
  acc.post('/receipts', { partyId, lines: [{ method: 'CASH', accountId: box.id, amount }] });
const balance = async (id) => (await owner.get(`/parties/${id}`)).data.balance;
const stock = async () => (await owner.get(`/products/${item.id}`)).data.stockOnHand;

console.log('== the cash customer, code 0');
const zero = (await owner.get('/parties?code=0')).data.items;
eq('exactly one party has code 0', zero.length, 1);
const walkIn = zero[0];
eq(
  'it is the system cash customer',
  [walkIn?.isSystem, walkIn?.isCashCustomer, walkIn?.types],
  [true, true, ['CUSTOMER']],
);
eq(
  'it can’t be closed',
  (await owner.put(`/parties/${walkIn.id}`, { isActive: false })).data?.code,
  'system_party',
);
eq(
  'it can’t stop paying in full',
  (await owner.put(`/parties/${walkIn.id}`, { isCashCustomer: false })).data?.code,
  'system_party',
);
eq(
  'it stays a customer',
  (await owner.put(`/parties/${walkIn.id}`, { types: ['SUPPLIER'] })).data?.code,
  'system_party',
);
eq('…and is unchanged', (await owner.get(`/parties/${walkIn.id}`)).data.isCashCustomer, true);
eq(
  'a sale to it on credit is refused',
  (await sale(owner, walkIn.id, 1)).data?.code,
  'cash_customer_must_pay',
);
ok(
  'paid in full it is sold',
  await sale(owner, walkIn.id, 1, { paidAmount: 1000, paidAccountId: box.id }),
);

console.log('== over the limit: everyone waits for the accountant');
const c1 = await customer('Lim1', 1500);
ok('10.00 on credit fits', await sale(owner, c1.id, 1));
const before = await stock();
const waits = ok('another 10.00 by the owner waits', await sale(owner, c1.id, 1));
eq(
  'a pending invoice marked over the limit',
  [waits.type, waits.status, waits.overLimit],
  ['SALES_ORDER', 'PENDING', true],
);
eq('nothing posted: balance', await balance(c1.id), 1000);
eq('nothing posted: stock', await stock(), before);
const listed = (
  await acc.get(`/sales/invoices?search=${encodeURIComponent(c1.name)}&state=AWAITING`)
).data;
check(
  'the sales list shows it awaiting',
  listed.items.some((d) => d.id === waits.id && d.state === 'AWAITING' && d.overLimit),
);

console.log('== a payment that doesn’t bring them within keeps it waiting');
ok('2.00 received', await receipt(c1.id, 200));
eq('still waiting', (await acc.get(`/sales/orders/${waits.id}`)).data.status, 'PENDING');

console.log('== a payment that brings them within accepts it by itself');
const r2 = ok('5.00 more received', await receipt(c1.id, 500));
const after = (await acc.get(`/sales/orders/${waits.id}`)).data;
eq('the pending one is closed', after.status, 'CONFIRMED');
check('…it became an invoice', !!after.invoiceId, after);
const autoInvoice = (await acc.get(`/sales/invoices/${after.invoiceId}`)).data;
eq(
  'posted on the account, says why',
  [autoInvoice.type, autoInvoice.overLimit, autoInvoice.approvalNote],
  ['SALES_INVOICE', false, `AUTO:${r2.number}`],
);
eq('the balance has it: 10 − 7 + 10', await balance(c1.id), 1300);
eq('its goods left', await stock(), before - 1);
const log = (await owner.get(`/audit?action=auto_approve&resource=sales_order`)).data;
check(
  'the activity log records the system accepting it',
  (log.items ?? log).some?.((x) => x.resourceId === waits.id),
  log,
);

console.log('== oldest first, only what fits');
const c2 = await customer('Lim2', 2000);
ok('20.00 fits', await sale(owner, c2.id, 2));
const w1 = ok('10.00 waits', await sale(owner, c2.id, 1));
const w2 = ok('10.00 more waits', await sale(owner, c2.id, 1));
ok('10.00 received: room for one', await receipt(c2.id, 1000));
eq('the older one is accepted', (await acc.get(`/sales/orders/${w1.id}`)).data.status, 'CONFIRMED');
eq('the newer one still waits', (await acc.get(`/sales/orders/${w2.id}`)).data.status, 'PENDING');
ok('…turned down', await acc.post(`/sales/orders/${w2.id}/reject`, { reason: 'later' }));

console.log('== a change that crosses the limit: saved, and waits');
const c3 = await customer('Lim3', 2500);
const inv = ok('20.00 fits', await sale(owner, c3.id, 2));
const changed = ok(
  'changed to 3 (30.00): saved',
  await owner.put(`/sales/invoices/${inv.id}`, {
    partyId: c3.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 3, unitPrice: 1000 }],
  }),
);
eq(
  'posted, same number, waits',
  [changed.type, changed.number, changed.overLimit],
  ['SALES_INVOICE', inv.number, true],
);
const changedNow = (await acc.get(`/sales/invoices/${inv.id}`)).data;
eq('shown as changed and waiting', [changedNow.edited, changedNow.overLimit], [true, true]);
eq('the balance has the change', await balance(c3.id), 3000);
const row = (
  await acc.get(`/sales/invoices?search=${encodeURIComponent(c3.name)}&state=AWAITING`)
).data.items.find((d) => d.id === inv.id);
eq(
  'listed as awaiting, edited and on credit',
  [row?.overLimit, row?.edited, row?.state],
  [true, true, 'CREDIT'],
);
const karim = await login('karim@skb.local');
eq(
  'a seller can’t accept it',
  (await karim.post(`/sales/invoices/${inv.id}/approve-limit`)).status,
  403,
);
const accepted = ok(
  'the accountant accepts it',
  await acc.post(`/sales/invoices/${inv.id}/approve-limit`),
);
eq(
  'no longer waiting, says who',
  [accepted.overLimit, accepted.approvalNote?.startsWith('BY:')],
  [false, true],
);
eq(
  'not twice',
  (await acc.post(`/sales/invoices/${inv.id}/approve-limit`)).data?.code,
  'not_awaiting',
);

const inv2 = ok('another invoice crossing it', await sale(owner, c3.id, 1, { paidAmount: 0 })).id;
// (c3 owes 30 of 25: a new sale waits; turn it down and make one inside the limit instead)
const c4 = await customer('Lim4', 1500);
const base4 = ok('10.00 fits', await sale(owner, c4.id, 1));
ok(
  'changed to 2: waits',
  await owner.put(`/sales/invoices/${base4.id}`, {
    partyId: c4.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }],
  }),
);
eq(
  'a reason is needed to turn it down',
  (await acc.post(`/sales/invoices/${base4.id}/reject-limit`, {})).data?.code,
  'reason_required',
);
const turned = ok(
  'turned down',
  await acc.post(`/sales/invoices/${base4.id}/reject-limit`, { reason: 'too much' }),
);
eq(
  'it is cancelled with the reason',
  [turned.status, turned.cancelReason],
  ['CANCELLED', 'too much'],
);
eq('nothing is owed on it', await balance(c4.id), 0);
check(
  'the over-limit sale on c3 waits',
  (await acc.get(`/sales/orders/${inv2}`)).data?.type === 'SALES_ORDER',
);

const c5 = await customer('Lim5', 1500);
const base5 = ok('10.00 fits', await sale(owner, c5.id, 1));
ok(
  'changed to 2: waits',
  await owner.put(`/sales/invoices/${base5.id}`, {
    partyId: c5.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }],
  }),
);
const r5 = ok('5.00 received', await receipt(c5.id, 500));
const released = (await acc.get(`/sales/invoices/${base5.id}`)).data;
eq(
  'a payment within the limit releases it',
  [released.overLimit, released.approvalNote],
  [false, `AUTO:${r5.number}`],
);

console.log('== goods come back only after Settings → hours');
ok('12 hours', await owner.put('/settings', { returnAfterHours: 12 }));
eq('shown in Settings', (await owner.get('/settings')).data.returnAfterHours, 12);
const fresh = ok(
  'a new invoice',
  await sale(owner, walkIn.id, 2, { paidAmount: 2000, paidAccountId: box.id }),
);
const tooSoon = await owner.post(`/sales/invoices/${fresh.id}/returns`, {
  lines: [{ lineId: fresh.lines[0].id, quantity: 1 }],
});
eq('a return now is refused', tooSoon.data?.code, 'return_too_soon');
check('…saying from when', !!tooSoon.data?.from, tooSoon.data);
ok('0 hours', await owner.put('/settings', { returnAfterHours: 0 }));
ok(
  'then it is allowed',
  await owner.post(`/sales/invoices/${fresh.id}/returns`, {
    lines: [{ lineId: fresh.lines[0].id, quantity: 1 }],
  }),
);

console.log('== a return without the invoice counts against it');
const c6 = await customer('Lim6', null);
const bought = ok('3 bought on an invoice', await sale(owner, c6.id, 3));
ok(
  '2 come back without the invoice',
  await owner.post('/sales/returns', {
    partyId: c6.id,
    warehouseId: wh.id,
    lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }],
  }),
);
eq(
  'the invoice shows 2 returned',
  (await owner.get(`/sales/invoices/${bought.id}`)).data.lines[0].returnedQuantity,
  2,
);
eq(
  '2 more on the invoice are refused',
  (
    await owner.post(`/sales/invoices/${bought.id}/returns`, {
      lines: [{ lineId: bought.lines[0].id, quantity: 2 }],
    })
  ).data?.code,
  'exceeds_returnable',
);
const last = ok(
  'the last one is allowed',
  await owner.post(`/sales/invoices/${bought.id}/returns`, {
    lines: [{ lineId: bought.lines[0].id, quantity: 1 }],
  }),
);
eq('…at its own share of the line', last.grandTotal, 1000);
ok(
  'a fourth without the invoice still goes on the account',
  await owner.post('/sales/returns', {
    partyId: c6.id,
    warehouseId: wh.id,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
  }),
);

console.log('== the accountant’s discounts and the customer’s invoices together');
const c7 = await customer('Lim7', null);
const a1 = ok('invoice 1: 20.00', await sale(owner, c7.id, 2));
const a2 = ok('invoice 2: 30.00', await sale(owner, c7.id, 3));
const together = ok('their invoices today', await acc.get(`/sales/customers/${c7.id}/invoices`));
eq(
  'both, oldest first',
  together.invoices.map((d) => d.id),
  [a1.id, a2.id],
);
eq(
  'owed before them, and on them',
  [together.previousBalance, together.onThese, together.balance],
  [0, 5000, 5000],
);
eq(
  'a seller without the discount permission can’t',
  (await karim.post(`/sales/invoices/${a1.id}/discount`, { percent: 10 })).status,
  403,
);
const d1 = ok(
  '10% off invoice 1',
  await acc.post(`/sales/invoices/${a1.id}/discount`, { percent: 10 }),
);
eq('it comes to 18.00, same number', [d1.grandTotal, d1.number], [1800, a1.number]);
eq('the balance follows', await balance(c7.id), 4800);
const shared = ok(
  '5.00 off both together',
  await acc.post('/sales/invoices/discount-all', { invoiceIds: [a1.id, a2.id], amount: 500 }),
);
eq(
  'shared by what each comes to',
  shared.map((d) => d.grandTotal),
  [1800 - 188, 3000 - 312],
);
eq('…exactly 5.00 in all', await balance(c7.id), 4300);
eq(
  'each keeps its own discount first',
  shared[0].charges.map((c) => c.kind),
  ['DISCOUNT', 'EXTRA_DISCOUNT'],
);
ok(
  '10% off both instead',
  await acc.post('/sales/invoices/discount-all', { invoiceIds: [a1.id, a2.id], percent: 10 }),
);
eq('…replaces the shared amount', await balance(c7.id), Math.round(1800 * 0.9) + 2700);
const other = await customer('Lim8', null);
const b1 = ok('another customer’s invoice', await sale(owner, other.id, 1));
eq(
  'one customer at a time',
  (await acc.post('/sales/invoices/discount-all', { invoiceIds: [a1.id, b1.id], percent: 5 })).data
    ?.code,
  'not_one_customer',
);
eq(
  'more than the invoices is refused',
  (await acc.post('/sales/invoices/discount-all', { invoiceIds: [a1.id], amount: 999999 })).data
    ?.code,
  'charge_too_big',
);
ok('the discount removed', await acc.post(`/sales/invoices/${a1.id}/discount`, {}));
const pend = ok('a pending one', await sale(owner, (await customer('Lim9', 500)).id, 1));
eq('it is pending', pend.type, 'SALES_ORDER');
const pd = ok(
  'a discount on a pending one',
  await acc.post(`/sales/orders/${pend.id}/discount`, { amount: 100 }),
);
eq(
  'it stays pending, same number, 9.00',
  [pd.type, pd.number, pd.grandTotal, pd.overLimit],
  ['SALES_ORDER', pend.number, 900, true],
);

console.log('== selling at the supply price needs costs:view');
const seller = ok(
  'a seller',
  await owner.post('/staff', {
    fullName: `Basis ${tag}`,
    email: `basis.${tag}@skb.local`,
    password: PASS,
    role: 'SALES',
    branchId: owner.user.branchId,
  }),
);
ok(
  'may choose the price basis',
  await owner.put(`/staff/${seller.id}/permissions`, { granted: ['sales:price_basis'] }),
);
const sp = await login(`basis.${tag}@skb.local`, PASS);
const asked = (basis) =>
  sp.post('/pricing/sale', {
    partyId: c7.id,
    warehouseId: wh.id,
    lines: [{ productId: item.id, quantity: 1, priceBasis: basis }],
  });
eq('the last price is fine', (await asked('LAST')).status, 200);
eq('the supply price is refused', (await asked('COST')).data?.code, 'cost_basis_not_allowed');
eq(
  '…and on an invoice',
  (
    await sp.post('/sales/invoices', {
      partyId: c7.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: item.id, quantity: 1, unitPrice: 600, priceBasis: 'COST' }],
    })
  ).data?.code,
  'cost_basis_not_allowed',
);

process.exit(summary('limits') ? 1 : 0);
