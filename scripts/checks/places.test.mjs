// Deleting branches and warehouses (owner, 2026-10-10): one with nothing recorded goes, with its cash
// boxes; one with documents or stock can only be closed; the default warehouse, the last branch and a
// branch people belong to stay. Own permissions; the server monitor is the owner's alone. Runs
// against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES

const branchesOf = async () => (await owner.get('/branches')).data;
const boxesOf = async (branchId) =>
  (await owner.get('/money-accounts')).data.filter((a) => a.branchId === branchId);

// An empty branch goes, with its store and cash boxes.
const empty = ok('an empty branch', await owner.post('/branches', { name: `Empty ${tag}` }));
check(
  'it has a store and cash boxes',
  empty.warehouses.length === 1 && (await boxesOf(empty.id)).length >= 1,
);
eq('sales staff may not delete it', (await karim.del(`/branches/${empty.id}`)).status, 403);
eq('the owner deletes it', (await owner.del(`/branches/${empty.id}`)).status, 204);
check('gone, with its store', !(await branchesOf()).some((b) => b.id === empty.id));
eq('its cash boxes too', (await boxesOf(empty.id)).length, 0);

// A branch with a used warehouse.
const used = ok('a second branch', await owner.post('/branches', { name: `Used ${tag}` }));
const store = used.warehouses[0];
const extra = ok(
  'an extra warehouse',
  await owner.post('/warehouses', { branchId: used.id, name: `Extra ${tag}` }),
);
eq(
  'the default warehouse stays',
  (await owner.del(`/warehouses/${store.id}`)).data?.code,
  'warehouse_is_default',
);
eq('an empty warehouse goes', (await owner.del(`/warehouses/${extra.id}`)).status, 204);
eq(
  'now the default is the last one',
  (await owner.del(`/warehouses/${store.id}`)).data?.code,
  'last_warehouse',
);

const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `PlSup ${tag}`, types: ['SUPPLIER'] }),
);
const dept = ok('a department', await owner.post('/departments', { name: `Pl ${tag}` }));
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Box ${tag}`,
    departmentId: dept.id,
    units: [{ unitId: piece.id, factor: 1 }],
  }),
);
const second = ok(
  'another warehouse',
  await owner.post('/warehouses', { branchId: used.id, name: `Second ${tag}` }),
);
ok(
  'goods bought into it',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: second.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 2, unitCost: 1000 }],
  }),
);
eq(
  'a warehouse with stock and documents stays',
  (await owner.del(`/warehouses/${second.id}`)).data?.code,
  'place_in_use',
);
check(
  'still there',
  (await branchesOf()).find((b) => b.id === used.id)?.warehouses.some((w) => w.id === second.id),
);
eq('its branch stays too', (await owner.del(`/branches/${used.id}`)).data?.code, 'place_in_use');

// People belong to a branch.
const main = (await branchesOf()).find((b) => b.id === owner.user.branchId);
eq(
  'a branch people belong to stays',
  (await owner.del(`/branches/${main.id}`)).data?.code,
  'branch_has_staff',
);

// Permissions.
check(
  'the owner holds the new ones',
  ['branches:delete', 'warehouses:delete', 'system:monitor', 'system:update'].every((p) =>
    owner.user.permissions.includes(p),
  ),
);
const catalog = (await owner.get('/permissions')).data.map((p) => p.key);
check(
  'the delete permissions can be given',
  catalog.includes('branches:delete') && catalog.includes('warehouses:delete'),
);
check(
  'the server monitor and updates cannot',
  !catalog.includes('system:monitor') && !catalog.includes('system:update'),
);
const admin = (await owner.get('/roles')).data?.find?.((r) => r.role === 'ADMIN');
if (admin)
  check(
    "the admin doesn't get the server monitor or updates",
    !admin.permissions.includes('system:monitor') && !admin.permissions.includes('system:update'),
  );

summary();
