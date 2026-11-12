// The store's screens (owner, 2026-11-10): the warehouse statement adds up, the stock statuses
// (run out is "out", not "at the reorder level"), the department shown is the main one, the
// stocktake by branch / warehouse / department / factory, and transfers by period and place.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const owner = await login('owner@skb.local');
const today = companyToday();
const tag = Date.now().toString(36);
const stores = ok('warehouses', await owner.get('/warehouses?activeOnly=true'));
const wh = stores[0];

console.log('== the warehouse statement adds up');
{
  const st = async (from, to) =>
    ok(
      `statement ${from}..${to}`,
      await owner.get(`/inventory/warehouses/${wh.id}/statement?from=${from}&to=${to}`),
    );
  const week = await st(addDays(today, -6), today);
  eq('opening + in − out = closing', week.opening + week.in - week.out, week.closing);
  const inLines = week.lines.filter((l) => l.quantity > 0).reduce((s, l) => s + l.quantity, 0);
  const outLines = -week.lines.filter((l) => l.quantity < 0).reduce((s, l) => s + l.quantity, 0);
  if (week.lines.length < 5000) {
    eq('in = the lines in', week.in, inLines);
    eq('out = the lines out', week.out, outLines);
  }
  const day = await st(today, today);
  const before = await st(addDays(today, -6), addDays(today, -1));
  eq("a day's opening = the day before's closing", day.opening, before.closing);
  eq('values add up too', before.closingValue, day.openingValue);
  const swapped = await st(today, addDays(today, -6));
  eq('days given the wrong way round still work', swapped.closing, week.closing);
}

console.log('== an item of a group under a department, from a factory, none in stock');
const units = ok('units', await owner.get('/units'));
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name)) ?? units[0];
const levels = ok('price levels', await owner.get('/price-levels'));
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
let departments = ok('departments', await owner.get('/departments')).filter((d) => d.isActive);
const dept =
  departments[0] ?? ok('a department', await owner.post('/departments', { name: `Men ${tag}` }));
const dept2 = ok('another department', await owner.post('/departments', { name: `Kids ${tag}` }));
const polo = ok(
  'a group',
  await owner.post('/groups', { name: `Polo ${tag}`, departmentId: dept.id }),
);
const factory = ok(
  'a factory',
  await owner.post('/parties', { name: `Factory ${tag}`, types: ['SUPPLIER'] }),
);
const factory2 = ok(
  'another factory',
  await owner.post('/parties', { name: `Factory2 ${tag}`, types: ['SUPPLIER'] }),
);
const newItem = async (name, categoryId, supplierId, reorderLevel = 0) =>
  ok(
    `item ${name}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId,
      supplierId,
      reorderLevel,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
    }),
  );
const shirt = await newItem('Shirt', polo.id, factory.id, 5);
const socks = ok(
  'a group of the other',
  await owner.post('/groups', { name: `Socks ${tag}`, departmentId: dept2.id }),
);
const sock = await newItem('Sock', socks.id, factory2.id);
const listed = async (q) => (await owner.get(`/inventory/items?pageSize=500&${q}`)).data.items;

console.log('== run out is "out", not "at the reorder level"');
{
  const found = (await listed(`code=${encodeURIComponent(shirt.sku)}`)).find(
    (i) => i.id === shirt.id,
  );
  eq('none left is not "low"', found?.isLow, false);
  const lows = await listed('status=low');
  check(
    'the low list has none run out',
    lows.every((i) => i.stockOnHand > 0),
    lows.slice(0, 3),
  );
  check(
    'the out list has it',
    (await listed('status=out')).some((i) => i.id === shirt.id),
  );
  const finder = (await owner.get('/products?stock=low&limit=200')).data;
  check(
    'the item finder: low has none run out',
    finder.every((p) => p.stockOnHand > 0),
    finder.slice(0, 2),
  );
  check(
    'the item finder: out has it',
    (
      await owner.get(`/products?stock=out&limit=200&search=${encodeURIComponent(shirt.name)}`)
    ).data.some((p) => p.id === shirt.id),
  );
}

console.log('== the department shown is the main one; the supplier with its code');
{
  const found = (await listed(`departmentId=${dept.id}&groupId=${polo.id}`)).find(
    (i) => i.id === shirt.id,
  );
  eq('an item of a group shows its department', found?.categoryName, dept.name);
  eq('the supplier', found?.supplierName, factory.name);
  eq('with its code', found?.supplierPartyCode, factory.code);
  const sorted = (await owner.get('/inventory/items?pageSize=50&sort=supplierCode')).data.items;
  const codes = sorted.map((i) => i.supplierPartyCode ?? Infinity);
  check(
    'sorted by supplier code',
    codes.every((c, i) => i === 0 || codes[i - 1] <= c),
    codes.slice(0, 10),
  );
}

console.log('== the stocktake by branch, warehouse, department and factory');
const wh2 =
  stores.find((w) => w.id !== wh.id && w.branchId !== wh.branchId) ??
  stores.find((w) => w.id !== wh.id);
check('two warehouses to count', !!wh2, stores.length);
{
  const sheet = async (q) => ok(`sheet ${q}`, await owner.get(`/inventory/stocktake/sheet?${q}`));
  const one = await sheet(`warehouseId=${wh.id}&supplierId=${factory.id}`);
  check(
    'one warehouse: every item of the factory, none in stock too',
    one.rows.some((r) => r.productId === shirt.id && r.quantity === 0),
    one.rows.length,
  );
  check(
    'only that factory',
    one.rows.every((r) => r.supplier === factory.name),
  );
  const row = one.rows.find((r) => r.productId === shirt.id);
  eq('the code and the name each on its own', [row?.code, row?.name], [shirt.sku, shirt.name]);
  // The first count, in two warehouses at once.
  const first = ok(
    'count two warehouses at once',
    await owner.post('/inventory/stocktake', {
      lines: [
        { productId: shirt.id, countedQuantity: 7, warehouseId: wh.id },
        { productId: sock.id, countedQuantity: 4, warehouseId: wh2.id },
        { productId: shirt.id, countedQuantity: 3, warehouseId: wh2.id },
      ],
    }),
  );
  eq('three lines changed', first.itemsChanged, 3);
  check(
    'one reference for both',
    first.reference.startsWith('ADJ-') && first.movements.length === 3,
  );
  const all = await sheet(`supplierId=${factory.id}`);
  const shirts = all.rows.filter((r) => r.productId === shirt.id);
  eq('several warehouses: the item in each it is in', shirts.map((r) => r.quantity).sort(), [3, 7]);
  const branch = await sheet(`branchId=${wh2.branchId}&departmentId=${dept2.id}`);
  check(
    'a branch and a department',
    branch.rows.length > 0 &&
      branch.rows.every((r) => r.department === dept2.name && r.branch === wh2.branchName),
    branch.rows.slice(0, 2),
  );
  check(
    'the sock there',
    branch.rows.some((r) => r.productId === sock.id && r.quantity === 4),
  );
  const searched = await sheet(`search=${encodeURIComponent(shirt.sku)}`);
  check(
    'by code',
    searched.rows.length >= 1 && searched.rows.every((r) => r.productId === shirt.id),
  );
  eq(
    'a count for one factory adjusts no other',
    (
      await owner.post('/inventory/stocktake', {
        supplierId: factory.id,
        lines: [{ productId: sock.id, countedQuantity: 1, warehouseId: wh2.id }],
      })
    ).data?.code,
    'outside_stocktake',
  );
  eq(
    'nor one for a department another',
    (
      await owner.post('/inventory/stocktake', {
        departmentId: dept2.id,
        lines: [{ productId: shirt.id, countedQuantity: 1, warehouseId: wh.id }],
      })
    ).data?.code,
    'outside_stocktake',
  );
  if (wh2.branchId !== wh.branchId)
    eq(
      'nor one for a branch another',
      (
        await owner.post('/inventory/stocktake', {
          branchId: wh2.branchId,
          lines: [{ productId: shirt.id, countedQuantity: 1, warehouseId: wh.id }],
        })
      ).data?.code,
      'outside_stocktake',
    );
  ok(
    'within its scope',
    await owner.post('/inventory/stocktake', {
      supplierId: factory.id,
      departmentId: dept.id,
      lines: [{ productId: shirt.id, countedQuantity: 6, warehouseId: wh.id }],
    }),
  );
  const after = (await listed(`code=${encodeURIComponent(shirt.sku)}&warehouseId=${wh.id}`)).find(
    (i) => i.id === shirt.id,
  );
  eq('the books follow the count', after?.stockOnHand, 6);
  const sara = await login('sara@skb.local');
  const hers = await sara.get(`/inventory/stocktake/sheet?warehouseId=${wh.id}`);
  check('store staff open the sheet', [200, 404].includes(hers.status), hers.status);
  const karim = await login('karim@skb.local');
  eq('a sales person does not', (await karim.get('/inventory/stocktake/sheet')).status, 403);
}

console.log('== transfers by period, from, to and department');
{
  const send = async (from, to, item, quantity) =>
    ok(
      `send ${quantity}`,
      await owner.post('/transfers', {
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        lines: [{ productId: item.id, quantity }],
      }),
    );
  const t1 = await send(wh, wh2, shirt, 2);
  const t2 = await send(wh2, wh, sock, 1);
  eq(
    'each line with its code and department',
    [t1.lines[0].code, t1.lines[0].department],
    [shirt.sku, dept.name],
  );
  eq('the transfer names its departments', t1.departments, [dept.name]);
  eq('and its branches', [t1.fromBranchId, t1.toBranchId], [wh.branchId, wh2.branchId]);
  const list = async (q) => ok(`transfers ${q}`, await owner.get(`/transfers?pageSize=100&${q}`));
  const ids = (r) => r.items.map((x) => x.id);
  const period = `from=${today}&to=${today}`;
  const out = await list(`${period}&fromWarehouseId=${wh.id}&toWarehouseId=${wh2.id}`);
  check('from one warehouse to another', ids(out).includes(t1.id) && !ids(out).includes(t2.id));
  check(
    'every one found goes that way',
    out.items.every((x) => x.fromWarehouseId === wh.id && x.toWarehouseId === wh2.id),
  );
  const back = await list(`${period}&fromBranchId=${wh2.branchId}&toBranchId=${wh.branchId}`);
  check(
    'from one branch to another',
    ids(back).includes(t2.id) &&
      back.items.every((x) => x.fromBranchId === wh2.branchId && x.toBranchId === wh.branchId),
  );
  const ofDept = await list(`${period}&departmentId=${dept2.id}`);
  check('by department', ids(ofDept).includes(t2.id) && !ids(ofDept).includes(t1.id));
  const before = await list(`from=${addDays(today, -9)}&to=${addDays(today, -1)}`);
  check('not in an earlier period', !ids(before).includes(t1.id) && !ids(before).includes(t2.id));
  const all = await list(period);
  eq(
    'the pieces of all found',
    all.quantity,
    all.items.reduce((s, x) => s + x.quantity, 0),
  );
  check('with their value', typeof all.value === 'number');
  const places = ok('the places to filter by', await owner.get('/transfers/places'));
  check(
    'both ends there',
    [wh.id, wh2.id].every((id) => places.some((p) => p.warehouseId === id)),
    places.length,
  );
}

console.log('== the valuation: totals, by warehouse and branch, by department, at sale prices');
{
  const v = ok('valuation', await owner.get('/inventory/valuation'));
  eq(
    'warehouses add up to the total',
    v.warehouses.reduce((s, r) => s + r.quantity, 0),
    v.quantity,
  );
  eq(
    'their values too',
    v.warehouses.reduce((s, r) => s + r.value, 0),
    v.value,
  );
  eq(
    'and at sale prices',
    v.warehouses.reduce((s, r) => s + r.saleValue, 0),
    v.saleValue,
  );
  check(
    'each warehouse with its branch',
    v.warehouses.every((r) => r.group),
    v.warehouses[0],
  );
  eq(
    'departments add up too',
    v.categories.reduce((s, r) => s + r.quantity, 0),
    v.quantity,
  );
  const row = v.items.find((r) => r.productId === shirt.id && r.quantity > 0);
  eq('an item with its supplier code', row?.supplierPartyCode, factory.code);
  const g = ok(
    'one group',
    await owner.get(`/inventory/valuation?departmentId=${dept.id}&groupId=${polo.id}`),
  );
  check(
    'only its items',
    g.items.length > 0 && g.items.every((r) => r.productId === shirt.id),
    g.items.map((r) => r.label),
  );
}

process.exit(summary('stock') ? 1 : 0);
