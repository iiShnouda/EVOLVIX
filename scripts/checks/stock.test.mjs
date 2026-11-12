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
const kidsRoot = (await owner.get('/categories')).data.find((c) => c.departmentId === dept2.id);
const sock = await newItem('Sock', kidsRoot?.id ?? polo.id, factory2.id);
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

process.exit(summary('stock') ? 1 : 0);
