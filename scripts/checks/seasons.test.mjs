// Seasons on invoices (owner, 2026-11-10): a department may come by season; a new invoice in it
// names its season after the department — summer, winter or none on a sale, summer or winter on a
// purchase; only the kind is the invoice's, the year is the items' (from the invoice's date).
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

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

console.log('== a department with seasons');
const plain = ok(
  'a department, seasons not asked for',
  await owner.post('/departments', { name: `SnPlain ${tag}` }),
);
eq('…has none', plain.hasSeasons, false);
const dept = ok(
  'a department with seasons',
  await owner.post('/departments', { name: `SnDept ${tag}`, hasSeasons: true }),
);
eq('…has them', dept.hasSeasons, true);
const off = ok('switched off', await owner.put(`/departments/${plain.id}`, { hasSeasons: true }));
eq('…and on', off.hasSeasons, true);
ok('…and off again', await owner.put(`/departments/${plain.id}`, { hasSeasons: false }));
eq(
  'listed with it',
  (await owner.get('/departments')).data.find((d) => d.id === dept.id)?.hasSeasons,
  true,
);

const cat = ok(
  'a category in it',
  await owner.post('/categories', { name: `SnCat ${tag}`, departmentId: dept.id }),
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `SnItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `SnSup ${tag}`, types: ['SUPPLIER'] }),
);

console.log('== purchases: summer or winter');
const buy = (extra = {}) =>
  owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 30, unitCost: 500 }],
    ...extra,
  });
eq('"no season" is not a purchase’s', (await buy({ seasonKind: 'NONE' })).data?.code, 'bad_season');
const p1 = ok('bought for winter', await buy({ seasonKind: 'WINTER' }));
eq('…kept', p1.seasonKind, 'WINTER');
eq(
  '…listed',
  (await owner.get(`/purchases/invoices?number=${p1.number}`)).data.items[0]?.seasonKind,
  'WINTER',
);
const of = async (kind, date) => (await owner.get(`/seasons/of?kind=${kind}&date=${date}`)).data;
eq(
  'winter bought in November 2026 is winter 2027',
  [of && (await of('WINTER', '2026-11-11')).kind, (await of('WINTER', '2026-11-11')).year],
  ['WINTER', 2027],
);
eq('summer bought then is summer 2027', (await of('SUMMER', '2026-11-11')).year, 2027);
eq('winter bought in February 2027 is that winter', (await of('WINTER', '2027-02-10')).year, 2027);
eq('summer bought in May 2026 is that summer', (await of('SUMMER', '2026-05-10')).year, 2026);
eq('winter bought in May 2026 is the next one', (await of('WINTER', '2026-05-10')).year, 2027);
const far = await of('SUMMER', '2023-06-01');
eq('an older one is added when asked', [far.kind, far.year], ['SUMMER', 2023]);
eq('a kind is needed', (await owner.get('/seasons/of?kind=NONE')).data?.code, 'bad_season');

console.log('== sales: summer, winter or none, after the department');
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `SnCust ${tag}`, types: ['CUSTOMER'] }),
);
const sale = (extra = {}) => ({
  partyId: customer.id,
  warehouseId: wh.id,
  departmentId: dept.id,
  lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
  ...extra,
});
eq(
  'without the season it is refused',
  (await owner.post('/sales/invoices', sale())).data?.code,
  'season_required',
);
eq(
  'an unknown one too',
  (await owner.post('/sales/invoices', sale({ seasonKind: 'SPRING' }))).data?.code,
  'bad_season',
);
const s1 = ok('a summer sale', await owner.post('/sales/invoices', sale({ seasonKind: 'SUMMER' })));
eq('…kept', s1.seasonKind, 'SUMMER');
const s2 = ok(
  'a sale of no season',
  await owner.post('/sales/invoices', sale({ seasonKind: 'NONE' })),
);
eq('…kept', s2.seasonKind, 'NONE');
const pc = ok(
  'a department without seasons asks none',
  await owner.post('/sales/invoices', sale({ departmentId: undefined })),
);
eq('…none kept', pc.seasonKind ?? null, null);
const ids = async (q) =>
  (
    await owner.get(`/sales/invoices?pageSize=200&from=${companyToday()}&to=${companyToday()}&${q}`)
  ).data.items.map((d) => d.id);
check('the summer list has the summer sale', (await ids('season=SUMMER')).includes(s1.id));
check('…not the other', !(await ids('season=SUMMER')).includes(s2.id));
check('the "no season" list has the other', (await ids('season=NONE')).includes(s2.id));
eq(
  'listed with its season',
  (await owner.get(`/sales/invoices?number=${s1.number}`)).data.items[0]?.seasonKind,
  'SUMMER',
);
const e1 = ok(
  'changed without naming it: it keeps its season',
  await owner.put(
    `/sales/invoices/${s1.id}`,
    sale({ lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }] }),
  ),
);
eq('…summer still', e1.seasonKind, 'SUMMER');
const e2 = ok(
  'changed to winter',
  await owner.put(`/sales/invoices/${s1.id}`, sale({ seasonKind: 'WINTER' })),
);
eq('…winter', e2.seasonKind, 'WINTER');

console.log('== pending invoices keep it');
const PASS = 'Str0ngPass!';
const s = ok(
  'a seller who only saves pending invoices',
  await owner.post('/staff', {
    fullName: `Sn Rep ${tag}`,
    email: `sn.${tag}@skb.local`,
    password: PASS,
    role: 'SALES',
    branchId: owner.user.branchId,
  }),
);
ok(
  '…so',
  await owner.put(`/staff/${s.id}/permissions`, {
    granted: ['sales:order'],
    revoked: ['sales:create'],
  }),
);
const rep = await login(`sn.${tag}@skb.local`, PASS);
eq(
  'a pending one needs it too',
  (await rep.post('/sales/orders', sale())).data?.code,
  'season_required',
);
const o1 = ok(
  'a winter pending invoice',
  await rep.post('/sales/orders', sale({ seasonKind: 'WINTER' })),
);
eq('…kept', o1.seasonKind, 'WINTER');
const o2 = ok(
  'changed by its maker without naming it',
  await rep.put(
    `/sales/orders/${o1.id}`,
    sale({ lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }] }),
  ),
);
eq('…still winter', o2.seasonKind, 'WINTER');
const approved = ok('approved', await owner.post(`/sales/orders/${o2.id}/approve`, {}));
eq('the invoice is winter', approved.seasonKind, 'WINTER');

process.exit(summary('seasons') ? 1 : 0);
