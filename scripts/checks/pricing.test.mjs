// Price lists and quantity discounts (DOMAIN.md §2.2): a party's list, lists for everyone (offers),
// dates, whole models, units worked out from the base unit, quantity steps per item and per model,
// what a sales person may charge without the permission to change prices, a supplier's list on
// purchases, validation, permissions and audit. Makes its own items and parties, so it can run again
// on the same database. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASSWORD = `Pricing-${tag}-Check1`;
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES: may sell, may not change prices

// ------------------------------------------------------------------ setup
console.log('== setup');
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const carton = ok('a carton unit', await owner.post('/units', { name: `Box ${tag}` }));
const cat = (await owner.get('/categories')).data[0];
const levels = (await owner.get('/price-levels')).data;
const sale = levels.find((l) => l.side === 'SALE' && l.isDefault);
const supply = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === karim.user.branchId);
const item = (name, piecePrice, cartonPrice) =>
  owner.post('/products', {
    name: `${name} ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }, ...(cartonPrice ? [{ unitId: carton.id, factor: 12 }] : [])],
    prices: [
      { unitId: piece.id, priceLevelId: sale.id, price: piecePrice },
      { unitId: piece.id, priceLevelId: supply.id, price: 600 },
      ...(cartonPrice ? [{ unitId: carton.id, priceLevelId: sale.id, price: cartonPrice }] : []),
    ],
  });
const A = ok('item A (piece 10.00, carton of 12 at 110.00)', await item('A', 1000, 11000));
const B = ok('item B (piece 20.00)', await item('B', 2000));
const S = ok('a size', await owner.post('/variant-options', { kind: 'SIZE', name: `S${tag}` }));
const M = ok('a size', await owner.post('/variant-options', { kind: 'SIZE', name: `M${tag}` }));
const model = ok(
  'model T in two sizes (piece 30.00)',
  await owner.post('/models', {
    name: `Tee ${tag}`,
    code: `T${tag}`,
    categoryId: cat.id,
    sizeIds: [S.id, M.id],
    colorIds: [],
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: sale.id, price: 3000 }],
  }),
);
const [tS, tM] = model.variants.map((v) => v.productId);
const party = (name, types) => owner.post('/parties', { name: `${name} ${tag}`, types });
const c1 = ok('customer with a list', await party('PCust1', ['CUSTOMER']));
const c2 = ok('customer without', await party('PCust2', ['CUSTOMER']));
const s1 = ok('supplier with a list', await party('PSupp1', ['SUPPLIER']));
ok(
  'stock in',
  await owner.post('/purchases/invoices', {
    partyId: s1.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [A, B].map((p) => ({ productId: p.id, quantity: 500, unitCost: 600 }))
      .concat([tS, tM].map((id) => ({ productId: id, quantity: 100, unitCost: 1500 }))),
  }),
);

const priceFor = async (who, customer, lines, side = 'sale') =>
  (await who.post(`/pricing/${side}`, {
    partyId: customer?.id,
    warehouseId: wh.id,
    lines: lines.map(([productId, quantity, unitId, isBonus]) => ({ productId, quantity, unitId, isBonus: !!isBonus })),
  })).data;
const one = async (customer, productId, quantity = 1, unitId) =>
  (await priceFor(karim, customer, [[productId, quantity, unitId]])).lines[0];

// ------------------------------------------------------------------ permissions
console.log('== permissions');
eq("sales can't make a list", (await karim.post('/price-lists', { name: `x ${tag}`, side: 'SALE' })).status, 403);
eq("…nor quantity discounts", (await karim.put('/quantity-breaks', { productId: A.id, steps: [] })).status, 403);
ok('sales can see the lists', await karim.get('/price-lists'));
eq('before any list: the level', [(await one(c1, A.id)).unitPrice, (await one(c1, A.id)).source], [1000, 'LEVEL']);

// ------------------------------------------------------------------ a party's list
console.log('== a party’s list');
const anyList = ok('customers only: no side needed', await owner.post('/price-lists', { name: `x ${tag}` }));
eq('…a sales list', anyList.list.side, 'SALE');
let L1 = ok('list "Friends"', await owner.post('/price-lists', { name: `Friends ${tag}`, side: 'SALE' }));
eq('empty and current', [L1.list.items, L1.list.current, L1.list.forEveryone], [0, true, false]);
eq('names are unique', (await owner.post('/price-lists', { name: `friends ${tag}`, side: 'SALE' })).data?.code, 'duplicate_name');
L1 = ok(
  'its prices: A piece 9.00, B 18.00, model T 25.00',
  await owner.put(`/price-lists/${L1.list.id}/items`, {
    items: [
      { productId: A.id, unitId: piece.id, price: 900 },
      { productId: B.id, unitId: piece.id, price: 1800 },
      { modelId: model.id, unitId: piece.id, price: 2500 },
    ],
  }),
);
eq('three prices', L1.list.items, 3);
eq(
  'with the level price beside each',
  L1.items.map((i) => [i.name.startsWith('Tee') ? 'T' : i.name[0], i.price, i.levelPrice]).sort(),
  [['A', 900, 1000], ['B', 1800, 2000], ['T', 2500, 3000]],
);
eq('the list is not given to anyone yet', (await one(c1, A.id)).unitPrice, 1000);
const given = ok('given to customer 1', await owner.put(`/parties/${c1.id}/price-levels`, { salesPriceListId: L1.list.id }));
eq('the party shows it', given.salesPriceListId, L1.list.id);
eq(
  'a purchase list can’t be a sales list',
  (await owner.put(`/parties/${c1.id}/price-levels`, { purchasePriceListId: L1.list.id })).data?.code,
  'price_list_not_found',
);
let p = await one(c1, A.id);
eq('customer 1: A from the list', [p.unitPrice, p.source, p.listName], [900, 'LIST', `Friends ${tag}`]);
eq('a carton: 12 × the list’s piece', [(await one(c1, A.id, 1, carton.id)).unitPrice, (await one(c1, A.id, 1, carton.id)).source], [10800, 'LIST']);
eq('a variant: its model’s list price', (await one(c1, tS)).unitPrice, 2500);
eq('customer 2 keeps the level', [(await one(c2, A.id)).unitPrice, (await one(c2, A.id)).source], [1000, 'LEVEL']);

const sell = (who, customer, lines, extra = {}) =>
  who.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: lines.map(([productId, quantity, unitPrice, discount = 0, unitId, isBonus]) => ({
      productId, quantity, unitPrice, discount, unitId, isBonus: !!isBonus,
    })),
    ...extra,
  });
ok('sales sells to customer 1 at the list price', await sell(karim, c1, [[A.id, 2, 900]]));
eq('…nor under it', (await sell(karim, c1, [[A.id, 2, 850]])).data?.code, 'price_not_allowed');
ok('a seller may add to it on this invoice (sales:raise_price)', await sell(karim, c1, [[A.id, 2, 1000]]));
eq('customer 2 at the list price: refused', (await sell(karim, c2, [[A.id, 2, 900]])).data?.code, 'price_not_allowed');
ok('a quotation at the list price', await karim.post('/sales/quotations', {
  partyId: c1.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: A.id, quantity: 3, unitPrice: 900 }],
}));
ok('the owner may charge anything', await sell(owner, c1, [[A.id, 1, 950]]));

// A variant's own price on the list beats its model's.
ok(
  'size M gets its own list price',
  await owner.put(`/price-lists/${L1.list.id}/items`, {
    items: [
      { productId: A.id, unitId: piece.id, price: 900 },
      { productId: B.id, unitId: piece.id, price: 1800 },
      { modelId: model.id, unitId: piece.id, price: 2500 },
      { productId: tM, unitId: piece.id, price: 2400 },
    ],
  }),
);
eq('M: its own, S: the model’s', [(await one(c1, tM)).unitPrice, (await one(c1, tS)).unitPrice], [2400, 2500]);

// ------------------------------------------------------------------ dates and closing
console.log('== dates');
const today = companyToday();
ok('ended yesterday', await owner.put(`/price-lists/${L1.list.id}`, { validTo: addDays(today, -1) }));
eq('…so the level again', [(await one(c1, A.id)).unitPrice, (await one(c1, A.id)).source], [1000, 'LEVEL']);
eq('listed as not current', (await owner.get('/price-lists?side=sale')).data.find((l) => l.id === L1.list.id)?.current, false);
ok('starts tomorrow', await owner.put(`/price-lists/${L1.list.id}`, { validFrom: addDays(today, 1), validTo: '' }));
eq('…not yet', (await one(c1, A.id)).unitPrice, 1000);
ok('from today, open-ended', await owner.put(`/price-lists/${L1.list.id}`, { validFrom: today }));
eq('…applies', (await one(c1, A.id)).unitPrice, 900);
eq('last day before the first', (await owner.put(`/price-lists/${L1.list.id}`, { validTo: addDays(today, -3) })).data?.code, 'bad_range');
ok('closed', await owner.put(`/price-lists/${L1.list.id}`, { isActive: false }));
eq('…so the level', (await one(c1, A.id)).unitPrice, 1000);
ok('open again', await owner.put(`/price-lists/${L1.list.id}`, { isActive: true }));
eq('a list stays on its side', (await owner.put(`/price-lists/${L1.list.id}`, { side: 'PURCHASE' })).data?.code, 'side_fixed');

// ------------------------------------------------------------------ an offer for everyone
console.log('== an offer for everyone');
const offer = ok(
  'offer: B at 15.00 for everyone',
  await owner.post('/price-lists', { name: `Offer ${tag}`, side: 'SALE', forEveryone: true }),
);
ok('its price', await owner.put(`/price-lists/${offer.list.id}/items`, { items: [{ productId: B.id, unitId: piece.id, price: 1500 }] }));
p = await one(c2, B.id);
eq('customer 2 gets the offer', [p.unitPrice, p.listName], [1500, `Offer ${tag}`]);
eq('customer 1: their own list first', (await one(c1, B.id)).unitPrice, 1800);
eq('A is not on the offer', (await one(c2, A.id)).unitPrice, 1000);
eq('no customer at all: the offer too', (await priceFor(karim, null, [[B.id, 1]])).lines[0].unitPrice, 1500);
ok('sales sells B to customer 2 at the offer', await sell(karim, c2, [[B.id, 1, 1500]]));

// ------------------------------------------------------------------ quantity discounts
console.log('== quantity discounts');
const steps = (target, list) => owner.put('/quantity-breaks', { ...target, steps: list });
eq('steps grow', (await steps({ productId: A.id }, [{ minQuantity: 10, percent: 5 }, { minQuantity: 50, percent: 4 }])).data?.code, 'bad_steps');
eq('at most 90%', (await steps({ productId: A.id }, [{ minQuantity: 10, percent: 95 }])).data?.code, 'bad_percent');
eq('two decimals', (await steps({ productId: A.id }, [{ minQuantity: 10, percent: 2.345 }])).data?.code, 'bad_percent');
eq('from 2 up', (await steps({ productId: A.id }, [{ minQuantity: 1, percent: 5 }])).data?.code, 'bad_quantity');
eq('an item or a model', (await steps({}, [])).data?.code, 'product_not_found');
const aSteps = ok('A: 10 → 5%, 50 → 10%', await steps({ productId: A.id }, [{ minQuantity: 50, percent: 10 }, { minQuantity: 10, percent: 5 }]));
eq('kept in order', aSteps.map((s) => [s.minQuantity, s.percentBp]), [[10, 500], [50, 1000]]);
p = await one(c2, A.id, 9);
eq('9 pieces: none', [p.unitPrice, p.discount, p.breakBp], [1000, 0, 0]);
p = await one(c2, A.id, 10);
eq('10 pieces: 5% off', [p.unitPrice, p.discount, p.breakBp], [1000, 500, 500]);
p = await one(c2, A.id, 1, carton.id);
eq('a carton is 12 pieces: 5% of 110.00', [p.unitPrice, p.discount], [11000, 550]);
const mixed = await priceFor(karim, c2, [[A.id, 5], [A.id, 1, carton.id]]);
eq('5 pieces + a carton = 17: both lines 5%', mixed.lines.map((l) => l.discount), [250, 550]);
eq('50: 10%', (await one(c2, A.id, 50)).discount, 5000);
eq('on the list price too', (await one(c1, A.id, 10)).discount, 450);
const bonus = await priceFor(karim, c2, [[A.id, 9], [A.id, 5, undefined, true]]);
eq('free goods neither count nor get it', bonus.lines.map((l) => [l.unitPrice, l.discount]), [[1000, 0], [0, 0]]);

ok('sales sells 10 of A with the 5% off', await sell(karim, c2, [[A.id, 10, 1000, 500]]));
ok('…or without it (never below the rule)', await sell(karim, c2, [[A.id, 10, 1000, 0]]));
eq('…but more is a discount, given from the customer’s invoices', (await sell(karim, c2, [[A.id, 10, 1000, 600]])).data?.code, 'discount_on_customer_invoices');
eq('…and the price can’t go under the list', (await sell(karim, c2, [[A.id, 10, 900, 500]])).data?.code, 'price_not_allowed');

ok('model T: 6 → 3%', await steps({ modelId: model.id }, [{ minQuantity: 6, percent: 3 }]));
const tees = await priceFor(karim, c2, [[tS, 3], [tM, 3]]);
eq('3 of S + 3 of M = 6 of the model: both 3%', tees.lines.map((l) => l.discount), [270, 270]);
eq('3 alone: none', (await one(c2, tS, 3)).discount, 0);
ok('size M: its own steps (8 → 7%)', await steps({ productId: tM }, [{ minQuantity: 8, percent: 7 }]));
const tees2 = await priceFor(karim, c2, [[tS, 3], [tM, 3]]);
eq('M now uses only its own (none at 3); S still the model’s', tees2.lines.map((l) => l.discount), [270, 0]);
eq('the item card lists both', (await karim.get(`/quantity-breaks?productId=${tM}`)).data.map((b) => [b.modelId ? 'model' : 'own', b.minQuantity]).sort(), [['model', 6], ['own', 8]]);
ok('steps removed', await steps({ productId: tM }, []));
eq('…so the model’s again', (await priceFor(karim, c2, [[tS, 3], [tM, 3]])).lines.map((l) => l.discount), [270, 270]);

// ------------------------------------------------------------------ customers only (owner, 2026-10-21)
console.log('== customers only');
const PL = ok('asked for a supplier’s list', await owner.post('/price-lists', { name: `Supplier ${tag}`, side: 'PURCHASE' }));
eq('…it is a customers’ list', PL.list.side, 'SALE');
eq('…so not a supplier’s', (await owner.put(`/parties/${s1.id}/price-levels`, { purchasePriceListId: PL.list.id })).data?.code, 'price_list_not_found');
eq('sales can’t ask purchase costs', (await karim.post('/pricing/purchase', { lines: [] })).status, 403);

// ------------------------------------------------------------------ a department's percent, from an amount
console.log('== a department’s percent');
const dep = ok('a department', await owner.post('/departments', { name: `Dep ${tag}` }));
const g1 = ok('its sub-group', await owner.post('/groups', { departmentId: dep.id, name: `G1 ${tag}` }));
const g2 = ok('another sub-group', await owner.post('/groups', { departmentId: dep.id, name: `G2 ${tag}` }));
const D = ok('item D in G1 (piece 10.00)', await owner.post('/products', {
  name: `D ${tag}`, categoryId: g1.id, units: [{ unitId: piece.id, factor: 1 }],
  prices: [{ unitId: piece.id, priceLevelId: sale.id, price: 1000 }, { unitId: piece.id, priceLevelId: supply.id, price: 600 }],
}));
ok('D in stock', await owner.post('/purchases/invoices', { partyId: s1.id, warehouseId: wh.id, taxPercent: 0, lines: [{ productId: D.id, quantity: 100, unitCost: 600 }] }));
const c3 = ok('customer 3', await party('PCust3', ['CUSTOMER']));
const DL = ok('list: 10% off the department from 50.00', await owner.post('/price-lists', { name: `Dep10 ${tag}`, departmentId: dep.id, percent: 10, minAmount: 5000 }));
eq('kept', [DL.list.departmentId, DL.list.percentBp, DL.list.minAmount], [dep.id, 1000, 5000]);
eq('a sub-group of another department', (await owner.put(`/price-lists/${DL.list.id}`, { groupId: (await owner.get('/groups')).data.find((g) => g.departmentId !== dep.id)?.id ?? 'x' })).data?.code, 'group_not_found');
eq('at most 90%', (await owner.put(`/price-lists/${DL.list.id}`, { percent: 95 })).data?.code, 'bad_percent');
eq('only customers get it', (await owner.put(`/price-lists/${DL.list.id}/parties`, { partyIds: [s1.id] })).data?.code, 'party_not_found');
eq('sales can’t give it', (await karim.put(`/price-lists/${DL.list.id}/parties`, { partyIds: [c3.id] })).status, 403);
const toC3 = ok('given to customer 3', await owner.put(`/price-lists/${DL.list.id}/parties`, { partyIds: [c3.id] }));
eq('…named on the list', toC3.parties.map((x) => x.id), [c3.id]);
p = await one(c3, D.id, 4);
eq('40.00 of the department: under the minimum', [p.unitPrice, p.source], [1000, 'LEVEL']);
p = await one(c3, D.id, 5);
eq('50.00: 10% off', [p.unitPrice, p.source], [900, 'LIST']);
const outside = await priceFor(karim, c3, [[D.id, 5], [B.id, 1]]);
const bAlone = await one(c2, B.id, 1);
eq('an item of another department keeps its price', outside.lines.map((l) => [l.unitPrice, l.source]), [[900, 'LIST'], [bAlone.unitPrice, bAlone.source]]);
eq('another customer: none', (await one(c2, D.id, 5)).unitPrice, 1000);
ok('sold at the list price', await sell(karim, c3, [[D.id, 5, 900, 0]]));
ok('only sub-group G2', await owner.put(`/price-lists/${DL.list.id}`, { groupId: g2.id }));
eq('D is in G1: not covered', (await one(c3, D.id, 5)).unitPrice, 1000);
ok('sub-group G1', await owner.put(`/price-lists/${DL.list.id}`, { groupId: g1.id }));
eq('covered again', (await one(c3, D.id, 5)).unitPrice, 900);
ok('taken from customer 3', await owner.put(`/price-lists/${DL.list.id}/parties`, { partyIds: [] }));
eq('…back to the level', (await one(c3, D.id, 5)).unitPrice, 1000);

// ------------------------------------------------------------------ quantity discounts by amount
console.log('== steps by amount');
eq('all by quantity or all by amount', (await steps({ productId: B.id }, [{ minQuantity: 0, minAmount: 5000, percent: 2 }, { minQuantity: 10, percent: 5 }])).data?.code, 'bad_steps');
const bSteps = ok('B: from 100.00 → 5%', await steps({ productId: B.id }, [{ minQuantity: 0, minAmount: 10000, percent: 5 }]));
eq('kept by amount', bSteps.map((x) => [x.minQuantity, x.minAmount, x.percentBp]), [[0, 10000, 500]]);
const bPrice = (await one(c2, B.id, 1)).unitPrice;
const under = Math.floor((10000 - 1) / bPrice);
eq('under 100.00: none', (await one(c2, B.id, under)).discount, 0);
eq('from 100.00: 5%', (await one(c2, B.id, under + 1)).discount, Math.round((under + 1) * bPrice * 0.05));
ok('B: no steps', await steps({ productId: B.id }, []));

// ------------------------------------------------------------------ deleting setup entries (owner, 2026-10-21)
console.log('== deleting units, sizes, seasons, sub-groups');
eq('sales can’t delete a unit', (await karim.del(`/units/${carton.id}`)).status, 403);
eq('a unit items use', (await owner.del(`/units/${carton.id}`)).data?.code, 'in_use');
const spare = ok('a spare unit', await owner.post('/units', { name: `Spare ${tag}` }));
eq('deleted', (await owner.del(`/units/${spare.id}`)).status, 204);
eq('gone', (await owner.get('/units')).data.some((u) => u.id === spare.id), false);
eq('a size items use', (await owner.del(`/variant-options/${S.id}`)).data?.code, 'in_use');
const XL = ok('a spare size', await owner.post('/variant-options', { kind: 'SIZE', name: `XL${tag}` }));
eq('deleted', (await owner.del(`/variant-options/${XL.id}`)).status, 204);
eq('a sub-group with items', (await owner.del(`/groups/${g1.id}`)).data?.code, 'in_use');
eq('an empty sub-group', (await owner.del(`/groups/${g2.id}`)).status, 204);
const season = ok('a season', await owner.post('/seasons', { name: `Eid ${tag}` }));
eq('renamed', (await owner.put(`/seasons/${season.id}`, { name: `Eid2 ${tag}` })).data?.name, `Eid2 ${tag}`);
const summer = (await owner.get('/seasons')).data.find((x) => x.kind === 'SUMMER');
eq('summer keeps its name', (await owner.put(`/seasons/${summer.id}`, { name: 'x' })).data?.code, 'system_season');
eq('the season deleted', (await owner.del(`/seasons/${season.id}`)).status, 204);
eq('…gone', (await owner.get('/seasons')).data.some((x) => x.id === season.id), false);

// ------------------------------------------------------------------ validation and deleting
console.log('== validation');
eq('a unit the item doesn’t have', (await owner.put(`/price-lists/${L1.list.id}/items`, { items: [{ productId: B.id, unitId: carton.id, price: 1 }] })).data?.code, 'unit_not_found');
eq('twice', (await owner.put(`/price-lists/${L1.list.id}/items`, { items: [{ productId: B.id, unitId: piece.id, price: 1 }, { productId: B.id, unitId: piece.id, price: 2 }] })).data?.code, 'duplicate_item');
eq('item and model at once', (await owner.put(`/price-lists/${L1.list.id}/items`, { items: [{ productId: B.id, modelId: model.id, unitId: piece.id, price: 1 }] })).data?.code, 'product_not_found');
eq('negative', (await owner.put(`/price-lists/${L1.list.id}/items`, { items: [{ productId: B.id, unitId: piece.id, price: -1 }] })).data?.code, 'bad_price');
eq('still its four prices', (await owner.get(`/price-lists/${L1.list.id}`)).data.items.length, 4);
eq('given to one party', (await owner.get('/price-lists')).data.find((l) => l.id === L1.list.id)?.parties, 1);
eq('deleted', (await owner.del(`/price-lists/${L1.list.id}`)).status, 204);
eq('customer 1 goes back to the level', [(await one(c1, A.id)).unitPrice, (await owner.get(`/parties/${c1.id}`)).data.salesPriceListId], [1000, null]);
ok('the offer closed again', await owner.put(`/price-lists/${offer.list.id}`, { isActive: false }));
ok('A’s steps removed', await steps({ productId: A.id }, []));
ok('T’s steps removed', await steps({ modelId: model.id }, []));

const log = (await owner.get('/audit?resource=price_list&pageSize=50')).data.items;
check('changes are in the activity log', log.some((e) => e.action === 'items') && log.some((e) => e.action === 'delete'));

process.exit(summary('pricing') ? 1 : 0);
