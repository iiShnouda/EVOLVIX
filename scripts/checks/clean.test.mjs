// A company server's first start (Seed:Demo off): only the owner, one branch with its warehouse and
// main cash box, the starter units and price levels, and the cash customer. The owner can buy and
// sell straight away. Runs against BASE on a server started on an EMPTY database with Seed__Demo=false.
import { login, check, eq, ok, summary } from './lib.mjs';

const owner = await login('owner@skb.local');
eq('owner is the only person', (await owner.get('/staff')).data.length, 1);
eq('no demo items', (await owner.get('/products')).data.length, 0);
const parties = (await owner.get('/parties')).data.items;
eq('only the cash customer', parties.map((p) => p.code), [0]);
const branches = (await owner.get('/branches')).data;
eq('one branch', branches.length, 1);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault);
check('its warehouse', !!wh);
const piece = (await owner.get('/units')).data.find((u) => u.name === 'قطعة');
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
check('starter unit and price level', !!piece && !!level);

const dept = ok('a department', await owner.post('/departments', { name: 'رجالي', prefix: 'M' }));
const supp = ok('a supplier', await owner.post('/parties', { name: 'مورد أول', types: ['SUPPLIER'] }));
const cust = ok('a customer', await owner.post('/parties', { name: 'عميل أول', types: ['CUSTOMER'] }));
const item = ok('an item', await owner.post('/products', {
  name: 'قميص', departmentId: dept.id, warehouseId: wh.id,
  units: [{ unitId: piece.id, factor: 1 }],
  prices: [{ unitId: piece.id, priceLevelId: level.id, price: 15000 }],
}));
ok('buy 10', await owner.post('/purchases/invoices', {
  partyId: supp.id, warehouseId: wh.id, departmentId: dept.id, taxPercent: 0,
  lines: [{ productId: item.id, quantity: 10, unitCost: 10000 }],
}));
ok('sell 2', await owner.post('/sales/invoices', {
  partyId: cust.id, warehouseId: wh.id, departmentId: dept.id, taxPercent: 0,
  lines: [{ productId: item.id, quantity: 2, unitPrice: 15000 }],
}));
eq('customer owes 300.00', (await owner.get(`/parties/${cust.id}`)).data.balance, 30000);
summary();
