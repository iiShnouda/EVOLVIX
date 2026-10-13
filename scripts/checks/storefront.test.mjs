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

console.log('== publishing outward is owner-only too');
eq('sales may not read the publish status', (await karim.get('/storefront/status')).status, 403);
eq('sales may not trigger a publish', (await karim.post('/storefront/publish')).status, 403);

console.log('== and the owner can publish the catalogue outward');
// In Development the publisher uses an in-memory target (no real bucket), so it reports as on.
const status = ok('owner reads the publish status', await owner.get('/storefront/status'));
check('publishing is set up (Development memory target)', status.enabled === true, status);
check('it names where it publishes', typeof status.publicBaseUrl === 'string' && status.publicBaseUrl.length > 0, status);

const after = ok('owner publishes now', await owner.post('/storefront/publish'));
check('it pushed the catalogue plus any photos', after.lastPushedFiles >= 1, after);
eq('the item count matches the catalogue', after.itemCount, cat.count);
check('it recorded when it last published', typeof after.lastPublishedAt === 'string' && !Number.isNaN(Date.parse(after.lastPublishedAt)), after);
check('nothing went wrong', after.error == null, after);

// Publishing again is safe (it re-pushes the catalogue; unchanged photos are skipped).
const again = ok('publishing again is idempotent', await owner.post('/storefront/publish'));
check('still at least the catalogue pushed', again.lastPushedFiles >= 1, again);

process.exit(summary('storefront') ? 1 : 0);
