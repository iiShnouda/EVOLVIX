// Delivery (DOMAIN.md step 4b): adding and editing parties, the delivery method on a sale, own
// deliveries, shipments with cash on delivery, refused parcels, carrier settlements, permissions,
// branch scoping and races. Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES, main branch
const sara = await login('sara@skb.local'); // INVENTORY, the other branch

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const cust = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const supplier = (await owner.get('/parties?type=SUPPLIER&pageSize=100')).data.items[0];
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const staff = (await owner.get('/staff')).data;
const karimId = staff.find((s) => s.email === 'karim@skb.local').id;
const party = async (id) => (await owner.get(`/parties/${id}`)).data;
const stock = async (id) => (await owner.get(`/products/${id}`)).data.stockOnHand;

console.log('== parties: add and edit');
const P = (body) => owner.post('/parties', body);
const shop = ok(
  'add a customer',
  await P({
    name: `  Shop ${tag} `,
    types: ['customer'],
    phone: '0100',
    address: '5 Nile St.',
    email: `Shop.${tag}@Example.com`,
  }),
);
eq('name trimmed, type normalised', [shop.name, shop.types], [`Shop ${tag}`, ['CUSTOMER']]);
eq(
  'email lower-cased, address kept',
  [shop.email, shop.address, shop.isActive, shop.balance],
  [`shop.${tag}@example.com`, '5 Nile St.', true, 0],
);
eq(
  'duplicate name',
  (await P({ name: `shop ${tag}`, types: ['CUSTOMER'] })).data?.code,
  'duplicate_name',
);
eq('no name', (await P({ name: '  ', types: ['CUSTOMER'] })).data?.code, 'bad_name');
eq('no type', (await P({ name: `X ${tag}`, types: [] })).data?.code, 'bad_type');
eq('unknown type', (await P({ name: `X ${tag}`, types: ['ALIEN'] })).data?.code, 'bad_type');
eq(
  'bad email',
  (await P({ name: `X ${tag}`, types: ['CUSTOMER'], email: 'not-an-email' })).data?.code,
  'bad_email',
);
const shop2 = ok(
  'sales staff may add a customer',
  await karim.post('/parties', { name: `Shop2 ${tag}`, types: ['CUSTOMER'] }),
);
eq(
  'store staff may not add parties',
  (await sara.post('/parties', { name: `Y ${tag}`, types: ['CUSTOMER'] })).status,
  403,
);
const K = ok(
  'add a shipping company',
  await P({ name: `Courier ${tag}`, types: ['CARRIER'], phone: '0111' }),
);
const K2 = ok(
  'add another shipping company',
  await P({ name: `Courier2 ${tag}`, types: ['CARRIER', 'SUPPLIER'] }),
);
check(
  'carriers listed by type',
  (await owner.get('/parties?type=CARRIER&pageSize=100')).data.items.some((p) => p.id === K.id),
);
const edited = ok(
  'edit a party',
  await owner.put(`/parties/${shop2.id}`, {
    name: `Shop2b ${tag}`,
    address: '9 Road 9',
    phone: '',
  }),
);
eq(
  'edit applied, blank phone cleared',
  [edited.name, edited.address, edited.phone, edited.types],
  [`Shop2b ${tag}`, '9 Road 9', null, ['CUSTOMER']],
);
eq(
  'rename onto another party refused',
  (await owner.put(`/parties/${shop2.id}`, { name: `SHOP ${tag}` })).data?.code,
  'duplicate_name',
);
eq('store staff may not edit', (await sara.put(`/parties/${shop2.id}`, { name: 'x' })).status, 403);
const closed = ok(
  'close a party with nothing owed',
  await owner.put(`/parties/${shop2.id}`, { isActive: false }),
);
eq('closed', closed.isActive, false);
ok('a closed name can be reused', await P({ name: `Shop2b ${tag}`, types: ['CUSTOMER'] }));
eq(
  'reopening onto a used name refused',
  (await owner.put(`/parties/${shop2.id}`, { isActive: true, name: `Shop2b ${tag}` })).data?.code,
  'duplicate_name',
);
eq(
  'unknown party',
  (await owner.put(`/parties/00000000-0000-0000-0000-000000000000`, { name: 'x' })).status,
  404,
);

// Items with stock to sell.
const make = async (name, price) =>
  ok(
    `item ${name}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: cust.id, price }],
    }),
  );
const A = await make('DelivA', 1000),
  B = await make('DelivB', 2500);
ok(
  'stock in',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: A.id, quantity: 500, unitCost: 600 },
      { productId: B.id, quantity: 500, unitCost: 1500 },
    ],
  }),
);
const sale = (who, body, lines = [{ productId: A.id, quantity: 2, unitPrice: 1000 }]) =>
  who.post('/sales/invoices', {
    partyId: shop.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines,
    ...body,
  });

console.log('== delivery method on a sale');
const pick = ok('a plain sale is picked up', await sale(owner, {}));
eq(
  'pickup has no delivery status',
  [pick.deliveryMethod, pick.deliveryStatus, pick.deliveryAddress],
  ['PICKUP', null, null],
);
eq('unknown method', (await sale(owner, { deliveryMethod: 'DRONE' })).data?.code, 'bad_delivery');
eq(
  'driver must exist',
  (
    await sale(owner, {
      deliveryMethod: 'OWN_DELIVERY',
      driverId: '00000000-0000-0000-0000-000000000000',
    })
  ).data?.code,
  'driver_not_found',
);
eq(
  'carrier needed',
  (await sale(owner, { deliveryMethod: 'SHIPPING_COMPANY' })).data?.code,
  'carrier_not_found',
);
eq(
  'a customer is not a carrier',
  (await sale(owner, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: shop.id })).data?.code,
  'carrier_not_found',
);
const own = ok(
  'own delivery with a driver',
  await sale(owner, { deliveryMethod: 'own_delivery', driverId: karimId }),
);
eq(
  'own delivery pending, address from the customer',
  [own.deliveryMethod, own.deliveryStatus, own.deliveryAddress, own.driverName],
  ['OWN_DELIVERY', 'PENDING', '5 Nile St.', 'Karim Sales'],
);
const own2 = ok(
  'own delivery to another address',
  await sale(karim, { deliveryMethod: 'OWN_DELIVERY', deliveryAddress: '  Gate 3  ' }),
);
eq('address typed wins', [own2.deliveryAddress, own2.driverName], ['Gate 3', null]);
const readBack = ok('read back', await owner.get(`/sales/invoices/${own.id}`));
eq(
  'detail keeps delivery',
  [readBack.deliveryMethod, readBack.deliveryStatus, readBack.driverId],
  ['OWN_DELIVERY', 'PENDING', karimId],
);

console.log('== own delivery');
const setD = (who, id, body) => who.put(`/sales/invoices/${id}/delivery`, body);
const list = ok('deliveries list', await owner.get('/deliveries?pageSize=100'));
check(
  'own delivery listed, pickup not',
  list.items.some((d) => d.documentId === own.id) &&
    !list.items.some((d) => d.documentId === pick.id),
);
check(
  'filter by status',
  (await owner.get('/deliveries?status=PENDING&method=OWN_DELIVERY&pageSize=100')).data.items.every(
    (d) => d.status === 'PENDING' && d.method === 'OWN_DELIVERY',
  ),
);
eq(
  'pending is not a step',
  (await setD(owner, own.id, { status: 'PENDING' })).data?.code,
  'bad_status',
);
eq('unknown step', (await setD(owner, own.id, { status: 'LOST' })).data?.code, 'bad_status');
eq(
  'a picked-up sale has no delivery',
  (await setD(owner, pick.id, { status: 'DELIVERED' })).data?.code,
  'not_delivered',
);
let r = ok(
  'out for delivery (sales staff)',
  await setD(karim, own.id, { status: 'OUT_FOR_DELIVERY', driverId: karimId }),
);
eq('status moved', r.delivery.status, 'OUT_FOR_DELIVERY');
eq(
  'not twice',
  (await setD(owner, own.id, { status: 'OUT_FOR_DELIVERY' })).data?.code,
  'bad_transition',
);
r = ok('delivered', await setD(owner, own.id, { status: 'DELIVERED' }));
eq('delivered, nothing returned', [r.delivery.status, r.returns], ['DELIVERED', []]);
eq(
  'delivered is final',
  (await setD(owner, own.id, { status: 'RETURNED' })).data?.code,
  'bad_transition',
);
eq(
  'store staff of another branch cannot see it',
  (await setD(sara, own2.id, { status: 'DELIVERED' })).status,
  404,
);
check(
  'nor list it',
  !(await sara.get('/deliveries?pageSize=100')).data.items.some((d) => d.documentId === own2.id),
);
// Sales people may post returns now (owner, 2026-09-30); one it was taken from may not.
const nrTag = Date.now().toString(36).slice(-5);
const noReturnP = ok('a seller without returns', await owner.post('/staff', {
  fullName: `No returns ${nrTag}`, email: `noret.${nrTag}@skb.local`, password: 'Str0ngPass!', role: 'SALES',
  branchId: owner.user.branchId,
}));
ok('returns taken from them', await owner.put(`/staff/${noReturnP.id}/permissions`, { granted: [], revoked: ['sales:return'] }));
const noReturn = await login(`noret.${nrTag}@skb.local`, 'Str0ngPass!');
eq(
  'without the return permission, no return is posted',
  (await setD(noReturn, own2.id, { status: 'RETURNED', createReturn: true })).data?.code,
  'return_not_allowed',
);
const balBefore = (await party(shop.id)).balance,
  stockBefore = await stock(A.id);
r = ok(
  'refused at the door, goods returned',
  await setD(owner, own2.id, { status: 'RETURNED', createReturn: true }),
);
eq('one return posted', [r.delivery.status, r.returns.length, r.problems], ['RETURNED', 1, []]);
eq('goods back in stock', await stock(A.id), stockBefore + 2);
eq('customer owes nothing for it', (await party(shop.id)).balance, balBefore - own2.grandTotal);
eq('invoice returned', (await owner.get(`/sales/invoices/${own2.id}`)).data.status, 'RETURNED');

console.log('== shipments');
const ship = (who, body) => who.post('/shipments', body);
const viaK = (who, body = {}, lines) =>
  sale(who, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: K.id, ...body }, lines);
const i1 = ok(
  'sale 1 with the courier',
  await viaK(owner, {}, [{ productId: A.id, quantity: 3, unitPrice: 1000 }]),
);
const i2 = ok(
  'sale 2, part paid',
  await viaK(owner, { paidAmount: 1000 }, [{ productId: B.id, quantity: 2, unitPrice: 2500 }]),
);
const other = ok('another customer', await P({ name: `Other ${tag}`, types: ['CUSTOMER'] }));
const i3 = ok(
  'sale to another customer',
  await owner.post('/sales/invoices', {
    partyId: other.id,
    warehouseId: wh.id,
    taxPercent: 0,
    deliveryMethod: 'SHIPPING_COMPANY',
    carrierId: K.id,
    lines: [{ productId: A.id, quantity: 1, unitPrice: 1000 }],
    paidAmount: 1000,
  }),
);
const i5 = ok(
  'sale with the other courier',
  await sale(owner, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: K2.id }),
);
eq(
  'shipping sale moves with its shipment',
  (await setD(owner, i1.id, { status: 'DELIVERED' })).data?.code,
  'use_shipment',
);
const elig = ok(
  'waiting for the courier',
  await owner.get(`/shipments/eligible?carrierId=${K.id}`),
);
eq(
  "eligible: the courier's sales only",
  elig.map((d) => d.documentId).sort(),
  [i1.id, i2.id, i3.id].sort(),
);
eq('outstanding shown', elig.find((d) => d.documentId === i2.id).outstanding, 4000);
eq(
  'no invoices',
  (await ship(owner, { carrierId: K.id, invoiceIds: [] })).data?.code,
  'no_invoices',
);
eq(
  'not a carrier',
  (await ship(owner, { carrierId: shop.id, invoiceIds: [i1.id] })).data?.code,
  'carrier_not_found',
);
eq(
  'mixed customers',
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id, i3.id] })).data?.code,
  'mixed_customers',
);
eq(
  "another courier's sale",
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id, i5.id] })).data?.code,
  'wrong_carrier',
);
eq(
  "own delivery can't ship",
  (await ship(owner, { carrierId: K.id, invoiceIds: [own.id] })).data?.code,
  'wrong_carrier',
);
eq(
  "returned invoice can't ship",
  (await ship(owner, { carrierId: K.id, invoiceIds: [own2.id] })).data?.code,
  'invoice_closed',
);
eq(
  'COD over what is owed',
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id, i2.id], codAmount: 7001 })).data?.code,
  'bad_cod',
);
eq(
  'negative COD',
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id], codAmount: -1 })).data?.code,
  'bad_cod',
);
eq(
  'same invoice twice',
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id, i1.id] })).data?.code,
  'invoice_not_found',
);
eq(
  'unknown invoice',
  (await ship(owner, { carrierId: K.id, invoiceIds: ['00000000-0000-0000-0000-000000000000'] }))
    .data?.code,
  'invoice_not_found',
);
eq(
  "store staff of another branch can't ship main-branch sales",
  (await ship(sara, { carrierId: K.id, invoiceIds: [i1.id] })).data?.code,
  'invoice_not_found',
);

let s1 = ok(
  'parcel for two invoices (sales staff)',
  await ship(karim, { carrierId: K.id, invoiceIds: [i2.id, i1.id], waybillNo: ' WB-1 ' }),
);
eq(
  'COD defaults to what is owed',
  [s1.codAmount, s1.status, s1.waybillNo],
  [3000 + 4000, 'CREATED', 'WB-1'],
);
eq(
  'COD shared per invoice',
  s1.invoices.map((i) => [i.number, i.codShare]),
  [
    [i1.number, 3000],
    [i2.number, 4000],
  ].sort(),
);
check('numbered SHP-', /^SHP-\d{4}-\d{6}$/.test(s1.number), s1.number);
eq(
  'invoice already in a parcel',
  (await ship(owner, { carrierId: K.id, invoiceIds: [i1.id] })).data?.code,
  'already_shipped',
);
check(
  'no longer eligible',
  !(await owner.get(`/shipments/eligible?carrierId=${K.id}`)).data.some(
    (d) => d.documentId === i1.id,
  ),
);
const dl = (await owner.get('/deliveries?method=SHIPPING_COMPANY&pageSize=100')).data.items.find(
  (d) => d.documentId === i1.id,
);
eq('delivery shows its parcel', [dl.shipmentNumber, dl.shipmentStatus], [s1.number, 'CREATED']);
eq('cancel', (await owner.post(`/shipments/${s1.id}/cancel`)).data?.status, 'CANCELLED');
eq('cancel twice', (await owner.post(`/shipments/${s1.id}/cancel`)).data?.code, 'bad_transition');
eq(
  "a cancelled parcel can't be picked up",
  (await owner.post(`/shipments/${s1.id}/picked-up`)).data?.code,
  'bad_transition',
);
check(
  'eligible again after cancel',
  (await owner.get(`/shipments/eligible?carrierId=${K.id}`)).data.some(
    (d) => d.documentId === i1.id,
  ),
);

// A parcel collecting only part of what's owed: the older invoice is paid first.
s1 = ok(
  'parcel with part COD',
  await ship(owner, { carrierId: K.id, invoiceIds: [i1.id, i2.id], codAmount: 5000 }),
);
eq(
  'COD shared oldest first',
  s1.invoices.map((i) => [i.number, i.codShare]).sort(),
  [
    [i1.number, 3000],
    [i2.number, 2000],
  ].sort(),
);
eq(
  'settle before delivery',
  (await owner.post('/carrier-settlements', { carrierId: K.id, shipmentIds: [s1.id], received: 1 }))
    .data?.code,
  'not_settleable',
);
eq("sara can't see the parcel", (await sara.get(`/shipments/${s1.id}`)).status, 404);
eq('nor move it', (await sara.post(`/shipments/${s1.id}/picked-up`)).status, 404);
check(
  'nor list it',
  !(await sara.get('/shipments?pageSize=100')).data.items.some((s) => s.id === s1.id),
);
eq('picked up', (await karim.post(`/shipments/${s1.id}/picked-up`)).data?.status, 'PICKED_UP');
eq(
  'invoices out for delivery',
  (await owner.get(`/sales/invoices/${i1.id}`)).data.deliveryStatus,
  'OUT_FOR_DELIVERY',
);
eq(
  'too late to cancel',
  (await owner.post(`/shipments/${s1.id}/cancel`)).data?.code,
  'bad_transition',
);
eq(
  'not picked up twice',
  (await owner.post(`/shipments/${s1.id}/picked-up`)).data?.code,
  'bad_transition',
);

// Delivered with COD: the customer's debt moves to the courier, in one step even if clicked twice at once.
const custBefore = (await party(shop.id)).balance,
  kBefore = (await party(K.id)).balance;
const race = await Promise.all([
  owner.post(`/shipments/${s1.id}/delivered`),
  mona.post(`/shipments/${s1.id}/delivered`),
]);
eq('delivered once when clicked twice', race.map((x) => x.status).sort(), [200, 400]);
eq('customer paid the courier', (await party(shop.id)).balance, custBefore - 5000);
eq('courier owes the COD', (await party(K.id)).balance, kBefore + 5000);
const d1 = (await owner.get(`/sales/invoices/${i1.id}`)).data,
  d2 = (await owner.get(`/sales/invoices/${i2.id}`)).data;
eq('invoice 1 paid', [d1.paidAmount, d1.status, d1.deliveryStatus], [3000, 'PAID', 'DELIVERED']);
eq('invoice 2 part paid', [d2.paidAmount, d2.status], [3000, 'PARTIALLY_PAID']);
eq(
  "a delivered parcel can't come back",
  (await owner.post(`/shipments/${s1.id}/returned`, { createReturns: false })).data?.code,
  'bad_transition',
);
const s1d = ok('read shipment', await owner.get(`/shipments/${s1.id}`));
check('delivery time kept', s1d.deliveredAt && s1d.pickedUpAt, s1d);

console.log('== prepaid and refused parcels');
const s3 = ok('prepaid parcel', await ship(owner, { carrierId: K.id, invoiceIds: [i3.id] }));
eq('nothing to collect', s3.codAmount, 0);
const otherBefore = (await party(other.id)).balance,
  kMid = (await party(K.id)).balance;
eq(
  'delivered straight away',
  (await owner.post(`/shipments/${s3.id}/delivered`)).data?.status,
  'DELIVERED',
);
eq(
  'no money moves',
  [(await party(other.id)).balance, (await party(K.id)).balance],
  [otherBefore, kMid],
);
eq(
  'a prepaid parcel is not settled',
  (await owner.post('/carrier-settlements', { carrierId: K.id, shipmentIds: [s3.id], received: 0 }))
    .data?.code,
  'not_settleable',
);

const i6 = ok(
  'sale to be refused',
  await viaK(owner, {}, [{ productId: B.id, quantity: 4, unitPrice: 2500 }]),
);
const i7 = ok(
  'second sale to be refused',
  await viaK(owner, {}, [{ productId: A.id, quantity: 1, unitPrice: 1000 }]),
);
const s4 = ok(
  'parcel to be refused',
  await ship(owner, { carrierId: K.id, invoiceIds: [i6.id, i7.id] }),
);
ok('picked up', await owner.post(`/shipments/${s4.id}/picked-up`));
eq(
  "without the return permission, no returns are posted",
  (await noReturn.post(`/shipments/${s4.id}/returned`, {})).data?.code,
  'return_not_allowed',
);
const bBefore = await stock(B.id),
  aBefore = await stock(A.id),
  shopBefore = (await party(shop.id)).balance,
  kBefore2 = (await party(K.id)).balance;
const back = ok('refused, goods back', await owner.post(`/shipments/${s4.id}/returned`, {}));
eq(
  'two returns, no problems',
  [back.shipment.status, back.returns.length, back.problems],
  ['RETURNED', 2, []],
);
eq('stock back', [await stock(B.id), await stock(A.id)], [bBefore + 4, aBefore + 1]);
eq(
  'customer owes nothing for them',
  (await party(shop.id)).balance,
  shopBefore - i6.grandTotal - i7.grandTotal,
);
eq('courier untouched', (await party(K.id)).balance, kBefore2);
eq(
  'invoices returned',
  [
    (await owner.get(`/sales/invoices/${i6.id}`)).data.status,
    (await owner.get(`/sales/invoices/${i6.id}`)).data.deliveryStatus,
  ],
  ['RETURNED', 'RETURNED'],
);
check(
  'a returned invoice is not eligible',
  !(await owner.get(`/shipments/eligible?carrierId=${K.id}`)).data.some(
    (d) => d.documentId === i6.id,
  ),
);

const i8 = ok(
  'sale refused without a return',
  await viaK(owner, {}, [{ productId: A.id, quantity: 1, unitPrice: 1000 }]),
);
const s5 = ok('parcel', await ship(karim, { carrierId: K.id, invoiceIds: [i8.id] }));
const noRet = ok(
  'sales staff mark it refused (no return)',
  await karim.post(`/shipments/${s5.id}/returned`, { createReturns: false }),
);
eq('no return posted', [noRet.shipment.status, noRet.returns], ['RETURNED', []]);
check(
  'eligible again to resend',
  (await owner.get(`/shipments/eligible?carrierId=${K.id}`)).data.some(
    (d) => d.documentId === i8.id,
  ),
);

console.log('== outstanding after a partial return');
const i9 = ok(
  'sale of 4',
  await viaK(owner, {}, [{ productId: A.id, quantity: 4, unitPrice: 1000 }]),
);
const line = (await owner.get(`/sales/invoices/${i9.id}`)).data.lines[0];
ok(
  'one piece returned before shipping',
  await owner.post(`/sales/invoices/${i9.id}/returns`, {
    lines: [{ lineId: line.id, quantity: 1 }],
  }),
);
eq(
  'owed less the return',
  (await owner.get(`/shipments/eligible?carrierId=${K.id}`)).data.find(
    (d) => d.documentId === i9.id,
  ).outstanding,
  3000,
);
eq(
  "COD can't collect the returned piece",
  (await ship(owner, { carrierId: K.id, invoiceIds: [i9.id], codAmount: 3001 })).data?.code,
  'bad_cod',
);
const s9 = ok('parcel for the rest', await ship(owner, { carrierId: K.id, invoiceIds: [i9.id] }));
eq('COD = 3 pieces', s9.codAmount, 3000);

console.log('== one invoice, one parcel, under a race');
const i10 = ok(
  'sale for the race',
  await viaK(owner, {}, [{ productId: A.id, quantity: 1, unitPrice: 1000 }]),
);
const both = await Promise.all([
  ship(owner, { carrierId: K.id, invoiceIds: [i10.id] }),
  ship(mona, { carrierId: K.id, invoiceIds: [i10.id] }),
]);
eq('only one parcel made', both.map((x) => x.status).sort(), [201, 400]);
eq('the other told why', both.find((x) => x.status === 400).data?.code, 'already_shipped');

console.log('== carrier settlement');
const settle = (who, body) => who.post('/carrier-settlements', body);
eq(
  "sales staff can't settle",
  (await settle(karim, { carrierId: K.id, shipmentIds: [s1.id], received: 1 })).status,
  403,
);
eq(
  'negative fees',
  (await settle(owner, { carrierId: K.id, shipmentIds: [s1.id], fees: -1 })).data?.code,
  'bad_amount',
);
eq(
  'no parcels',
  (await settle(owner, { carrierId: K.id, shipmentIds: [] })).data?.code,
  'no_shipments',
);
eq(
  'other courier',
  (await settle(owner, { carrierId: K2.id, shipmentIds: [s1.id] })).data?.code,
  'wrong_carrier',
);
eq(
  'not a carrier',
  (await settle(owner, { carrierId: shop.id, shipmentIds: [s1.id] })).data?.code,
  'carrier_not_found',
);
ok('parcel 9 picked up', await owner.post(`/shipments/${s9.id}/picked-up`));
ok('parcel 9 delivered', await owner.post(`/shipments/${s9.id}/delivered`));
const kPre = (await party(K.id)).balance;
const st = ok(
  'courier pays for two parcels, keeping its fees and paying short',
  await settle(mona, {
    carrierId: K.id,
    shipmentIds: [s1.id, s9.id],
    fees: 450,
    received: 7300,
    notes: 'weekly',
  }),
);
eq('settlement totals', [st.codTotal, st.fees, st.received, st.difference], [8000, 450, 7300, 250]);
eq('parcels on it', st.shipments.sort(), [s1.number, s9.number].sort());
check('numbered CST-', /^CST-\d{4}-\d{6}$/.test(st.number), st.number);
eq('courier still owes the difference', (await party(K.id)).balance, kPre - 450 - 7300);
const s1s = (await owner.get(`/shipments/${s1.id}`)).data;
eq('parcel settled', [s1s.status, s1s.settlementNumber], ['SETTLED', st.number]);
eq(
  'settle twice',
  (await settle(owner, { carrierId: K.id, shipmentIds: [s1.id] })).data?.code,
  'not_settleable',
);
check(
  'settlement listed',
  (await owner.get(`/carrier-settlements?carrierId=${K.id}`)).data.some((x) => x.id === st.id),
);
check(
  'sara sees no main-branch settlement',
  !(await sara.get('/carrier-settlements')).data.some((x) => x.id === st.id),
);
eq(
  'a settled parcel stays on its customer',
  (await owner.post(`/shipments/${s1.id}/returned`, { createReturns: false })).data?.code,
  'bad_transition',
);
eq(
  "carrier with a balance can't be closed",
  (await owner.put(`/parties/${K.id}`, { isActive: false })).data?.code,
  'has_balance',
);

console.log('== permissions and scoping of lists');
ok('sales staff list shipments', await karim.get('/shipments'));
ok('store staff list deliveries', await sara.get('/deliveries'));
const settled = (await owner.get(`/shipments?status=SETTLED&carrierId=${K.id}&pageSize=100`)).data
  .items;
check(
  'status filter',
  settled.every((x) => x.status === 'SETTLED') &&
    [s1.id, s9.id].every((id) => settled.some((x) => x.id === id)),
  settled,
);
eq(
  'unknown shipment',
  (await owner.get('/shipments/00000000-0000-0000-0000-000000000000')).status,
  404,
);
const noAuth = await fetch(`${BASE}/shipments`);
eq('signed out', noAuth.status, 401);

process.exit(summary('delivery') ? 1 : 0);
