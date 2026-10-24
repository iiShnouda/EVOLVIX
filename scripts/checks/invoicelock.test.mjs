// Invoice edit lock + the per-kind discount permissions (owner, 2026-10-13). The accountant can
// freeze an invoice (no more editing/deleting) and reopen it; the combined print freezes too; the
// person who made an invoice may change it for half an hour even without the edit right; a whole
// discount, a line discount and a combined discount are each their own permission, and are given
// only on the customer's invoices, never while one is made or changed (owner, 2026-10-24). Runs
// against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: create, but no edit/cancel/lock/discount
const PASS = 'Str0ngPass!';
ok(
  'an accountant',
  await owner.post('/staff', {
    fullName: `Lock Acc ${tag}`,
    email: `lockacc.${tag}@skb.local`,
    password: PASS,
    role: 'ACCOUNTANT',
    branchId: owner.user.branchId,
  }),
);
const accountant = await login(`lockacc.${tag}@skb.local`, PASS);

console.log('== the accountant has the new rights, a seller has none of them');
for (const p of ['sales:lock', 'sales:discount', 'sales:discount_combined'])
  check(`accountant has ${p}`, accountant.user.permissions.includes(p));
for (const p of ['sales:lock', 'sales:discount', 'sales:discount_combined', 'sales:edit', 'sales:cancel'])
  check(`a seller has no ${p}`, !karim.user.permissions.includes(p));

// --- a sellable item with stock, and a customer ---
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const cat = ok('a category', await owner.post('/categories', { name: `LockCat ${tag}` }));
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `LockItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
const supplier = ok('a supplier', await owner.post('/parties', { name: `LockSup ${tag}`, types: ['SUPPLIER'] }));
ok(
  'bought 100 at 5.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 100, unitCost: 500 }],
  }),
);
const customer = ok('a customer', await owner.post('/parties', { name: `LockCust ${tag}`, types: ['CUSTOMER'] }));
const sale = (qty) => ({
  partyId: customer.id,
  warehouseId: wh.id,
  taxPercent: 0,
  lines: [{ productId: item.id, quantity: qty, unitPrice: 1000 }],
});
const locked = async (id) => (await owner.get(`/sales/invoices/${id}`)).data.locked;

console.log('== the accountant freezes an invoice: no editing, deleting or discount until reopened');
const inv = ok('accountant sells 3', await accountant.post('/sales/invoices', sale(3)));
eq('not locked yet', await locked(inv.id), false);
eq('a seller may not lock', (await karim.post('/sales/invoices/lock', { ids: [inv.id], locked: true })).status, 403);
ok('the accountant locks it', await accountant.post('/sales/invoices/lock', { ids: [inv.id], locked: true }));
eq('now it shows locked', await locked(inv.id), true);
eq('editing a locked invoice is refused', (await accountant.put(`/sales/invoices/${inv.id}`, sale(4))).data?.code, 'invoice_locked');
eq('deleting a locked invoice is refused', (await accountant.post(`/sales/invoices/${inv.id}/cancel`)).data?.code, 'invoice_locked');
eq('a discount on a locked invoice is refused', (await accountant.post(`/sales/invoices/${inv.id}/discount`, { percent: 5 })).data?.code, 'invoice_locked');

console.log('== reopening lets it be changed again');
ok('the accountant reopens it', await accountant.post('/sales/invoices/lock', { ids: [inv.id], locked: false }));
eq('not locked now', await locked(inv.id), false);
ok('and it can be changed again', await accountant.put(`/sales/invoices/${inv.id}`, sale(2)));

console.log('== the maker gets half an hour on a fresh invoice, even without the edit right');
const mine = ok('a seller makes their own invoice', await karim.post('/sales/invoices', sale(1)));
ok('the seller changes it within the half hour', await karim.put(`/sales/invoices/${mine.id}`, sale(2)));
ok('the accountant locks the seller out', await accountant.post('/sales/invoices/lock', { ids: [mine.id], locked: true }));
eq('now the seller cannot change it', (await karim.put(`/sales/invoices/${mine.id}`, sale(3))).data?.code, 'invoice_locked');

console.log('== each kind of discount is its own permission');
eq('a seller may not give a whole-invoice discount', (await karim.post(`/sales/invoices/${inv.id}/discount`, { percent: 5 })).status, 403);
eq('a seller may not give a combined discount', (await karim.post('/sales/invoices/discount-all', { invoiceIds: [inv.id], percent: 5 })).status, 403);
ok('the accountant may give a whole-invoice discount', await accountant.post(`/sales/invoices/${inv.id}/discount`, { percent: 5 }));
ok('the accountant may give a combined discount', await accountant.post('/sales/invoices/discount-all', { invoiceIds: [inv.id], percent: 0 }));

console.log('== discounts are given on the customer’s invoices only (owner, 2026-10-24)');
const withLine = { ...sale(2), lines: [{ productId: item.id, quantity: 2, unitPrice: 1000, discount: 100 }] };
eq('none while selling, not even by the accountant', (await accountant.post('/sales/invoices', withLine)).data?.code, 'discount_on_customer_invoices');
eq('nor an invoice discount', (await accountant.post('/sales/invoices', { ...sale(2), charges: [{ kind: 'DISCOUNT', percent: 5 }] })).data?.code, 'discount_on_customer_invoices');
const ownerTry = await owner.post('/sales/invoices', withLine);
eq('nor by the owner, with no way past', [ownerTry.data?.code, ownerTry.canOverride], ['discount_on_customer_invoices', false]);
eq('nor on a pending invoice', (await owner.post('/sales/orders', withLine)).data?.code, 'discount_on_customer_invoices');
const d = ok('a sale of 4', await accountant.post('/sales/invoices', sale(4)));
eq('a seller may not discount its items', (await karim.post(`/sales/invoices/${d.id}/line-discounts`, { lines: [{ lineId: d.lines[0].id, discount: 100 }] })).status, 403);
const d1 = ok('the accountant takes 1.00 off its line', await accountant.post(`/sales/invoices/${d.id}/line-discounts`, { lines: [{ lineId: d.lines[0].id, discount: 100 }] }));
eq('…on the same invoice', [d1.id, d1.number, d1.lines[0].discount, d1.grandTotal], [d.id, d.number, 100, 3900]);
eq('a line of another invoice is refused', (await accountant.post(`/sales/invoices/${d.id}/line-discounts`, { lines: [{ lineId: inv.lines[0].id, discount: 1 }] })).data?.code, 'line_not_found');
const d2 = ok('and 5% off the invoice', await accountant.post(`/sales/invoices/${d.id}/discount`, { percent: 5 }));
eq('…both kept', [d2.lines[0].discount, d2.discountTotal, d2.grandTotal], [100, 100 + 195, 3705]);
eq('a discount does not mark it changed', (await owner.get(`/sales/invoices/${d.id}`)).data.edited ?? false, false);
eq(
  'the changes report lists both discounts',
  (await owner.get('/reports/invoice-changes?kind=DISCOUNT')).data.filter((r) => r.documentId === d.id).map((r) => [r.kind, r.totalBefore, r.totalAfter]),
  [['DISCOUNT', 3900, 3705], ['DISCOUNT', 4000, 3900]],
);
// Changing its items keeps them: a line's discount follows its quantity.
const kept = { ...sale(2), lines: [{ productId: item.id, quantity: 2, unitPrice: 1000, discount: 50 }], charges: [{ kind: 'DISCOUNT', percent: 5 }] };
const d3 = ok('2 instead of 4, its discounts kept', await accountant.put(`/sales/invoices/${d.id}`, kept));
eq('…the line’s halved with it, the 5% the same', [d3.lines[0].discount, d3.discountTotal], [50, 50 + 98]);
eq('a bigger one is refused there', (await accountant.put(`/sales/invoices/${d.id}`, { ...kept, lines: [{ ...kept.lines[0], discount: 60 }] })).data?.code, 'discount_on_customer_invoices');
eq('so is another invoice discount', (await accountant.put(`/sales/invoices/${d.id}`, { ...kept, charges: [{ kind: 'DISCOUNT', percent: 6 }] })).data?.code, 'discount_on_customer_invoices');

console.log('== each kind of discount works alone');
const soloEmail = `lockdisc.${tag}@skb.local`;
const soloStaff = ok('someone with no role', await owner.post('/staff', { fullName: `Disc ${tag}`, email: soloEmail, password: PASS, role: 'NONE', branchId: owner.user.branchId }));
const only = async (permissions) => {
  ok(`only ${permissions.join(', ')}`, await owner.put(`/staff/${soloStaff.id}/permissions`, { granted: permissions, revoked: [] }));
  return login(soloEmail, PASS);
};
const e0 = ok('a sale of 3', await owner.post('/sales/invoices', sale(3)));
const e1 = ok('5% off it', await owner.post(`/sales/invoices/${e0.id}/discount`, { percent: 5 }));
let solo = await only(['sales:discount_line']);
ok('the customer’s invoices open for a discount on items', await solo.get(`/sales/customers/${customer.id}/invoices`));
const e2 = ok('…and it is given', await solo.post(`/sales/invoices/${e1.id}/line-discounts`, { lines: [{ lineId: e1.lines[0].id, discount: 30 }] }));
eq('…the invoice discount stays', [e2.lines[0].discount, e2.charges.find((c) => c.kind === 'DISCOUNT')?.rate], [30, 5]);
eq('not an invoice discount', (await solo.post(`/sales/invoices/${e1.id}/discount`, { percent: 6 })).status, 403);
eq('nor one over several', (await solo.post('/sales/invoices/discount-all', { invoiceIds: [e1.id], amount: 50 })).status, 403);
solo = await only(['sales:discount_combined']);
ok('they open for one discount over several', await solo.get(`/sales/customers/${customer.id}/invoices`));
const e3 = await solo.post('/sales/invoices/discount-all', { invoiceIds: [e1.id], amount: 50 });
ok('given on an invoice with its own discounts already', e3);
eq('…all three on it', [e3.data?.[0]?.lines[0].discount, e3.data?.[0]?.charges.filter((c) => c.kind !== 'TAX').map((c) => [c.kind, c.rate ?? c.amount])], [30, [['DISCOUNT', 5], ['EXTRA_DISCOUNT', 50]]]);
eq('not a discount on items', (await solo.post(`/sales/invoices/${e1.id}/line-discounts`, { lines: [{ lineId: e2.lines[0].id, discount: 40 }] })).status, 403);
solo = await only(['sales:discount']);
ok('they open for an invoice discount', await solo.get(`/sales/customers/${customer.id}/invoices`));
const e4 = ok('it is changed, the others kept', await solo.post(`/sales/invoices/${e1.id}/discount`, { percent: 6 }));
eq('…6% now', [e4.lines[0].discount, e4.charges.filter((c) => c.kind !== 'TAX').map((c) => [c.kind, c.rate ?? c.amount])], [30, [['DISCOUNT', 6], ['EXTRA_DISCOUNT', 50]]]);
eq('not a discount on items', (await solo.post(`/sales/invoices/${e1.id}/line-discounts`, { lines: [{ lineId: e4.lines[0].id, discount: 40 }] })).status, 403);
solo = await only([]);
eq('with none of them, the customer’s invoices stay shut', (await solo.get(`/sales/customers/${customer.id}/invoices`)).status, 403);
ok('they have work in the books now: closed', await owner.put(`/staff/${soloStaff.id}`, { isActive: false }));

// ------------------------------------------------------------------ the owner (owner, 2026-10-22)
console.log('== the owner is warned, then may go past any rule');
const sure = owner.confirmed();
const asked = (res, code) => eq(`the owner is stopped first (${code}), and told they may go on`, [res.data?.code, res.canOverride], [code, true]);
const frozen = ok('another invoice', await accountant.post('/sales/invoices', sale(2)));
ok('locked', await accountant.post('/sales/invoices/lock', { ids: [frozen.id], locked: true }));
const accRes = await accountant.put(`/sales/invoices/${frozen.id}`, sale(3));
eq('the accountant is refused, with no way past', [accRes.data?.code, accRes.canOverride], ['invoice_locked', false]);
asked(await owner.put(`/sales/invoices/${frozen.id}`, sale(3)), 'invoice_locked');
ok('confirmed: the owner changes the locked invoice', await sure.put(`/sales/invoices/${frozen.id}`, sale(3)));
ok('…and gives it a discount', await sure.post(`/sales/invoices/${frozen.id}/discount`, { percent: 5 }));
const lineId = (await owner.get(`/sales/invoices/${frozen.id}`)).data.lines[0].id;
// Goods come back after Settings → hours (12 by default; other suites set 0): as by default here.
const hoursBefore = (await owner.get('/settings')).data.returnAfterHours;
ok('returns wait 12 hours', await owner.put('/settings', { returnAfterHours: 12 }));
eq('a return within the hours is refused to others', (await accountant.post(`/sales/invoices/${frozen.id}/returns`, { lines: [{ lineId, quantity: 1 }] })).data?.code, 'return_too_soon');
asked(await owner.post(`/sales/invoices/${frozen.id}/returns`, { lines: [{ lineId, quantity: 1 }] }), 'return_too_soon');
ok('confirmed: the owner takes goods back at once', await sure.post(`/sales/invoices/${frozen.id}/returns`, { lines: [{ lineId, quantity: 1 }] }));
ok('the hours as they were', await owner.put('/settings', { returnAfterHours: hoursBefore }));
const below = { ...sale(1), lines: [{ productId: item.id, quantity: 1, unitPrice: 100 }] };
eq('below cost is refused to others', (await accountant.post('/sales/invoices', below)).data?.code, 'below_cost');
asked(await owner.post('/sales/invoices', below), 'below_cost');
ok('confirmed: the owner sells below cost', await sure.post('/sales/invoices', below));
const tight = ok('a customer with a 1.00 limit', await owner.post('/parties', { name: `Tight ${tag}`, types: ['CUSTOMER'] }));
ok('limit set', await owner.put(`/parties/${tight.id}/credit-limit`, { creditLimit: 100 }));
asked(await owner.post('/sales/invoices', { ...sale(1), partyId: tight.id }), 'over_credit_limit');
const overSale = ok('confirmed: the owner sells over the limit', await sure.post('/sales/invoices', { ...sale(1), partyId: tight.id }));
eq('…posted, not waiting', [overSale.type, overSale.overLimit ?? false], ['SALES_INVOICE', false]);
const noStock = await sure.post('/sales/invoices', sale(100000));
eq('stock still can’t go below zero, even confirmed', [noStock.data?.code, noStock.canOverride], ['insufficient_stock', false]);
asked(await owner.put(`/parties/${tight.id}`, { isActive: false }), 'has_balance');
ok('confirmed: the owner closes an account that still owes', await sure.put(`/parties/${tight.id}`, { isActive: false }));

// ------------------------------------------------------------------ given to anyone (owner, 2026-10-22)
console.log('== going past the rules is a permission anyone may be given');
eq('the owner holds it', owner.user.permissions.includes('rules:override'), true);
const adminRole = (await owner.get('/roles')).data?.find?.((r) => r.role === 'ADMIN');
check('the admin role is listed', !!adminRole);
if (adminRole) eq('an admin doesn’t, until given', adminRole.permissions.includes('rules:override'), false);
const accId = ((await owner.get('/staff')).data.items ?? (await owner.get('/staff')).data).find((x) => x.email === `lockacc.${tag}@skb.local`).id;
ok('given to the accountant', await owner.put(`/staff/${accId}/permissions`, { granted: ['rules:override'], revoked: [] }));
const acc2 = await login(`lockacc.${tag}@skb.local`, PASS);
eq('…who now holds it', acc2.user.permissions.includes('rules:override'), true);
const locked2 = ok('an invoice', await acc2.post('/sales/invoices', sale(1)));
ok('locked', await acc2.post('/sales/invoices/lock', { ids: [locked2.id], locked: true }));
asked(await acc2.put(`/sales/invoices/${locked2.id}`, sale(2)), 'invoice_locked');
ok('confirmed: the accountant changes the locked invoice', await acc2.confirmed().put(`/sales/invoices/${locked2.id}`, sale(2)));
ok('taken back', await owner.put(`/staff/${accId}/permissions`, { granted: [], revoked: [] }));

process.exit(summary('invoicelock') ? 1 : 0);
