// Deleting branches and warehouses (owner, 2026-10-10): one with nothing recorded goes, with its cash
// boxes; one with documents or stock can only be closed; the default warehouse, the last branch and a
// branch people belong to stay. Departments (owner, 2026-10-11): added in the warehouses chosen (the
// others go on as they were), moved, and deleted when nothing is recorded under them. Own
// permissions; the server monitor is the owner's alone. Runs against BASE.
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

// ------------------------------------------------------------------ departments: where, and deleting
console.log('== departments');
const br = ok('a branch for departments', await owner.post('/branches', { name: `Dept ${tag}` }));
const w1 = br.warehouses[0];
const w2 = ok(
  'its second warehouse',
  await owner.post('/warehouses', { branchId: br.id, name: `W2 ${tag}` }),
);
const wh = async (id) =>
  (await owner.get('/warehouses?activeOnly=true')).data.find((w) => w.id === id);
eq('a new warehouse offers every department', (await wh(w2.id)).departmentIds ?? [], []);
const before = (await owner.get('/departments')).data.map((d) => d.id);
eq(
  'a department needs a warehouse when places are given',
  (await owner.post('/departments', { name: `Nowhere ${tag}`, warehouseIds: [] })).data?.code,
  'choose_warehouse',
);
eq(
  'an unknown warehouse',
  (
    await owner.post('/departments', {
      name: `Bad ${tag}`,
      warehouseIds: ['00000000-0000-0000-0000-000000000001'],
    })
  ).data?.code,
  'warehouse_not_found',
);
const d1 = ok(
  'a department in the first warehouse only',
  await owner.post('/departments', { name: `Shoes ${tag}`, prefix: 'SH', warehouseIds: [w1.id] }),
);
eq(
  'it says where it is',
  d1.warehouseIds?.includes(w1.id) && !d1.warehouseIds.includes(w2.id),
  true,
);
const after1 = (await wh(w1.id)).departmentIds;
check(
  'the first warehouse keeps every department it had, and has the new one',
  before.every((d) => after1.includes(d)) && after1.includes(d1.id),
);
const after2 = (await wh(w2.id)).departmentIds;
check(
  'the second keeps what it had, without the new one',
  before.every((d) => after2.includes(d)) && !after2.includes(d1.id),
);
const moved = ok(
  'moved to both',
  await owner.put(`/departments/${d1.id}`, { warehouseIds: [w1.id, w2.id] }),
);
check('now in both', moved.warehouseIds.includes(w1.id) && moved.warehouseIds.includes(w2.id));
ok(
  'and back to the second only',
  await owner.put(`/departments/${d1.id}`, { warehouseIds: [w2.id] }),
);
check('out of the first', !(await wh(w1.id)).departmentIds.includes(d1.id));

eq(
  'sales staff may not delete a department',
  (await karim.del(`/departments/${d1.id}`)).status,
  403,
);
const groupsAt = async () =>
  (await owner.get('/groups')).data.filter((g) => g.departmentId === d1.id);
const g1 = await owner.post('/groups', { departmentId: d1.id, name: `Men ${tag}` });
if (g1.status < 300)
  await owner.post('/groups', { departmentId: d1.id, parentId: g1.data.id, name: `Boots ${tag}` });
eq(
  'an empty department goes, with its groups',
  (await owner.del(`/departments/${d1.id}`)).status,
  204,
);
check('gone', !(await owner.get('/departments')).data.some((d) => d.id === d1.id));
eq('its groups too', (await groupsAt()).length, 0);
check('and from the warehouses', !(await wh(w2.id)).departmentIds.includes(d1.id));
eq('a deleted one is not found', (await owner.del(`/departments/${d1.id}`)).status, 404);

// One with an item stays (it can be closed).
const d2 = ok(
  'another department',
  await owner.post('/departments', { name: `Bags ${tag}`, warehouseIds: [w1.id] }),
);
const units = (await owner.get('/units')).data;
const cat = ok(
  'a group in it',
  await owner.post('/groups', { departmentId: d2.id, name: `Leather ${tag}` }),
);
const bag = await owner.post('/products', {
  name: `Bag ${tag}`,
  categoryId: cat.id,
  units: [{ unitId: units[0].id, factor: 1 }],
  prices: [],
});
if (bag.status < 300) {
  eq(
    'a department with items stays',
    (await owner.del(`/departments/${d2.id}`)).data?.code,
    'department_in_use',
  );
  check(
    'still there',
    (await owner.get('/departments')).data.some((d) => d.id === d2.id),
  );
} else console.log('  (item not made:', bag.data?.code, ')');
const audit = ok('audit', await owner.get('/audit?page=1&pageSize=80'));
check(
  'deleting a department is in the activity log',
  JSON.stringify(audit.items ?? audit).includes('"department"'),
);

summary();
