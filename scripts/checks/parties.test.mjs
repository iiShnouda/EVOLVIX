// Parties (owner decisions 2026-09-30): a factory is a supplier (no FACTORY type), and customers /
// suppliers carry more details — other phones, the owner / person in charge, the factory address,
// a shipping address that delivered sales start at, and notes. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const P = (body) => owner.post('/parties', body);

console.log('== a factory is a supplier');
const fac = ok(
  'add a factory the old way (FACTORY)',
  await P({ name: `Factory ${tag}`, types: ['FACTORY'] }),
);
eq('stored as a supplier', fac.types, ['SUPPLIER']);
const both = ok('FACTORY + SUPPLIER', await P({ name: `Factory2 ${tag}`, types: ['FACTORY', 'supplier'] }));
eq('listed once', both.types, ['SUPPLIER']);
const suppliers = (await owner.get(`/parties?type=SUPPLIER&search=${tag}&pageSize=100`)).data.items;
check('found under suppliers', suppliers.some((p) => p.id === fac.id), suppliers.map((p) => p.name));
const oldFilter = (await owner.get(`/parties?type=FACTORY&search=${tag}&pageSize=100`)).data.items;
check('the old FACTORY filter shows suppliers', oldFilter.some((p) => p.id === fac.id));
eq('unknown type refused', (await P({ name: `X ${tag}`, types: ['ROBOT'] })).data?.code, 'bad_type');
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
  ['Hag Sayed', ['+20 2 3333 4444', '+20 111 555 6666'], 'Mahalla — Industrial Zone', 'Pays by cheque.'],
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
const byPhone = (await owner.get(`/parties?search=${encodeURIComponent('3333 4444')}&pageSize=100`)).data.items;
check('found by another phone', byPhone.some((p) => p.id === sup.id), byPhone.map((p) => p.name));
const byOwner = (await owner.get(`/parties?search=hag%20sayed&pageSize=100`)).data.items;
check('found by the owner name', byOwner.some((p) => p.id === sup.id));

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
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
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
  ok('own delivery, typed', await sale({ deliveryMethod: 'OWN_DELIVERY', deliveryAddress: 'Gate 2' }))
    .deliveryAddress,
  'Gate 2',
);
ok('no shipping address any more', await owner.put(`/parties/${cust.id}`, { shippingAddress: '' }));
eq(
  'then the main address',
  ok('own delivery, no shipping address', await sale({ deliveryMethod: 'OWN_DELIVERY' })).deliveryAddress,
  '1 Office St.',
);

process.exit(summary('parties') ? 1 : 0);
