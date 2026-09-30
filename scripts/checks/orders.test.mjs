// Pending invoices (owner decision 2026-09-30): a department's sales person saves the invoice —
// items, customer, date — and it waits for the accountant. Its goods are held for it, but no stock,
// money, balance or ledger moves. The accountant may change its discounts (within their own
// permission and limit), takes what the customer pays and approves it: it becomes a sales invoice.
// The rest stays on the customer's account, which the accountant sees per department. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';
const person = async (role, name) => {
  const email = `${name}.${tag}@skb.local`;
  const staff = ok(
    `add ${role}`,
    await owner.post('/staff', { fullName: `${name} ${tag}`, email, password: PASS, role, branchId: owner.user.branchId }),
  );
  return { ...staff, email };
};
const access = (p, body) =>
  owner.put(`/staff/${p.id}/access`, { allBranches: null, branchIds: [], warehouseIds: [], moneyAccountIds: [], ...body });

const dept = ok('a department', await owner.post('/departments', { name: `Floor1 ${tag}` }));
const cat = ok('its category', await owner.post('/categories', { name: `F1 goods ${tag}`, departmentId: dept.id }));
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const supplier = ok('a supplier', await owner.post('/parties', { name: `OrdSup ${tag}`, types: ['SUPPLIER'] }));
const customer = ok('a customer', await owner.post('/parties', { name: `OrdCust ${tag}`, types: ['CUSTOMER'] }));
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `Coat ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
  }),
);
ok(
  '10 bought at 6.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 600 }],
  }),
);
const stock = async () => (await owner.get(`/products/${item.id}`)).data.stockOnHand;
const balance = async () => (await owner.get(`/parties/${customer.id}`)).data.balance;
const body = (quantity, extra = {}, line = {}) => ({
  partyId: customer.id,
  warehouseId: wh.id,
  taxPercent: 0,
  lines: [{ productId: item.id, quantity, unitPrice: 1000, ...line }],
  ...extra,
});

const repP = await person('SALES', 'rep');
ok('rep: floor 1 only, may discount up to 10%', await access(repP, { departmentIds: [dept.id], maxDiscountPercent: 10 }));
ok('…with the discount permission', await owner.put(`/staff/${repP.id}/permissions`, { granted: ['sales:discount'] }));
const rep = await login(repP.email, PASS);
check('sales people may save pending invoices', rep.user.permissions.includes('sales:order'));
check('…but not approve them', !rep.user.permissions.includes('sales:approve'));
const accP = await person('ACCOUNTANT', 'acc');
let acc = await login(accP.email, PASS);
check('the accountant approves', acc.user.permissions.includes('sales:approve'));

console.log('== a pending invoice');
const before = { stock: await stock(), balance: await balance() };
const o1 = ok(
  'rep saves 6 coats, 5% off, with a note',
  await rep.post('/sales/orders', body(6, { notes: 'Pick up Thursday', paidAmount: 5000 }, { discount: 300 })),
);
eq('it waits', [o1.type, o1.status, o1.number.startsWith('SO-')], ['SALES_ORDER', 'PENDING', true]);
eq('…in the rep’s department', o1.departmentId, dept.id);
eq('…with its total', [o1.subtotal, o1.discountTotal, o1.grandTotal], [6000, 300, 5700]);
eq('nothing paid on it (the accountant takes the money)', o1.paidAmount, 0);
eq('no cost for the rep', [o1.costTotal, o1.profitTotal], [0, 0]);
eq('no stock left', await stock(), before.stock);
eq('no balance moved', await balance(), before.balance);
eq('over the rep’s limit refused', (await rep.post('/sales/orders', body(1, {}, { discount: 101 }))).data?.code, 'discount_over_limit');

console.log('== its goods are held');
eq('another 5 can’t be held (4 free)', (await rep.post('/sales/orders', body(5))).data?.code, 'insufficient_stock');
eq('nor sold directly', (await owner.post('/sales/invoices', body(5))).data?.code, 'insufficient_stock');
const o2 = ok('4 more held', await rep.post('/sales/orders', body(4, {}, { discount: 200 })));
eq('none left to hold', (await rep.post('/sales/orders', body(1))).data?.code, 'insufficient_stock');
const ids = async (who, path) => (await who.get(`${path}?pageSize=100`)).data.items.map((d) => d.id);
check('listed as pending', (await ids(acc, '/sales/orders')).includes(o1.id));
check('not among invoices', !(await ids(owner, '/sales/invoices')).includes(o1.id));
check('not on the dashboard', !(await owner.get('/dashboard')).data.recentDocuments.some((d) => d.id === o1.id));

console.log('== the accountant approves');
eq('the rep can’t approve', (await rep.post(`/sales/orders/${o1.id}/approve`, {})).status, 403);
const cash = (await acc.get('/money-accounts')).data.find((a) => a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId);
const inv = ok(
  'accountant: 10% off instead, 30.00 paid in cash',
  await acc.post(`/sales/orders/${o1.id}/approve`, {
    paidAmount: 3000,
    paidAccountId: cash?.id,
    lineDiscounts: [{ lineId: o1.lines[0].id, discount: 600 }],
  }),
);
eq('an invoice now', [inv.type, inv.number.startsWith('INV-'), inv.sourceNumber], ['SALES_INVOICE', true, o1.number]);
eq('its amounts', [inv.discountTotal, inv.grandTotal, inv.paidAmount, inv.status], [600, 5400, 3000, 'PARTIALLY_PAID']);
eq('department, note and rep kept', [inv.departmentId, inv.notes, inv.repName], [dept.id, 'Pick up Thursday', `rep ${tag}`]);
eq('the stock left', await stock(), before.stock - 6);
eq('the rest is on the account', await balance(), before.balance + 2400);
const closed = (await acc.get(`/sales/orders/${o1.id}`)).data;
eq('the pending one points to it', [closed.status, closed.invoiceNumber], ['CONFIRMED', inv.number]);
eq('approved once only', (await acc.post(`/sales/orders/${o1.id}/approve`, {})).data?.code, 'order_closed');

console.log('== discounts on approval are the approver’s');
ok('accountant limited to 3%', await access(accP, { maxDiscountPercent: 3 }));
acc = await login(accP.email, PASS);
eq(
  'raising the rep’s 5% to 6% is over their limit',
  (await acc.post(`/sales/orders/${o2.id}/approve`, { lineDiscounts: [{ lineId: o2.lines[0].id, discount: 240 }] })).data?.code,
  'discount_over_limit',
);
eq('still pending', (await acc.get(`/sales/orders/${o2.id}`)).data.status, 'PENDING');
const inv2 = ok('kept as the rep gave it', await acc.post(`/sales/orders/${o2.id}/approve`, {}));
eq('…5% off', [inv2.discountTotal, inv2.grandTotal], [200, 3800]);
eq('stock all gone', await stock(), 0);

console.log('== cancelling');
ok('4 back in stock', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 4, unitCost: 600 }] }));
const o3 = ok('rep holds 4', await rep.post('/sales/orders', body(4)));
const otherP = await person('SALES', 'other');
const other = await login(otherP.email, PASS);
eq('another sales person can’t cancel it', (await other.post(`/sales/orders/${o3.id}/cancel`)).data?.code, 'cancel_not_allowed');
eq('the rep cancels it', ok('cancel', await rep.post(`/sales/orders/${o3.id}/cancel`)).status, 'CANCELLED');
ok('the goods are free again', await owner.post('/sales/invoices', body(1)));
eq('a cancelled one can’t be approved', (await acc.post(`/sales/orders/${o3.id}/approve`, {})).data?.code, 'order_closed');
const o4 = ok('one more pending', await rep.post('/sales/orders', body(2, { notes: 'Wants blue' })));

console.log('== the customer’s account');
const account = ok('accountant opens the account', await acc.get(`/sales/customers/${customer.id}/account`));
eq('what they owe', account.balance, await balance());
eq('invoiced and left', [account.invoiced, account.outstanding], [5400 + 3800 + 1000, 2400 + 3800 + 1000]);
eq('waiting for approval', account.pending, o4.grandTotal);
const row = account.departments.find((d) => d.departmentId === dept.id);
eq('per department', [row?.invoices, row?.total, row?.discounts], [2, 9200, 800]);
check('and one of no department (the owner’s direct sale)', account.departments.some((d) => d.departmentId === null && d.total === 1000));
const doc = account.documents.find((d) => d.id === inv.id);
eq('each invoice with its date, discount, paid, left and note', [doc.discountTotal, doc.paidAmount, doc.outstanding, doc.notes, doc.departmentName], [600, 3000, 2400, 'Pick up Thursday', `Floor1 ${tag}`]);
check('the pending one is listed', account.documents.some((d) => d.id === o4.id && d.type === 'SALES_ORDER'));
check('no cost or profit in it', !JSON.stringify(account).includes('profit') && !JSON.stringify(account).includes('cost'));
eq('by department', (await acc.get(`/sales/customers/${customer.id}/account?departmentId=none`)).data.invoiced, 1000);

ok(
  'a cheque for what is left on the first invoice',
  await acc.post('/notes/receive', {
    partyId: customer.id,
    kind: 'CHEQUE',
    serialNumber: `CH-${tag}`,
    amount: 2400,
    dueDate: '2030-01-01',
    bankName: 'NBE',
    allocations: [{ documentId: inv.id, amount: 2400 }],
  }),
);
const after = (await acc.get(`/sales/customers/${customer.id}/account`)).data;
eq('that invoice is settled', after.documents.find((d) => d.id === inv.id).outstanding, 0);
eq('the balance dropped', after.balance, account.balance - 2400);

process.exit(summary('orders') ? 1 : 0);
