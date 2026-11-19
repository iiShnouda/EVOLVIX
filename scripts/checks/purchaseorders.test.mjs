// Purchase orders to a factory (owner, 2026-11-18): items in the catalog (offered from the "what to
// buy" suggestions) and new items only named; DRAFT → SENT → PARTLY_RECEIVED / RECEIVED or CANCELLED.
// The order moves no stock, money or ledger; a purchase invoice made from it receives its goods (a new
// item is made then) and the order records what arrived. Each action its own permission; only the
// person's branches; every change in the activity log. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: no purchase orders
const sara = await login('sara@skb.local'); // INVENTORY (another branch): view, create, edit, receive; no cancel
const mona = await login('mona@skb.local'); // ACCOUNTANT: every branch, everything on orders

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const sale = levels.find((l) => l.side === 'SALE' && l.isDefault);
const buy = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
const main = (await owner.get('/branches')).data.find((b) => b.id === owner.user.branchId);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === main.id);
const dept = ok('a department', await owner.post('/departments', { name: `PO dept ${tag}` }));
const group = ok('a group', await owner.post('/groups', { departmentId: dept.id, name: `PO group ${tag}` }));
const sizes = (await owner.get('/variant-options')).data ?? [];
const size = sizes.find((o) => o.kind === 'SIZE' && o.isActive);
const supplier = ok('a supplier', await owner.post('/parties', { name: `Factory ${tag}`, types: ['SUPPLIER'] }));
const other = ok('another supplier', await owner.post('/parties', { name: `Factory2 ${tag}`, types: ['SUPPLIER'] }));

const newItem = async (name) =>
  ok(
    `item ${name}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      departmentId: dept.id,
      warehouseId: wh.id,
      supplierId: supplier.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [
        { unitId: piece.id, priceLevelId: sale.id, price: 15000 },
        { unitId: piece.id, priceLevelId: buy.id, price: 10000 },
      ],
    }),
  );
const shirt = await newItem('PO Shirt');
const trousers = await newItem('PO Trousers');

// Bought and sold, so the suggestions offer it.
ok('10 shirts bought', await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 10, unitCost: 10000 }],
}));
const customer = ok('a customer', await owner.post('/parties', { name: `PO cust ${tag}`, types: ['CUSTOMER'] }));
ok('9 shirts sold', await owner.post('/sales/invoices', {
  partyId: customer.id, taxPercent: 0, departmentId: dept.id,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 9, unitPrice: 15000, warehouseId: wh.id }],
}));

console.log('== suggestions for the supplier prefill an order');
const sug = ok('the supplier’s suggestions', await owner.get(`/purchase-orders/suggestions?supplierId=${supplier.id}`));
const sShirt = (sug ?? []).find((r) => r.productId === shirt.id);
check('the shirt is suggested with a quantity', sShirt && sShirt.suggested > 0, sug);
check('only this supplier’s items', (sug ?? []).every((r) => [shirt.id, trousers.id].includes(r.productId)), sug);
eq('nobody without create/edit gets them', (await karim.get(`/purchase-orders/suggestions?supplierId=${supplier.id}`)).status, 403);

const stockBefore = (await owner.get(`/products/${shirt.id}`)).data.stockOnHand;
const balanceBefore = (await owner.get(`/parties/${supplier.id}`)).data.balance;
const entriesBefore = (await owner.get('/ledger/entries?page=1&pageSize=1')).data?.total;

console.log('== an order with items in the catalog and new ones');
const body = {
  partyId: supplier.id,
  warehouseId: wh.id,
  expectedDate: '2099-01-01',
  notes: `deliver fast ${tag}`,
  lines: [
    { productId: shirt.id, quantity: sShirt?.suggested ?? 5, unitPrice: 10000 },
    { productId: trousers.id, quantity: 4, unitPrice: 12000 },
    { name: `New jacket ${tag}`, departmentId: dept.id, groupId: group.id, sizeId: size?.id, quantity: 6, unitPrice: 20000, supplierCode: 'M-77' },
  ],
};
const po = ok('saved as a draft', await owner.post('/purchase-orders', body));
eq('a draft', po?.status, 'DRAFT');
check('numbered PO-', /^PO-\d{4}-\d{6}$/.test(po?.number ?? ''), po?.number);
eq('three lines, one new', [po?.lines.length, po?.lines.filter((l) => l.isNew).length], [3, 1]);
eq('the new item keeps its department, group, size and model', [po?.lines[2].departmentId, po?.lines[2].groupId, po?.lines[2].sizeId ?? null, po?.lines[2].supplierCode], [dept.id, group.id, size?.id ?? null, 'M-77']);
eq('its total', po?.total, (sShirt?.suggested ?? 5) * 10000 + 4 * 12000 + 6 * 20000);
eq('the order moved no stock', (await owner.get(`/products/${shirt.id}`)).data.stockOnHand, stockBefore);
eq('…nor the supplier’s account', (await owner.get(`/parties/${supplier.id}`)).data.balance, balanceBefore);
eq('…nor the ledger', (await owner.get('/ledger/entries?page=1&pageSize=1')).data?.total, entriesBefore);
eq('a new item needs a name', (await owner.post('/purchase-orders', { ...body, lines: [{ quantity: 1 }] })).data?.code, 'po_no_name');
eq('a group of another department is refused', (await owner.post('/purchase-orders', { ...body, lines: [{ name: 'x', groupId: group.id, quantity: 1 }] })).data?.code, 'group_not_found');
eq('a customer is no supplier', (await owner.post('/purchase-orders', { ...body, partyId: customer.id })).data?.code, 'party_not_found');
eq('a quantity of 0 is refused', (await owner.post('/purchase-orders', { ...body, lines: [{ productId: shirt.id, quantity: 0 }] })).data?.code, 'bad_quantity');

console.log('== list, change, send');
const list = ok('listed by supplier', await owner.get(`/purchase-orders?partyId=${supplier.id}`));
check('…it is there', list?.items.some((o) => o.id === po.id && o.newItems === 1), list);
eq('by status', (await owner.get(`/purchase-orders?partyId=${supplier.id}&status=SENT`)).data?.total, 0);
check('by an item on it', (await owner.get(`/purchase-orders?item=${encodeURIComponent(`New jacket ${tag}`)}`)).data?.items.some((o) => o.id === po.id));
const changed = ok('changed while a draft', await mona.put(`/purchase-orders/${po.id}`, { ...body, lines: body.lines.map((l, i) => (i === 1 ? { ...l, quantity: 5 } : l)) }));
eq('…the new quantity', changed?.lines[1].quantity, 5);
const sent = ok('marked sent', await owner.post(`/purchase-orders/${po.id}/send`));
eq('sent', sent?.status, 'SENT');
eq('sent only once', (await owner.post(`/purchase-orders/${po.id}/send`)).status, 409);

console.log('== receiving: a purchase invoice made from the order');
const lineOf = (i) => sent.lines[i];
// The new item is made on the purchase screen, then the invoice names the order line.
const jacket = ok('the new item is made', await owner.post('/products', {
  name: `New jacket ${tag}`, departmentId: dept.id, groupId: group.id, warehouseId: wh.id, supplierId: supplier.id,
  units: [{ unitId: piece.id, factor: 1 }],
  prices: [
    { unitId: piece.id, priceLevelId: sale.id, price: 30000 },
    { unitId: piece.id, priceLevelId: buy.id, price: 20000 },
  ],
}));
eq('receiving needs its own permission', (await karim.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: lineOf(0).id }],
})).status, 403);
eq('another supplier’s invoice can’t receive it', (await owner.post('/purchases/invoices', {
  partyId: other.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: lineOf(0).id }],
})).data?.code, 'po_other_supplier');
eq('a line takes only the item ordered', (await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [{ productId: trousers.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: lineOf(0).id }],
})).data?.code, 'po_line_other_item');
const shirtsOrdered = lineOf(0).quantity;
const part = ok('part received (the accountant)', await mona.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [
    { productId: shirt.id, unitId: piece.id, quantity: shirtsOrdered, unitCost: 10000, orderLineId: lineOf(0).id },
    { productId: jacket.id, unitId: piece.id, quantity: 2, unitCost: 20000, orderLineId: lineOf(2).id },
  ],
}));
let now = ok('the order', await owner.get(`/purchase-orders/${po.id}`));
eq('partly received', now?.status, 'PARTLY_RECEIVED');
eq('what each line received', now?.lines.map((l) => l.receivedPieces), [shirtsOrdered, 0, 2]);
eq('the new line now names the item made', now?.lines[2].productId, jacket.id);
eq('the invoice is among its receipts', now?.receipts.map((r) => r.number), [part?.number]);
eq('the stock came in on the invoice', (await owner.get(`/products/${shirt.id}`)).data.stockOnHand, stockBefore + shirtsOrdered);
eq('no more changes once received', (await owner.put(`/purchase-orders/${po.id}`, body)).data?.code, 'po_locked');
const rest = ok('the rest received', await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [
    { productId: trousers.id, unitId: piece.id, quantity: 5, unitCost: 12000, orderLineId: lineOf(1).id },
    { productId: jacket.id, unitId: piece.id, quantity: 4, unitCost: 20000, orderLineId: lineOf(2).id },
  ],
}));
now = (await owner.get(`/purchase-orders/${po.id}`)).data;
eq('received', now?.status, 'RECEIVED');
eq('two receipts', now?.receipts.map((r) => r.number), [part?.number, rest?.number]);
eq('a received order takes no more', (await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po.id,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: lineOf(0).id }],
})).data?.code, 'po_closed');
eq('nor can it be cancelled', (await owner.post(`/purchase-orders/${po.id}/cancel`)).status, 409);

console.log('== cancelling');
const saraWh = (await sara.get('/warehouses')).data.find((w) => w.kind === 'STORE' && w.isActive && w.branchId === sara.user.branchId);
const saraPo = ok('inventory staff order for their own branch', await sara.post('/purchase-orders', { ...body, warehouseId: saraWh?.id, lines: [{ productId: shirt.id, quantity: 2 }] }));
eq('…which is theirs', saraPo?.branchId, sara.user.branchId);
eq('inventory staff may not cancel', (await sara.post(`/purchase-orders/${saraPo?.id}/cancel`)).status, 403);
check('they don\u2019t see the main branch\u2019s orders', !((await sara.get('/purchase-orders?pageSize=200')).data?.items ?? []).some((o) => o.id === po.id));
eq('…nor open one', (await sara.get(`/purchase-orders/${po.id}`)).status, 404);
const po2 = ok('another order', await owner.post('/purchase-orders', { ...body, lines: [{ productId: shirt.id, quantity: 3, unitPrice: 10000 }] }));
const cancelled = ok('the owner cancels it', await owner.post(`/purchase-orders/${po2.id}/cancel`));
eq('cancelled', cancelled?.status, 'CANCELLED');
eq('a cancelled order receives nothing', (await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: po2.id,
  lines: [{ productId: shirt.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: po2.lines[0].id }],
})).data?.code, 'po_closed');

console.log('== permissions and scope');
for (const [what, res] of [
  ['list', await karim.get('/purchase-orders')],
  ['open', await karim.get(`/purchase-orders/${po.id}`)],
  ['create', await karim.post('/purchase-orders', body)],
  ['send', await karim.post(`/purchase-orders/${po2.id}/send`)],
])
  eq(`sales staff can't ${what}`, res.status, 403);
// A branch the person doesn't work in: its orders are out of sight.
const far = ok('another branch', await owner.post('/branches', { name: `PO far ${tag}`, code: `PF${tag}`.slice(0, 8) }));
const farWh = (await owner.get('/warehouses')).data.find((w) => w.branchId === far.id && w.kind === 'STORE');
if (farWh) {
  const farOrder = ok('an order of that branch', await owner.at(far.id).post('/purchase-orders', { ...body, warehouseId: farWh.id }));
  eq('its branch is the warehouse’s', farOrder?.branchId, far.id);
  const monaSees = (await mona.get('/purchase-orders?pageSize=200')).data?.items ?? [];
  const saraSees = (await sara.get('/purchase-orders?pageSize=200')).data?.items ?? [];
  check('someone of every branch sees it', monaSees.some((o) => o.id === farOrder?.id) || mona.user.allBranches === false);
  check('someone of one branch doesn’t', !saraSees.some((o) => o.id === farOrder?.id));
  eq('…nor opens it', (await sara.get(`/purchase-orders/${farOrder?.id}`)).status, 404);
  eq('receiving it needs working in its branch', (await owner.post('/purchases/invoices', {
    partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, purchaseOrderId: farOrder?.id,
    lines: [{ productId: shirt.id, unitId: piece.id, quantity: 1, unitCost: 10000, orderLineId: farOrder?.lines[0].id }],
  })).data?.code, 'po_other_branch');
} else check('the new branch has a store', false);

console.log('== the activity log');
const log = (await owner.get(`/audit?resource=purchase_order&resourceId=${po.id}&pageSize=50`)).data?.items ?? [];
eq('created, changed, sent and received twice', ['create', 'update', 'send', 'receive'].map((a) => log.filter((e) => e.action === a).length), [1, 1, 1, 2]);
check('cancelling is there too', ((await owner.get(`/audit?resource=purchase_order&resourceId=${po2.id}`)).data?.items ?? []).some((e) => e.action === 'cancel'));
eq('printing it is its own permission', (await karim.post('/outputs', { page: 'purchase_orders', kind: 'print', title: 'x' })).status, 403);
eq('…the owner may', (await owner.post('/outputs', { page: 'purchase_orders', kind: 'excel', title: 'x' })).status, 204);

process.exit(summary('purchaseorders') ? 1 : 0);
