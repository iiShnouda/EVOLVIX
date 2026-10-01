// Owner decisions 2026-09-30: customers, suppliers and staff have a code (كود) — 1, 2, 3… in the
// order they were added — that finds them; a sales invoice posts at once (no approval) and whoever
// takes the payment (sales:invoice_alerts) is told the customer and department; a seller may add to
// a price on one invoice (sales:raise_price) but not go under it; and each person's work in
// progress is kept on the server while the app updates. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';
const person = async (role, name, extra = {}) => {
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
  return { ...staff, email, ...extra };
};

console.log('== codes');
const a = ok(
  'a customer',
  await owner.post('/parties', { name: `CodeA ${tag}`, types: ['CUSTOMER'] }),
);
const b = ok(
  'another',
  await owner.post('/parties', { name: `CodeB ${tag}`, types: ['SUPPLIER'] }),
);
check('numbered', Number.isInteger(a.code) && a.code > 0, a.code);
eq('one after the other', b.code, a.code + 1);
const byCode = (await owner.get(`/parties?code=${a.code}`)).data.items;
eq(
  'found by its code',
  byCode.map((p) => p.id),
  [a.id],
);
eq(
  '…only as a customer',
  (await owner.get(`/parties?code=${b.code}&type=CUSTOMER`)).data.items.length,
  0,
);
check(
  'searching the number finds it',
  (await owner.get(`/parties?search=${a.code}`)).data.items.some((p) => p.id === a.id),
);
eq(
  'kept when renamed',
  ok('renamed', await owner.put(`/parties/${a.id}`, { name: `CodeA2 ${tag}`, types: ['CUSTOMER'] }))
    .code,
  a.code,
);

const seller = await person('SALES', 'cseller');
const accountant = await person('ACCOUNTANT', 'cacc');
check('staff numbered', seller.code > 0 && accountant.code === seller.code + 1, [
  seller.code,
  accountant.code,
]);
const reps = (await owner.get('/sales/reps')).data;
eq('reps show it', reps.find((r) => r.id === seller.id)?.code, seller.code);

console.log('== an invoice posts at once; the accountant is told');
const s = await login(seller.email, PASS);
const acc = await login(accountant.email, PASS);
check('seller may add to a price', s.user.permissions.includes('sales:raise_price'));
check('…not lower one', !s.user.permissions.includes('sales:change_price'));
check('seller no longer saves pending invoices', !s.user.permissions.includes('sales:order'));
check('accountant is told of new invoices', acc.user.permissions.includes('sales:invoice_alerts'));

const dept = ok('a department', await owner.post('/departments', { name: `Dept ${tag}` }));
const cat = ok(
  'its category',
  await owner.post('/categories', { name: `Cat ${tag}`, departmentId: dept.id }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `Item ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
ok(
  'bought',
  await owner.post('/purchases/invoices', {
    partyId: b.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 50, unitCost: 500 }],
  }),
);
const sell = (who, price, extra = {}) =>
  who.post('/sales/invoices', {
    partyId: a.id,
    warehouseId: wh.id,
    taxPercent: 0,
    departmentId: dept.id,
    lines: [{ productId: item.id, quantity: 2, unitPrice: price }],
    ...extra,
  });

const inv = ok('seller posts an invoice at 12.00 a piece', await sell(s, 1200));
eq('posted, not pending', [inv.type, inv.status], ['SALES_INVOICE', 'CONFIRMED']);
eq('at the raised price', inv.grandTotal, 2400);
eq('the seller is its rep', [inv.repId, inv.repCode], [seller.id, seller.code]);
eq('the customer’s code on it', inv.partyCode, a.code);
const lower = await sell(s, 900);
eq('under the price is refused', [lower.status, lower.data?.code], [403, 'price_not_allowed']);

const notes = (await acc.get('/notifications')).data;
const told = notes.items.find((n) => n.documentId === inv.id);
check('the accountant is told', !!told, notes.items.slice(0, 2));
eq(
  '…of a new invoice: customer, department, amount',
  [told?.kind, told?.partyName, told?.departmentName, told?.amount],
  ['INVOICE_NEW', `CodeA2 ${tag}`, `Dept ${tag}`, 2400],
);
check(
  'the seller is not told of their own',
  !(await s.get('/notifications')).data.items.some((n) => n.documentId === inv.id),
);
check(
  'the owner is told too',
  (await owner.get('/notifications')).data.items.some((n) => n.documentId === inv.id),
);
const other = await person('ACCOUNTANT', 'cother');
ok(
  'another accountant only in another department',
  await owner.put(`/staff/${other.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    departmentIds: [ok('dept2', await owner.post('/departments', { name: `Other ${tag}` })).id],
  }),
);
const inv2 = ok('another invoice', await sell(s, 1000));
const o = await login(other.email, PASS);
check(
  '…is not told of it',
  !(await o.get('/notifications')).data.items.some((n) => n.documentId === inv2.id),
);

console.log('== work kept while the app updates');
const data = JSON.stringify({ v: 1, partyId: a.id, lines: [{ productId: item.id, quantity: 3 }] });
ok('saved', await s.put('/drafts', { key: '/sales/new', data }), [204]);
ok('saved again (replaces)', await s.put('/drafts', { key: '/sales/new', data }), [204]);
eq('someone else has none', (await acc.post('/drafts/take', { key: '/sales/new' })).status, 204);
const back = ok('taken back', await s.post('/drafts/take', { key: '/sales/new' }));
eq('as it was', back.data, data);
eq('only once', (await s.post('/drafts/take', { key: '/sales/new' })).status, 204);
eq(
  'too big refused',
  (await s.put('/drafts', { key: 'x', data: 'y'.repeat(300 * 1024) })).data?.code,
  'bad_draft',
);
eq('needs a key', (await s.put('/drafts', { key: ' ', data: '{}' })).data?.code, 'bad_draft');

console.log('== the invoice list, like the old screen');
const listOf = async (q) =>
  (await acc.get(`/sales/invoices?pageSize=100&search=${encodeURIComponent(`CodeA2 ${tag}`)}${q}`))
    .data;
const all = await listOf('');
const mine = all.items.find((x) => x.id === inv.id);
eq(
  'a row: code, rep, total, net, paid, left',
  [mine?.partyCode, mine?.repName, mine?.subtotal, mine?.grandTotal, mine?.paidAmount, mine?.owed],
  [a.code, `cseller ${tag}`, 2400, 2400, 0, 2400],
);
eq(
  'totals of what the filter found',
  [all.totals.count, all.totals.grandTotal, all.totals.owed],
  [2, 4400, 4400],
);
const cash = (await acc.get('/money-accounts')).data.find((m) => m.kind === 'CASH_BOX');
ok(
  'the customer pays the first one',
  await acc.post('/receipts', {
    partyId: a.id,
    lines: [{ method: 'CASH', accountId: cash.id, amount: 2400 }],
    allocations: [{ documentId: inv.id, amount: 2400 }],
  }),
);
const credit = await listOf('&payment=credit');
const paid = await listOf('&payment=paid');
eq(
  'on account: only the unpaid one',
  credit.items.map((x) => x.id),
  [inv2.id],
);
eq(
  'paid: only the paid one',
  paid.items.map((x) => x.id),
  [inv.id],
);
eq('…its totals', [paid.totals.count, paid.totals.paidAmount, paid.totals.owed], [1, 2400, 0]);
eq(
  'a page of one still adds up all',
  (await acc.get(`/sales/invoices?pageSize=1&search=${encodeURIComponent(`CodeA2 ${tag}`)}`)).data
    .totals.count,
  2,
);

console.log('== due date (تاريخ الاستحقاق)');
const { companyToday, addDays } = await import('./lib.mjs');
eq(
  'before today refused',
  (await sell(s, 1000, { dueDate: addDays(companyToday(), -1) })).data?.code,
  'bad_due_date',
);
const dueInv = ok(
  'a sale due in a month',
  await sell(s, 1000, { dueDate: addDays(companyToday(), 30) }),
);
eq('…kept on it', dueInv.dueDate, addDays(companyToday(), 30));

console.log('== the detailed item search (البحث المفصل)');
const find = async (q) => (await acc.get(`/products?limit=200&${q}`)).data.map((p) => p.id);
check(
  'code contains',
  (await find(`code=${encodeURIComponent(item.sku.slice(-4))}`)).includes(item.id),
);
check('name contains', (await find(`name=${encodeURIComponent(`tem ${tag}`)}`)).includes(item.id));
check(
  'in the price range',
  (await find(`name=${tag}&minPrice=1000&maxPrice=1000`)).includes(item.id),
);
check('…not outside it', !(await find(`name=${tag}&minPrice=1001`)).includes(item.id));
check('in stock', (await find(`name=${tag}&stock=in`)).includes(item.id));
check('…not out of stock', !(await find(`name=${tag}&stock=out`)).includes(item.id));
const loose = ok(
  'an item of no supplier',
  await owner.post('/products', {
    name: `Loose ${tag}`,
    categoryId: cat.id,
    reorderLevel: 5,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 500 }],
  }),
);
check('no supplier', (await find(`supplierId=none&name=${tag}`)).includes(loose.id));
check('…a supplied one isn’t', !(await find(`supplierId=none&name=${tag}`)).includes(item.id));
check('at its reorder level', (await find(`stock=low&name=${tag}`)).includes(loose.id));
check('…a well-stocked one isn’t', !(await find(`stock=low&name=${tag}`)).includes(item.id));

console.log('== screen preferences (hidden columns), per person');
ok('saved', await s.put('/preferences', { key: 'columns:test', value: '["Rep"]' }), [204]);
eq('read back', (await s.get('/preferences')).data['columns:test'], '["Rep"]');
check('not someone else’s', !('columns:test' in (await acc.get('/preferences')).data));
ok(
  'an empty value forgets it',
  await s.put('/preferences', { key: 'columns:test', value: '' }),
  [204],
);
check('…gone', !('columns:test' in (await s.get('/preferences')).data));
eq(
  'too big refused',
  (await s.put('/preferences', { key: 'x', value: 'y'.repeat(9000) })).data?.code,
  'bad_preference',
);

summary('codes');
