import { login, ok, check, eq, summary } from './lib.mjs';
const o = await login('owner@skb.local');
const depts = ok('departments', await o.get('/departments'));
let d = depts.find((x) => x.name === 'داخلي');
if (!d) d = ok('dept', await o.post('/departments', { name: 'داخلي', prefix: 'UND' }));
else await o.put(`/departments/${d.id}`, { prefix: 'UND' });
const sfx = Date.now().toString(36).slice(-4);
const men = ok(
  'men',
  await o.post('/groups', {
    name: 'رجالي' + sfx,
    departmentId: d.id,
    prefix: 'M',
    keywords: ['رجالي'],
  }),
);
const vest = ok(
  'vest',
  await o.post('/groups', {
    name: 'فانلة' + sfx,
    departmentId: d.id,
    parentId: men.id,
    prefix: 'V',
    keywords: ['فنيله', 'فانلة'],
  }),
);
const half = ok(
  'half',
  await o.post('/groups', {
    name: 'نصف كم' + sfx,
    departmentId: d.id,
    parentId: vest.id,
    prefix: 'HS',
    keywords: ['نص كم', 'نص'],
  }),
);
check(
  'dup sibling refused',
  (await o.post('/groups', { name: 'فانلة' + sfx, departmentId: d.id, parentId: men.id }))
    .status === 400,
);
check('loop refused', (await o.put(`/groups/${men.id}`, { parentId: half.id })).status === 400);
const nc = ok(
  'next code',
  await o.get(`/products/next-code?departmentId=${d.id}&groupId=${half.id}`),
);
console.log('next code', nc.code);
check('code has path', /UND-M-V-HS-\d{5}$/.test(nc.code), nc);
const units = ok('units', await o.get('/units'));
const p = ok(
  'create',
  await o.post('/products', {
    name: 'ادم فانلة رجالي نص كم ' + sfx,
    departmentId: d.id,
    groupId: half.id,
    units: [{ unitId: units[0].id, factor: 1 }],
  }),
);
console.log('created', p.sku, p.units);
check('sku path', p.sku.includes('UND-M-V-HS-'), p.sku);
const bc = p.units[0].barcode;
check('auto ean13', /^20\d{11}$/.test(bc), bc);
// search with typo/variant spellings
for (const q of ['فنيله ' + sfx, 'ريجالي ' + sfx, 'فانله رجالى', 'فنله']) {
  const r = ok('search ' + q, await o.get(`/products?search=${encodeURIComponent(q)}`));
  check(
    'found by ' + q,
    r.some((x) => x.id === p.id),
    r.map((x) => x.name),
  );
}
const typo = ok('typo', await o.get(`/products?search=${encodeURIComponent('فاتلة ' + sfx)}`));
check(
  'typo found',
  typo.some((x) => x.id === p.id),
  typo.map((x) => x.name),
);
const byGroup = ok('group filter', await o.get(`/products?groupId=${men.id}`));
check(
  'subtree filter',
  byGroup.some((x) => x.id === p.id),
);
const groups = ok('groups', await o.get('/groups'));
eq('men count', groups.find((g) => g.id === men.id).itemCount, 1);
const bar = ok('assign', await o.post('/products/barcodes', [p.id]));
eq('keeps barcode', bar[p.id], bc);
summary('tree');
