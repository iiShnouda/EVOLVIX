// Returns typed without an invoice (owner decision 2026-10-01): line by line like an invoice, on the
// party's account (a cash customer is paid back from the cash box), at the party's last invoice price
// unless the person may change prices; purchase returns go back at the net price. Runs against BASE.
import { login, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: may return, may not change prices

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const saleLevel = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const supplier = ok('a supplier', await owner.post('/parties', { name: `RetSup ${tag}`, types: ['SUPPLIER'] }));
const customer = ok('a customer', await owner.post('/parties', { name: `RetCust ${tag}`, types: ['CUSTOMER'] }));
const walkIn = ok(
  'a cash customer',
  await owner.post('/parties', { name: `RetCash ${tag}`, types: ['CUSTOMER'], isCashCustomer: true }),
);
const item = ok(
  'an item at 10.00',
  await owner.post('/products', {
    name: `Scarf ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
  }),
);
ok(
  '10 bought at 6.00 less 1.00 a piece',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 10, unitCost: 600, discount: 1000 }],
  }),
);
const stock = async () => (await owner.get(`/products/${item.id}`)).data.stockOnHand;
const balance = async (p) => (await owner.get(`/parties/${p.id}`)).data.balance;
ok(
  'customer buys 3 at 10.00 on account',
  await owner.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: 3, unitPrice: 1000 }],
  }),
);

console.log('== sales return without an invoice');
const last = ok(
  'last price of the item for the customer',
  await karim.get(`/sales/returns/last-prices?partyId=${customer.id}&productIds=${item.id}`),
);
eq('last price is 10.00', last.find((r) => r.productId === item.id)?.price, 1000);

const before = await balance(customer);
const stockBefore = await stock();
const line = (quantity, unitPrice, extra = {}) => ({ productId: item.id, unitId: piece.id, quantity, unitPrice, ...extra });
const free = (p, body) => p.post('/sales/returns', { partyId: customer.id, warehouseId: wh.id, ...body });

eq(
  'over the last price needs the change-price permission',
  (await free(karim, { lines: [line(1, 1500)] })).data?.code,
  'price_not_allowed',
);
const r1 = ok('sales person returns 2 at the last price', await free(karim, { lines: [line(2, 1000)] }));
eq('return type', r1.type, 'SALES_RETURN');
eq('return total', r1.grandTotal, 2000);
eq('goes on the account (nothing paid out)', r1.paidAmount, 0);
eq('customer owes 20.00 less', await balance(customer), before - 2000);
eq('2 pieces back in stock', await stock(), stockBefore + 2);
ok('the owner may type another price', await free(owner, { lines: [line(1, 1200)] }));
eq('no lines refused', (await free(owner, { lines: [] })).status, 400);

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
const r2 = ok(
  'cash customer returns 1',
  await owner.post('/sales/returns', { partyId: walkIn.id, warehouseId: wh.id, lines: [line(1, 1000)] }),
);
eq('paid back in full', r2.paidAmount, r2.grandTotal);
eq("cash customer's balance unchanged", await balance(walkIn), cashBefore);

console.log('== purchase return without an invoice, at the net price');
const supBefore = await balance(supplier);
const p1 = ok(
  'return 2 to the supplier at 6.00 less 1.00 each',
  await owner.post('/purchases/returns', {
    partyId: supplier.id,
    warehouseId: wh.id,
    lines: [line(2, 600, { discount: 200 })],
  }),
);
eq('purchase return type', p1.type, 'PURCHASE_RETURN');
eq('at the net price', p1.grandTotal, 1000);
eq('we owe the supplier 10.00 less', await balance(supplier), supBefore + 1000);
eq(
  "can't return more than we hold",
  (
    await owner.post('/purchases/returns', {
      partyId: supplier.id,
      warehouseId: wh.id,
      lines: [line(100000, 600)],
    })
  ).data?.code,
  'insufficient_stock',
);
eq(
  'a customer is not a supplier',
  (await owner.post('/purchases/returns', { partyId: customer.id, warehouseId: wh.id, lines: [line(1, 600)] })).data
    ?.code,
  'party_not_found',
);
eq('sales person cannot make purchase returns', (await karim.post('/purchases/returns', {})).status, 403);

console.log('== invoice return: a cash customer is paid back without asking');
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
const r3 = ok(
  'returns 1 against the invoice',
  await owner.post(`/sales/invoices/${cashInv.id}/returns`, { lines: [{ lineId: cashInv.lines[0].id, quantity: 1 }] }),
);
eq('refunded in full', r3.paidAmount, r3.grandTotal);

summary('returns');
