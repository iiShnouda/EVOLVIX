// The public storefront catalog (owner, 2026-10-12: show products on the KM Collection site without
// exposing the company server). Owner-only, and scrubbed: names, departments, colours, sizes and
// in-stock-or-not only — never a cost, price, stock count, supplier or customer. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES, no settings:manage

console.log('== the storefront catalog is owner-only');
eq('sales may not read it', (await karim.get('/storefront/catalog')).status, 403);

console.log('== and carries only public fields');
const cat = ok('owner reads the catalog', await owner.get('/storefront/catalog'));
check('it has the company, a time and items', typeof cat.company === 'string' && typeof cat.generatedAt === 'string' && Array.isArray(cat.items), cat);
eq('the count matches the items', cat.count, cat.items.length);

const forbidden = /"(cost|costPrice|salePrice|price|stockOnHand|supplierId|supplierCode|customer|balance)"/i;
check('no cost, price, stock count, supplier or customer anywhere', !forbidden.test(JSON.stringify(cat)), JSON.stringify(cat).slice(0, 300));

if (cat.items.length > 0) {
  const keys = Object.keys(cat.items[0]).sort().join(',');
  eq('an item carries only the public fields', keys, 'colors,department,hasImage,inStock,name,ref,sizes');
  const it = cat.items[0];
  check(
    'the fields have the right shapes',
    typeof it.name === 'string' &&
      Array.isArray(it.colors) &&
      Array.isArray(it.sizes) &&
      typeof it.inStock === 'boolean' &&
      typeof it.hasImage === 'boolean',
    it,
  );
}

process.exit(summary('storefront') ? 1 : 0);
