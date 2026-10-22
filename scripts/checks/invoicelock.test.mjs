// Invoice edit lock + the per-kind discount permissions (owner, 2026-10-13). The accountant can
// freeze an invoice (no more editing/deleting) and reopen it; the combined print freezes too; the
// person who made an invoice may change it for half an hour even without the edit right; a whole
// discount, a line discount and a combined discount are each their own permission. Runs against BASE.
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

// ------------------------------------------------------------------ the owner (owner, 2026-10-22)
console.log('== nothing stops the owner');
const frozen = ok('another invoice', await accountant.post('/sales/invoices', sale(2)));
ok('locked', await accountant.post('/sales/invoices/lock', { ids: [frozen.id], locked: true }));
eq('the accountant is still refused', (await accountant.put(`/sales/invoices/${frozen.id}`, sale(3))).data?.code, 'invoice_locked');
ok('the owner changes the locked invoice', await owner.put(`/sales/invoices/${frozen.id}`, sale(3)));
ok('…gives it a discount', await owner.post(`/sales/invoices/${frozen.id}/discount`, { percent: 5 }));
const lineId = (await owner.get(`/sales/invoices/${frozen.id}`)).data.lines[0].id;
eq('a return within the hours is refused to others', (await accountant.post(`/sales/invoices/${frozen.id}/returns`, { lines: [{ lineId, quantity: 1 }] })).data?.code, 'return_too_soon');
ok('the owner takes goods back at once', await owner.post(`/sales/invoices/${frozen.id}/returns`, { lines: [{ lineId, quantity: 1 }] }));
const below = { ...sale(1), lines: [{ productId: item.id, quantity: 1, unitPrice: 100 }] };
eq('below cost is refused to others', (await accountant.post('/sales/invoices', below)).data?.code, 'below_cost');
ok('the owner sells below cost', await owner.post('/sales/invoices', below));
const tight = ok('a customer with a 1.00 limit', await owner.post('/parties', { name: `Tight ${tag}`, types: ['CUSTOMER'] }));
ok('limit set', await owner.put(`/parties/${tight.id}/credit-limit`, { creditLimit: 100 }));
const overSale = ok('the owner sells over the limit', await owner.post('/sales/invoices', { ...sale(1), partyId: tight.id }));
eq('…posted, not waiting', overSale.overLimit ?? false, false);
eq('stock still can’t go below zero', (await owner.post('/sales/invoices', sale(100000))).data?.code, 'insufficient_stock');
ok('the owner closes an account that still owes', await owner.put(`/parties/${tight.id}`, { isActive: false }));

process.exit(summary('invoicelock') ? 1 : 0);
