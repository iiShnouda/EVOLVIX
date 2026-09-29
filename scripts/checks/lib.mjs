// Tiny API test helpers. BASE from env (default :5090).
export const BASE = process.env.BASE ?? 'http://localhost:5090/api';
let passed = 0, failed = 0;
const failures = [];
export async function login(email, password = email.startsWith('owner') ? 'ChangeMe!Owner123' : 'ChangeMe!Staff123') {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`);
  return client(j.accessToken, j.user);
}
export function client(token, user, lang = 'en') {
  const call = async (method, path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'accept-language': lang },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  };
  return {
    user, token,
    lang: (l) => client(token, user, l),
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
export function summary(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed) console.log('Failures:\n - ' + failures.join('\n - '));
  return failed;
}
