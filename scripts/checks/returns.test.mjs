// Returns, one way (owner, 2026-11-10): typed like an invoice — the party, branch, warehouse and the
// items — but only what the party bought here, up to what they bought less what came back, at what
// they paid (after discounts, with its share of tax), taken from their invoices newest first; each
// line linked to its invoice line. A cash customer is paid back from the cash box; cancelling a return
// puts everything back. Runs against BASE.
import { login, eq, ok, check, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: may return

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const saleLevel = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const supplier = ok('a supplier', await owner.post('/parties', { name: `RetSup ${tag}`, types: ['SUPPLIER'] }));
const customer = ok('a customer', await owner.post('/parties', { name: `RetCust ${tag}`, types: ['CUSTOMER'] }));
const other = ok('another customer', await owner.post('/parties', { name: `RetOther ${tag}`, types: ['CUSTOMER'] }));
const walkIn = (await owner.get('/parties?code=0')).data.items[0];
const mkItem = async (name, price) =>
  ok(
    `${name} at ${price / 100}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price }],
    }),
  );
const item = await mkItem('Scarf', 1000);
const never = await mkItem('Belt', 500);
const pur1 = ok(
  '10 bought at 6.00 less 1.00 a piece',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 600, discount: 1000 }],
  }),
);
ok(
  'and 10 more at 7.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: item.id, quantity: 10, unitCost: 700 },
      { productId: never.id, quantity: 5, unitCost: 300 },
    ],
  }),
);
const stock = async () => (await owner.get(`/products/${item.id}`)).data.stockOnHand;
const balance = async (p) => (await owner.get(`/parties/${p.id}`)).data.balance;
const sell = (body) => owner.post('/sales/invoices', { partyId: customer.id, warehouseId: wh.id, taxPercent: 0, ...body });
// The hours before a return (Settings) are for the owner to pass, confirmed.
const sure = owner.confirmed();
const old = ok('customer buys 3 at 10.00', await sell({ lines: [{ productId: item.id, quantity: 3, unitPrice: 1000 }] }));
const newer = ok('…then 2 at 12.00', await sell({ lines: [{ productId: item.id, quantity: 2, unitPrice: 1200 }] }));
const line = (quantity, extra = {}) => ({ productId: item.id, unitId: piece.id, quantity, ...extra });
const back = (who, body, p = customer) => who.post('/sales/returns', { partyId: p.id, warehouseId: wh.id, ...body });

console.log('== what can come back');
const can = ok('the customer’s returnable items', await sure.get(`/sales/returns/returnable?partyId=${customer.id}`));
eq('only the item they bought', can.map((i) => i.productId), [item.id]);
eq(
  '…from their invoices, newest first, what is left and what they paid',
  can[0].lines.map((l) => [l.invoiceNumber, l.left, l.net]),
  [
    [newer.number, 2, 2400],
    [old.number, 3, 3000],
  ],
);
eq('a seller may see it', (await karim.get(`/sales/returns/returnable?partyId=${customer.id}`)).status, 200);

console.log('== a return takes only what they bought, newest first, at what they paid');
const hoursBefore = (await owner.get('/settings')).data.returnAfterHours;
ok('returns wait 12 hours', await owner.put('/settings', { returnAfterHours: 12 }));
eq('the hours after a sale', (await back(karim, { lines: [line(1)] })).data?.code, 'return_too_soon');
eq('an item they never bought', (await back(sure, { lines: [{ productId: never.id, quantity: 1 }] })).data?.code, 'not_bought');
eq('another customer did not buy it', (await back(sure, { lines: [line(1)] }, other)).data?.code, 'not_bought');
eq('more than they bought', (await back(sure, { lines: [line(6)] })).data?.code, 'exceeds_returnable');
const [b0, s0] = [await balance(customer), await stock()];
const r1 = ok('returns 3: 2 of the newer invoice and 1 of the older', await back(sure, { lines: [line(3)], notes: 'size' }));
eq('return type, at what they paid', [r1.type, r1.grandTotal], ['SALES_RETURN', 3400]);
eq(
  'two lines, each from its invoice line',
  r1.lines.map((l) => [l.quantity, l.lineTotal]),
  [
    [2, 2400],
    [1, 1000],
  ],
);
eq('of two invoices: none named alone', r1.sourceDocumentId ?? null, null);
eq('on the account (nothing paid out)', r1.paidAmount, 0);
eq('customer owes 34.00 less', await balance(customer), b0 - 3400);
eq('3 back in stock', await stock(), s0 + 3);
eq('the newer invoice is all back', (await owner.get(`/sales/invoices/${newer.id}`)).data.status, 'RETURNED');
eq('the older has 1 back', (await owner.get(`/sales/invoices/${old.id}`)).data.lines[0].returnedQuantity, 1);
eq('…and only 2 left to return', (await back(sure, { lines: [line(3)] })).data?.code, 'exceeds_returnable');
const cost1 = r1.lines.reduce((s, l) => s + (l.lineCost ?? 0), 0);
eq('cost back at what the goods left at', cost1, newer.lines[0].lineCost + Math.round(old.lines[0].lineCost / 3));
const r2 = ok('from one invoice named', await back(sure, { invoiceId: old.id, lines: [line(2)] }));
eq('…all of what is left, against it', [r2.grandTotal, r2.sourceDocumentId], [2000, old.id]);
eq('…the older one is all back too', (await owner.get(`/sales/invoices/${old.id}`)).data.status, 'RETURNED');
eq('nothing left', (await sure.get(`/sales/returns/returnable?partyId=${customer.id}`)).data.length, 0);
ok('the hours as they were', await owner.put('/settings', { returnAfterHours: hoursBefore }));
const st = ok('the customer’s statement', await owner.get(`/ledger/parties/${customer.id}/statement?from=2022-01-01`));
eq('closes at their balance', st.closing, await balance(customer));

console.log('== discounts and tax come back in their share');
const taxed = ok(
  'sold 4 at 10.00 with 14% tax',
  await sell({ taxPercent: 14, lines: [{ productId: item.id, quantity: 4, unitPrice: 1000 }] }),
);
ok('a 10% discount on it', await owner.post(`/sales/invoices/${taxed.id}/discount`, { kind: 'DISCOUNT', percent: 10 }));
const t1 = ok('1 back', await back(sure, { lines: [line(1)] }));
eq('at 9.00 + 14% = 10.26', t1.grandTotal, 1026);
const t2 = ok('the other 3 back', await back(sure, { lines: [line(3)] }));
const inv = (await owner.get(`/sales/invoices/${taxed.id}`)).data;
eq('together exactly the invoice', t1.grandTotal + t2.grandTotal, inv.grandTotal);
eq('…its tax too', t1.taxTotal + t2.taxTotal, inv.taxTotal);

console.log('== cash customer is paid back at once');
ok(
  'cash customer buys 1',
  await owner.post('/sales/invoices', {
    partyId: walkIn.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paidAmount: 1000,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
  }),
);
const cashBefore = await balance(walkIn);
const r3 = ok('cash customer returns 1', await back(sure, { lines: [line(1)] }, walkIn));
eq('paid back in full', [r3.paidAmount, r3.grandTotal], [1000, 1000]);
eq("cash customer's balance unchanged", await balance(walkIn), cashBefore);

console.log('== purchase return: only what we bought from them and still hold');
const supBefore = await balance(supplier);
const sCan = ok('what we can send back', await owner.get(`/purchases/returns/returnable?partyId=${supplier.id}`));
eq('both items', sCan.map((i) => i.productId).sort(), [item.id, never.id].sort());
const p1 = ok(
  '2 back to the supplier: from the newest invoice, at 7.00',
  await owner.post('/purchases/returns', { partyId: supplier.id, warehouseId: wh.id, lines: [line(2)] }),
);
eq('purchase return, at the price we paid', [p1.type, p1.grandTotal], ['PURCHASE_RETURN', 1400]);
eq('we owe the supplier 14.00 less', await balance(supplier), supBefore + 1400);
const p2 = ok(
  'from the first invoice named: at 6.00 less 1.00',
  await owner.post('/purchases/returns', { partyId: supplier.id, warehouseId: wh.id, invoiceId: pur1.id, lines: [line(2)] }),
);
eq('…5.00 each', p2.grandTotal, 1000);
eq(
  'not more than we bought',
  (await owner.post('/purchases/returns', { partyId: supplier.id, warehouseId: wh.id, lines: [line(100000)] })).data?.code,
  'exceeds_returnable',
);
eq(
  'a customer is not a supplier',
  (await owner.post('/purchases/returns', { partyId: customer.id, warehouseId: wh.id, lines: [line(1)] })).data?.code,
  'party_not_found',
);
eq('sales person cannot make purchase returns', (await karim.post('/purchases/returns', {})).status, 403);

console.log('== against one invoice by its lines (still taken)');
const cashInv = ok(
  'cash customer buys 2',
  await owner.post('/sales/invoices', {
    partyId: walkIn.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paidAmount: 2000,
    lines: [{ productId: item.id, quantity: 2, unitPrice: 1000 }],
  }),
);
const r4 = ok(
  'returns 1 against the invoice',
  await sure.post(`/sales/invoices/${cashInv.id}/returns`, { lines: [{ lineId: cashInv.lines[0].id, quantity: 1 }] }),
);
eq('refunded in full', r4.paidAmount, r4.grandTotal);

console.log('== a return entered by mistake is cancelled (owner, 2026-10-24)');
const accountNow = async (id) => (await owner.get('/money-accounts')).data.find((a) => a.id === id)?.balance;
const [cb0, s1] = [await balance(customer), await stock()];
eq('a seller may not cancel one', (await karim.post(`/sales/returns/${r1.id}/cancel`, {})).status, 403);
const c1 = ok('the return of 3 over two invoices cancelled', await owner.post(`/sales/returns/${r1.id}/cancel`, {}));
eq('…it stays, cancelled', [c1.id, c1.status], [r1.id, 'CANCELLED']);
eq('…its goods leave stock again', await stock(), s1 - 3);
eq('…the customer owes it again', await balance(customer), cb0 + 3400);
check('…the newer invoice is no longer returned', (await owner.get(`/sales/invoices/${newer.id}`)).data.status !== 'RETURNED');
eq(
  '…so it can be returned again',
  (await sure.get(`/sales/returns/returnable?partyId=${customer.id}`)).data[0]?.lines.map((l) => l.left),
  [2, 1],
);
eq('…not twice', (await owner.post(`/sales/returns/${r1.id}/cancel`, {})).data?.code, 'return_cancelled');
eq(
  '…its entry reversed',
  (await owner.get('/ledger/entries?source=SALES_RETURN_CANCEL&pageSize=100')).data.items.filter((e) => e.number === r1.number)
    .length,
  1,
);
const st2 = ok('the customer’s statement', await owner.get(`/ledger/parties/${customer.id}/statement?from=2022-01-01`));
eq(
  '…leaves the cancelled return out and closes at their balance',
  [st2.lines.some((l) => l.documentNumber === r1.number), st2.closing],
  [false, await balance(customer)],
);
const m0 = await accountNow(r3.paidAccountId);
ok('the cash customer’s return cancelled', await owner.post(`/sales/returns/${r3.id}/cancel`, {}));
eq('…the cash paid back comes in again', await accountNow(r3.paidAccountId), m0 + r3.paidAmount);
eq('…their balance as it was', await balance(walkIn), cashBefore);
const [sb0, s2] = [await balance(supplier), await stock()];
eq('a seller may not cancel a purchase return', (await karim.post(`/purchases/returns/${p1.id}/cancel`, {})).status, 403);
ok('the purchase return cancelled', await owner.post(`/purchases/returns/${p1.id}/cancel`, {}));
eq('…its goods are back', await stock(), s2 + 2);
eq('…we owe the supplier it again', await balance(supplier), sb0 - 1400);

console.log('== one permission to return');
const perms = ok('permission list', await owner.get('/permissions')).map((p) => p.key);
check('no separate return without an invoice', !perms.includes('sales:return_free') && !perms.includes('purchases:return_free'));
check('a seller still returns', karim.user.permissions.includes('sales:return'));

summary('returns');
