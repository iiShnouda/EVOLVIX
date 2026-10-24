// Item photos (owner, 2026-10-12: "a picture for every item", with upload or camera). The server
// keeps one photo per item in the database, checked against the file's own bytes — a script renamed
// to a photo is refused — served with no-store and no-sniff, and needs products:edit to change.
// Self-contained: creates its own item. Runs against BASE (default :5090), fresh or upgraded DB.
import { login, check, eq, ok, summary, BASE } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES (no products:edit)

const categories = ok('categories', await owner.get('/categories'));
const units = ok('units', await owner.get('/units'));
const cat = categories[0];
const unit = units[0];
check('a category and a unit exist', !!cat && !!unit, { cat: cat?.id, unit: unit?.id });

const item = ok(
  'create an item',
  await owner.post('/products', {
    name: `Photo item ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: unit.id, factor: 1 }],
  }),
);

// A tiny real PNG and a script pretending to be one.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const putImage = (token, bytes, type, name) => {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type }), name);
  return fetch(`${BASE}/products/${item.id}/image`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: f,
  });
};
const findItem = async () =>
  ((await owner.get(`/products?search=${item.sku}`)).data || []).find((p) => p.id === item.id);

console.log('== item photo');
eq('a new item has no photo', (await findItem())?.hasImage ?? false, false);
eq(
  'a missing photo is a plain 404',
  (
    await fetch(`${BASE}/products/${item.id}/image`, {
      headers: { authorization: `Bearer ${owner.token}` },
    })
  ).status,
  404,
);
eq(
  'sales may not add a photo',
  (await putImage(karim.token, PNG, 'image/png', 'p.png')).status,
  403,
);

eq('owner adds the photo', (await putImage(owner.token, PNG, 'image/png', 'p.png')).status, 200);
eq('the item now shows it has a photo', (await findItem())?.hasImage, true);
const img = await fetch(`${BASE}/products/${item.id}/image`, {
  headers: { authorization: `Bearer ${owner.token}` },
});
eq(
  'served as PNG, never cached, no-sniff',
  [
    img.status,
    img.headers.get('content-type'),
    img.headers.get('cache-control'),
    img.headers.get('x-content-type-options'),
  ],
  [200, 'image/png', 'no-store', 'nosniff'],
);

console.log('== a bad upload is refused');
eq(
  'a script renamed to .jpg is refused (its bytes are checked)',
  (
    await (
      await putImage(
        owner.token,
        Buffer.from('<?php system($_GET[0]); ?>', 'utf8'),
        'image/jpeg',
        'evil.jpg',
      )
    ).json()
  ).code,
  'bad_photo',
);
eq(
  'an empty file is refused',
  (await (await putImage(owner.token, Buffer.alloc(0), 'image/png', 'empty.png')).json()).code,
  'bad_photo',
);
eq(
  'a photo over 3 MB is refused',
  (
    await (
      await putImage(
        owner.token,
        Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]),
        'image/png',
        'big.png',
      )
    ).json()
  ).code,
  'bad_photo',
);
eq('after a refused upload the photo is still the good one', (await findItem())?.hasImage, true);

console.log('== remove');
eq(
  'sales may not remove the photo',
  (
    await fetch(`${BASE}/products/${item.id}/image`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${karim.token}` },
    })
  ).status,
  403,
);
eq(
  'owner removes the photo',
  (
    await fetch(`${BASE}/products/${item.id}/image`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${owner.token}` },
    })
  ).status,
  204,
);
eq('the item no longer has a photo', (await findItem())?.hasImage, false);
eq(
  'serving it again is 404',
  (
    await fetch(`${BASE}/products/${item.id}/image`, {
      headers: { authorization: `Bearer ${owner.token}` },
    })
  ).status,
  404,
);

process.exit(summary('images') ? 1 : 0);
