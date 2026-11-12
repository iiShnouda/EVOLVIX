// The server's log (owner, 2026-11-12): a line per request with its id, errors with their stack
// trace and the id the person is given, errors the app reports, the owner's page (system:logs, the
// owner's alone), and what is never written: passwords, tokens, keys, free text from a query string,
// forged lines. Runs against BASE; a development server keeps its log in "logs" beside the app
// (Logs:Folder to put it elsewhere). With LOGS_DIR=<that folder> the files' modes are checked too.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local');
const branch = ok('branches', await owner.get('/branches'))[0];
const email = `adm-${tag}@skb.local`;
ok(
  'an admin',
  await owner.post('/staff', {
    fullName: `Adm ${tag}`,
    email,
    password: 'ChangeMe!Staff123',
    role: 'ADMIN',
    branchId: branch.id,
  }),
);
const admin = await login(email, 'ChangeMe!Staff123');
const today = companyToday();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** A raw request, for its headers. */
const raw = (path, token, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
/** The log's lines for a request id (the writer is a moment behind). */
async function linesOf(requestId) {
  for (let i = 0; i < 20; i++) {
    const r = await owner.get(`/system/logs?requestId=${requestId}`);
    if (r.status === 200 && r.data.entries.length) return r.data.entries;
    await wait(150);
  }
  return [];
}
async function dayText() {
  const r = await raw(`/system/logs/download?day=${today}`, owner.token);
  return {
    status: r.status,
    type: r.headers.get('content-type'),
    disposition: r.headers.get('content-disposition'),
    text: await r.text(),
  };
}

// ------------------------------------------------------------------ who may read it
console.log('== permission');
const first = ok('the owner reads the log', await owner.get('/system/logs'));
check('it is on', first.enabled === true, first);
eq('today by default', first.day, today);
check('today is one of its days', first.days.includes(today), first.days);
eq('not the admin', (await admin.get('/system/logs')).status, 403);
eq('nor sales', (await karim.get('/system/logs')).status, 403);
eq(
  'nor the admin downloading',
  (await admin.get(`/system/logs/download?day=${today}`)).status,
  403,
);
eq('nor sales downloading', (await karim.get(`/system/logs/download?day=${today}`)).status, 403);
eq('not signed in', (await raw('/system/logs')).status, 401);
const me = ok("the owner's permissions", await owner.get('/auth/me'));
check('the owner has system:logs', me.permissions.includes('system:logs'));
const adm = ok('the admin', await admin.get('/auth/me'));
check('the admin has not', !adm.permissions.includes('system:logs'));
const catalog = JSON.stringify((await owner.get('/staff/permissions')).data ?? '');
check('it cannot be given to anyone', !catalog.includes('"system:logs"') || catalog.length === 0);

// ------------------------------------------------------------------ a request's line
console.log('== a request');
const r1 = await raw('/branches', owner.token, { headers: { 'x-branch': branch.id } });
const rid = r1.headers.get('x-request-id');
check('every answer carries a request id', /^[A-Z2-9]{10}$/.test(rid ?? ''), rid);
const l1 = await linesOf(rid);
eq('one line for it', l1.length, 1);
const e1 = l1[0] ?? {};
check(
  'method, path, status, time',
  e1.method === 'GET' && e1.path === '/api/branches' && e1.status === 200 && e1.ms >= 0,
  e1,
);
check('who made it, and the branch', e1.user && e1.userId === me.id && e1.branch === branch.id, e1);
eq('an information line from the server', [e1.level, e1.source], ['info', 'server']);
const forged = await raw('/branches', owner.token, { headers: { 'x-request-id': 'FAKE-ID-123' } });
check(
  'a request id is never taken from the client',
  forged.headers.get('x-request-id') !== 'FAKE-ID-123',
);

// ------------------------------------------------------------------ an error nobody handled
console.log('== an error');
const fail = await raw('/system/logs/fail', owner.token);
const failBody = await fail.json();
eq('a server error', fail.status, 500);
check(
  'the answer gives its request id, and nothing more',
  failBody.requestId === fail.headers.get('x-request-id') &&
    failBody.code === 'server_error' &&
    !JSON.stringify(failBody).includes('forced'),
  failBody,
);
const l2 = await linesOf(failBody.requestId);
const err = l2.find((e) => e.level === 'error');
check(
  'logged as an error with its stack trace',
  err && /InvalidOperationException/.test(err.exception) && /LogsController/.test(err.exception),
  l2,
);
check(
  'its message has no secret',
  err && !/forced-secret-1|forced\.secret\.token2/.test(JSON.stringify(l2)),
  err?.exception?.slice(0, 200),
);
check(
  'no folders of the server in the stack',
  err && !/\/(home|app|src|root|usr)\//.test(err.exception) && !/[A-Z]:\\/.test(err.exception),
);
const byLevel = ok(
  'errors only',
  await owner.get(`/system/logs?level=error&requestId=${failBody.requestId}`),
);
check('the level filter keeps it', byLevel.entries.length >= 1);
const warnOnly = ok('warnings and up', await owner.get('/system/logs?level=warning&limit=200'));
check(
  'no information lines among warnings',
  warnOnly.entries.every((e) => ['warning', 'error'].includes(e.level)),
);
const found = ok(
  'text search',
  await owner.get(`/system/logs?q=${encodeURIComponent('logs/fail')}`),
);
check(
  'finds the failed request',
  found.entries.some((e) => e.requestId === failBody.requestId),
);

// ------------------------------------------------------------------ what is never written
console.log('== scrubbing');
const secret = `hunter2-${tag}`;
const token = `tok-${tag}`;
const r3 = await raw(
  `/branches?password=${secret}&access_token=${token}&apiKey=k-${tag}&email=ali-${tag}@x.com&search=Ahmed+${tag}&page=2`,
  owner.token,
);
const l3 = await linesOf(r3.headers.get('x-request-id'));
const p3 = l3[0]?.path ?? '';
check('the line is there', p3.startsWith('/api/branches?'), l3);
check(
  'no password, token or key',
  !p3.includes(secret) && !p3.includes(token) && !p3.includes(`k-${tag}`),
  p3,
);
check('no email or typed text', !p3.includes(`ali-${tag}`) && !p3.includes(`Ahmed`), p3);
check(
  'the names stay, a plain number too',
  /password=\*\*\*/.test(p3) && p3.includes('page=2'),
  p3,
);
const wrong = `Wrong-${tag}!pw`;
const signIn = await raw('/auth/login', null, {
  method: 'POST',
  body: JSON.stringify({
    email: `owner@skb.local\n{"l":"error","m":"forged ${tag}"}`,
    password: wrong,
  }),
});
eq('a failed sign-in', signIn.status, 401);
await wait(400);
const warns = ok(
  'the warnings',
  await owner.get(`/system/logs?level=warning&q=${encodeURIComponent('Failed sign-in')}`),
);
const w = warns.entries[0];
check(
  'a failed sign-in is a warning',
  w && /Failed sign-in for ow\*\*\*/.test(w.message),
  warns.entries.slice(0, 2),
);
check('its address is not written whole', w && !w.message.includes('owner@skb.local'));

// ------------------------------------------------------------------ errors from the app
console.log('== client errors');
const report = {
  kind: 'render',
  message: `TypeError: x is undefined ${tag}\n{"l":"error","m":"injected ${tag}"}\u001b[31m`,
  stack: `TypeError: x\n    at Page (http://localhost/assets/index-abc.js:1:2)\n    Authorization: Bearer abc.def.ghi password=${secret}`,
  route: `/sales/new?customer=Ahmed-${tag}#x`,
  version: 'build-1',
};
eq(
  'not signed in: refused',
  (await raw('/client-errors', null, { method: 'POST', body: JSON.stringify(report) })).status,
  401,
);
eq('anyone signed in may report', (await karim.post('/client-errors', report)).status, 204);
eq(
  'an empty report is refused',
  (await karim.post('/client-errors', { message: '  ' })).status,
  400,
);
eq(
  'a large one is refused',
  (await karim.post('/client-errors', { message: 'x'.repeat(40_000) })).status,
  413,
);
await wait(400);
const cl = ok('client errors', await owner.get(`/system/logs?source=client&q=${tag}`));
const c = cl.entries[0];
check(
  'logged as a client error',
  c && c.source === 'client' && c.level === 'error' && c.category === 'render',
  cl.entries,
);
check(
  'one line: the forged part stays inside it',
  c && !c.message.includes('\n') && !/\u001b/.test(c.message),
);
check('the page without its query', c && c.route === '/sales/new', c);
check('the app build and the browser', c && c.version === 'build-1' && c.userAgent);
check('who it was', c && c.user && c.userId === karim.user.id, c);
check(
  'no secrets in its stack',
  c && !c.exception.includes(secret) && !c.exception.includes('abc.def.ghi'),
  c?.exception,
);
const injected = ok(
  'the injected text',
  await owner.get(`/system/logs?q=${encodeURIComponent(`injected ${tag}`)}`),
);
check(
  'makes no line of its own',
  injected.entries.every((e) => e.source === 'client' && e.message.includes('TypeError')),
  injected.entries,
);

// ------------------------------------------------------------------ the day as a file
console.log('== download');
const d = await dayText();
eq('the owner downloads the day', d.status, 200);
check('as text', /^text\/plain/.test(d.type ?? ''), d.type);
check('named by the day only', d.disposition?.includes(`evolvix-log-${today}.txt`), d.disposition);
check('it has the failed request', d.text.includes(failBody.requestId));
check(
  'no password, token or key in the whole day',
  !d.text.includes(secret) &&
    !d.text.includes(token) &&
    !d.text.includes(owner.token) &&
    !d.text.includes(wrong),
);
check(
  'no forged line',
  !d.text
    .split('\n')
    .some((l) => l.startsWith('{') || (l.includes(`"forged ${tag}"`) && !l.includes('ow***'))),
);
check(
  'stack lines are indented',
  d.text
    .split('\n')
    .filter((l) => l.includes('at SKB.Api'))
    .every((l) => l.startsWith('    ')),
);
check('no folders of the server', !/\/(home|root|var|usr)\/\S*\/(logs|SKB)/.test(d.text));

// ------------------------------------------------------------------ only a day, never a file
console.log('== no other files');
for (const day of [
  '../../etc/passwd',
  '..%2F..%2Fappsettings.json',
  '2026-11-12/../../x',
  'C:\\Windows\\win.ini',
  '2026-13-45',
  '20261112',
]) {
  eq(
    `not a day: ${day}`,
    (await owner.get(`/system/logs?day=${encodeURIComponent(day)}`)).status,
    400,
  );
  eq(
    `nor to download: ${day}`,
    (await owner.get(`/system/logs/download?day=${encodeURIComponent(day)}`)).status,
    400,
  );
}
eq('a day with no log', (await owner.get('/system/logs/download?day=2001-01-01')).status, 404);
const other = ok(
  'a file name is not a filter',
  await owner.get('/system/logs?file=/etc/passwd&path=../appsettings.json'),
);
eq('the same day as ever', other.day, today);
check(
  'the answers never name a folder or file',
  !/\/(home|etc|var|tmp|app)\/|\.log\b|\\/.test(JSON.stringify({ ...first, entries: [] })),
);

// ------------------------------------------------------------------ paging and what came since
console.log('== paging');
const p1 = ok('a page of 3', await owner.get('/system/logs?limit=3'));
eq('three lines', p1.entries.length, 3);
check(
  'newest first',
  p1.entries.every((e, i) => i === 0 || e.id < p1.entries[i - 1].id),
);
const p2 = ok('the next page', await owner.get(`/system/logs?limit=3&before=${p1.older}`));
check('older ones, none repeated', p2.entries.length > 0 && p2.entries[0].id < p1.entries[2].id, {
  p1: p1.entries.map((e) => e.id),
  p2: p2.entries.map((e) => e.id),
});
const r4 = await raw('/branches', owner.token);
await linesOf(r4.headers.get('x-request-id'));
const since = ok('what came since', await owner.get(`/system/logs?after=${p1.end}`));
check(
  'the new request is there',
  since.entries.some((e) => e.requestId === r4.headers.get('x-request-id')),
  since.entries.map((e) => e.requestId),
);
check(
  'nothing from before',
  since.entries.every((e) => e.id >= p1.end),
);

// ------------------------------------------------------------------ audited
console.log('== audit');
const audit = ok('audit', await owner.get('/audit?resource=server_logs&pageSize=50'));
const items = audit.items ?? audit;
check(
  'reading the log is audited',
  items.some((a) => a.action === 'view' && a.resourceId === today),
  items.slice(0, 3),
);
check(
  'downloading it is audited',
  items.some((a) => a.action === 'export' && a.resourceId === today),
);

// ------------------------------------------------------------------ the files themselves
if (process.env.LOGS_DIR) {
  console.log('== files');
  const dir = process.env.LOGS_DIR;
  check(
    "the folder is the service user's alone",
    (statSync(dir).mode & 0o077) === 0,
    (statSync(dir).mode & 0o777).toString(8),
  );
  const files = readdirSync(dir);
  check('a file per day', files.includes(`evolvix-${today}.log`), files);
  check(
    'each readable by the service user alone',
    files.every((f) => (statSync(join(dir, f)).mode & 0o077) === 0),
  );
}

// ------------------------------------------------------------------ a few reports a minute
console.log('== rate limit');
const mona = await login('mona@skb.local');
const codes = [];
for (let i = 0; i < 30; i++)
  codes.push((await mona.post('/client-errors', { message: `flood ${tag} ${i}` })).status);
check('a few are taken', codes.includes(204), codes);
check(
  'then refused for a while',
  codes.slice(-5).every((s) => s === 429),
  codes,
);
check('the rest of the app still answers', (await mona.get('/auth/me')).status === 200);

process.exit(summary('logs') ? 1 : 0);
