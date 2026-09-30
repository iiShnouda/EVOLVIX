// Step 3 checks: units, price levels, prices & permissions, size × color models, invoices and
// returns in units, reports. Runs against BASE (default :5090). Works on an upgraded or a fresh DB.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local');   // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const sara = await login('sara@skb.local');   // INVENTORY (October branch)
const round = (x) => Math.round(x);

// ------------------------------------------------------------------ catalog lists
console.log('== catalog lists');
let units = ok('units list', await owner.get('/units'));
// Starter units are named in Arabic (a database from before may still say Piece/Carton/Dozen).
const byName = (list, ...names) => list.find((u) => names.includes(u.name));
const piece = byName(units, 'قطعة', 'Piece'), carton = byName(units, 'كرتونة', 'Carton'), dozen = byName(units, 'دستة', 'Dozen');
check('piece/carton/dozen exist', piece && carton && dozen, units.map((u) => u.name));
const categories = ok('categories', await owner.get('/categories'));
const cat = categories[0];
let levels = ok('price levels', await owner.get('/price-levels'));
const custLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const suppLevel = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
check('default customer + supplier levels', custLevel && suppLevel, levels);
eq('customer level name', custLevel.name, 'سعر العملاء');
eq('supplier level name', suppLevel.name, 'سعر الموردين');

eq('dup unit refused', (await owner.post('/units', { name: carton.name })).data?.code, 'duplicate_name');
eq('empty unit name refused', (await owner.post('/units', { name: '  ' })).data?.code, 'bad_name');
eq('sales cannot add unit', (await karim.post('/units', { name: `Sack ${tag}` })).status, 403);
const sack = ok('inventory adds a unit in Arabic', await sara.post('/units', { name: `شوال ${tag}` }));
eq('name kept as typed', sack.name, `شوال ${tag}`);
const sackEn = ok('units in an English request', await sara.lang('en').get('/units')).find((u) => u.id === sack.id);
eq('same name on an English screen (never translated)', sackEn.name, `شوال ${tag}`);
check('no translation fields', !('names' in sackEn), sackEn);
ok('rename unit', await owner.put(`/units/${sack.id}`, { name: `Sack ${tag}` }));

eq('accountant cannot add price level', (await mona.post('/price-levels', { side: 'SALE', name: `Retail ${tag}` })).status, 403);
eq('bad side', (await owner.post('/price-levels', { side: 'X', name: 'x' })).data?.code, 'bad_side');
const retail = ok('owner adds retail level', await owner.post('/price-levels', { side: 'SALE', name: `Retail ${tag}` }));
eq('new level not default', retail.isDefault, false);
eq('dup level name', (await owner.post('/price-levels', { side: 'SALE', name: `retail ${tag}` })).data?.code, 'duplicate_name');
eq('cannot close default level', (await owner.put(`/price-levels/${custLevel.id}`, { isActive: false })).data?.code, 'price_level_is_default');
eq('cannot un-default', (await owner.put(`/price-levels/${custLevel.id}`, { isDefault: false })).data?.code, 'default_required');

const size = (n) => owner.post('/variant-options', { kind: 'SIZE', name: `${n}${tag}` });
const sizeS = ok('add size', await size('S')), sizeM = ok('add size', await size('M')), sizeL = ok('add size', await size('L'));
const red = ok('add color', await owner.post('/variant-options', { kind: 'COLOR', name: `Red ${tag}` }));
const blue = ok('add color', await owner.post('/variant-options', { kind: 'COLOR', name: `Blue ${tag}` }));
eq('bad kind', (await owner.post('/variant-options', { kind: 'SHAPE', name: 'x' })).data?.code, 'bad_kind');
eq('dup size', (await size('S')).data?.code, 'duplicate_name');
eq('sales cannot add size', (await karim.post('/variant-options', { kind: 'SIZE', name: `Q${tag}` })).status, 403);
const newCat = ok('inventory adds category', await sara.post('/categories', { name: `Tools ${tag}` }));
eq('sales cannot add category', (await karim.post('/categories', { name: `Nope ${tag}` })).status, 403);

// ------------------------------------------------------------------ items
console.log('== items');
const bc1 = `99${tag}001`, bc2 = `99${tag}024`;
const itemReq = {
  name: `Juice 250ml ${tag}`, categoryId: cat.id, reorderLevel: 10,
  units: [{ unitId: piece.id, factor: 1, barcode: bc1 }, { unitId: carton.id, factor: 24, barcode: bc2 }],
  prices: [
    { unitId: piece.id, priceLevelId: custLevel.id, price: 1200 },
    { unitId: carton.id, priceLevelId: custLevel.id, price: 27000 },
  ],
};
const juice = ok('create item with units + prices', await owner.post('/products', itemReq));
eq('item has 2 units', juice.units.map((u) => u.factor), [1, 24]);
check('auto SKU', /^ITEM-\d{5}$/.test(juice.sku), juice.sku);
const cell = (d, unitId, levelId) => d.prices.find((p) => p.unitId === unitId && p.priceLevelId === levelId);
eq('piece customer price own', [cell(juice, piece.id, custLevel.id).own, cell(juice, piece.id, custLevel.id).source], [1200, 'OWN']);
eq('carton at retail falls back to default level', [cell(juice, carton.id, retail.id).effective, cell(juice, carton.id, retail.id).source], [27000, 'DEFAULT']);
eq('item name as typed', juice.name, `Juice 250ml ${tag}`);

eq('inventory cannot set prices', (await sara.post('/products', { ...itemReq, name: `X ${tag}`, units: [{ unitId: piece.id, factor: 1 }] })).status, 403);
const plain = ok('inventory creates item without prices', await sara.post('/products', { name: `Tape ${tag}`, categoryId: newCat.id, units: [{ unitId: piece.id, factor: 1 }] }));
eq('sales cannot create item', (await karim.post('/products', { name: `Y ${tag}`, categoryId: cat.id, units: [{ unitId: piece.id, factor: 1 }] })).status, 403);

const bad = async (name, body, code) => eq(name, (await owner.post('/products', { name: `Bad ${tag} ${name}`, categoryId: cat.id, ...body })).data?.code, code);
await bad('two base units', { units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 1 }] }, 'one_base_unit');
await bad('no base unit', { units: [{ unitId: carton.id, factor: 12 }] }, 'one_base_unit');
await bad('factor 0', { units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 0 }] }, 'bad_factor');
await bad('factor too big', { units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 100001 }] }, 'bad_factor');
await bad('same unit twice', { units: [{ unitId: piece.id, factor: 1 }, { unitId: piece.id, factor: 6 }] }, 'duplicate_unit');
await bad('same factor twice', { units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 12 }, { unitId: dozen.id, factor: 12 }] }, 'duplicate_factor');
await bad('taken barcode', { units: [{ unitId: piece.id, factor: 1, barcode: bc2 }] }, 'duplicate_barcode');
await bad('barcode twice', { units: [{ unitId: piece.id, factor: 1, barcode: 'Z1' }, { unitId: carton.id, factor: 6, barcode: 'z1' }] }, 'duplicate_barcode');
await bad('unknown unit', { units: [{ unitId: '00000000-0000-0000-0000-000000000001', factor: 1 }] }, 'unit_not_found');
await bad('no units', { units: [] }, 'no_units');
await bad('negative reorder', { reorderLevel: -1, units: [{ unitId: piece.id, factor: 1 }] }, 'bad_reorder');
await bad('dup sku', { sku: juice.sku.toLowerCase(), units: [{ unitId: piece.id, factor: 1 }] }, 'duplicate_sku');
eq('no category', (await owner.post('/products', { name: `NoCat ${tag}`, units: [{ unitId: piece.id, factor: 1 }] })).data?.code, 'category_not_found');
await bad('price for unit not on item', { units: [{ unitId: piece.id, factor: 1 }], prices: [{ unitId: carton.id, priceLevelId: custLevel.id, price: 5 }] }, 'bad_price_cell');
await bad('negative price', { units: [{ unitId: piece.id, factor: 1 }], prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: -5 }] }, 'bad_price');

let found = ok('scan carton barcode', await owner.get(`/products?search=${bc2}`));
eq('scan finds item first with carton', [found[0]?.id, found[0]?.matchedUnitId], [juice.id, carton.id]);
eq('search returns unit prices', found[0].units.find((u) => u.unitId === carton.id).prices.find((p) => p.priceLevelId === custLevel.id).price, 27000);
found = ok('partial barcode search', await owner.get(`/products?search=${bc1.slice(0, 8)}`));
check('partial barcode finds item (no match flag)', found.some((p) => p.id === juice.id && !p.matchedUnitId), found.map((p) => p.sku));

// prices endpoint
eq('sales cannot set prices', (await karim.put(`/products/${juice.id}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 1 }] })).status, 403);
eq('inventory cannot set prices', (await sara.put(`/products/${juice.id}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 1 }] })).status, 403);
let d = ok('accountant sets retail piece price', await mona.put(`/products/${juice.id}/prices`, { prices: [{ unitId: piece.id, priceLevelId: retail.id, price: 1500 }] }));
eq('retail carton = piece × 24 (BASE)', [cell(d, carton.id, retail.id).effective, cell(d, carton.id, retail.id).source], [36000, 'BASE']);
d = ok('clear carton customer price', await owner.put(`/products/${juice.id}/prices`, { prices: [{ unitId: carton.id, priceLevelId: custLevel.id, price: null }] }));
eq('carton customer now piece × 24', [cell(d, carton.id, custLevel.id).effective, cell(d, carton.id, custLevel.id).source], [28800, 'BASE']);
d = ok('set carton customer back', await owner.put(`/products/${juice.id}/prices`, { prices: [{ unitId: carton.id, priceLevelId: custLevel.id, price: 27000 }] }));
eq('list price mirrors base customer price', (await owner.get(`/products?search=${bc1}`)).data[0].salePrice, 1200);
eq('bad price cell', (await owner.put(`/products/${juice.id}/prices`, { prices: [{ unitId: dozen.id, priceLevelId: custLevel.id, price: 1 }] })).data?.code, 'bad_price_cell');

// units edit before any movement: base may change
d = ok('change base unit before movements', await owner.put(`/products/${plain.id}`, { units: [{ unitId: dozen.id, factor: 1 }] }));
eq('base changed', d.units.map((u) => u.unitId), [dozen.id]);
ok('change back', await owner.put(`/products/${plain.id}`, { units: [{ unitId: piece.id, factor: 1 }] }));
eq('sales cannot edit item', (await karim.put(`/products/${juice.id}`, { reorderLevel: 3 })).status, 403);
d = ok('swap barcodes between own units', await owner.put(`/products/${juice.id}`, { units: [{ unitId: piece.id, factor: 1, barcode: bc2 }, { unitId: carton.id, factor: 24, barcode: bc1 }] }));
eq('barcodes swapped', d.units.map((u) => u.barcode), [bc2, bc1]);
ok('swap back', await owner.put(`/products/${juice.id}`, { units: [{ unitId: piece.id, factor: 1, barcode: bc1 }, { unitId: carton.id, factor: 24, barcode: bc2 }] }));

// ------------------------------------------------------------------ parties & documents
const parties = (await owner.get('/parties?pageSize=100')).data.items;
const customers = parties.filter((p) => p.types.includes('CUSTOMER'));
const [c1, c2] = customers;
const supplier = parties.find((p) => p.types.includes('SUPPLIER'));
const whs = (await owner.get('/warehouses')).data;
const mainWh = whs.find((w) => w.isDefault && w.branchId === owner.user.branchId);

console.log('== purchases in cartons');
eq('purchase unit not on item', (await owner.post('/purchases/invoices', { partyId: supplier.id, lines: [{ productId: juice.id, unitId: dozen.id, quantity: 1, unitCost: 100 }] })).data?.code, 'unit_not_found');
eq('purchase qty 0', (await owner.post('/purchases/invoices', { partyId: supplier.id, lines: [{ productId: juice.id, quantity: 0, unitCost: 100 }] })).data?.code, 'bad_qty');
eq('purchase qty too big', (await owner.post('/purchases/invoices', { partyId: supplier.id, lines: [{ productId: juice.id, quantity: 1000001, unitCost: 100 }] })).data?.code, 'bad_qty');
const bulk = ok('bulk item', await owner.post('/products', { name: `Bulk ${tag}`, categoryId: cat.id, units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 100000 }] }));
eq('base quantity overflow refused', (await owner.post('/purchases/invoices', { partyId: supplier.id, lines: [{ productId: bulk.id, unitId: carton.id, quantity: 1000000, unitCost: 1 }] })).data?.code, 'bad_qty');
const pur = ok('buy 2 cartons @ 230.00 + 5 pieces @ 9.50', await owner.post('/purchases/invoices', {
  partyId: supplier.id, warehouseId: mainWh.id, taxPercent: 0,
  lines: [{ productId: plain.id, quantity: 10, unitCost: 500 },
    { productId: juice.id, unitId: carton.id, quantity: 2, unitCost: 23000 },
    { productId: juice.id, quantity: 5, unitCost: 950 }],
}));
const cartonLine = pur.lines.find((l) => l.productId === juice.id && l.unitFactor === 24);
eq('carton purchase line', [cartonLine.quantity, cartonLine.unitQuantity, cartonLine.unitPrice, cartonLine.lineTotal, cartonLine.lineCost, cartonLine.unitName], [48, 2, 23000, 46000, 46000, carton.name]);
eq('purchase priced at supplier level', pur.priceLevelId, suppLevel.id);
let jd = (await owner.get(`/products/${juice.id}`)).data;
// the pool average is kept in whole piastres after each receipt: 46000/48 → 958, then (48×958 + 4750)/53 → 957
eq('juice stock 53 pieces, avg per receipt', [jd.stockOnHand, jd.costPrice], [53, round((48 * round(46000 / 48) + 4750) / 53)]);

console.log('== sales in units, level prices, permissions');
const sale = async (who, body) => who.post('/sales/invoices', { partyId: c1.id, taxPercent: 0, warehouseId: mainWh.id, ...body });
const cost = jd.costPrice;
let r = await sale(karim, { lines: [{ productId: juice.id, unitId: carton.id, quantity: 1, unitPrice: 27000 }] });
const s1 = ok('sales sells 1 carton at level price', r);
eq('sale line in cartons', [s1.lines[0].quantity, s1.lines[0].unitQuantity, s1.lines[0].unitName, s1.lines[0].lineTotal], [24, 1, carton.name, 27000]);
eq('sale profit uses piece cost × 24', s1.lines[0].lineProfit, 27000 - 24 * cost);
eq('sale priced at customer level', s1.priceLevelId, custLevel.id);
r = await sale(karim, { lines: [{ productId: juice.id, unitId: carton.id, quantity: 1, unitPrice: 26000 }] });
eq('sales cannot change price', [r.status, r.data?.code], [403, 'price_not_allowed']);
r = await sale(karim, { lines: [{ productId: juice.id, quantity: 1, unitPrice: 1200, discount: 10 }] });
eq('sales cannot discount', [r.status, r.data?.code], [403, 'price_not_allowed']);
r = await sale(karim, { priceLevelId: retail.id, lines: [{ productId: juice.id, quantity: 1, unitPrice: 1500 }] });
eq('sales cannot choose level', [r.status, r.data?.code], [403, 'price_level_not_allowed']);
r = await sale(mona, { priceLevelId: retail.id, lines: [{ productId: juice.id, quantity: 1, unitPrice: 1500 }] });
const s2 = ok('accountant sells at retail level', r);
eq('retail level stored', s2.priceLevelName, `Retail ${tag}`);
r = await sale(mona, { priceLevelId: suppLevel.id, lines: [{ productId: juice.id, quantity: 1, unitPrice: 1500 }] });
eq('purchase level refused on a sale', r.data?.code, 'price_level_not_found');
r = await sale(mona, { lines: [{ productId: juice.id, quantity: 1, unitPrice: 1300, discount: 1300 - cost + 1 }] });
eq('discount below cost blocked', r.data?.code, 'below_cost');
r = await sale(owner, { lines: [{ productId: juice.id, unitId: carton.id, quantity: 1, unitPrice: 27000 }, { productId: juice.id, quantity: 5, unitPrice: 1200 }] });
eq('oversell across units blocked (24+5 > 28)', r.data?.code, 'insufficient_stock');
r = await sale(owner, { lines: [{ productId: juice.id, unitId: dozen.id, quantity: 1, unitPrice: 100 }] });
eq('unit not on item', r.data?.code, 'unit_not_found');
r = await sale(owner, { lines: [{ productId: juice.id, quantity: 2, unitPrice: 100, discount: 201 }] });
eq('discount above line', r.data?.code, 'bad_price');

// party price level
eq('sales cannot set party level', (await karim.put(`/parties/${c2.id}/price-levels`, { salesPriceLevelId: retail.id })).status, 403);
eq('purchase level on sales side refused', (await mona.put(`/parties/${c2.id}/price-levels`, { salesPriceLevelId: suppLevel.id })).data?.code, 'price_level_not_found');
const pc2 = ok('accountant sets customer level', await mona.put(`/parties/${c2.id}/price-levels`, { salesPriceLevelId: retail.id }));
eq('party level stored', pc2.salesPriceLevelId, retail.id);
r = await karim.post('/sales/invoices', { partyId: c2.id, taxPercent: 0, warehouseId: mainWh.id, lines: [{ productId: juice.id, quantity: 1, unitPrice: 1500 }] });
const s3 = ok('sales sells at the customer\'s own level', r);
eq('own level used', s3.priceLevelId, retail.id);
r = await karim.post('/sales/invoices', { partyId: c2.id, taxPercent: 0, warehouseId: mainWh.id, lines: [{ productId: juice.id, quantity: 1, unitPrice: 1200 }] });
eq('default level price refused for that customer', r.data?.code, 'price_not_allowed');
ok('clear party level', await owner.put(`/parties/${c2.id}/price-levels`, { salesPriceLevelId: '' }));
eq('cleared', (await owner.get(`/parties/${c2.id}`)).data.salesPriceLevelId, null);

// unpriced item: price = cost × (1 + default markup)
const settings = (await owner.get('/settings')).data;
const plainCost = (await owner.get(`/products/${plain.id}`)).data.costPrice;
const markupPrice = round(plainCost * (100 + settings.defaultMarkupPercent) / 100);
r = await sale(karim, { lines: [{ productId: plain.id, quantity: 1, unitPrice: markupPrice }] });
ok('sales sells unpriced item at cost + markup', r);
r = await sale(karim, { lines: [{ productId: plain.id, quantity: 1, unitPrice: markupPrice + 1 }] });
eq('other price refused', r.data?.code, 'price_not_allowed');

// base unit locked once stock moved
eq('base unit locked after movement', (await owner.put(`/products/${juice.id}`, { units: [{ unitId: dozen.id, factor: 1 }, { unitId: carton.id, factor: 24 }] })).data?.code, 'base_unit_locked');
d = ok('carton factor may change', await owner.put(`/products/${juice.id}`, { units: [{ unitId: piece.id, factor: 1, barcode: bc1 }, { unitId: carton.id, factor: 20, barcode: bc2 }] }));
eq('factor now 20', d.units[1].factor, 20);
const sd1 = (await owner.get(`/sales/invoices/${s1.id}`)).data;
eq('old line keeps factor 24', [sd1.lines[0].unitFactor, sd1.lines[0].quantity], [24, 24]);
ok('factor back to 24', await owner.put(`/products/${juice.id}`, { units: [{ unitId: piece.id, factor: 1, barcode: bc1 }, { unitId: carton.id, factor: 24, barcode: bc2 }] }));
eq('cannot close item with stock', (await owner.put(`/products/${juice.id}`, { isActive: false })).data?.code, 'has_stock');

console.log('== returns in units');
// sale of 2 cartons (48 pcs) needs stock: buy 2 more cartons
ok('buy 2 more cartons', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: mainWh.id, taxPercent: 14, lines: [{ productId: juice.id, unitId: carton.id, quantity: 2, unitCost: 23000 }] }));
const big = ok('sell 2 cartons with tax + discount', await sale(mona, { taxPercent: 14, lines: [{ productId: juice.id, unitId: carton.id, quantity: 2, unitPrice: 27000, discount: 100 }] }));
const bl = big.lines[0];
const ret1 = ok('return 1 whole carton', await owner.post(`/sales/invoices/${big.id}/returns`, { lines: [{ lineId: bl.id, quantity: 24 }] }));
eq('whole carton returned in cartons', [ret1.lines[0].unitName, ret1.lines[0].unitQuantity, ret1.lines[0].unitPrice, ret1.lines[0].discount, ret1.lines[0].lineTotal], [carton.name, 1, 27000, 50, 26950]);
const ret2 = ok('return 5 pieces', await owner.post(`/sales/invoices/${big.id}/returns`, { lines: [{ lineId: bl.id, quantity: 5 }] }));
eq('pieces returned in base unit', [ret2.lines[0].unitName, ret2.lines[0].unitFactor, ret2.lines[0].unitQuantity], [piece.name, 1, 5]);
eq('pieces gross share', ret2.lines[0].lineTotal + ret2.lines[0].discount, round(54000 * 5 / 48));
const ret3 = ok('return the last 19 pieces', await owner.post(`/sales/invoices/${big.id}/returns`, { lines: [{ lineId: bl.id, quantity: 19 }] }));
const rets = [ret1, ret2, ret3];
eq('gross returned exactly', rets.reduce((s, x) => s + x.lines[0].lineTotal + x.lines[0].discount, 0), 54000);
eq('discount returned exactly', rets.reduce((s, x) => s + x.lines[0].discount, 0), 100);
eq('cost returned exactly', rets.reduce((s, x) => s + x.costTotal, 0), bl.lineCost);
eq('tax returned exactly', rets.reduce((s, x) => s + x.taxTotal, 0), big.taxTotal);
eq('grand returned exactly', rets.reduce((s, x) => s + x.grandTotal, 0), big.grandTotal);
eq('invoice fully returned', (await owner.get(`/sales/invoices/${big.id}`)).data.status, 'RETURNED');
eq('over-return refused', (await owner.post(`/sales/invoices/${big.id}/returns`, { lines: [{ lineId: bl.id, quantity: 1 }] })).data?.code, 'exceeds_returnable');

// purchase return backs the exact carton value out of the average
const beforePR = (await owner.get(`/products/${juice.id}`)).data;
const prl = cartonLine;
const pret = ok('return 1 carton to supplier', await owner.post(`/purchases/invoices/${pur.id}/returns`, { lines: [{ lineId: prl.id, quantity: 24 }] }));
eq('purchase return value = carton price', [pret.lines[0].lineCost, pret.lines[0].unitName], [23000, carton.name]);
const afterPR = (await owner.get(`/products/${juice.id}`)).data;
const expectAvg = round((beforePR.stockOnHand * beforePR.costPrice - 23000) / (beforePR.stockOnHand - 24));
check('average backs out exact value', Math.abs(afterPR.costPrice - expectAvg) <= 1, { got: afterPR.costPrice, expectAvg });
const pret2 = ok('return 7 pieces of the other carton', await owner.post(`/purchases/invoices/${pur.id}/returns`, { lines: [{ lineId: prl.id, quantity: 7 }] }));
eq('partial carton to supplier in pieces', [pret2.lines[0].unitName, pret2.lines[0].lineCost], [piece.name, round(46000 * 7 / 48)]);
const pret3 = ok('return rest of that line', await owner.post(`/purchases/invoices/${pur.id}/returns`, { lines: [{ lineId: prl.id, quantity: 17 }] }));
eq('purchase line cost returned exactly', pret.lines[0].lineCost + pret2.lines[0].lineCost + pret3.lines[0].lineCost, 46000);

// ------------------------------------------------------------------ models & variants
console.log('== models');
const modelReq = {
  name: `Polo ${tag}`, code: `PL${tag}`, categoryId: cat.id, reorderLevel: 6,
  sizeIds: [sizeS.id, sizeM.id], colorIds: [red.id, blue.id],
  units: [{ unitId: piece.id, factor: 1 }, { unitId: dozen.id, factor: 12 }],
  prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 15000 }, { unitId: piece.id, priceLevelId: suppLevel.id, price: 9000 }],
};
eq('inventory cannot price a model', (await sara.post('/models', modelReq)).status, 403);
eq('sales cannot add a model', (await karim.post('/models', { ...modelReq, prices: [] })).status, 403);
eq('model needs size or color', (await owner.post('/models', { ...modelReq, code: `Q${tag}`, sizeIds: [], colorIds: [] })).data?.code, 'no_variants');
eq('size given as color', (await owner.post('/models', { ...modelReq, code: `Q${tag}`, colorIds: [sizeS.id] })).data?.code, 'variant_option_not_found');
let m = ok('create model 2 sizes × 2 colors', await owner.post('/models', modelReq));
eq('4 variants', m.variants.length, 4);
eq('variant SKUs', m.variants.map((v) => v.sku).sort(), [`PL${tag}-BLUE-M${tag}`.toUpperCase(), `PL${tag}-BLUE-S${tag}`.toUpperCase(), `PL${tag}-RED-M${tag}`.toUpperCase(), `PL${tag}-RED-S${tag}`.toUpperCase()].sort());
const vRedS = m.variants.find((v) => v.colorId === red.id && v.sizeId === sizeS.id);
eq('variant name EN', vRedS.name, `Polo ${tag} — Red ${tag} / S${tag}`);
const vAr = (await owner.lang('ar').get(`/models/${m.id}`)).data.variants.find((v) => v.productId === vRedS.productId);
eq('variant name the same on an Arabic screen', vAr.name, `Polo ${tag} — Red ${tag} / S${tag}`);
eq('dup model code', (await owner.post('/models', { ...modelReq })).data?.code, 'duplicate_code');
let vd = (await owner.get(`/products/${vRedS.productId}`)).data;
eq('variant inherits model price', [cell(vd, piece.id, custLevel.id).effective, cell(vd, piece.id, custLevel.id).source], [15000, 'MODEL']);
eq('variant dozen = 12 × model piece', [cell(vd, dozen.id, custLevel.id).effective, cell(vd, dozen.id, custLevel.id).source], [180000, 'BASE']);
eq('variant list price', vRedS.salePrice, 15000);

vd = ok('variant own price', await owner.put(`/products/${vRedS.productId}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 16000 }] }));
eq('variant own price wins', cell(vd, piece.id, custLevel.id).source, 'OWN');
m = ok('model price change', await owner.put(`/models/${m.id}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 14000 }] }));
eq('other variants follow model', m.variants.filter((v) => v.productId !== vRedS.productId).map((v) => v.salePrice), [14000, 14000, 14000]);
eq('own-price variant keeps its price', m.variants.find((v) => v.productId === vRedS.productId).salePrice, 16000);
eq('own-price flag', m.variants.find((v) => v.productId === vRedS.productId).ownPrices, true);
vd = ok('reset variant to model price', await owner.put(`/products/${vRedS.productId}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: null }] }));
eq('back to model price', [cell(vd, piece.id, custLevel.id).effective, cell(vd, piece.id, custLevel.id).source], [14000, 'MODEL']);
eq('inventory cannot set model prices', (await sara.put(`/models/${m.id}/prices`, { prices: [{ unitId: piece.id, priceLevelId: custLevel.id, price: 1 }] })).status, 403);

eq('variant name locked', (await owner.put(`/products/${vRedS.productId}`, { name: 'x' })).data?.code, 'variant_managed_by_model');
eq('variant category locked', (await owner.put(`/products/${vRedS.productId}`, { categoryId: newCat.id })).data?.code, 'variant_managed_by_model');
eq('variant units locked', (await owner.put(`/products/${vRedS.productId}`, { units: [{ unitId: piece.id, factor: 1 }] })).data?.code, 'variant_managed_by_model');
vd = ok('variant barcode', await owner.put(`/products/${vRedS.productId}`, { units: [{ unitId: piece.id, factor: 1, barcode: `VB${tag}` }, { unitId: dozen.id, factor: 12, barcode: `VD${tag}` }] }));
eq('variant barcodes set', vd.units.map((u) => u.barcode), [`VB${tag}`, `VD${tag}`]);
found = (await owner.get(`/products?search=VD${tag}`)).data;
eq('scan variant dozen', [found[0].id, found[0].matchedUnitId, found[0].sizeName, found[0].colorName], [vRedS.productId, dozen.id, `S${tag}`, `Red ${tag}`]);

m = ok('add size L', await owner.put(`/models/${m.id}`, { addSizeIds: [sizeL.id] }));
eq('6 variants after adding L', m.variants.length, 6);
eq('sizes listed', m.sizes.map((s) => s.name), [`S${tag}`, `M${tag}`, `L${tag}`]);
const colorOnly = ok('colour-only model', await owner.post('/models', { ...modelReq, code: `CO${tag}`, name: `Cap ${tag}`, sizeIds: [], prices: [] }));
eq('colour-only model has 2 variants', colorOnly.variants.length, 2);
eq('cannot add sizes to colour-only model', (await owner.put(`/models/${colorOnly.id}`, { addSizeIds: [sizeS.id] })).data?.code, 'dimension_fixed');
m = ok('rename model', await owner.put(`/models/${m.id}`, { name: `Polo Pro ${tag}` }));
check('variants renamed', m.variants.every((v) => v.name.startsWith(`Polo Pro ${tag} — `)), m.variants.map((v) => v.name));
ok('rename colour', await owner.put(`/variant-options/${red.id}`, { name: `Crimson ${tag}` }));
m = (await owner.get(`/models/${m.id}`)).data;
eq('colour rename flows to variant', m.variants.find((v) => v.productId === vRedS.productId).name, `Polo Pro ${tag} — Crimson ${tag} / S${tag}`);

// buy and sell a variant by the dozen
ok('buy 2 dozen of a variant', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: mainWh.id, taxPercent: 0, lines: [{ productId: vRedS.productId, unitId: dozen.id, quantity: 2, unitCost: 108000 }] }));
const vs = ok('sales sells 1 dozen at model price', await sale(karim, { lines: [{ productId: vRedS.productId, unitId: dozen.id, quantity: 1, unitPrice: 168000 }] }));
eq('variant sold 12 pieces', vs.lines[0].quantity, 12);
eq('model base unit locked', (await owner.put(`/models/${m.id}`, { units: [{ unitId: dozen.id, factor: 1 }] })).data?.code, 'base_unit_locked');
m = ok('model gains a carton of 48', await owner.put(`/models/${m.id}`, { units: [{ unitId: piece.id, factor: 1 }, { unitId: dozen.id, factor: 12 }, { unitId: carton.id, factor: 48 }] }));
vd = (await owner.get(`/products/${vRedS.productId}`)).data;
eq('variant follows model units, keeps barcodes', vd.units.map((u) => [u.factor, u.barcode]), [[1, `VB${tag}`], [12, `VD${tag}`], [48, null]]);
eq('cannot close model with stock', (await owner.put(`/models/${m.id}`, { isActive: false })).data?.code, 'has_stock');
const closed = ok('close stock-less model', await owner.put(`/models/${colorOnly.id}`, { isActive: false }));
check('its variants closed', closed.variants.every((v) => !v.isActive), closed.variants);
eq('closed variant not sellable', (await sale(owner, { lines: [{ productId: colorOnly.variants[0].productId, quantity: 1, unitPrice: 1 }] })).data?.code, 'product_not_found');

console.log('== reports');
const today = companyToday();
const byModel = ok('profit by model', await owner.get(`/reports/profitability?from=${today}&to=${today}&by=model`));
const modelRow = byModel.rows.find((x) => x.key === m.id);
check('variant sales roll up to model', modelRow && modelRow.quantity === 12, byModel.rows.map((x) => [x.label, x.quantity]));
const byProduct = ok('profit by product', await owner.get(`/reports/profitability?from=${today}&to=${today}&by=product`));
eq('same totals by model and product', byModel.rows.reduce((s, x) => s + x.profit, 0), byProduct.rows.reduce((s, x) => s + x.profit, 0));
const val = ok('valuation', await owner.get('/inventory/valuation'));
check('valuation by model has polo', val.models.some((x) => x.key === m.id && x.quantity === 12), val.models);
const inv = ok('inventory list filtered by model', await owner.get(`/inventory/items?modelId=${m.id}`));
eq('model filter rows', inv.items.length, 6);
check('inventory rows carry units', inv.items[0].units.length === 3, inv.items[0].units);

console.log('== concurrency: 5 sales of 1 carton with 2 cartons in stock');
const conc = ok('conc item', await owner.post('/products', { name: `Conc ${tag}`, categoryId: cat.id, units: [{ unitId: piece.id, factor: 1 }, { unitId: carton.id, factor: 10 }], prices: [{ unitId: carton.id, priceLevelId: custLevel.id, price: 2000 }] }));
ok('stock 20', await owner.post('/purchases/invoices', { partyId: supplier.id, warehouseId: mainWh.id, taxPercent: 0, lines: [{ productId: conc.id, quantity: 20, unitCost: 100 }] }));
const results = await Promise.all([1, 2, 3, 4, 5].map(() => sale(karim, { lines: [{ productId: conc.id, unitId: carton.id, quantity: 1, unitPrice: 2000 }] })));
eq('exactly 2 succeed', results.filter((x) => x.status === 201).length, 2);
eq('conc stock 0', (await owner.get(`/products/${conc.id}`)).data.stockOnHand, 0);

console.log('== old documents still readable');
const oldSales = (await owner.get('/sales/invoices?pageSize=100')).data.items;
for (const doc of oldSales.slice(-3)) {
  const dd = ok(`read ${doc.number}`, await owner.get(`/sales/invoices/${doc.id}`));
  check(`${doc.number} lines have units`, dd.lines.every((l) => l.unitName && l.unitQuantity * l.unitFactor === l.quantity), dd.lines);
}
ok('dashboard', await owner.get('/dashboard'));
ok('item card', await owner.get(`/inventory/items/${juice.id}/card`));
ok('products list default', await karim.get('/products'));

process.exit(summary('catalog') ? 1 : 0);
