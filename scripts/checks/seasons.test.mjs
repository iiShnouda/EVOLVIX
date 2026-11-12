// Seasons are the items' (owner, 2026-11-12: the department's season is gone, the item's stays): an
// item is bought for a season with its year (e.g. Summer 2026), named at the end of its name and
// filtered by; Settings may set the current season. Departments and invoices carry no season.
import { login, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
ok(
  'rules for the checks',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);

console.log('== the seasons list');
const seasons = (await owner.get('/seasons')).data;
const summer = seasons.find((s) => s.kind === 'SUMMER');
const winter = seasons.find((s) => s.kind === 'WINTER');
eq('summer and winter with their years', [!!summer?.year, !!winter?.year], [true, true]);
eq('one is current', seasons.filter((s) => s.isCurrent).length, 1);
eq('no season-of-an-invoice lookup', (await owner.get('/seasons/of?kind=SUMMER')).status, 404);

console.log('== the current season set in Settings');
const before = (await owner.get('/settings')).data.currentSeasonId ?? '';
ok('set by hand', await owner.put('/settings', { currentSeasonId: winter.id }));
eq('…marked current', (await owner.get('/seasons')).data.find((s) => s.isCurrent)?.id, winter.id);
eq(
  'a wrong one refused',
  (await owner.put('/settings', { currentSeasonId: 'x' })).data?.code,
  'bad_season',
);
ok('back as it was', await owner.put('/settings', { currentSeasonId: before }));

console.log('== a department has no season');
const dept = ok('a department', await owner.post('/departments', { name: `SnDept ${tag}` }));
eq('…no season switch', 'hasSeasons' in dept, false);
const cat = ok(
  'a category in it',
  await owner.post('/categories', { name: `SnCat ${tag}`, departmentId: dept.id }),
);

console.log('== an item bought for a season');
const item = ok(
  'an item for summer',
  await owner.post('/products', {
    name: `SnItem ${tag}`,
    categoryId: cat.id,
    seasonId: summer.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
eq('…its season', item.seasonId, summer.id);
eq('…its year at the end of its name', item.name.endsWith(String(summer.year)), true);
eq(
  'a wrong season refused',
  (
    await owner.post('/products', {
      name: `SnBad ${tag}`,
      categoryId: cat.id,
      seasonId: '00000000-0000-0000-0000-000000000000',
      units: [{ unitId: piece.id, factor: 1 }],
    })
  ).data?.code,
  'season_not_found',
);
const bySeason = async (id) => {
  const d = (
    await owner.get(`/products?seasonId=${id}&search=${encodeURIComponent(`SnItem ${tag}`)}`)
  ).data;
  return (d.items ?? d).some((p) => p.id === item.id);
};
eq('found by its season', await bySeason(summer.id), true);
eq('…not by another', await bySeason(winter.id), false);
const moved = ok(
  'moved to winter',
  await owner.put(`/products/${item.id}`, { seasonId: winter.id }),
);
eq('…its season', moved.seasonId, winter.id);

console.log('== invoices carry no season');
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `SnSup ${tag}`, types: ['SUPPLIER'] }),
);
const bought = ok(
  'bought (a season sent is ignored)',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    seasonKind: 'WINTER',
    lines: [{ productId: item.id, quantity: 30, unitCost: 500 }],
  }),
);
eq('…none kept', 'seasonKind' in bought, false);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `SnCust ${tag}`, types: ['CUSTOMER'] }),
);
const sold = ok(
  'sold in the department, no season asked',
  await owner.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    departmentId: dept.id,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
  }),
);
eq('…none kept', 'seasonKind' in sold, false);
const row = (await owner.get(`/sales/invoices?number=${sold.number}`)).data.items[0] ?? {};
eq('…nor listed', 'seasonKind' in row, false);

process.exit(summary('seasons') ? 1 : 0);
