// The lock screen (owner, 2026-11-18: "remember this device is pointless when everyone is signed out
// after a while"). Idle on a remembered device LOCKS it: its access tokens and refresh are refused
// until the password or a personal PIN is given to the server; five wrong tries sign it out. A device
// not remembered (or a company that chose "sign out") is signed out, and gets no long refresh token.
// Settings → security: idle action, PIN unlock, remember length. Runs against BASE.
import { login, check, eq, ok, summary, BASE } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';
const email = `lock.${tag}@skb.local`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const person = ok('a person to lock', await owner.post('/staff', { fullName: `Lock ${tag}`, email, password: PASS, role: 'SALES', branchId: owner.user.branchId }));

const original = (await owner.get('/settings')).data;
ok('lock on idle, PIN allowed, remembered 30 days', await owner.put('/settings', { idleAction: 'LOCK', pinUnlock: true, rememberDays: 30, idleMinutes: 30 }));

const cookieOf = (r) => (r.headers.get('set-cookie') ?? '').split(';')[0];
async function signIn(remember) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ email, password: PASS, rememberDevice: remember }),
  });
  const j = await r.json();
  return { token: j.accessToken, cookie: cookieOf(r), raw: r.headers.get('set-cookie') ?? '', remembered: j.remembered };
}
const call = (s, method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json', 'user-agent': UA,
      ...(s.token ? { authorization: `Bearer ${s.token}` } : {}),
      ...(s.cookie ? { cookie: s.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r) => ({ status: r.status, data: await r.json().catch(() => null), cookie: cookieOf(r) });
const lockIt = async (s) => json(await call(s, 'POST', '/auth/lock'));
const unlock = async (s, body) => {
  const r = await json(await call({ cookie: s.cookie }, 'POST', '/auth/unlock', body));
  if (r.status === 200) {
    s.token = r.data.accessToken;
    if (r.cookie) s.cookie = r.cookie;
  }
  return r;
};

console.log('== the sign-in page learns how long a device is remembered');
eq('branding says 30 days', (await (await fetch(`${BASE}/branding`)).json()).rememberDays, 30);

console.log('== a remembered device locks, and only its password opens it');
let dev = await signIn(true);
eq('remembered', dev.remembered, true);
check('its cookie lasts about 30 days', /expires=/i.test(dev.raw) && (Date.parse(/expires=([^;]+)/i.exec(dev.raw)?.[1] ?? '') - Date.now()) / 86400000 > 29, dev.raw);
let r = await lockIt(dev);
eq('locked', [r.status, r.data?.locked, r.data?.name], [200, true, `Lock ${tag}`]);
eq('no PIN yet', r.data?.pin, false);
eq('its access token is refused at once', (await json(await call({ token: dev.token }, 'GET', '/auth/me'))).data?.code, 'LOCKED');
const refused = await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'));
eq('…and refreshing says locked, with the name', [refused.status, refused.data?.code, refused.data?.name], [401, 'LOCKED', `Lock ${tag}`]);
r = await unlock(dev, { password: 'wrong' });
eq('a wrong password counts', [r.status, r.data?.code, r.data?.left], [401, 'WRONG_UNLOCK', 4]);
r = await unlock(dev, { password: PASS });
eq('the right one unlocks', r.status, 200);
eq('…as the same person', r.data?.user?.email, email);
eq('the new token works', (await call({ token: dev.token }, 'GET', '/auth/me')).status, 200);
const again = await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'));
eq('…and refreshing works again', again.status, 200);
dev.cookie = again.cookie || dev.cookie;
dev.token = again.data?.accessToken ?? dev.token;

console.log('== a personal PIN');
const me = { token: dev.token };
eq('no PIN to begin with', (await json(await call(me, 'GET', '/auth/pin'))).data, { hasPin: false, allowed: true });
eq('4 to 6 digits', (await json(await call(me, 'PUT', '/auth/pin', { pin: '12a4', password: PASS }))).data?.code, 'bad_pin');
eq('not an easy one', (await json(await call(me, 'PUT', '/auth/pin', { pin: '1234', password: PASS }))).data?.code, 'weak_pin');
eq('…nor all one digit', (await json(await call(me, 'PUT', '/auth/pin', { pin: '777777', password: PASS }))).data?.code, 'weak_pin');
eq('the password confirms it', (await json(await call(me, 'PUT', '/auth/pin', { pin: '2580', password: 'nope' }))).data?.code, 'wrong_password');
eq('set', (await json(await call(me, 'PUT', '/auth/pin', { pin: '2580', password: PASS }))).data, { hasPin: true });
dev.token = me.token;
r = await lockIt(dev);
eq('the lock offers the PIN', r.data?.pin, true);
r = await unlock(dev, { pin: '2581' });
eq('a wrong PIN counts', r.data?.code, 'WRONG_UNLOCK');
r = await unlock(dev, { pin: '2580' });
eq('the PIN unlocks', r.status, 200);

console.log('== the owner turns PINs off');
ok('PINs off', await owner.put('/settings', { pinUnlock: false }));
r = await lockIt(dev);
eq('the lock asks for the password only', r.data?.pin, false);
r = await unlock(dev, { pin: '2580' });
eq('a PIN is refused', r.data?.code, 'PIN_NOT_ALLOWED');
r = await unlock(dev, { password: PASS });
eq('the password still works', r.status, 200);
ok('PINs on again', await owner.put('/settings', { pinUnlock: true }));
eq('clearing one’s PIN', (await json(await call({ token: dev.token }, 'DELETE', '/auth/pin'))).data, { hasPin: false });

console.log('== five wrong tries sign the device out');
r = await lockIt(dev);
for (let i = 1; i <= 4; i++) r = await unlock(dev, { password: `bad${i}` });
eq('four wrong: one left', r.data?.left, 1);
r = await unlock(dev, { password: 'bad5' });
eq('the fifth signs out', [r.status, r.data?.code], [401, 'UNLOCK_SIGNED_OUT']);
eq('even the right password is too late', (await unlock(dev, { password: PASS })).data?.code, 'NO_SESSION');
eq('…and refreshing finds no session', (await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'))).data?.code, 'NO_SESSION');

console.log('== a device not remembered is signed out, with no long refresh token');
let brief = await signIn(false);
eq('not remembered', brief.remembered, false);
check('its cookie ends with the browser', !/expires=/i.test(brief.raw), brief.raw);
r = await lockIt(brief);
eq('idle signs it out', [r.status, r.data?.locked], [200, false]);
eq('nothing left to refresh', (await json(await call({ cookie: brief.cookie }, 'POST', '/auth/refresh'))).data?.code, 'NO_SESSION');

console.log('== the owner chooses "sign out"');
ok('idle signs out', await owner.put('/settings', { idleAction: 'SIGN_OUT' }));
dev = await signIn(true);
r = await lockIt(dev);
eq('a remembered device is signed out too', r.data?.locked, false);
eq('…for good', (await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'))).data?.code, 'NO_SESSION');
eq('a bad choice is refused', (await owner.put('/settings', { idleAction: 'NAP' })).data?.code, 'bad_idle_action');

console.log('== "remember" turned off: the checkbox goes, nothing is remembered');
ok('remember off', await owner.put('/settings', { idleAction: 'LOCK', rememberDays: 0 }));
eq('branding says 0', (await (await fetch(`${BASE}/branding`)).json()).rememberDays, 0);
dev = await signIn(true);
eq('asking to be remembered does nothing', dev.remembered, false);
check('…a browser-length cookie', !/expires=/i.test(dev.raw), dev.raw);
ok('remember 7 days', await owner.put('/settings', { rememberDays: 7 }));
dev = await signIn(true);
const days = (Date.parse(/expires=([^;]+)/i.exec(dev.raw)?.[1] ?? '') - Date.now()) / 86400000;
check('a 7-day cookie', days > 6.9 && days < 7.1, dev.raw);

console.log('== locking needs a session of one’s own; the lock screen can sign out');
const someoneElse = await login('karim@skb.local');
eq('another person’s token with this cookie is refused', (await json(await call({ token: someoneElse.token, cookie: dev.cookie }, 'POST', '/auth/lock'))).status, 401);
r = await lockIt(dev);
eq('locked again', r.data?.locked, true);
eq('"sign out" from the lock screen', (await call({ cookie: dev.cookie }, 'POST', '/auth/lock/end')).status, 200);
eq('…the session is over', (await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'))).data?.code, 'NO_SESSION');
eq('only the security part may change these', (await someoneElse.put('/settings', { rememberDays: 1 })).status, 403);

// A device whose app was closed longer than the idle time (needs the database: PGURL).
if (process.env.PGURL) {
  console.log('== the app closed past the idle time');
  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: process.env.PGURL });
  await db.connect();
  const age = (s) =>
    db.query(`UPDATE "Sessions" SET "CreatedAt" = now() - interval '2 hours' WHERE "TokenHash" = encode(sha256($1::bytea), 'hex') OR "RevokedAt" IS NULL AND "StaffId" = $2`, [s, person?.staff?.id ?? person?.id]);
  dev = await signIn(true);
  await age(decodeURIComponent(dev.cookie.split('=')[1] ?? ''));
  eq('a remembered device comes back locked', (await json(await call({ cookie: dev.cookie }, 'POST', '/auth/refresh'))).data?.code, 'LOCKED');
  eq('…and opens with the password', (await unlock(dev, { password: PASS })).status, 200);
  brief = await signIn(false);
  await age(decodeURIComponent(brief.cookie.split('=')[1] ?? ''));
  eq('one not remembered comes back signed out', (await json(await call({ cookie: brief.cookie }, 'POST', '/auth/refresh'))).data?.code, 'NO_SESSION');
  await db.end();
}

console.log('== the activity log');
const log = (await owner.get(`/audit?resource=auth&actorId=${person?.staff?.id ?? person?.id}&pageSize=200`)).data?.items ?? [];
const acts = (a) => log.filter((e) => e.action === a).length;
check('locks', acts('auth.lock') >= 4, log.map((e) => e.action));
check('unlocks', acts('auth.unlock') >= 3);
check('wrong tries', acts('auth.unlock.failed') >= 7);
check('signed out after too many', acts('auth.unlock.signed_out') === 1);
check('PIN set and cleared', acts('auth.pin.set') === 1 && acts('auth.pin.clear') === 1);

ok('settings back', await owner.put('/settings', {
  idleAction: original.idleAction ?? 'LOCK', pinUnlock: original.pinUnlock ?? true,
  rememberDays: original.rememberDays ?? 30, idleMinutes: original.idleMinutes ?? 30,
}));
process.exit(summary('lock') ? 1 : 0);
