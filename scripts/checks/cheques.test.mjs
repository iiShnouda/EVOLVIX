// Cheques the way the owner works them (owner, 2026-10-02): several at once (a series), when each
// came and who brought it, settling the oldest invoices, a photo kept per cheque (only real photos,
// never cached), found by number / bank / party, and lost papers. Runs against BASE.
import { BASE, login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const today = companyToday();
ok(
  'returns at once, no department rule',
  await owner.put('/settings', { returnAfterHours: 0, requireDepartment: false }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `ChqCust ${tag}`, types: ['CUSTOMER'] }),
);
const sup = ok(
  'a supplier',
  await owner.post('/parties', { name: `ChqSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'an item',
  await owner.post('/products', {
    name: `Chq ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 10000 }],
  }),
);
ok(
  'stock',
  await owner.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 20, unitCost: 5000 }],
  }),
);
const sell = (q) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: q, unitPrice: 10000 }],
  });
const i1 = ok('first invoice 200.00', await sell(2));
const i2 = ok('second invoice 300.00', await sell(3));

console.log('== three cheques at once, every month, oldest invoice first');
const cheque = (n, amount, allocations) => ({
  partyId: cust.id,
  kind: 'CHEQUE',
  serialNumber: `${tag}-${n}`,
  amount,
  dueDate: addDays(today, 30 * n),
  bankName: 'Banque Misr',
  receivedOn: addDays(today, -1),
  broughtBy: 'Ahmed the driver',
  allocations,
});
eq(
  "sales staff can't take cheques",
  (await karim.post('/notes/receive-many', { notes: [cheque(1, 100)] })).status,
  403,
);
eq('nothing given', (await mona.post('/notes/receive-many', { notes: [] })).data?.code, 'no_notes');
const bad = await mona.post('/notes/receive-many', {
  notes: [
    cheque(1, 20000, [{ documentId: i1.id, amount: 20000 }]),
    cheque(2, 100, [{ documentId: i1.id, amount: 100 }]),
  ],
});
eq('a bad one stops them all', bad.data?.code, 'over_outstanding');
eq('…and says which', bad.data?.index, 1);
const before = (await owner.get(`/parties/${cust.id}`)).data.balance;
const made = ok(
  'the series',
  await mona.post('/notes/receive-many', {
    notes: [
      cheque(1, 20000, [{ documentId: i1.id, amount: 20000 }]),
      cheque(2, 15000, [{ documentId: i2.id, amount: 15000 }]),
      cheque(3, 15000, [{ documentId: i2.id, amount: 15000 }]),
    ],
  }),
);
eq('three saved', made.length, 3);
eq(
  'monthly due dates',
  made.map((n) => n.dueDate),
  [1, 2, 3].map((n) => addDays(today, 30 * n)),
);
eq('received yesterday', made[0].receivedOn, addDays(today, -1));
eq('who brought it', made[0].broughtBy, 'Ahmed the driver');
eq(
  'customer owes 500.00 less',
  (await owner.get(`/parties/${cust.id}`)).data.balance,
  before - 50000,
);
eq('first invoice settled', (await owner.get(`/sales/invoices/${i1.id}`)).data.paidAmount, 20000);
eq('second invoice settled', (await owner.get(`/sales/invoices/${i2.id}`)).data.paidAmount, 30000);

console.log('== the photo of a cheque');
const upload = async (who, id, bytes, type = 'image/jpeg') => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), 'photo');
  const r = await fetch(`${BASE}/notes/${id}/photo`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${who.token}` },
    body: form,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
eq(
  'not a real photo refused',
  (await upload(mona, made[0].id, svg, 'image/jpeg')).data?.code,
  'bad_photo',
);
eq("sales staff can't add one", (await upload(karim, made[0].id, jpeg)).status, 403);
const withPhoto = ok('photo kept', await upload(mona, made[0].id, jpeg));
check('marked as having a photo', withPhoto.hasPhoto === true);
const got = await fetch(`${BASE}/notes/${made[0].id}/photo`, {
  headers: { authorization: `Bearer ${mona.token}` },
});
eq('served back', got.status, 200);
eq('never cached', got.headers.get('cache-control'), 'no-store');
eq('as a JPEG', got.headers.get('content-type'), 'image/jpeg');
eq('the same bytes', new Uint8Array(await got.arrayBuffer()).length, jpeg.length);
ok('removed', await mona.del(`/notes/${made[0].id}/photo`));
eq('gone', (await mona.get(`/notes/${made[0].id}`)).data.hasPhoto, false);

console.log('== finding a cheque in hand');
const bySerial = ok('by its number', await mona.get(`/notes?search=${tag}-2`));
eq(
  'found it',
  bySerial.items.map((n) => n.id),
  [made[1].id],
);
const byParty = ok(
  'by the customer',
  await mona.get(`/notes?search=${encodeURIComponent(`ChqCust ${tag}`)}`),
);
eq('all three', byParty.items.length, 3);
const byCode = ok("by the customer's code", await mona.get(`/notes?search=${cust.code}`));
check(
  'found by code',
  byCode.items.some((n) => n.partyId === cust.id),
);

console.log('== a lost cheque');
const owedBefore = (await owner.get(`/parties/${cust.id}`)).data.balance;
const lost = ok(
  'lost',
  await mona.post(`/notes/${made[2].id}/lost`, { remark: 'fell from the car' }),
);
eq('marked lost', lost.status, 'LOST');
eq(
  'the customer owes it again',
  (await owner.get(`/parties/${cust.id}`)).data.balance,
  owedBefore + 15000,
);
eq(
  'its invoice is open again',
  (await owner.get(`/sales/invoices/${i2.id}`)).data.paidAmount,
  15000,
);
eq('not twice', (await mona.post(`/notes/${made[2].id}/lost`, {})).data?.code, 'bad_transition');
eq("sales staff can't", (await karim.post(`/notes/${made[1].id}/lost`, {})).status, 403);

console.log('== expense items and accounts: added and removed from the withdraw / deposit page');
const item1 = ok(
  'an expense item',
  await owner.post('/expense-categories', { name: `Tea ${tag}` }),
);
ok('deleted while unused', await owner.del(`/expense-categories/${item1.id}`), 204);
const item2 = ok('another item', await owner.post('/expense-categories', { name: `Fuel ${tag}` }));
const boxes = (await owner.get('/money-accounts')).data;
const mainBox = boxes.find(
  (a) => a.isDefault && a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId,
);
ok(
  'money in the box',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: mainBox.id, amount: 5000 }],
  }),
);
ok(
  'an expense on it',
  await owner.post('/expenses', {
    categoryId: item2.id,
    lines: [{ method: 'CASH', accountId: mainBox.id, amount: 1000 }],
  }),
);
eq('a used item stays', (await owner.del(`/expense-categories/${item2.id}`)).data?.code, 'in_use');
eq(
  "sales staff can't delete items",
  (await karim.del(`/expense-categories/${item2.id}`)).status,
  403,
);
const spare = ok(
  'a new cash box',
  await owner.post('/money-accounts', {
    name: `Spare ${tag}`,
    kind: 'CASH_BOX',
    branchId: owner.user.branchId,
  }),
);
ok('deleted while nothing went through it', await owner.del(`/money-accounts/${spare.id}`), 204);
check(
  'gone from the list',
  !(await owner.get('/money-accounts')).data.some((a) => a.id === spare.id),
);
eq(
  'the main box stays',
  (await owner.del(`/money-accounts/${mainBox.id}`)).data?.code,
  'is_default',
);
const used = ok(
  'another box',
  await owner.post('/money-accounts', {
    name: `Used ${tag}`,
    kind: 'CASH_BOX',
    branchId: owner.user.branchId,
  }),
);
ok(
  'money into it',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: used.id, amount: 100 }],
  }),
);
eq('one with money stays', (await owner.del(`/money-accounts/${used.id}`)).data?.code, 'in_use');

summary('cheques');
