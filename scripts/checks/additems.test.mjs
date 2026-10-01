// Adding items is a purchase invoice (owner decision 2026-10-01): items created into a warehouse take
// its branch's and warehouse's prefixes in their code, and the purchase carries the supplier's
// discount per line, so the goods and the supplier's account are at the net cost. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: no purchases

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const sale = levels.find((l) => l.side === 'SALE' && l.isDefault);
const buy = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
const branches = (await owner.get('/branches')).data;
const main = branches.find((b) => b.id === owner.user.branchId);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === main.id);
const dept = ok('a department with a prefix', await owner.post('/departments', { name: `Kids ${tag}`, prefix: `K${tag.slice(0, 3)}`.toUpperCase() }));
const supplier = ok('a supplier', await owner.post('/parties', { name: `AddSup ${tag}`, types: ['SUPPLIER'] }));

const item = ok(
  'an item bought into a warehouse',
  await owner.post('/products', {
    name: `Jacket ${tag}`,
    departmentId: dept.id,
    warehouseId: wh.id,
    supplierId: supplier.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [
      { unitId: piece.id, priceLevelId: sale.id, price: 13000 },
      { unitId: piece.id, priceLevelId: buy.id, price: 10000 },
    ],
  }),
);
check('its code carries the department prefix', item.sku.includes(dept.prefix), item.sku);
if (main.prefix) check('and the branch prefix', item.sku.startsWith(main.prefix), item.sku);
eq(
  'an unknown warehouse is refused',
  (await owner.post('/products', { name: `X ${tag}`, departmentId: dept.id, warehouseId: '00000000-0000-0000-0000-000000000000', units: [{ unitId: piece.id, factor: 1 }] })).data?.code,
  'warehouse_not_found',
);

const before = (await owner.get(`/parties/${supplier.id}`)).data.balance;
const inv = ok(
  '5 bought at 100.00 less 10.00 a piece',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, unitId: piece.id, quantity: 5, unitCost: 10000, discount: 5000 }],
  }),
);
eq('subtotal before the discount', inv.subtotal, 50000);
eq('discount', inv.discountTotal, 5000);
eq('owed at the net cost', inv.grandTotal, 45000);
eq('line keeps its discount', [inv.lines[0].discount, inv.lines[0].lineTotal], [5000, 45000]);
eq('supplier owed 450.00 more', (await owner.get(`/parties/${supplier.id}`)).data.balance, before - 45000);
const detail = (await owner.get(`/products/${item.id}`)).data;
eq('stock at the net cost', [detail.stockOnHand, detail.costPrice], [5, 9000]);
eq(
  'a discount over the line is refused',
  (await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 1, unitCost: 10000, discount: 20000 }] })).status,
  400,
);
eq('sales staff cannot buy', (await karim.post('/purchases/invoices', {})).status, 403);

summary('additems');
