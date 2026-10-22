// Tiny API test helpers. BASE from env (default :5090).
export const BASE = process.env.BASE ?? 'http://localhost:5090/api';
let passed = 0, failed = 0;
let shownNew = false;
const failures = [];
export async function login(email, password = email.startsWith('owner') ? 'ChangeMe!Owner123' : 'ChangeMe!Staff123') {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`);
  const c = client(j.accessToken, j.user);
  // The checks add branches, warehouses and money accounts and use them with other people: new ones
  // are seen by everyone here (the company default hides them until given; story.test checks that).
  if (email.startsWith('owner') && !process.env.KEEP_NEW_HIDDEN && !shownNew) {
    shownNew = true;
    await c.put('/settings', { hideNewPlaces: false });
  }
  return c;
}
/** A signed-in client; `at(branchId)` gives one working in that branch (the X-Branch header). */
export function client(token, user, lang = 'en', branch = null, extra = {}) {
  const call = async (method, path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`, 'accept-language': lang,
        ...(branch ? { 'x-branch': branch } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data, canOverride: r.headers.get('x-owner-can-override') === '1' };
  };
  return {
    user, token,
    lang: (l) => client(token, user, l, branch, extra),
    at: (b) => client(token, user, lang, b, extra),
    /** The owner, having confirmed going past a rule (owner, 2026-10-22). */
    confirmed: () => client(token, user, lang, branch, { ...extra, 'x-owner-override': '1' }),
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p),
  };
}
export function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`); }
}
export function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}
export function ok(name, res, status = [200, 201]) {
  const s = Array.isArray(status) ? status : [status];
  check(name, s.includes(res.status), { status: res.status, data: res.data });
  return res.data;
}
// The company's calendar (Settings → time zone, Africa/Cairo by default): business days follow it.
export const ZONE = 'Africa/Cairo';
/** The yyyy-MM-dd day an instant falls on in a time zone (the company's by default). */
export function dayIn(when = new Date(), zone = ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(when));
}
export const companyToday = () => dayIn();
/** A yyyy-MM-dd day plus n days. */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function summary(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed) console.log('Failures:\n - ' + failures.join('\n - '));
  return failed;
}
