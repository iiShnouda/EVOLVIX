// Sign-in hardening (owner, 2026-11-20: "rate-limit a wrong email+password"). A wrong password is
// counted per account AND per address, only failures count (ordinary users are never slowed), the
// account locks after N wrong tries for a spell, a guesser spraying many made-up emails from one
// address is blocked too, the reply never says which emails exist nor how many tries are left, and
// the owner always gets back in once the window passes. Thresholds: Security:Login* (minutes may be
// fractional). This suite starts its OWN API with a tiny window, so it needs no running server.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { check, eq, summary } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const apiDir = resolve(root, 'apps/api/src/SKB.Api');
const dll = resolve(apiDir, 'bin/Debug/net10.0/SKB.Api.dll');
const PORT = Number(process.env.LOGIN_TEST_PORT ?? 5198);
const LBASE = `http://localhost:${PORT}/api`;
const DB = process.env.LOGIN_TEST_DB ?? 'skb_logintest';
const WINDOW_MIN = 0.05; // 3 seconds
const ACCOUNT_MAX = 5;
const ADDRESS_MAX = 12;
const OWNER = 'owner@skb.local';
const OWNER_PW = 'ChangeMe!Owner123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const windowMs = WINDOW_MIN * 60_000;

async function tryLogin(email, password) {
  const t0 = performance.now();
  const r = await fetch(`${LBASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, code: data?.code, data, ms: performance.now() - t0 };
}
// A per-try count must never be leaked (the thing the owner asked us to stop showing).
const noCount = (d) =>
  d == null ||
  ['left', 'remaining', 'attempts', 'attemptsLeft', 'triesLeft', 'retriesLeft', 'tries'].every(
    (k) => d[k] === undefined,
  );

const child = spawn('dotnet', [dll], {
  cwd: apiDir,
  env: {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Development',
    ASPNETCORE_URLS: LBASE.replace('/api', ''),
    ConnectionStrings__Default: `Host=localhost;Port=5432;Database=${DB};Username=skb;Password=skb_dev_password;Pooling=true;Maximum Pool Size=20`,
    // High request caps so only the failed-login guard (below) is under test.
    RateLimit__UserPerMinute: '100000',
    RateLimit__IpPerMinute: '100000',
    RateLimit__LoginPerMinute: '100000',
    Security__LoginMaxFailures: String(ACCOUNT_MAX),
    Security__LoginAddressMaxFailures: String(ADDRESS_MAX),
    Security__LoginWindowMinutes: String(WINDOW_MIN),
    Security__LoginLockMinutes: String(WINDOW_MIN),
    Updates__Folder: resolve(here, 'node_modules/.login-test-updates'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logTail = '';
child.stdout.on('data', (b) => (logTail = (logTail + b).slice(-4000)));
child.stderr.on('data', (b) => (logTail = (logTail + b).slice(-4000)));

async function waitHealthy() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${LBASE}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null)
      throw new Error(`API exited early (${child.exitCode})\n${logTail}`);
    await sleep(1000);
  }
  throw new Error(`API never became healthy on ${LBASE}\n${logTail}`);
}

let failedSuite = true;
try {
  await waitHealthy();

  console.log('== a normal sign-in works');
  eq('owner signs in', (await tryLogin(OWNER, OWNER_PW)).status, 200);

  console.log('== a wrong password never reveals the account, the count, or locks forever');
  await sleep(windowMs + 400); // fresh window
  const wrongReal = [];
  for (let i = 1; i < ACCOUNT_MAX; i++) wrongReal.push(await tryLogin(OWNER, `nope${i}`));
  check(
    'each wrong try is a generic 401',
    wrongReal.every((r) => r.status === 401 && r.code === 'INVALID_CREDENTIALS'),
    wrongReal.map((r) => [r.status, r.code]),
  );
  check(
    '…and never says how many tries are left',
    wrongReal.every((r) => noCount(r.data)),
    wrongReal.map((r) => r.data),
  );
  const tripped = await tryLogin(OWNER, `nope${ACCOUNT_MAX}`); // the Nth wrong try trips the lock
  check(
    'the Nth wrong try is still a generic 401 (no count)',
    tripped.status === 401 && tripped.code === 'INVALID_CREDENTIALS' && noCount(tripped.data),
    tripped.data,
  );
  const blocked = await tryLogin(OWNER, OWNER_PW); // correct password, but now locked
  eq(
    'now even the right password is refused — locked',
    [blocked.status, blocked.code],
    [429, 'TOO_MANY_ATTEMPTS'],
  );
  check('…the lock reply leaks no count', noCount(blocked.data), blocked.data);

  console.log('== the owner gets back in once the window passes (never locked out for good)');
  await sleep(windowMs + 600);
  eq('owner signs in again after the window', (await tryLogin(OWNER, OWNER_PW)).status, 200);

  console.log('== a non-existent email gives the SAME generic error (existence is hidden)');
  await sleep(windowMs + 400);
  const ghost = await tryLogin(`ghost.${Date.now()}@nowhere.local`, 'whatever');
  const realWrong = await tryLogin(OWNER, 'stillwrong');
  eq(
    'non-existent email: same status + code as a real wrong password',
    [ghost.status, ghost.code],
    [realWrong.status, realWrong.code],
  );
  check('…and no count either', noCount(ghost.data), ghost.data);

  console.log('== hammering many made-up emails from one address is throttled');
  await sleep(windowMs + 600); // reset so the two tries above don't count toward the address lock
  let addressLocked = null;
  for (let i = 0; i < ADDRESS_MAX + 6 && addressLocked === null; i++) {
    const r = await tryLogin(`spray.${i}.${Date.now()}@nowhere.local`, 'guess');
    if (r.status === 429) addressLocked = i + 1;
  }
  check(
    'one address spraying made-up emails is blocked after ~N failures',
    addressLocked !== null && addressLocked <= ADDRESS_MAX + 2,
    addressLocked,
  );
  // Even a valid sign-in from that blocked address is refused while the address window holds.
  eq(
    '…and the address block is a generic 429, no count',
    (await tryLogin(OWNER, OWNER_PW)).status,
    429,
  );

  console.log(
    '== the hasher runs for a missing email too, so timing doesn’t leak which emails exist',
  );
  await sleep(windowMs + 600);
  const sample = async (fn) => {
    const xs = [];
    for (let i = 0; i < 5; i++) xs.push((await fn()).ms);
    xs.sort((a, b) => a - b);
    return xs[2]; // median
  };
  const realMs = await sample(() => tryLogin(OWNER, `bad.${Math.random()}`));
  await sleep(windowMs + 600);
  const ghostMs = await sample(() => tryLogin(`g.${Math.random()}@nowhere.local`, 'bad'));
  const ratio = ghostMs / realMs;
  // Soft: the missing-email path should not be dramatically faster (it would leak non-existence).
  check('missing-email timing is close to a real account (within 3x)', ratio > 0.33 && ratio < 3, {
    realMs: Math.round(realMs),
    ghostMs: Math.round(ghostMs),
    ratio: Number(ratio.toFixed(2)),
  });

  failedSuite = summary('login') !== 0;
} catch (e) {
  console.error(e.message ?? e);
} finally {
  child.kill('SIGTERM');
  await sleep(300);
  if (child.exitCode === null) child.kill('SIGKILL');
}
process.exit(failedSuite ? 1 : 0);
