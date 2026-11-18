// The detailed search of each list (owner, 2026-11-16): the filters the server gained for it —
// invoices by rep and amount, parties by phone, cheques by bank and amount, vouchers by number,
// period and amount, cash handovers, deliveries and transfers by number, the activity log by words
// and branch, and items by sale price. Every one narrows a list already limited to what the person
// may see. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const today = companyToday();
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
ok('no department rule', await owner.put('/settings', { requireDepartment: false }));

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.isDefault && a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId,
);
const item = ok(
  'an item at 100.00',
  await owner.post('/products', {
    name: `Filter ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 10000 }],
  }),
);
const supp = ok(
  'a supplier',
  await owner.post('/parties', { name: `FSup ${tag}`, types: ['SUPPLIER'] }),
);
const buy = (qty) =>
  owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: qty, unitCost: 5000 }],
  });
ok('a small purchase (10 × 50.00)', await buy(10));
ok('a big purchase (100 × 50.00)', await buy(100));
const cust = ok(
  'a customer with a phone',
  await owner.post('/parties', {
    name: `FCust ${tag}`,
    types: ['CUSTOMER'],
    phone: '+20 100 777 8899',
  }),
);
const reps = ok('the reps list', await owner.get('/sales/reps'));
const rep = reps.find((r) => r.id !== owner.user.id) ?? reps[0];
const sell = (qty, extra = {}) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: qty, unitPrice: 10000 }],
    ...extra,
  });
const small = ok('a sale of 100.00', await sell(1));
const big = ok('a sale of 300.00 by a rep', await sell(3, { repId: rep.id }));

console.log('== sales and purchases: rep and amount');
const sales = async (q) =>
  (await owner.get(`/sales/invoices?partyCode=${cust.code}&pageSize=50&${q}`)).data.items.map(
    (d) => d.id,
  );
eq('both without a filter', (await sales('')).sort(), [small.id, big.id].sort());
eq('from 200.00 up: the big one', await sales('min=20000'), [big.id]);
eq('up to 150.00: the small one', await sales('max=15000'), [small.id]);
eq('between 50 and 150', await sales('min=5000&max=15000'), [small.id]);
eq('nothing above 1000.00', await sales('min=100000'), []);
eq('by the rep', await sales(`repId=${rep.id}`), [big.id]);
eq('an amount that is not a number is ignored', (await sales('min=abc')).length, 2);
const purchases = async (q) =>
  (await owner.get(`/purchases/invoices?partyCode=${supp.code}&pageSize=50&${q}`)).data.items;
eq('purchases from 1000.00 up', (await purchases('min=100000')).length, 1);
eq('purchases up to 1000.00', (await purchases('max=100000')).length, 1);
eq(
  'the reps list opens for the accountant (sales:view)',
  (await mona.get('/sales/reps')).status,
  200,
);

console.log('== parties: by phone');
const byPhone = async (phone) =>
  (await owner.get(`/parties?phone=${encodeURIComponent(phone)}&pageSize=50`)).data.items.map(
    (p) => p.id,
  );
check('part of the number, without spaces', (await byPhone('1007778')).includes(cust.id));
check('typed with spaces', (await byPhone('100 777 88')).includes(cust.id));
check('another number does not find it', !(await byPhone('5550001')).includes(cust.id));

console.log('== cheques: bank and amount');
const bank = ok('a bank to draw on', await owner.post('/banks', { name: `Bank ${tag}` }));
const note = ok(
  'a cheque of 75.00',
  await owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: `F${tag}`,
    amount: 7500,
    dueDate: today,
    bankId: bank.id,
  }),
);
const notes = async (q) =>
  (await owner.get(`/notes?partyId=${cust.id}&${q}`)).data.items.map((n) => n.id);
eq('by the bank', await notes(`bankId=${bank.id}`), [note.id]);
eq('another bank', await notes('bankId=00000000-0000-0000-0000-000000000001'), []);
eq('amount from 70.00', await notes('min=7000'), [note.id]);
eq('amount up to 50.00', await notes('max=5000'), []);

console.log('== vouchers: number, period and amount');
const receipt = ok(
  'a receipt of 42.00',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 4200 }],
  }),
);
const vouchers = async (q) =>
  (await owner.get(`/vouchers?partyId=${cust.id}&${q}`)).data.items.map((v) => v.id);
eq('by its number', await vouchers(`number=${encodeURIComponent(receipt.number)}`), [receipt.id]);
eq('another number', await vouchers('number=NO-SUCH-1'), []);
eq('today', await vouchers(`from=${today}&to=${today}`), [receipt.id]);
eq('tomorrow on', await vouchers(`from=${addDays(today, 1)}`), []);
eq('until yesterday', await vouchers(`to=${addDays(today, -1)}`), []);
eq('amount between 40 and 45', await vouchers('min=4000&max=4500'), [receipt.id]);
eq('amount from 50.00', await vouchers('min=5000'), []);
const paged = (await owner.get('/vouchers?pageSize=1&page=2')).data;
eq('a page at a time', [paged.page, paged.items.length <= 1], [2, true]);

console.log('== cash handovers, deliveries, transfers: by number');
const hand = ok('handovers', await owner.get('/cash-handovers'));
if (hand.length > 0) {
  const h = hand[0];
  check(
    'a handover by its number',
    (await owner.get(`/cash-handovers?number=${encodeURIComponent(h.number)}`)).data.some(
      (x) => x.id === h.id,
    ),
  );
  check(
    'by a box on either side',
    (await owner.get(`/cash-handovers?accountId=${h.fromAccountId}`)).data.every(
      (x) => x.fromAccountId === h.fromAccountId || x.toAccountId === h.fromAccountId,
    ),
  );
}
eq('no handover above any amount', (await owner.get('/cash-handovers?min=999999999')).data, []);
eq(
  'no delivery with that number',
  (await owner.get('/deliveries?number=NO-SUCH-1')).data.items,
  [],
);
eq(
  'no delivery for another shipping company',
  (await owner.get('/deliveries?carrierId=00000000-0000-0000-0000-000000000001')).data.items,
  [],
);
const transfers = (await owner.get('/transfers?pageSize=5')).data.items;
if (transfers.length > 0)
  eq(
    'a transfer by its number',
    (
      await owner.get(`/transfers?number=${encodeURIComponent(transfers[0].number)}`)
    ).data.items.map((x) => x.id),
    [transfers[0].id],
  );
eq('no transfer with that number', (await owner.get('/transfers?number=NO-SUCH-1')).data.items, []);

console.log('== activity log: words and branch');
const words = (await owner.get(`/audit?search=${tag}&pageSize=200`)).data.items;
check('the changes naming this run are found', words.length > 0);
check(
  'each has the words in its details',
  words.every((e) => (e.details ?? '').toLowerCase().includes(tag)),
);
const inBranch = (await owner.get(`/audit?branchId=${owner.user.branchId}&pageSize=20`)).data.items;
const branchName = owner.user.branches?.find((b) => b.id === owner.user.branchId)?.name;
check(
  'by branch',
  inBranch.length > 0 && inBranch.every((e) => !branchName || e.branchName === branchName),
);

console.log('== items: by sale price');
const items = async (q) =>
  (
    await owner.get(`/inventory/items?search=${encodeURIComponent(`Filter ${tag}`)}&${q}`)
  ).data.items.map((i) => i.id);
eq('price up to 150.00', await items('priceMax=15000'), [item.id]);
eq('price from 150.00', await items('priceMin=15000'), []);
eq('price between 50 and 100', await items('priceMin=5000&priceMax=10000'), [item.id]);

summary('filters');
