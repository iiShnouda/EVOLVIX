// Per-person access (DOMAIN.md §2.1): the branches, warehouses and money accounts each person may
// use, and the working branch new documents go to (the X-Branch header). Runs in two new branches
// with its own people, so it can run again on the same database. Runs against BASE.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASSWORD = `Access-${tag}-Check1`;
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: no staff:access

// ------------------------------------------------------------------ setup
console.log('== setup');
const b1 = ok('branch A', await owner.post('/branches', { name: `Access A ${tag}` }));
const b2 = ok('branch B', await owner.post('/branches', { name: `Access B ${tag}` }));
const store1 = b1.warehouses[0];
const store2 = b2.warehouses[0];
const side1 = ok('a second store in A', await owner.post('/warehouses', { branchId: b1.id, name: `Side ${tag}` }));
const boxes = (await owner.get('/money-accounts')).data;
const box1 = boxes.find((a) => a.branchId === b1.id && a.isDefault);
const box2 = boxes.find((a) => a.branchId === b2.id && a.isDefault);
const side1Box = ok(
  'a second cash box in A',
  await owner.post('/money-accounts', { branchId: b1.id, name: `Drawer ${tag}`, kind: 'CASH_BOX' }),
);
check('each branch has its cash box', box1 && box2);
const home = owner.user.branchId; // the seeded main branch: not A or B

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `Access item ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);
const supp = ok('supplier', await owner.post('/parties', { name: `ASupp ${tag}`, types: ['SUPPLIER'] }));
const cust = ok('customer', await owner.post('/parties', { name: `ACust ${tag}`, types: ['CUSTOMER'] }));
const buy = (who, warehouseId, quantity) =>
  who.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity, unitCost: 1000 }],
  });
const p1 = ok('owner buys 10 into A (working in A)', await buy(owner.at(b1.id), store1.id, 10));
eq('the purchase is in A', p1.branchName, b1.name);
ok('owner buys 7 into the side store', await buy(owner.at(b1.id), side1.id, 7));
const p2 = ok('owner buys 5 into B (working in B)', await buy(owner.at(b2.id), store2.id, 5));
eq('that one is in B', p2.branchName, b2.name);
const sell = (who, body = {}) =>
  who.post('/sales/invoices', {
    partyId: cust.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 2000, warehouseId: body.warehouseId }],
    ...body,
  });
const sA = ok('a sale in A', await sell(owner.at(b1.id), { warehouseId: store1.id }));
const sB = ok('a sale in B', await sell(owner.at(b2.id), { warehouseId: store2.id }));
eq('each in its branch', [sA.branchName, sB.branchName], [b1.name, b2.name]);
const sHome = ok('owner with no branch picked: their own', await sell(owner, { warehouseId: store1.id }));
check('…which is neither A nor B', ![b1.name, b2.name].includes(sHome.branchName), sHome.branchName);

// People: Rana sells in A; Adam is an admin who works only in A.
const mk = async (name, role, branchId) =>
  ok(
    `${name} (${role})`,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email: `${name.toLowerCase()}-${tag}@skb.local`,
      password: PASSWORD,
      role,
      branchId,
    }),
  );
const rana = await mk('Rana', 'SALES', b1.id);
const adam = await mk('Adam', 'ADMIN', b1.id);
ok(
  'Rana may also take and cancel receipts, and see reports',
  await owner.put(`/staff/${rana.id}/permissions`, {
    granted: ['receipts:view', 'receipts:create', 'vouchers:cancel', 'analytics:view'],
    revoked: [],
  }),
);
const as = (p) => login(p.email, PASSWORD);
const setAccess = (who, person, body) =>
  who.put(`/staff/${person.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    ...body,
  });

// ------------------------------------------------------------------ by role
console.log('== by role');
let r = await as(rana);
eq('a sales person: their branch only', [r.user.allBranches, r.user.branches.map((b) => b.id)], [false, [b1.id]]);
eq('no narrowing', [r.user.warehouseIds, r.user.moneyAccountIds], [null, null]);
const listed = async (who) => (await who.get('/sales/invoices?pageSize=100')).data.items.map((d) => d.id);
let seen = await listed(r);
check("sees A's sale, not B's", seen.includes(sA.id) && !seen.includes(sB.id));
eq("B's sale is not found", (await r.get(`/sales/invoices/${sB.id}`)).status, 404);
eq('asking to work in B is ignored', (await sell(r.at(b2.id))).data?.branchName, b1.name);
const staffRow = (await owner.get('/staff')).data.find((s) => s.id === rana.id);
eq('the staff list says so', [staffRow.allBranches, staffRow.seesAllBranches, staffRow.branchIds], [null, false, []]);

// ------------------------------------------------------------------ more branches
console.log('== a second branch');
ok('Rana also works in B', await setAccess(owner, rana, { allBranches: false, branchIds: [b2.id] }));
eq('her old token still says A only', (await r.get(`/sales/invoices/${sB.id}`)).status, 404);
r = await as(rana);
eq('signed in again: A and B, hers first', r.user.branches.map((b) => b.id), [b1.id, b2.id]);
ok("now she sees B's sale", await r.get(`/sales/invoices/${sB.id}`));
const rB = ok('she sells working in B', await sell(r.at(b2.id)));
eq('…it goes to B, from B’s store', [rB.branchName, rB.lines[0].warehouseId], [b2.name, store2.id]);
const rA = ok('with nothing picked', await sell(r));
eq('…her own branch and store', [rA.branchName, rA.lines[0].warehouseId], [b1.name, store1.id]);
eq('a branch she lacks is ignored', (await sell(r.at(home))).data?.branchName, b1.name);
seen = await listed(r);
check('lists hold A and B, not the owner’s', seen.includes(sA.id) && seen.includes(sB.id) && !seen.includes(sHome.id));
const prof = (await r.get(`/reports/profitability?from=${companyToday()}&to=${companyToday()}&by=customer`)).data;
const ownerProf = (await owner.get(`/reports/profitability?from=${companyToday()}&to=${companyToday()}&by=customer`)).data;
const custRow = (p) => p.rows.find((x) => x.key === cust.id)?.revenue ?? 0;
eq('profitability: A and B only', custRow(prof), custRow(ownerProf) - sHome.subtotal);
const trendToday = (d) => d.trend.find((p) => p.date === companyToday())?.sales ?? 0;
check('dashboard counts fewer than the owner’s', trendToday((await r.get('/dashboard')).data) < trendToday((await owner.get('/dashboard')).data));

// ------------------------------------------------------------------ only some warehouses
console.log('== only some warehouses');
ok(
  'Rana: in A and B, but only the side store',
  await setAccess(owner, rana, { allBranches: false, branchIds: [b2.id], warehouseIds: [side1.id] }),
);
r = await as(rana);
eq('her token says so', r.user.warehouseIds, [side1.id]);
const whs = (await r.get('/warehouses?activeOnly=true')).data.map((w) => w.id);
eq('she sees just that store', whs, [side1.id]);
eq("A's main store is refused", (await sell(r, { warehouseId: store1.id })).data?.code, 'warehouse_not_found');
eq('no store picked, working in A: the side store', (await sell(r)).data?.lines?.[0]?.warehouseId, side1.id);
eq('working in B: no store of hers there', (await sell(r.at(b2.id))).data?.code, 'no_warehouse');
const inv = (await r.get('/inventory/items')).data.items.find((i) => i.id === item.id);
eq('stock counts only her store', inv?.stockOnHand, 7 - 1);
const card = (await r.get(`/inventory/items/${item.id}/card`)).data;
check('the item card: her store only', card.stock.every((s) => s.warehouseId === side1.id) && card.movements.every((m) => m.warehouseId === side1.id), card.stock);
eq('…and its balance', card.closingBalance, 6);
eq(
  'another store on the card is not found',
  (await r.get(`/inventory/items/${item.id}/card?warehouseId=${store1.id}`)).status,
  404,
);
const val = (await r.get('/inventory/valuation')).data;
check('valuation: her store only', val.warehouses.every((w) => w.key === side1.id), val.warehouses);
const ownerVal = (await owner.get('/inventory/valuation')).data;
check('…while the owner sees more', ownerVal.warehouses.length > val.warehouses.length);

// ------------------------------------------------------------------ only some cash boxes
console.log('== only some cash boxes');
ok(
  'Rana: every store again, but only the drawer',
  await setAccess(owner, rana, { allBranches: false, branchIds: [b2.id], moneyAccountIds: [side1Box.id] }),
);
r = await as(rana);
eq('she sees just the drawer', (await r.get('/money-accounts')).data.map((a) => a.id), [side1Box.id]);
const cash = ok('a cash sale with no account picked', await sell(r, { paidAmount: 2000 }));
const drawer = (await owner.get('/money-accounts')).data.find((a) => a.id === side1Box.id);
eq("…goes into her drawer, not A's main box", drawer.balance, 2000);
eq(
  "paying into A's main box is refused",
  (await sell(r, { paidAmount: 2000, paidAccountId: box1.id })).data?.code,
  'account_not_found',
);
eq('working in B: no cash box of hers', (await sell(r.at(b2.id), { paidAmount: 2000 })).data?.code, 'no_cash_box');
eq(
  'a receipt into the main box is refused',
  (await r.post('/receipts', { partyId: cust.id, lines: [{ method: 'CASH', accountId: box1.id, amount: 100 }] })).data?.code,
  'account_not_found',
);
const rc = ok(
  'a receipt into her drawer',
  await r.post('/receipts', { partyId: cust.id, lines: [{ method: 'CASH', accountId: side1Box.id, amount: 100 }] }),
);
eq('in the branch of that drawer', rc.branchName, b1.name);
const ownerRc = ok(
  "the owner's receipt into A's main box",
  await owner.post('/receipts', { partyId: cust.id, lines: [{ method: 'CASH', accountId: box1.id, amount: 100 }] }),
);
eq("she can't cancel it (not her box)", (await r.post(`/vouchers/${ownerRc.id}/cancel`)).status, 404);
ok('she can cancel her own', await r.post(`/vouchers/${rc.id}/cancel`));
eq("the main box's statement is not hers", (await r.get(`/money-accounts/${box1.id}/movements`)).status, 404);
void cash;

// ------------------------------------------------------------------ nobody gives more than they have
console.log('== nobody gives more than they have');
ok('Adam (admin) works only in A', await setAccess(owner, adam, { allBranches: false }));
const a = await as(adam);
eq('his token: A only', [a.user.allBranches, a.user.branches.map((b) => b.id)], [false, [b1.id]]);
eq("he can't give B", (await setAccess(a, rana, { allBranches: false, branchIds: [b2.id] })).data?.code, 'not_your_branch');
eq("…nor every branch", (await setAccess(a, rana, { allBranches: true })).data?.code, 'not_your_branch');
ok('he can keep her to A', await setAccess(a, rana, { allBranches: false }));
eq("…but not himself", (await setAccess(a, adam, { allBranches: true })).data?.code, 'own_access');
eq("an owner can't be narrowed", (await setAccess(owner, { id: owner.user.id }, { allBranches: false })).data?.code, 'owner_fixed');
eq('without the permission: refused', (await setAccess(karim, rana, {})).status, 403);
eq(
  'a store outside her branches',
  (await setAccess(owner, rana, { allBranches: false, warehouseIds: [store2.id] })).data?.code,
  'warehouse_not_found',
);
eq(
  'a cash box outside her branches',
  (await setAccess(owner, rana, { allBranches: false, moneyAccountIds: [box2.id] })).data?.code,
  'account_not_found',
);
eq('a branch that doesn’t exist', (await setAccess(owner, rana, { branchIds: ['nope'] })).data?.code, 'branch_not_found');
ok('Adam: A, and only the side store', await setAccess(owner, adam, { allBranches: false, warehouseIds: [side1.id] }));
const a2 = await as(adam);
eq(
  'he can’t give every store',
  (await setAccess(a2, rana, { allBranches: false })).data?.code,
  'not_your_warehouse',
);
ok('only the store he has', await setAccess(a2, rana, { allBranches: false, warehouseIds: [side1.id] }));
const run = ok('a payroll for the whole company…', await a2.post('/payroll/runs', { year: 2001, month: 1 }));
eq('…becomes his branch’s', run?.branchId, b1.id);
if (run) ok('(cancelled again)', await owner.post(`/payroll/runs/${run.id}/cancel`));

// ------------------------------------------------------------------ every branch
console.log('== every branch');
ok('Rana: every branch', await setAccess(owner, rana, { allBranches: true }));
r = await as(rana);
check('she sees every branch', r.user.allBranches && r.user.branches.length >= 3);
ok("the owner's sale in his branch", await r.get(`/sales/invoices/${sHome.id}`));
eq('working in the owner’s branch', (await sell(r.at(home), { warehouseId: store1.id })).data?.branchName, sHome.branchName);
ok('back to her role', await setAccess(owner, rana, {}));
r = await as(rana);
eq('as a sales person: A only', r.user.branches.map((b) => b.id), [b1.id]);

// ------------------------------------------------------------------ audit
const log = (await owner.get(`/audit?resource=staff&action=access&pageSize=50`)).data.items;
check('every change is in the activity log', log.filter((e) => e.resourceId === rana.id).length >= 5);

process.exit(summary('access') ? 1 : 0);
