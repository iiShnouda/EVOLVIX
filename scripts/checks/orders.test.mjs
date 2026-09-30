// Pending invoices (owner decision 2026-09-30): a department's sales person saves the invoice —
// items, customer, date — and it waits for the accountant. Its goods are held for it, but no stock,
// money, balance or ledger moves. The accountant may change its discounts (within their own
// permission and limit), takes what the customer pays and approves it: it becomes a sales invoice.
// The rest stays on the customer's account, which the accountant sees per department. Runs against BASE.
import { login, check, eq, ok, summary, addDays, companyToday } from './lib.mjs';

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

console.log('== the statement, like the old كشف حساب');
const st = ok('with items', await acc.get(`/ledger/parties/${customer.id}/statement?items=true`));
const invRow = st.lines.find((l) => l.sourceId === inv.id && l.debit > 0);
eq('the book is the department, with number and note', [invRow?.book, invRow?.documentNumber, invRow?.note], [`Floor1 ${tag}`, inv.number, 'Pick up Thursday']);
eq('its items', invRow?.items?.map((i) => [i.productName, i.quantity, i.unitPrice, i.discount, i.lineTotal]), [[`Coat ${tag}`, 6, 1000, 600, 5400]]);
const payRow = st.lines.find((l) => l.sourceId === inv.id && l.credit > 0);
eq('what was paid on the spot: its cash box, no items again', [payRow?.book, payRow?.credit, payRow?.items ?? null], [cash?.name, 3000, null]);
const noteRow = st.lines.find((l) => l.sourceType === 'NOTE');
eq('the cheque: its number and bank', [noteRow?.documentNumber, noteRow?.book], [`CH-${tag}`, 'NBE']);
check('a branch on every line', st.lines.every((l) => l.branchName));
check('no items unless asked', (await acc.get(`/ledger/parties/${customer.id}/statement`)).data.lines.every((l) => !l.items));
const elsewhere = (await acc.get(`/ledger/parties/${customer.id}/statement?branchId=00000000-0000-0000-0000-000000000001`)).data;
eq('another branch: nothing', [elsewhere.lines.length, elsewhere.opening], [0, 0]);

console.log('== changing a pending invoice');
ok('4 more coats', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 4, unitCost: 600 }] }));
const o5 = ok('rep saves 1', await rep.post('/sales/orders', body(1, { notes: 'first' })));
eq('another sales person can’t change it', (await other.put(`/sales/orders/${o5.id}`, body(2))).data?.code, 'edit_not_allowed');
const o5b = ok('the rep makes it 2', await rep.put(`/sales/orders/${o5.id}`, body(2, { notes: 'second' })));
eq('same invoice, number and date; new lines', [o5b.id, o5b.number, o5b.issueDate.slice(0, 19), o5b.grandTotal, o5b.notes, o5b.lines.length], [o5.id, o5.number, o5.issueDate.slice(0, 19), 2000, 'second', 1]);
eq('still pending', o5b.status, 'PENDING');
eq('over the stock refused', (await rep.put(`/sales/orders/${o5.id}`, body(50))).data?.code, 'insufficient_stock');
eq('left as it was', (await rep.get(`/sales/orders/${o5.id}`)).data.grandTotal, 2000);
ok('approved', await acc.post(`/sales/orders/${o5.id}/approve`, { paidAmount: 2000, paidAccountId: cash?.id }));
eq('an approved one can’t change', (await rep.put(`/sales/orders/${o5.id}`, body(1))).data?.code, 'order_closed');

console.log('== credit limit');
const buyer = ok('another customer', await owner.post('/parties', { name: `Credit ${tag}`, types: ['CUSTOMER'] }));
eq('the rep can’t set it', (await rep.put(`/parties/${buyer.id}/credit-limit`, { creditLimit: 1000 })).status, 403);
eq('the accountant sets 15.00', ok('limit', await acc.put(`/parties/${buyer.id}/credit-limit`, { creditLimit: 1500 })).creditLimit, 1500);
const sellTo = (who, q, paidAmount = 0) =>
  who.post('/sales/invoices', { ...body(q), partyId: buyer.id, paidAmount, paidAccountId: paidAmount ? cash?.id : undefined });
ok('4 more coats in stock', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 4, unitCost: 600 }] }));
ok('10.00 on credit is within it', await sellTo(acc, 1));
eq('another 10.00 is over it', (await sellTo(acc, 1)).data?.code, 'over_credit_limit');
ok('…unless 5.00 is paid now', await sellTo(acc, 1, 500));
const o6 = ok('a pending one for them is saved', await rep.post('/sales/orders', { ...body(1), partyId: buyer.id }));
eq('approving it on credit is over', (await acc.post(`/sales/orders/${o6.id}/approve`, {})).data?.code, 'over_credit_limit');
ok('the owner may go over it', await acc.post(`/sales/orders/${o6.id}/cancel`).then(() => sellTo(owner, 1)));
eq('the account shows the limit', (await acc.get(`/sales/customers/${buyer.id}/account`)).data.creditLimit, 1500);
ok('limit cleared', await acc.put(`/parties/${buyer.id}/credit-limit`, { creditLimit: null }));

console.log('== pending invoices hold goods for so many days');
ok('hold 3 days', await owner.put('/settings', { pendingHoldDays: 3 }));
const o7 = ok('a pending one', await rep.post('/sales/orders', body(1)));
eq('holds until 3 days from today', o7.dueDate, addDays(companyToday(), 3));
if (process.env.PGURL) {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.PGURL });
  await db.connect();
  // The earlier pending one (2 coats) still holds its goods.
  const left = (await owner.get(`/products/${item.id}`)).data.stockOnHand - 2;
  eq('while held, it can’t be sold', (await owner.post('/sales/invoices', body(left))).data?.code, 'insufficient_stock');
  await db.query('UPDATE "SalesDocuments" SET "DueDate" = now() - interval \'2 days\' WHERE "Id" = $1', [o7.id]);
  await db.end();
  ok('past its days it holds nothing', await owner.post('/sales/invoices', body(left)));
}
ok('hold days back to none', await owner.put('/settings', { pendingHoldDays: 0 }));

process.exit(summary('orders') ? 1 : 0);
