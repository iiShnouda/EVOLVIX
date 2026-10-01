// Owner decisions 2026-10-01: a posted sales invoice can be changed (sales:edit) or cancelled
// (sales:cancel), reversing what it moved; a sale may be priced at the customer's last price or at
// cost (sales:price_basis); the shipping company and address come from the customer's file
// (sales:change_shipping to change them); a cash customer pays every invoice in full; each sale
// names its department (Settings); the serial number's prefix and start are set in Settings; the
// list has one payment state (credit, collecting, partly paid, paid, cancelled). Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local');
const PASS = 'Str0ngPass!';
const acc = ok(
  'an accountant',
  await owner.post('/staff', {
    fullName: `Inv Acc ${tag}`,
    email: `invacc.${tag}@skb.local`,
    password: PASS,
    role: 'ACCOUNTANT',
    branchId: owner.user.branchId,
  }),
);
const accountant = await login(`invacc.${tag}@skb.local`, PASS);
for (const p of ['sales:edit', 'sales:cancel', 'sales:price_basis', 'sales:change_shipping', 'parties:cash_customer'])
  check(`accountant has ${p}`, accountant.user.permissions.includes(p));
check('a seller does not change posted invoices', !karim.user.permissions.includes('sales:edit'));
check('…nor cancel them', !karim.user.permissions.includes('sales:cancel'));

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const cat = ok('a category', await owner.post('/categories', { name: `InvCat ${tag}` }));
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `InvItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
const supplier = ok('a supplier', await owner.post('/parties', { name: `InvSup ${tag}`, types: ['SUPPLIER'] }));
ok(
  'bought 50 at 5.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 50, unitCost: 500 }],
  }),
);
const customer = ok('a customer', await owner.post('/parties', { name: `InvCust ${tag}`, types: ['CUSTOMER'] }));
const cash = (await accountant.get('/money-accounts')).data.find((m) => m.kind === 'CASH_BOX' && m.isDefault)
  ?? (await accountant.get('/money-accounts')).data.find((m) => m.kind === 'CASH_BOX');
const stock = async () => (await owner.get(`/products/${item.id}`)).data.stockOnHand;
const balance = async (id = customer.id) => (await owner.get(`/parties/${id}`)).data.balance;
const box = async () => (await accountant.get('/money-accounts')).data.find((m) => m.id === cash.id).balance;
const sale = (qty, extra = {}) => ({
  partyId: customer.id,
  warehouseId: wh.id,
  taxPercent: 0,
  lines: [{ productId: item.id, quantity: qty, unitPrice: 1000 }],
  ...extra,
});

console.log('== change a posted invoice');
const box0 = await box();
const inv = ok('sold 2, 10.00 paid now', await accountant.post('/sales/invoices', sale(2, { paidAmount: 1000, paidAccountId: cash.id })));
eq('stock 48', await stock(), 48);
eq('customer owes 10.00', await balance(), 1000);
eq('10.00 in the box', (await box()) - box0, 1000);
eq('a seller may not change it', (await karim.put(`/sales/invoices/${inv.id}`, sale(3))).status, 403);
const changed = ok('changed to 3, nothing paid', await accountant.put(`/sales/invoices/${inv.id}`, sale(3)));
eq('same invoice and number', [changed.id, changed.number], [inv.id, inv.number]);
eq('new total', changed.grandTotal, 3000);
eq('stock 47', await stock(), 47);
eq('customer owes 30.00', await balance(), 3000);
eq('the 10.00 left the box again', (await box()) - box0, 0);
const again = ok('changed again: 1, all paid', await accountant.put(`/sales/invoices/${inv.id}`, sale(1, { paidAmount: 1000, paidAccountId: cash.id })));
eq('paid', again.status, 'PAID');
eq('stock 49', await stock(), 49);
eq('customer owes nothing', await balance(), 0);
eq('10.00 in the box', (await box()) - box0, 1000);
const card = (await owner.get(`/inventory/items/${item.id}/card`)).data;
check(
  'the item card shows the goods coming back',
  JSON.stringify(card ?? '').includes('SALE_CANCELLED'),
);

console.log('== cancel (delete) a posted invoice');
eq('a seller may not cancel it', (await karim.post(`/sales/invoices/${inv.id}/cancel`)).status, 403);
const gone = ok('cancelled', await accountant.post(`/sales/invoices/${inv.id}/cancel`));
eq('kept, as cancelled', [gone.number, gone.status], [inv.number, 'CANCELLED']);
eq('stock back to 50', await stock(), 50);
eq('customer owes nothing', await balance(), 0);
eq('the money went back out', (await box()) - box0, 0);
eq('not twice', (await accountant.post(`/sales/invoices/${inv.id}/cancel`)).data?.code, 'invoice_cancelled');
eq('nor changed', (await accountant.put(`/sales/invoices/${inv.id}`, sale(1))).data?.code, 'invoice_cancelled');
eq('nor returned', (await accountant.post(`/sales/invoices/${inv.id}/returns`, { lines: [] })).status, 400);
const listed = (await accountant.get(`/sales/invoices?search=${inv.number}&state=CANCELLED`)).data;
eq('listed as cancelled', listed.items.map((d) => [d.id, d.state]), [[inv.id, 'CANCELLED']]);

const kept = ok('another sale of 2', await accountant.post('/sales/invoices', sale(2)));
ok(
  'one comes back',
  await accountant.post(`/sales/invoices/${kept.id}/returns`, { lines: [{ lineId: kept.lines[0].id, quantity: 1 }] }),
);
eq('then it can no longer be cancelled', (await accountant.post(`/sales/invoices/${kept.id}/cancel`)).data?.code, 'invoice_has_returns');
eq('…or changed', (await accountant.put(`/sales/invoices/${kept.id}`, sale(2))).data?.code, 'invoice_has_returns');

const paidLater = ok('one paid later by a receipt', await accountant.post('/sales/invoices', sale(1)));
ok(
  'receipt against it',
  await accountant.post('/receipts', {
    partyId: customer.id,
    lines: [{ method: 'CASH', accountId: cash.id, amount: 1000 }],
    allocations: [{ documentId: paidLater.id, amount: 1000 }],
  }),
);
eq('payments taken: not cancelled', (await accountant.post(`/sales/invoices/${paidLater.id}/cancel`)).data?.code, 'invoice_has_payments');

console.log('== list states');
const credit = ok('one on credit', await accountant.post('/sales/invoices', sale(1)));
const partial = ok('one partly paid', await accountant.post('/sales/invoices', sale(2, { paidAmount: 500, paidAccountId: cash.id })));
const stateOf = async (doc) =>
  (await accountant.get(`/sales/invoices?search=${doc.number}`)).data.items.find((d) => d.id === doc.id)?.state;
eq('credit', await stateOf(credit), 'CREDIT');
eq('partly paid', await stateOf(partial), 'PARTIAL');
eq('paid', await stateOf(paidLater), 'PAID');
const onlyPartial = (await accountant.get(`/sales/invoices?search=InvCust ${tag}&state=PARTIAL&pageSize=100`)).data.items;
check('the PARTIAL filter', onlyPartial.length > 0 && onlyPartial.every((d) => d.state === 'PARTIAL'), onlyPartial.map((d) => d.state));
eq(
  'branch filter',
  (await accountant.get(`/sales/invoices?search=${credit.number}&branchId=${owner.user.branchId}`)).data.items.length,
  1,
);
eq(
  'warehouse filter',
  (await accountant.get(`/sales/invoices?search=${credit.number}&warehouseId=00000000-0000-0000-0000-000000000001`)).data.items.length,
  0,
);

console.log('== price basis: selling price, last price or cost');
ok('owner sold it at 13.00', await owner.post('/sales/invoices', sale(1, { lines: [{ productId: item.id, quantity: 1, unitPrice: 1300 }] })));
const ask = (who, basis) =>
  who.post('/pricing/sale', { partyId: customer.id, warehouseId: wh.id, priceBasis: basis, lines: [{ productId: item.id, unitId: piece.id, quantity: 1 }] });
const listP = ok('selling price', await ask(accountant, 'LIST')).lines[0];
eq('10.00, last 13.00', [listP.unitPrice, listP.listPrice, listP.lastPrice], [1000, 1000, 1300]);
eq('last price', ok('at last', await ask(accountant, 'LAST')).lines[0].unitPrice, 1300);
const atCost = ok('at cost', await ask(owner, 'COST')).lines[0];
eq('cost 5.00', [atCost.unitPrice, atCost.unitCost], [500, 500]);
eq('a seller may not ask for it', (await ask(karim, 'LAST')).status, 403);
eq('a seller sees no cost', ok('seller list', await ask(karim, 'LIST')).lines[0].unitCost ?? null, null);
ok(
  'sold at the last price',
  await accountant.post('/sales/invoices', sale(1, { priceBasis: 'LAST', lines: [{ productId: item.id, quantity: 1, unitPrice: 1300 }] })),
);
eq('a seller may not sell on it', (await karim.post('/sales/invoices', sale(1, { priceBasis: 'LAST', lines: [{ productId: item.id, quantity: 1, unitPrice: 1300 }] }))).status, 403);
eq('unknown basis', (await accountant.post('/sales/invoices', sale(1, { priceBasis: 'X' }))).data?.code, 'bad_price_basis');

console.log('== shipping from the customer file');
const carrier = ok('a shipping company', await owner.post('/parties', { name: `InvShip ${tag}`, types: ['CARRIER'] }));
const other = ok('another one', await owner.post('/parties', { name: `InvShip2 ${tag}`, types: ['CARRIER'] }));
const shipped = ok(
  'customer ships with it',
  await owner.put(`/parties/${customer.id}`, { defaultCarrierId: carrier.id, shippingAddress: '5 Nile St' }),
);
eq('kept on the customer', shipped.defaultCarrierId, carrier.id);
const viaCarrier = ok(
  'a seller ships without naming the company',
  await karim.post('/sales/invoices', sale(1, { deliveryMethod: 'SHIPPING_COMPANY' })),
);
eq('the customer’s company and address', [viaCarrier.carrierId, viaCarrier.deliveryAddress], [carrier.id, '5 Nile St']);
eq(
  'a seller may not pick another company',
  (await karim.post('/sales/invoices', sale(1, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: other.id }))).data?.code,
  'shipping_not_allowed',
);
eq(
  '…or another address',
  (await karim.post('/sales/invoices', sale(1, { deliveryMethod: 'SHIPPING_COMPANY', deliveryAddress: 'Elsewhere' }))).data?.code,
  'shipping_not_allowed',
);
ok(
  'the accountant may',
  await accountant.post('/sales/invoices', sale(1, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: other.id, deliveryAddress: 'Elsewhere' })),
);
eq('not a shipping company', (await owner.put(`/parties/${customer.id}`, { defaultCarrierId: supplier.id })).data?.code, 'carrier_not_found');

console.log('== cash customer');
const walkIn = ok('a walk-in customer', await owner.post('/parties', { name: `InvCash ${tag}`, types: ['CUSTOMER'] }));
eq('a seller may not mark it', (await karim.put(`/parties/${walkIn.id}`, { isCashCustomer: true })).status, 403);
eq('the accountant marks it', ok('marked', await accountant.put(`/parties/${walkIn.id}`, { isCashCustomer: true })).isCashCustomer, true);
eq(
  'nothing on account',
  (await accountant.post('/sales/invoices', sale(1, { partyId: walkIn.id, paidAmount: 500, paidAccountId: cash.id }))).data?.code,
  'cash_customer_must_pay',
);
ok('paid in full', await accountant.post('/sales/invoices', sale(1, { partyId: walkIn.id, paidAmount: 1000, paidAccountId: cash.id })));
eq('owes nothing', await balance(walkIn.id), 0);

console.log('== every sale names its department');
const dept = ok('a department', await owner.post('/departments', { name: `InvDept ${tag}` }));
ok('rule on', await owner.put('/settings', { requireDepartment: true }));
eq('no department refused', (await accountant.post('/sales/invoices', sale(1))).data?.code, 'department_required');
ok('with one', await accountant.post('/sales/invoices', sale(1, { departmentId: dept.id })));
eq('a seller may not turn it off', (await karim.put('/settings', { requireDepartment: false })).status, 403);
ok('rule off again', await owner.put('/settings', { requireDepartment: false }));
ok('closed', await owner.put(`/departments/${dept.id}`, { isActive: false }));

console.log('== serial number from Settings');
eq('a seller may not set it', (await karim.put('/settings/numbering', { type: 'SALES_INVOICE', prefix: 'KM-' })).status, 403);
eq('no trailing digit', (await owner.put('/settings/numbering', { type: 'SALES_INVOICE', prefix: 'KM1' })).data?.code, 'bad_prefix');
const kmPrefix = `K${tag.toUpperCase().replace(/[0-9]/g, 'X')}-`;
const set = ok('KM-style from 100', await owner.put('/settings/numbering', { type: 'SALES_INVOICE', prefix: kmPrefix, startAt: 100, digits: 6 }));
eq('next shown', set.find((n) => n.type === 'SALES_INVOICE').next, `${kmPrefix}000100`);
const n1 = ok('numbered', await accountant.post('/sales/invoices', sale(1)));
const n2 = ok('and the next', await accountant.post('/sales/invoices', sale(1)));
eq('KM-000100, KM-000101', [n1.number, n2.number], [`${kmPrefix}000100`, `${kmPrefix}000101`]);
ok('start lowered', await owner.put('/settings/numbering', { type: 'SALES_INVOICE', prefix: kmPrefix, startAt: 1, digits: 6 }));
eq('never goes back', ok('after', await accountant.post('/sales/invoices', sale(1))).number, `${kmPrefix}000102`);
const back = ok('built-in again', await owner.put('/settings/numbering', { type: 'SALES_INVOICE', prefix: '' }));
check('INV- style again', back.find((n) => n.type === 'SALES_INVOICE').next.startsWith('INV-'));

console.log('== a cheque not collected yet: being paid');
const byCheque = ok('sold 2 on credit', await accountant.post('/sales/invoices', sale(2)));
eq('on credit', await stateOf(byCheque), 'CREDIT');
const cheque = ok(
  'a cheque against it',
  await owner.post('/notes/receive', {
    partyId: customer.id, kind: 'CHEQUE', serialNumber: `CH${tag}`, amount: 2000,
    dueDate: new Date().toISOString().slice(0, 10), bankName: 'CIB',
    allocations: [{ documentId: byCheque.id, amount: 2000 }],
  }),
);
eq('being paid until the cheque is collected', await stateOf(byCheque), 'COLLECTING');
const box2 = (await accountant.get('/money-accounts')).data.find((m) => m.kind === 'CASH_BOX');
ok('cheque collected', await owner.post(`/notes/${cheque.id}/collect`, { accountId: box2.id }));
eq('then paid', await stateOf(byCheque), 'PAID');

console.log('== cancelled invoices are not on the customer statement');
const st = async () => (await owner.get(`/ledger/parties/${customer.id}/statement`)).data;
const before = await st();
const temp = ok('another sale', await accountant.post('/sales/invoices', sale(1)));
const during = await st();
check('it shows while it stands', JSON.stringify(during).includes(temp.number));
ok('cancelled, with a reason', await accountant.post(`/sales/invoices/${temp.id}/cancel`, { reason: 'Wrong customer' }));
const after = await st();
check('gone from the statement', !JSON.stringify(after).includes(temp.number));
eq('the closing balance is back', after.closing ?? after.closingBalance, before.closing ?? before.closingBalance);
eq('the reason is kept', (await accountant.get(`/sales/invoices/${temp.id}`)).data.cancelReason, 'Wrong customer');
const changedTwice = ok('a sale changed twice', await accountant.post('/sales/invoices', sale(1)));
ok('changed', await accountant.put(`/sales/invoices/${changedTwice.id}`, sale(2)));
ok('changed again', await accountant.put(`/sales/invoices/${changedTwice.id}`, sale(3)));
const lines = JSON.stringify((await st()).lines.filter((l) => JSON.stringify(l).includes(changedTwice.number)));
eq('shown once, as it stands', (lines.match(/"debit":3000/g) ?? []).length, 1);

console.log('== report of cancelled and changed invoices');
eq('a seller may not see it', (await karim.get('/reports/invoice-changes')).status, 403);
const changes = ok('the accountant sees it', await accountant.get('/reports/invoice-changes'));
const mine = changes.filter((r) => r.documentId === temp.id || r.documentId === changedTwice.id);
eq('cancel with its reason and totals', mine.filter((r) => r.kind === 'CANCEL').map((r) => [r.number, r.reason, r.totalBefore, r.totalAfter]), [[temp.number, 'Wrong customer', 1000, 0]]);
eq('two changes', mine.filter((r) => r.kind === 'EDIT').map((r) => [r.totalBefore, r.totalAfter]), [[2000, 3000], [1000, 2000]]);
eq('only cancellations', (await accountant.get('/reports/invoice-changes?kind=CANCEL')).data.every((r) => r.kind === 'CANCEL'), true);

console.log('== one device per account; remember this device');
const signIn = async (remember) => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `invacc.${tag}@skb.local`, password: PASS, rememberDevice: remember }),
  });
  return { token: (await r.json()).accessToken, cookie: r.headers.get('set-cookie') ?? '' };
};
const first = await signIn(false);
check('not remembered: the cookie ends with the browser', !/expires=/i.test(first.cookie), first.cookie);
const me = (token) => fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
eq('works', (await me(first.token)).status, 200);
const second = await signIn(true);
check('remembered: the cookie lasts', /expires=/i.test(second.cookie), second.cookie);
const kicked = await me(first.token);
eq('the first device is signed out', kicked.status, 401);
eq('…told why', (await kicked.json()).code, 'SIGNED_IN_ELSEWHERE');
eq('the new one works', (await me(second.token)).status, 200);
const rt = (c) => c.split(';')[0];
const refreshOld = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { cookie: rt(first.cookie) } });
eq('the old device cannot come back by refreshing', [refreshOld.status, (await refreshOld.json()).code], [401, 'SIGNED_IN_ELSEWHERE']);
const refreshNew = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { cookie: rt(second.cookie) } });
eq('the new one refreshes', refreshNew.status, 200);
check('and stays remembered', /expires=/i.test(refreshNew.headers.get('set-cookie') ?? ''));

summary('invoices');
