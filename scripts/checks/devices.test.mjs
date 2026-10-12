// One phone and one computer per account, both at once (owner, 2026-10-12: "a bill on the computer
// while scanning a barcode on the phone"). A new sign-in takes over only its own kind's slot; the
// other kind stays signed in. The device kind comes from the user agent. Runs against BASE.
import { check, eq, summary, BASE } from './lib.mjs';

const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Mobile Safari/537.36';
const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

async function signIn(ua) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify({
      email: 'karim@skb.local',
      password: 'ChangeMe!Staff123',
      rememberDevice: true,
    }),
  });
  const j = await r.json();
  return { token: j.accessToken, cookie: r.headers.get('set-cookie') ?? '' };
}
const me = (token, ua) =>
  fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${token}`, 'user-agent': ua } });
const refresh = (cookie) =>
  fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { cookie: cookie.split(';')[0] } });

console.log('== a phone and a computer signed in at once');
const pc1 = await signIn(PC_UA);
const phone1 = await signIn(PHONE_UA);
eq('the computer still works after the phone signs in', (await me(pc1.token, PC_UA)).status, 200);
eq('the phone works too', (await me(phone1.token, PHONE_UA)).status, 200);

console.log('== a second computer takes over only the computer');
const pc2 = await signIn(PC_UA);
eq('the first computer is signed out', (await me(pc1.token, PC_UA)).status, 401);
eq('…told why', (await (await me(pc1.token, PC_UA)).json()).code, 'SIGNED_IN_ELSEWHERE');
eq('the new computer works', (await me(pc2.token, PC_UA)).status, 200);
eq('the phone is untouched', (await me(phone1.token, PHONE_UA)).status, 200);

console.log('== a second phone takes over only the phone');
const phone2 = await signIn(PHONE_UA);
eq('the first phone is signed out', (await me(phone1.token, PHONE_UA)).status, 401);
eq('the new phone works', (await me(phone2.token, PHONE_UA)).status, 200);
eq('the computer is untouched', (await me(pc2.token, PC_UA)).status, 200);

console.log('== refresh follows the same rule');
eq(
  'the kicked computer cannot refresh',
  (await (await refresh(pc1.cookie)).json()).code,
  'SIGNED_IN_ELSEWHERE',
);
eq('the live computer refreshes', (await refresh(pc2.cookie)).status, 200);
eq('the live phone refreshes', (await refresh(phone2.cookie)).status, 200);

console.log('== each account keeps its own devices');
const otherPc = await signIn(PC_UA); // signs the computer in again for karim
check('a fresh computer sign-in works', !!otherPc.token);
eq(
  'karim phone still works after another computer sign-in',
  (await me(phone2.token, PHONE_UA)).status,
  200,
);

console.log('== the account knows its own two devices');
const devices = async (token, ua) =>
  (
    await fetch(`${BASE}/auth/devices`, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': ua },
    })
  ).json();
const fromPc = await devices(otherPc.token, PC_UA);
eq('this request is the computer', fromPc.thisKind, 'DESKTOP');
eq(
  'both the phone and the computer are signed in',
  [fromPc.mobile.signedIn, fromPc.desktop.signedIn],
  [true, true],
);
const fromPhone = await devices(phone2.token, PHONE_UA);
eq('from the phone, this request is the phone', fromPhone.thisKind, 'MOBILE');

process.exit(summary('devices') ? 1 : 0);
