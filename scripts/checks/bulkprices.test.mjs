// A supplier's prices at once (owner, 2026-11-10) and deleting an item made by mistake. The supply
// price (default purchase level) and the selling price (default sales level) change by a percent,
// an amount or a margin; preview saves nothing; apply is one logged request; the stock's average
// cost stays; prices:bulk_edit and products:delete are permissions of their own. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT: prices:edit, not these two
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const dozen = ok('a unit of 12', await owner.post('/units', { name: `Doz ${tag}`, pieces: 12 }));
const cat = (await owner.get('/categories')).data[0];
const levels = (await owner.get('/price-levels')).data;
const sale = levels.find((l) => l.side === 'SALE' && l.isDefault);
const buy = levels.find((l) => l.side === 'PURCHASE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const sup = ok(
  'a factory',
  await owner.post('/parties', { name: `Factory ${tag}`, types: ['SUPPLIER'] }),
);
const other = ok(
  'another factory',
  await owner.post('/parties', { name: `Other ${tag}`, types: ['SUPPLIER'] }),
);
const make = (name, supplierId, cost, price, extra = []) =>
  owner.post('/products', {
    name: `${name} ${tag}`,
    categoryId: cat.id,
    supplierId,
    units: [{ unitId: piece.id, factor: 1 }, ...extra.map((e) => e.unit)],
    prices: [
      { unitId: piece.id, priceLevelId: buy.id, price: cost },
      { unitId: piece.id, priceLevelId: sale.id, price },
      ...extra.flatMap((e) => e.prices),
    ],
  });
const a = ok('item A', await make('Shirt', sup.id, 10000, 13000));
const b = ok(
  'item B, with a dozen priced on its own',
  await make('Pants', sup.id, 20000, 25000, [
    {
      unit: { unitId: dozen.id, factor: 12 },
      prices: [{ unitId: dozen.id, priceLevelId: sale.id, price: 280000 }],
    },
  ]),
);
const c = ok('item C of another factory', await make('Coat', other.id, 30000, 40000));
ok(
  'A bought at 100',
  await owner.post('/purchases/invoices', {
    partyId: sup.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: a.id, quantity: 5, unitCost: 10000 }],
  }),
);

const list = ok('the factory items', await owner.get(`/prices/bulk/items?supplierId=${sup.id}`));
eq('only that factory', list.map((r) => r.id).sort(), [a.id, b.id].sort());
const rowA = list.find((r) => r.id === a.id);
eq('supply and sale prices', [rowA.supplyPrice, rowA.salePrice], [10000, 13000]);
eq(
  'the accountant may not',
  (await mona.get(`/prices/bulk/items?supplierId=${sup.id}`)).status,
  403,
);

const body = {
  supplierId: sup.id,
  productIds: [a.id, b.id],
  supply: { mode: 'pct', value: 10 },
  sale: { mode: 'margin', value: 25 },
  round: 1,
};
const pre = ok('preview', await owner.post('/prices/bulk/preview', body));
const pa = pre.rows.find((r) => r.id === a.id);
eq('A: supply 100 → 110', [pa.supplyBefore, pa.supplyAfter], [10000, 11000]);
eq('A: sale from a 25% margin, rounded up to a pound: 137.50 → 138', pa.saleAfter, 13800);
eq(
  'preview saves nothing',
  (await owner.get(`/products/${a.id}`)).data.prices.find(
    (p) => p.priceLevelId === sale.id && p.unitId === piece.id,
  ).own,
  13000,
);
eq(
  'an item of another factory is refused',
  (await owner.post('/prices/bulk/preview', { ...body, productIds: [c.id] })).data?.code,
  'product_not_found',
);
eq(
  'nothing to change',
  (await owner.post('/prices/bulk/preview', { ...body, supply: null, sale: null })).data?.code,
  'no_change',
);
eq('the accountant may not apply', (await mona.post('/prices/bulk/apply', body)).status, 403);

const applied = ok('apply', await owner.post('/prices/bulk/apply', body));
eq('two items changed', applied.changed, 2);
const da = (await owner.get(`/products/${a.id}`)).data;
const own = (d, unit, level) =>
  d.prices.find((p) => p.unitId === unit && p.priceLevelId === level)?.own;
eq('A saved', [own(da, piece.id, buy.id), own(da, piece.id, sale.id)], [11000, 13800]);
eq('the stock keeps its average cost', da.costPrice, 10000);
const db = (await owner.get(`/products/${b.id}`)).data;
eq('B: 220 → 275', [own(db, piece.id, buy.id), own(db, piece.id, sale.id)], [22000, 27500]);
eq('B: its dozen from the dozen supply price (12 × 220) + 25%', own(db, dozen.id, sale.id), 330000);
const item = (await owner.get(`/products?search=${encodeURIComponent(a.sku)}`)).data.find(
  (p) => p.id === a.id,
);
eq('the list price follows', item.salePrice, 13800);
const log = (await owner.get(`/audit?resourceId=${a.id}`)).data;
const entries = log.items ?? log;
check('logged on the item', JSON.stringify(entries).includes('prices'), entries);

const pct = ok(
  'sale −10% by itself',
  await owner.post('/prices/bulk/apply', { productIds: [a.id], sale: { mode: 'pct', value: -10 } }),
);
eq('138 → 124.20', pct.rows[0].saleAfter, 12420);
const amt = ok(
  'supply +5 a piece',
  await owner.post('/prices/bulk/apply', { productIds: [a.id], supply: { mode: 'amt', value: 5 } }),
);
eq('110 → 115', amt.rows[0].supplyAfter, 11500);

console.log('== deleting an item made by mistake');
const typo = ok('an item made by mistake', await make('Typo', sup.id, 100, 200));
eq('the accountant may not delete', (await mona.del(`/products/${typo.id}`)).status, 403);
eq(
  'one bought may not be deleted',
  (await owner.del(`/products/${a.id}`)).data?.code,
  'item_in_use',
);
eq('deleted', (await owner.del(`/products/${typo.id}`)).status, 204);
eq('gone', (await owner.get(`/products/${typo.id}`)).status, 404);
const remade = ok(
  'its barcode is free again',
  await owner.post('/products', {
    name: `Again ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1, barcode: typo.units[0].barcode }],
  }),
);
check('…taken by the new item', remade.units[0].barcode === typo.units[0].barcode, remade.units);
const cleared = ok(
  'a barcode cleared',
  await owner.put(`/products/${remade.id}`, {
    units: [{ unitId: piece.id, factor: 1, barcode: '' }],
  }),
);
eq('…none left', cleared.units[0].barcode ?? null, null);
const coded = ok(
  'a supplier code set',
  await owner.put(`/products/${remade.id}`, { supplierCode: 'M-55' }),
);
eq('…kept', coded.supplierCode, 'M-55');
eq(
  '…and cleared',
  (await owner.put(`/products/${remade.id}`, { supplierCode: '' })).data.supplierCode ?? null,
  null,
);

process.exit(summary('bulkprices') ? 1 : 0);
