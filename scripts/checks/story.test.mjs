// The item card's whole story, the detailed search by place, new places hidden until given and the
// admin with every permission (owner, 2026-10-02). Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const acc = await login('mona@skb.local'); // ACCOUNTANT: card sales, returns and prices; no costs
const sara = await login('sara@skb.local'); // INVENTORY: card purchases and returns
const karim = await login('karim@skb.local'); // SALES: none of the card's parts

ok(
  'returns at once, no department rule',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const saleLevel = (await owner.get('/price-levels')).data.find(
  (l) => l.side === 'SALE' && l.isDefault,
);
const warehouses = (await owner.get('/warehouses')).data;
const wh = warehouses.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const cat = (await owner.get('/categories')).data[0];
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `StorySup ${tag}`, types: ['SUPPLIER'] }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `StoryCus ${tag}`, types: ['CUSTOMER'] }),
);
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `Story ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
  }),
);
ok(
  '10 bought at 6.00 less 1.00 in all',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 600, discount: 100 }],
  }),
);
const sale = (q, price) =>
  owner.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: q, unitPrice: price }],
  });
const s1 = ok('sold 2 at 10.00', await sale(2, 1000));
ok('sold 3 at 11.00', await sale(3, 1100));
ok(
  '1 back from the first',
  await owner.post(`/sales/invoices/${s1.id}/returns`, {
    lines: [{ lineId: s1.lines[0].id, quantity: 1 }],
  }),
);

console.log('== the item card, part by part');
const all = ok('the owner sees it all', await owner.get(`/inventory/items/${item.id}/life`));
eq('bought', all.totals.bought, 10);
eq('sold', all.totals.sold, 5);
eq('back from customers', all.totals.returnedByCustomers, 1);
eq('purchases listed', all.purchases.length, 1);
eq('the supplier', all.purchases[0].partyName, supplier.name);
eq('the supplier discount', all.purchases[0].discount, 100);
eq('net supply price a piece', all.purchases[0].net, 590);
eq(
  'sales newest first',
  all.sales.map((r) => r.net),
  [1100, 1000],
);
check("profit on the owner's card", all.sales[0].profit > 0, all.sales[0]);
eq('returns listed', all.returns.length, 1);
check('prices part allowed', all.prices === true);
eq('margin on the last cost', all.totals.marginPercent, Math.round(((1000 - 590) * 100) / 590));
eq(
  'stock now',
  all.stock.reduce((n, w) => n + w.quantity, 0),
  6,
);

const a = ok('the accountant', await acc.get(`/inventory/items/${item.id}/life`));
check('no purchases for the accountant', a.purchases == null);
eq('her sales', a.sales.length, 2);
check(
  'no profit without costs',
  a.sales.every((r) => r.profit == null && r.unitCost == null),
);
check('no margin without costs', a.totals.marginPercent == null && a.totals.profit == null);

const s = ok('store staff', await sara.get(`/inventory/items/${item.id}/life`));
check('purchases part for store staff', Array.isArray(s.purchases));
check(
  '…never the supply price',
  s.purchases.every((r) => r.net == null && r.unitPrice == null),
  s.purchases,
);
check('no sales for store staff', s.sales == null);

const k = ok('a sales person', await karim.get(`/inventory/items/${item.id}/life`));
check(
  'no parts for sales staff',
  k.purchases == null && k.sales == null && k.returns == null && k.prices === false,
);

console.log('== the detailed search by place');
const inWh = ok(
  'search one warehouse',
  await owner.get(`/products?name=${encodeURIComponent(`Story ${tag}`)}&warehouseId=${wh.id}`),
);
eq('the stock there', inWh[0]?.stockOnHand, 6);
const inBranch = ok(
  'search a branch',
  await owner.get(`/products?name=${encodeURIComponent(`Story ${tag}`)}&branchId=${wh.branchId}`),
);
eq('the branch stock', inBranch[0]?.stockOnHand, 6);
const other = warehouses.find(
  (w) => w.id !== wh.id && w.kind === 'STORE' && w.branchId === wh.branchId,
);
if (other) {
  const none = ok(
    'another warehouse',
    await owner.get(`/products?name=${encodeURIComponent(`Story ${tag}`)}&warehouseId=${other.id}`),
  );
  eq('not there', none.length, 0);
}
const dept = ok('a department', await owner.post('/departments', { name: `StoryDept ${tag}` }));
const loose = (
  await owner.get(`/products?name=${encodeURIComponent(`Story ${tag}`)}&departmentId=${dept.id}`)
).data;
const strict = (
  await owner.get(
    `/products?name=${encodeURIComponent(`Story ${tag}`)}&departmentId=${dept.id}&onlyDepartment=true`,
  )
).data;
check(
  "only the department's own items",
  strict.length <= loose.length && strict.every((p) => p.departmentId === dept.id),
  { loose: loose.length, strict },
);

console.log('== new places are hidden until given');
ok('hide new places (the company default)', await owner.put('/settings', { hideNewPlaces: true }));
const box = ok(
  'a new cash box',
  await owner.post('/money-accounts', {
    name: `Box ${tag}`,
    kind: 'CASH_BOX',
    branchId: owner.user.branchId,
  }),
);
const fresh = await login('mona@skb.local');
const seen = (await fresh.get('/money-accounts')).data.map((x) => x.id);
check("the accountant doesn't see it", !seen.includes(box.id));
check(
  'the owner does',
  (await owner.get('/money-accounts')).data.some((x) => x.id === box.id),
);
const monaRow = (await owner.get('/staff')).data.find((x) => x.email === 'mona@skb.local');
ok(
  'given to her',
  await owner.put(`/staff/${monaRow.id}/access`, {
    moneyAccountIds: [...monaRow.moneyAccountIds, box.id],
  }),
);
const again = await login('mona@skb.local');
check(
  'now she sees it',
  (await again.get('/money-accounts')).data.some((x) => x.id === box.id),
);
ok(
  'everyone sees new places again (as the other checks expect)',
  await owner.put('/settings', { hideNewPlaces: false }),
);
ok(
  '…and she sees every account again',
  await owner.put(`/staff/${monaRow.id}/access`, { moneyAccountIds: [] }),
);

console.log('== the admin has every permission');
const perms = (await owner.get('/permissions')).data;
const roles = (await owner.get('/roles')).data;
eq(
  'admin role holds them all',
  roles.find((r) => r.role === 'ADMIN').permissions.length,
  perms.length,
);

summary('story');
