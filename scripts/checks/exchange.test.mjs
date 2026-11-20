// Return reasons, damaged goods and exchanges (owner, 2026-11-18). Each return line carries a reason
// from a fixed list (OTHER with its words), shown and filtered on the returns list and in the returns
// report (by reason, item, customer or rep, with the return rate). A damaged line of a sales return
// goes to the branch's damaged warehouse (not sold from) or is written off at once to the damaged
// goods loss; later it is repaired back to a store, written off, or sent back to its supplier on a
// purchase return. An exchange saves a sales return and a sales invoice together, linked, with only
// the difference paid (a cash customer at once). Runs against BASE.
import { login, eq, ok, check, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: returns and invoices
const mona = await login('mona@skb.local'); // ACCOUNTANT: write-offs, the report
const sara = await login('sara@skb.local'); // INVENTORY: damaged goods, no write-off

ok(
  'rules',
  await owner.put('/settings', {
    returnAfterHours: 0,
    requireDepartment: false,
    damagedReturns: 'WAREHOUSE',
  }),
);
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const saleLevel = (await owner.get('/price-levels')).data.find(
  (l) => l.side === 'SALE' && l.isDefault,
);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `ExSup ${tag}`, types: ['SUPPLIER'] }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `ExCust ${tag}`, types: ['CUSTOMER'] }),
);
const walkIn = (await owner.get('/parties?code=0')).data.items[0];
const mkItem = async (name, price) =>
  ok(
    `${name} at ${price / 100}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: cat.id,
      supplierId: supplier.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price }],
    }),
  );
const shirt = await mkItem('Shirt', 1000);
const pants = await mkItem('Pants', 1500);
const socks = await mkItem('Socks', 400);
ok(
  'bought from the supplier',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: shirt.id, quantity: 30, unitCost: 600 },
      { productId: pants.id, quantity: 20, unitCost: 800 },
      { productId: socks.id, quantity: 20, unitCost: 200 },
    ],
  }),
);
const balance = async (p) => (await owner.get(`/parties/${p.id}`)).data.balance;
const total = async (item) => (await owner.get(`/products/${item.id}`)).data.stockOnHand;
const inStore = async (item, warehouseId = wh.id) =>
  (
    await owner.get(
      `/inventory/items?warehouseId=${warehouseId}&search=${encodeURIComponent(item.name)}`,
    )
  ).data.items?.[0]?.stockOnHand ?? 0;
const sell = (who, body, party = customer) =>
  who.post('/sales/invoices', { partyId: party.id, warehouseId: wh.id, taxPercent: 0, ...body });
const back = (who, body, party = customer) =>
  who.post('/sales/returns', { partyId: party.id, warehouseId: wh.id, ...body });
const line = (item, quantity, extra = {}) => ({
  productId: item.id,
  unitId: piece.id,
  quantity,
  ...extra,
});
const entriesOf = async (source) =>
  (await owner.get(`/ledger/entries?source=${source}&pageSize=200&from=2022-01-01`)).data.items;
const accounts = (await owner.get('/ledger/accounts')).data;
const lossAccount = accounts.find((a) => a.systemKey === 'DAMAGED_LOSS');
const invAccount = accounts.find((a) => a.systemKey === 'INVENTORY');
check(
  'the damaged goods loss is in the chart',
  !!lossAccount && lossAccount.type === 'EXPENSE',
  lossAccount,
);
const sides = (e) =>
  e.lines
    .map((l) => [l.accountCode.split('-')[0].trim(), l.debit, l.credit])
    .sort((a, b) => a[0].localeCompare(b[0]));

ok(
  'the customer buys 10 shirts at 10.00',
  await sell(owner, { lines: [{ productId: shirt.id, quantity: 10, unitPrice: 1000 }] }),
);

console.log('== reasons');
eq(
  'a reason from the list only',
  (await back(karim, { lines: [line(shirt, 1, { reason: 'BORED' })] })).data.code,
  'bad_reason',
);
eq(
  'OTHER needs its words',
  (await back(karim, { lines: [line(shirt, 1, { reason: 'OTHER' })] })).data.code,
  'reason_note_required',
);
const r1 = ok(
  'one return: wrong size for all, one line other with its words',
  await back(karim, {
    reason: 'WRONG_SIZE',
    lines: [line(shirt, 1), line(shirt, 1, { reason: 'OTHER', reasonNote: 'stained collar' })],
  }),
);
eq(
  'each line keeps its reason',
  r1.lines
    .map((l) => [l.quantity, l.reason, l.reasonNote ?? null])
    .sort((a, b) => a[1].localeCompare(b[1])),
  [
    [1, 'OTHER', 'stained collar'],
    [1, 'WRONG_SIZE', null],
  ],
);
eq('…both from the same invoice line', new Set(r1.lines.map((l) => l.warehouseId)).size, 1);
eq('…at what was paid', r1.grandTotal, 2000);
const listed = ok(
  'returns of wrong size',
  await owner.get(`/sales/returns?reason=WRONG_SIZE&number=${r1.number}`),
);
eq(
  'found, with its reasons',
  listed.items.map((x) => [x.number, x.reasons]),
  [[r1.number, ['OTHER', 'WRONG_SIZE']]],
);
eq(
  'not under late delivery',
  (await owner.get(`/sales/returns?reason=LATE_DELIVERY&number=${r1.number}`)).data.items.length,
  0,
);

console.log('== damaged goods into the damaged warehouse');
const [t0, s0] = [await total(shirt), await inStore(shirt)];
const r2 = ok(
  'a damaged shirt comes back (Settings: to the damaged warehouse)',
  await back(karim, { lines: [line(shirt, 1, { reason: 'DAMAGED' })] }),
);
eq(
  'kept in the damaged warehouse',
  r2.lines.map((l) => l.damaged),
  ['WAREHOUSE'],
);
const places = ok(
  'warehouses with the damaged ones',
  await owner.get('/warehouses?includeDamaged=true'),
);
const damaged = places.find((w) => w.kind === 'DAMAGED' && w.branchId === owner.user.branchId);
check(
  'the branch has its damaged warehouse',
  !!damaged,
  places.map((w) => w.kind),
);
eq('…the return line is in it', r2.lines[0].warehouseId, damaged?.id);
check(
  'not among the plain warehouses',
  !(await owner.get('/warehouses')).data.some((w) => w.kind === 'DAMAGED'),
);
eq('the store did not get it back', await inStore(shirt), s0);
eq('…the damaged warehouse holds it', await inStore(shirt, damaged.id), 1);
eq('the company total still counts it (valuation)', await total(shirt), t0 + 1);
const listRow = (await owner.get(`/inventory/items?search=${encodeURIComponent(shirt.name)}`)).data
  .items[0];
eq('…but the stock list leaves it out of what can be sold', listRow.stockOnHand, t0);
const finder = (
  await owner.get(
    `/products?search=${encodeURIComponent(shirt.name)}&branchId=${owner.user.branchId}`,
  )
).data[0];
eq('the item finder shows only the stores', finder.stockOnHand, s0);
eq(
  'nothing is sold from the damaged warehouse',
  (
    await owner.post('/sales/invoices', {
      partyId: customer.id,
      warehouseId: damaged.id,
      taxPercent: 0,
      lines: [{ productId: shirt.id, quantity: 1, unitPrice: 1000 }],
    })
  ).data.code,
  'warehouse_not_found',
);
const val = ok(
  'stock valuation',
  await owner.get(`/inventory/valuation?warehouseId=${damaged.id}`),
);
check('the valuation counts the damaged goods', JSON.stringify(val).includes(shirt.name), val);

console.log('== written off at once');
eq(
  'a seller may not write off',
  (await back(karim, { lines: [line(shirt, 1, { reason: 'DAMAGED', damaged: 'WRITE_OFF' })] }))
    .status,
  403,
);
const lossBefore = (await entriesOf('DAMAGED_WRITE_OFF')).length;
const r3 = ok(
  'the owner writes one off on the return',
  await back(owner, { lines: [line(shirt, 1, { reason: 'DAMAGED', damaged: 'WRITE_OFF' })] }),
);
eq(
  'marked written off',
  r3.lines.map((l) => l.damaged),
  ['WRITE_OFF'],
);
eq('the damaged warehouse holds what it held', await inStore(shirt, damaged.id), 1);
eq('…and the company total too', await total(shirt), t0 + 1);
const wo = (await entriesOf('DAMAGED_WRITE_OFF')).filter((e) => e.number === r3.number);
eq('one write-off entry', wo.length, 1);
eq(
  'Dr damaged goods loss · Cr inventory, at its cost',
  sides(wo[0]),
  [
    [invAccount.code, 0, r3.lines[0].lineCost],
    [lossAccount.code, r3.lines[0].lineCost, 0],
  ].sort((a, b) => a[0].localeCompare(b[0])),
);
check('at the cost it came back at (6.00)', r3.lines[0].lineCost === 600, r3.lines[0]);
ok(
  'Settings: damaged goods are written off',
  await owner.put('/settings', { damagedReturns: 'WRITE_OFF' }),
);
const r4 = ok(
  'a seller returns a damaged one: no permission, so to the warehouse',
  await back(karim, { lines: [line(shirt, 1, { reason: 'DAMAGED' })] }),
);
eq('…kept', r4.lines[0].damaged, 'WAREHOUSE');
const r5 = ok(
  'the owner returns one',
  await back(owner, { lines: [line(shirt, 1, { reason: 'DAMAGED' })] }),
);
eq('…written off', r5.lines[0].damaged, 'WRITE_OFF');
ok('Settings back', await owner.put('/settings', { damagedReturns: 'WAREHOUSE' }));
eq(
  'a bad choice is refused',
  (await owner.put('/settings', { damagedReturns: 'BIN' })).status,
  400,
);
const before5 = [await total(shirt), await balance(customer)];
ok('the write-off return is cancelled', await owner.post(`/sales/returns/${r5.id}/cancel`, {}));
eq(
  'goods and balance as before it',
  [await total(shirt), await balance(customer)],
  [before5[0], before5[1] + 1000],
);
const undone = (await entriesOf('DAMAGED_WRITE_OFF_CANCEL')).filter((e) => e.number === r5.number);
eq('its write-off reversed', undone.length, 1);
eq('the damaged warehouse as before', await inStore(shirt, damaged.id), 2);

console.log('== damaged goods later: the list, repaired, written off, back to the supplier');
eq('a seller may not see the list', (await karim.get('/inventory/damaged')).status, 403);
eq(
  'a stock keeper of another branch sees none of this one',
  (await sara.get('/inventory/damaged')).data.filter((r) => r.branchId === owner.user.branchId)
    .length,
  0,
);
const keeperStaff = ok(
  'a stock keeper of this branch',
  await owner.post('/staff', {
    fullName: `Keep ${tag}`,
    email: `keep.${tag}@skb.local`,
    password: 'Str0ngPass!',
    role: 'INVENTORY',
    branchId: owner.user.branchId,
  }),
);
const keeper = await login(`keep.${tag}@skb.local`, 'Str0ngPass!');
const rows = ok(
  'the stock keeper sees it',
  await keeper.get(`/inventory/damaged?supplierId=${supplier.id}`),
);
eq(
  'by supplier',
  rows
    .filter((r) => r.productId === shirt.id)
    .map((r) => [r.quantity, r.supplierId, r.warehouseId]),
  [[2, supplier.id, damaged.id]],
);
check(
  'no cost for who may not see it',
  rows.every((r) => r.unitCost == null),
);
check(
  'cost for the owner',
  (await owner.get('/inventory/damaged')).data.some(
    (r) => r.productId === shirt.id && r.unitCost === 600,
  ),
);
const s1 = await inStore(shirt);
const fixed = ok(
  'one repaired, back to the store',
  await keeper.post('/inventory/damaged/repair', {
    warehouseId: damaged.id,
    toWarehouseId: wh.id,
    lines: [{ productId: shirt.id, quantity: 1 }],
  }),
);
check('numbered', fixed.number.startsWith('DMG-'), fixed.number);
eq('the store has it', await inStore(shirt), s1 + 1);
eq('…the damaged warehouse not', await inStore(shirt, damaged.id), 1);
eq(
  'more than is there is refused',
  (
    await keeper.post('/inventory/damaged/repair', {
      warehouseId: damaged.id,
      lines: [{ productId: shirt.id, quantity: 5 }],
    })
  ).data.code,
  'insufficient_stock',
);
eq(
  'repaired only from a damaged warehouse',
  (
    await keeper.post('/inventory/damaged/repair', {
      warehouseId: wh.id,
      lines: [{ productId: shirt.id, quantity: 1 }],
    })
  ).status,
  404,
);
eq(
  'the stock keeper may not write off',
  (
    await keeper.post('/inventory/damaged/write-off', {
      warehouseId: damaged.id,
      lines: [{ productId: shirt.id, quantity: 1 }],
    })
  ).status,
  403,
);
ok(
  'one more damaged shirt comes back',
  await back(karim, { lines: [line(shirt, 1, { reason: 'DAMAGED' })] }),
);
const off = ok(
  'the accountant writes one off',
  await mona.post('/inventory/damaged/write-off', {
    warehouseId: damaged.id,
    lines: [{ productId: shirt.id, quantity: 1 }],
    notes: 'torn',
  }),
);
const offEntry = (await entriesOf('DAMAGED_WRITE_OFF')).filter((e) => e.number === off.number);
eq('posted to the damaged goods loss', offEntry.map(sides), [
  [
    [invAccount.code, 0, 600],
    [lossAccount.code, 600, 0],
  ].sort((a, b) => a[0].localeCompare(b[0])),
]);
eq('one left in the damaged warehouse', await inStore(shirt, damaged.id), 1);
const supBefore = await balance(supplier);
const pr = ok(
  'sent back to the supplier from the damaged warehouse',
  await owner.post('/purchases/returns', {
    partyId: supplier.id,
    warehouseId: damaged.id,
    lines: [line(shirt, 1, { reason: 'DAMAGED' })],
  }),
);
eq('…at what we paid', pr.grandTotal, 600);
eq('the damaged warehouse is empty', await inStore(shirt, damaged.id), 0);
eq('the supplier owes us less', await balance(supplier), supBefore + 600);
eq(
  'no more than it holds',
  (
    await owner.post('/purchases/returns', {
      partyId: supplier.id,
      warehouseId: damaged.id,
      lines: [line(shirt, 1)],
    })
  ).data.code,
  'insufficient_stock',
);
check(
  'a sales return never goes into it by hand',
  (await back(owner, { warehouseId: damaged.id, lines: [line(shirt, 1)] })).status === 400,
);
check(
  'lost before = after the write-offs',
  (await entriesOf('DAMAGED_WRITE_OFF')).length === lossBefore + 3,
);

console.log('== exchange: a customer on account');
const exchange = (who, body) => who.post('/sales/exchanges', body);
const ex = (ret, take, extra = {}) => ({
  return: { partyId: customer.id, warehouseId: wh.id, lines: ret },
  invoice: { partyId: customer.id, warehouseId: wh.id, taxPercent: 0, lines: take },
  ...extra,
});
const [b0, sh0, pa0] = [await balance(customer), await inStore(shirt), await inStore(pants)];
const returnsBefore = (await owner.get('/sales/returns?pageSize=1')).data.total;
const e1 = ok(
  'a shirt back (10.00), trousers taken (15.00)',
  await exchange(
    karim,
    ex(
      [line(shirt, 1, { reason: 'WRONG_SIZE' })],
      [{ productId: pants.id, quantity: 1, unitPrice: 1500 }],
    ),
  ),
);
eq('the difference', e1.difference, 500);
eq(
  'linked both ways',
  [e1.return.exchangeNumber, e1.invoice.exchangeNumber],
  [e1.invoice.number, e1.return.number],
);
eq('…by id', [e1.return.exchangeId, e1.invoice.exchangeId], [e1.invoice.id, e1.return.id]);
eq('only the difference on the account', await balance(customer), b0 + 500);
eq('stock moved both ways', [await inStore(shirt), await inStore(pants)], [sh0 + 1, pa0 - 1]);
eq('nothing paid at the counter', [e1.return.paidAmount, e1.invoice.paidAmount], [0, 0]);
const listedInv = (await owner.get(`/sales/invoices?number=${e1.invoice.number}`)).data.items[0];
eq('the invoice list names the return', listedInv.exchangeNumber, e1.return.number);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.branchId === owner.user.branchId && a.isMain,
);
const cash = async (id = box.id) =>
  (await owner.get('/money-accounts')).data.find((a) => a.id === id).balance;
const c0 = await cash();
const e2 = ok(
  'two shirts back (20.00), socks taken (4.00), 6.00 of the 16.00 paid back',
  await exchange(
    owner,
    ex([line(shirt, 2)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }], {
      refund: 600,
      refundAccountId: box.id,
    }),
  ),
);
eq('the difference', e2.difference, -1600);
eq('the return paid back 6.00', e2.return.paidAmount, 600);
eq('the box paid it', await cash(), c0 - 600);
eq('the rest stays the customer’s credit', await balance(customer), b0 + 500 - 1600 + 600);
const e3 = ok(
  'no more paid back than the difference',
  await exchange(
    owner,
    ex([line(shirt, 1)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }], {
      refund: 5000,
      refundAccountId: box.id,
    }),
  ),
);
eq('…6.00 at most', e3.return.paidAmount, 600);

console.log('== exchange: all or nothing');
const snap = async () => [
  await balance(customer),
  await inStore(shirt),
  await inStore(pants),
  (await owner.get('/sales/returns?pageSize=1')).data.total,
  await cash(),
];
const s2 = await snap();
const bad1 = await exchange(
  owner,
  ex([line(shirt, 1)], [{ productId: pants.id, quantity: 100000, unitPrice: 1500 }]),
);
check('more than the store holds: refused', bad1.status === 400, bad1.data);
eq('nothing saved: no return, stock and balance as they were', await snap(), s2);
const bad2 = await exchange(
  owner,
  ex([line(socks, 50)], [{ productId: pants.id, quantity: 1, unitPrice: 1500 }]),
);
eq('more back than they bought: refused', bad2.data.code, 'exceeds_returnable');
eq('nothing saved', await snap(), s2);
const bad3 = await exchange(
  karim,
  ex([line(shirt, 1)], [{ productId: pants.id, quantity: 1, unitPrice: 100 }]),
);
check('the invoice’s price rules hold', bad3.status >= 400, bad3.data);
eq('nothing saved', await snap(), s2);
check('returns counted as before the first exchange + 3', s2[3] === returnsBefore + 3, [
  s2[3],
  returnsBefore,
]);

console.log('== exchange: a cash customer');
const walkSale = ok(
  'the cash customer buys 3 shirts',
  await sell(
    owner,
    { paidAmount: 3000, lines: [{ productId: shirt.id, quantity: 3, unitPrice: 1000 }] },
    walkIn,
  ),
);
const till = walkSale.paidAccountId;
const [w0, c1] = [await balance(walkIn), await cash(till)];
const e4 = ok(
  'a shirt back, trousers taken: pays 5.00',
  await exchange(owner, {
    return: { partyId: walkIn.id, warehouseId: wh.id, lines: [line(shirt, 1)] },
    invoice: {
      partyId: walkIn.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: pants.id, quantity: 1, unitPrice: 1500 }],
    },
  }),
);
eq('the invoice is paid only the difference', e4.invoice.paidAmount, 500);
eq('the return paid nothing back', e4.return.paidAmount, 0);
eq('the box took 5.00', await cash(till), c1 + 500);
eq('the cash customer owes nothing', await balance(walkIn), w0);
const e5 = ok(
  'a shirt back, socks taken: gets 6.00',
  await exchange(owner, {
    return: { partyId: walkIn.id, warehouseId: wh.id, lines: [line(shirt, 1)] },
    invoice: {
      partyId: walkIn.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: socks.id, quantity: 1, unitPrice: 400 }],
    },
  }),
);
eq(
  'the return paid back 6.00, the invoice nothing',
  [e5.return.paidAmount, e5.invoice.paidAmount],
  [600, 0],
);
eq('the box paid 6.00', await cash(till), c1 + 500 - 600);
eq('still owes nothing', await balance(walkIn), w0);
const sr = (
  await owner.get(`/ledger/entries?source=SALES_RETURN&pageSize=200&from=2022-01-01`)
).data.items.find((e) => e.number === e5.return.number);
check(
  'the return’s entry pays back only 6.00',
  sr && sr.lines.some((l) => l.credit === 600 && l.accountCode.startsWith('1101')),
  sr?.lines,
);
const tb = ok('trial balance', await owner.get('/ledger/trial-balance?from=2022-01-01'));
eq(
  'the books balance',
  tb.rows.reduce((s, r) => s + r.closingDebit, 0),
  tb.rows.reduce((s, r) => s + r.closingCredit, 0),
);
const lossRow = tb.rows.find((r) => r.code === lossAccount.code || r.accountId === lossAccount.id);
check(
  'the damaged goods loss carries the write-offs',
  lossRow && lossRow.closingDebit >= 1200,
  lossRow,
);

console.log('== the return pays the exchange’s invoice, not the invoices it came from');
const openOf = async (party) =>
  Object.fromEntries(
    (await owner.get(`/parties/${party.id}/open-invoices`)).data.map((o) => [o.documentId, o.outstanding]),
  );
const stateOf = async (id) => {
  const d = (await owner.get(`/sales/invoices/${id}`)).data;
  return [d.state, d.owed];
};
const walkOpen = await openOf(walkIn);
eq(
  'cash customer: neither exchange invoice is left open',
  [walkOpen[e4.invoice.id], walkOpen[e5.invoice.id]],
  [undefined, undefined],
);
eq('…paid', [(await stateOf(e4.invoice.id))[0], (await stateOf(e5.invoice.id))[0]], ['PAID', 'PAID']);
const c2 = ok(
  'a customer on account',
  await owner.post('/parties', { name: `ExCust2 ${tag}`, types: ['CUSTOMER'] }),
);
const src = ok(
  'buys 5 shirts (50.00)',
  await sell(owner, { lines: [{ productId: shirt.id, quantity: 5, unitPrice: 1000 }] }, c2),
);
const exOf = (ret, take, extra = {}) => ({
  return: { partyId: c2.id, warehouseId: wh.id, lines: ret },
  invoice: { partyId: c2.id, warehouseId: wh.id, taxPercent: 0, lines: take },
  ...extra,
});
const xa = ok(
  'a shirt back (10.00), trousers taken (15.00)',
  await exchange(owner, exOf([line(shirt, 1)], [{ productId: pants.id, quantity: 1, unitPrice: 1500 }])),
);
let open2 = await openOf(c2);
eq(
  'the exchange’s invoice owes the 5.00 difference; the shirts’ invoice all of it',
  [open2[xa.invoice.id], open2[src.id]],
  [500, 5000],
);
eq('…part paid', await stateOf(xa.invoice.id), ['PARTIAL', 500]);
const xb = ok(
  'three shirts back (30.00), socks taken (4.00), 6.00 paid back',
  await exchange(
    owner,
    exOf([line(shirt, 3)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }], {
      refund: 600,
      refundAccountId: box.id,
    }),
  ),
);
open2 = await openOf(c2);
eq(
  'its invoice is paid; the rest (20.00) credits the shirts’ invoice',
  [open2[xb.invoice.id], open2[src.id], open2[xa.invoice.id]],
  [undefined, 3000, 500],
);
eq('…paid', await stateOf(xb.invoice.id), ['PAID', 0]);
eq('the shirts’ invoice part paid', await stateOf(src.id), ['PARTIAL', 3000]);
const agingRow = async () =>
  (await owner.get('/analytics/aging')).data.rows.find((r) => r.partyId === c2.id);
eq('aging: what is open is the balance', [(await agingRow()).total, await balance(c2)], [3500, 3500]);
eq(
  'the accountant is told of an exchange’s invoice',
  (await mona.get('/notifications')).data.items.filter(
    (n) => n.kind === 'INVOICE_NEW' && n.documentId === xb.invoice.id,
  ).length,
  1,
);
const emptyBox = ok(
  'an empty cash box',
  await owner.post('/money-accounts', {
    branchId: owner.user.branchId,
    name: `ExEmpty ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 0,
  }),
);
const told0 = (await mona.get('/notifications')).data.total;
const snap2 = [await balance(c2), (await owner.get('/sales/returns?pageSize=1')).data.total];
const badRefund = await exchange(
  owner,
  exOf([line(shirt, 1)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }], {
    refund: 600,
    refundAccountId: emptyBox.id,
  }),
);
eq('paid back from an empty box: refused', badRefund.data?.code, 'insufficient_funds');
eq(
  '…nothing saved',
  [await balance(c2), (await owner.get('/sales/returns?pageSize=1')).data.total],
  snap2,
);
eq('…and nobody told', (await mona.get('/notifications')).data.total, told0);
ok('the first exchange’s invoice is cancelled', await owner.post(`/sales/invoices/${xa.invoice.id}/cancel`, { reason: 'test' }));
open2 = await openOf(c2);
eq('its return credits the shirts’ invoice again', [open2[src.id], open2[xa.invoice.id]], [2000, undefined]);
eq('…as the balance says', await balance(c2), 2000);
ok('the second exchange’s return is cancelled', await owner.post(`/sales/returns/${xb.return.id}/cancel`, {}));
open2 = await openOf(c2);
eq(
  'its invoice is owed again; the shirts’ invoice loses its credit',
  [open2[xb.invoice.id], open2[src.id]],
  [400, 4000],
);
eq('…as the balance says', await balance(c2), 4400);

console.log('== cancelling either part follows the usual rules');
const bc = await balance(customer);
ok(
  'the exchange’s invoice is cancelled',
  await owner.post(`/sales/invoices/${e1.invoice.id}/cancel`, { reason: 'test' }),
);
eq(
  'its 15.00 comes off the account; the return’s credit stays',
  await balance(customer),
  bc - 1500,
);
const still = ok('the return', await owner.get(`/sales/returns/${e1.return.id}`));
eq('…still names the invoice', still.exchangeNumber, e1.invoice.number);

console.log('== permissions');
eq(
  'a stock keeper may not exchange',
  (
    await exchange(
      sara,
      ex([line(shirt, 1)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }]),
    )
  ).status,
  403,
);
const onlyReturns = ok(
  'someone who may return but not sell',
  await owner.post('/staff', {
    fullName: `Ret ${tag}`,
    email: `ret.${tag}@skb.local`,
    password: 'Str0ngPass!',
    role: 'NONE',
    branchId: owner.user.branchId,
  }),
);
ok(
  '…given returns only',
  await owner.put(`/staff/${onlyReturns.id}/permissions`, { granted: ['sales:return'] }),
);
const retOnly = await login(`ret.${tag}@skb.local`, 'Str0ngPass!');
eq(
  '…may not exchange',
  (
    await exchange(
      retOnly,
      ex([line(shirt, 1)], [{ productId: socks.id, quantity: 1, unitPrice: 400 }]),
    )
  ).status,
  403,
);

console.log('== the returns report');
eq('a seller may not see it', (await karim.get('/reports/returns')).status, 403);
const byReason = ok('by reason', await mona.get('/reports/returns?by=reason'));
const reasonOf = (k) => byReason.rows.find((r) => r.key === k);
check(
  'wrong size, other, damaged listed',
  ['WRONG_SIZE', 'OTHER', 'DAMAGED'].every((k) => reasonOf(k)?.quantity > 0),
  byReason.rows,
);
eq(
  'each reason’s share of what came back',
  reasonOf('DAMAGED').rate,
  Math.round((reasonOf('DAMAGED').quantity * 10000) / byReason.quantity),
);
const byItem = ok('by item', await owner.get('/reports/returns?by=item'));
const shirtRow = byItem.rows.find((r) => r.key === shirt.id);
check(
  'the shirt with what was sold',
  shirtRow && shirtRow.sold >= 13 && shirtRow.label === shirt.name,
  shirtRow,
);
eq('…and the return rate', shirtRow.rate, Math.round((shirtRow.quantity * 10000) / shirtRow.sold));
const byCustomer = ok('by customer', await owner.get('/reports/returns?by=customer'));
check(
  'the customer listed',
  byCustomer.rows.some((r) => r.key === customer.id && r.label === customer.name),
  byCustomer.rows.length,
);
const byRep = ok('by rep', await owner.get('/reports/returns?by=rep'));
check(
  'karim listed',
  byRep.rows.some((r) => r.label && r.quantity > 0),
);
const away = ok(
  'another branch',
  await owner.post('/branches', {
    name: `ExB ${tag}`,
    code: `EX${tag}`.toUpperCase().slice(0, 10),
  }),
);
const elsewhere = ok(
  'an accountant of the other branch only',
  await owner.post('/staff', {
    fullName: `Far ${tag}`,
    email: `far.${tag}@skb.local`,
    password: 'Str0ngPass!',
    role: 'ACCOUNTANT',
    branchId: away.id,
  }),
);
ok(
  '…only there',
  await owner.put(`/staff/${elsewhere.id}/access`, { allBranches: false, branchIds: [away.id] }),
);
const far = await login(`far.${tag}@skb.local`, 'Str0ngPass!');
const farReport = ok('their report', await far.get('/reports/returns?by=item'));
eq('nothing of the main branch', farReport.quantity, 0);
eq(
  'no damaged goods of the main branch',
  (await far.get('/inventory/damaged')).data.filter((r) => r.branchId === owner.user.branchId)
    .length,
  0,
);

summary('exchange');
