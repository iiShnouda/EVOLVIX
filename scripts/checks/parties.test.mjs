// Parties (owner decisions 2026-09-30): a factory is a supplier (no FACTORY type), and customers /
// suppliers carry more details — other phones, the owner / person in charge, the factory address,
// a shipping address that delivered sales start at, and notes. Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const P = (body) => owner.post('/parties', body);

console.log('== a factory is a supplier');
const fac = ok(
  'add a factory the old way (FACTORY)',
  await P({ name: `Factory ${tag}`, types: ['FACTORY'] }),
);
eq('stored as a supplier', fac.types, ['SUPPLIER']);
const both = ok(
  'FACTORY + SUPPLIER',
  await P({ name: `Factory2 ${tag}`, types: ['FACTORY', 'supplier'] }),
);
eq('listed once', both.types, ['SUPPLIER']);
const suppliers = (await owner.get(`/parties?type=SUPPLIER&search=${tag}&pageSize=100`)).data.items;
check(
  'found under suppliers',
  suppliers.some((p) => p.id === fac.id),
  suppliers.map((p) => p.name),
);
const oldFilter = (await owner.get(`/parties?type=FACTORY&search=${tag}&pageSize=100`)).data.items;
check(
  'the old FACTORY filter shows suppliers',
  oldFilter.some((p) => p.id === fac.id),
);
eq(
  'unknown type refused',
  (await P({ name: `X ${tag}`, types: ['ROBOT'] })).data?.code,
  'bad_type',
);
eq('a number is not a type', (await P({ name: `X2 ${tag}`, types: ['7'] })).data?.code, 'bad_type');

console.log('== details');
const sup = ok(
  'a supplier with its owner, factory address and phones',
  await P({
    name: `Weaver ${tag}`,
    types: ['SUPPLIER'],
    contactName: '  Hag Sayed  ',
    phone: '+20 100 111 2222',
    otherPhones: [' +20 2 3333 4444 ', '', '+20 100 111 2222', '+20 111 555 6666'],
    address: 'Mahalla — Industrial Zone',
    notes: 'Pays by cheque.',
  }),
);
eq(
  'saved clean (blank and the main phone dropped)',
  [sup.contactName, sup.otherPhones, sup.address, sup.notes],
  [
    'Hag Sayed',
    ['+20 2 3333 4444', '+20 111 555 6666'],
    'Mahalla — Industrial Zone',
    'Pays by cheque.',
  ],
);
eq(
  'more than five other phones refused',
  (
    await P({
      name: `Phones ${tag}`,
      types: ['CUSTOMER'],
      otherPhones: ['1', '2', '3', '4', '5', '6'],
    })
  ).data?.code,
  'too_many_phones',
);
const byPhone = (await owner.get(`/parties?search=${encodeURIComponent('3333 4444')}&pageSize=100`))
  .data.items;
check(
  'found by another phone',
  byPhone.some((p) => p.id === sup.id),
  byPhone.map((p) => p.name),
);
const byOwner = (await owner.get(`/parties?search=hag%20sayed&pageSize=100`)).data.items;
check(
  'found by the owner name',
  byOwner.some((p) => p.id === sup.id),
);

const edited = ok(
  'edit: clear the notes and other phones, leave the rest',
  await owner.put(`/parties/${sup.id}`, { notes: '', otherPhones: [] }),
);
eq(
  'only those changed',
  [edited.notes, edited.otherPhones, edited.contactName, edited.address],
  [null, [], 'Hag Sayed', 'Mahalla — Industrial Zone'],
);
eq('read back', (await owner.get(`/parties/${sup.id}`)).data.contactName, 'Hag Sayed');

console.log('== shipping address on delivered sales');
const cust = ok(
  'a customer with a shipping address',
  await P({
    name: `Buyer ${tag}`,
    types: ['CUSTOMER'],
    address: '1 Office St.',
    shippingAddress: 'Store 4, Market St.',
  }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Ship ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
ok(
  'stock in',
  await owner.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 600 }],
  }),
);
const sale = (body) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
    ...body,
  });
eq(
  'delivery starts at the shipping address',
  ok('own delivery', await sale({ deliveryMethod: 'OWN_DELIVERY' })).deliveryAddress,
  'Store 4, Market St.',
);
eq(
  'a typed address still wins',
  ok(
    'own delivery, typed',
    await sale({ deliveryMethod: 'OWN_DELIVERY', deliveryAddress: 'Gate 2' }),
  ).deliveryAddress,
  'Gate 2',
);
ok('no shipping address any more', await owner.put(`/parties/${cust.id}`, { shippingAddress: '' }));
eq(
  'then the main address',
  ok('own delivery, no shipping address', await sale({ deliveryMethod: 'OWN_DELIVERY' }))
    .deliveryAddress,
  '1 Office St.',
);

console.log('== items and their main supplier');
const karim = await login('karim@skb.local'); // SALES: no purchases:view
const suppLevel = (await owner.get('/price-levels')).data.find((l) => l.side === 'PURCHASE' && l.isDefault);
const S2 = ok('second supplier', await P({ name: `Loom ${tag}`, types: ['SUPPLIER'] }));
const newItem = (name, body = {}) =>
  owner.post('/products', {
    name: `${name} ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    ...body,
  });
const W = ok(
  'an item with its supplier and the supplier code',
  await newItem('Towel', {
    supplierId: sup.id,
    supplierCode: '  W-77/b ',
    prices: [
      { unitId: piece.id, priceLevelId: level.id, price: 123450 },
      { unitId: piece.id, priceLevelId: suppLevel.id, price: 777 },
    ],
  }),
);
eq('saved', [W.supplierId, W.supplierName, W.supplierCode], [sup.id, `Weaver ${tag}`, 'W-77/b']);
eq('a customer is not a supplier', (await newItem('Bad1', { supplierId: cust.id })).data?.code, 'supplier_not_found');
eq('an unknown supplier', (await newItem('Bad2', { supplierId: 'nope' })).data?.code, 'supplier_not_found');

const find = async (who, q) => (await who.get(`/products?${q}`)).data ?? [];
const ids = (rows) => rows.map((r) => r.id);
// The Ship item above was bought from Weaver, so it became Weaver's too.
eq('only that supplier', ids(await find(owner, `supplierId=${sup.id}`)).sort(), [W.id, item.id].sort());
check('by the supplier code', ids(await find(owner, 'search=w-77')).includes(W.id));
check('by the sale price', ids(await find(owner, 'search=1234.5')).includes(W.id));
check('by the sale price in Arabic digits', ids(await find(owner, `search=${encodeURIComponent('١٬٢٣٤٫٥')}`)).includes(W.id));
check('by the supplier price (purchases staff)', ids(await find(owner, 'search=7.77')).includes(W.id));
check(
  'not by the supplier price for sales staff',
  !ids(await find(karim, 'search=7.77')).includes(W.id),
);
check('sales staff still find the sale price', ids(await find(karim, 'search=1234.50')).includes(W.id));
eq('filter + search together', ids(await find(owner, `supplierId=${S2.id}&search=towel`)), []);

const cleared = ok(
  'edit: clear the supplier, keep the code',
  await owner.put(`/products/${W.id}`, { supplierId: '' }),
);
eq('cleared', [cleared.supplierId, cleared.supplierCode], [null, 'W-77/b']);

console.log('== the first supplier bought from becomes the main one');
const Fresh = ok('an item with no supplier', await newItem('Fresh'));
const Kept = ok('an item already from Weaver', await newItem('Kept', { supplierId: sup.id }));
ok(
  'buy both from Loom',
  await owner.post('/purchases/invoices', {
    partyId: S2.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: Fresh.id, quantity: 2, unitCost: 500 },
      { productId: Kept.id, quantity: 2, unitCost: 500 },
    ],
  }),
);
eq('set on the new one', (await owner.get(`/products/${Fresh.id}`)).data.supplierId, S2.id);
eq('kept on the other', (await owner.get(`/products/${Kept.id}`)).data.supplierId, sup.id);

console.log('== a model and its variants follow one supplier');
const small = ok('size', await owner.post('/variant-options', { kind: 'SIZE', name: `S${tag}` }));
const large = ok('size', await owner.post('/variant-options', { kind: 'SIZE', name: `L${tag}` }));
const M = ok(
  'a model from Weaver',
  await owner.post('/models', {
    name: `Robe ${tag}`,
    categoryId: cat.id,
    sizeIds: [small.id],
    colorIds: [],
    units: [{ unitId: piece.id, factor: 1 }],
    supplierId: sup.id,
    supplierCode: 'R-1',
  }),
);
const v1 = (await owner.get(`/products/${M.variants[0].productId}`)).data;
eq('its variant follows', [v1.supplierId, v1.supplierCode], [sup.id, 'R-1']);
eq(
  'a variant cannot change it on its own',
  (await owner.put(`/products/${v1.id}`, { supplierId: S2.id })).data?.code,
  'variant_managed_by_model',
);
const M2 = ok(
  'move the model to Loom and add a size',
  await owner.put(`/models/${M.id}`, { supplierId: S2.id, supplierCode: 'R-2', addSizeIds: [large.id] }),
);
eq('model saved', [M2.supplierId, M2.supplierCode], [S2.id, 'R-2']);
const vs = await Promise.all(M2.variants.map(async (v) => (await owner.get(`/products/${v.productId}`)).data));
eq(
  'every variant (old and new) follows',
  vs.map((v) => [v.supplierId, v.supplierCode]),
  vs.map(() => [S2.id, 'R-2']),
);
eq('found under Loom', ids(await find(owner, `supplierId=${S2.id}`)).sort(), [Fresh.id, ...vs.map((v) => v.id)].sort());

console.log('== contacts, extra address, temporary shipping company, ID card photos');
const contact = ok(
  'a customer with named phones and a second address',
  await P({
    name: `Contacts ${tag}`,
    types: ['CUSTOMER'],
    phone: '0100 000 0001',
    otherPhones: ['0100 000 0002', '0100 000 0003', '0100 000 0002'],
    otherPhoneLabels: ['his brother', '', 'dup'],
    address: '1 Main St',
    extraAddress: '9 Market Rd',
    extraAddressLabel: 'The shop',
    tempCarrierName: 'Fast Boxes',
  }),
);
eq('phones kept once, each with its name', [contact.otherPhones, contact.otherPhoneLabels], [['0100 000 0002', '0100 000 0003'], ['his brother', '']]);
eq('second address', [contact.extraAddress, contact.extraAddressLabel], ['9 Market Rd', 'The shop']);
eq('temporary shipping company', contact.tempCarrierName, 'Fast Boxes');
const relabeled = ok('rename a phone', await owner.put(`/parties/${contact.id}`, { otherPhones: ['0100 000 0003'], otherPhoneLabels: ['office'] }));
eq('labels follow their phones', [relabeled.otherPhones, relabeled.otherPhoneLabels], [['0100 000 0003'], ['office']]);

const upload = async (who, side, bytes, type = 'image/jpeg') => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), 'photo');
  const r = await fetch(`${BASE}/parties/${contact.id}/id-card/${side}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${who.token}` },
    body: form,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]);
const front = ok('keep the front of the ID card', await upload(owner, 'front', jpeg));
eq('marked kept', [front.hasIdFront, front.hasIdBack], [true, false]);
eq('not a photo is refused', (await upload(owner, 'back', new TextEncoder().encode('<script>alert(1)</script> not an image'))).data?.code, 'bad_photo');
eq('only front or back', (await upload(owner, 'side', jpeg)).status, 404);
const got = await fetch(`${BASE}/parties/${contact.id}/id-card/front`, { headers: { authorization: `Bearer ${owner.token}` } });
eq('served back as it was, never cached', [got.status, got.headers.get('content-type'), got.headers.get('cache-control'), (await got.arrayBuffer()).byteLength], [200, 'image/jpeg', 'no-store', jpeg.length]);
const viewerEmail = `viewer.${tag}@skb.local`;
ok('a viewer', await owner.post('/staff', { fullName: `Viewer ${tag}`, email: viewerEmail, password: 'Str0ngPass!', role: 'VIEWER', branchId: owner.user.branchId }));
const viewer = await login(viewerEmail, 'Str0ngPass!');
{
  eq("someone without the permission can't see it", (await viewer.get(`/parties/${contact.id}/id-card/front`)).status, 403);
  eq("…or keep one", (await upload(viewer, 'back', jpeg)).status, 403);
}
const removed = ok('remove it', await owner.del(`/parties/${contact.id}/id-card/front`));
eq('no longer kept', removed.hasIdFront, false);
eq('gone', (await owner.get(`/parties/${contact.id}/id-card/front`)).status, 404);

// ------------------------------------------------------------------ every field optional (owner, 2026-10-22)
console.log('== nothing but the kind');
const bare = ok('a customer with no details at all', await owner.post('/parties', { types: ['CUSTOMER'] }));
eq('named after its kind and code', bare.name, `عميل ${bare.code}`);
const bareSupplier = ok('a supplier the same', await owner.post('/parties', { name: '', types: ['SUPPLIER'] }));
eq('…named as a supplier', bareSupplier.name, `مورد ${bareSupplier.code}`);
eq('an existing one still keeps a name', (await owner.put(`/parties/${bare.id}`, { name: '' })).data?.code, 'bad_name');

process.exit(summary('parties') ? 1 : 0);
