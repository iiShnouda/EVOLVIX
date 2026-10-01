// Owner decision 2026-10-01: the program is Evolvix; a company using it shows its own name and
// logo beside the Evolvix mark. The name and logo are readable before sign-in (the sign-in page
// shows them); only settings:manage changes the logo, which must be a real PNG, JPEG or WebP.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local');
const anon = async (path) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, type: r.headers.get('content-type'), headers: r.headers, bytes: new Uint8Array(await r.arrayBuffer()) };
};

// A 1×1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9mWQAAAABJRU5ErkJggg==';

console.log('== branding before sign-in');
const before = await fetch(`${BASE}/branding`).then((r) => r.json());
check('the company name, no sign-in needed', typeof before.companyName === 'string' && before.companyName.length > 0, before);

console.log('== only settings:manage changes the logo');
eq('a seller cannot', (await mona.put('/branding/logo', { data: PNG })).status, 403);
eq('nor remove it', (await mona.del('/branding/logo')).status, 403);
eq('nobody signed out', (await fetch(`${BASE}/branding/logo`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: PNG }) })).status, 401);

console.log('== the picture is checked by its bytes');
eq('not a picture', (await owner.put('/branding/logo', { data: btoa('<svg onload=alert(1)>') })).data?.code, 'bad_logo');
eq('not base64', (await owner.put('/branding/logo', { data: '%%%' })).data?.code, 'bad_logo');
eq('too big', (await owner.put('/branding/logo', { data: 'A'.repeat(800_000) })).data?.code, 'logo_too_big');

console.log('== upload, read, remove');
const up = ok('owner uploads (as a data: URL)', await owner.put('/branding/logo', { data: `data:image/png;base64,${PNG}` }));
check('version goes up', up.logoVersion > before.logoVersion, up);
const img = await anon('/branding/logo');
eq('served without sign-in', img.status, 200);
eq('as a PNG', img.type, 'image/png');
eq('never sniffed', img.headers.get('x-content-type-options'), 'nosniff');
check('never run as a page', (img.headers.get('content-security-policy') ?? '').includes('sandbox'));
eq('the same bytes', Buffer.from(img.bytes).toString('base64'), PNG);
eq('branding has the version', (await fetch(`${BASE}/branding`).then((r) => r.json())).logoVersion, up.logoVersion);
eq('settings too', (await owner.get('/settings')).data.logoVersion, up.logoVersion);
const audit = (await owner.get('/audit?resource=company_logo&pageSize=5')).data;
check('audited', JSON.stringify(audit ?? '').includes('company_logo'), audit);

const gone = ok('owner removes it', await owner.del('/branding/logo'));
eq('version 0', gone.logoVersion, 0);
eq('no picture now', (await anon('/branding/logo')).status, 404);

summary('branding');
