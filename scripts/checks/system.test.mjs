// Who's online (presence over the SignalR hub, as the web app talks to it) and backups:
// permissions, the encrypted download, the automatic ones in the server folder, and the audit.
// Runs against BASE. With BACKUP_OUT set, the downloaded backup is saved there (for
// restore-check.mjs); SKB_BACKUP_PASSPHRASE is its passphrase (a default is used otherwise).
// The automatic-backup checks need the server started with Backup__Folder (and Backup__Keep=2).
import { writeFileSync } from 'node:fs';
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const HUB = BASE.replace(/^http/, 'ws').replace(/\/api$/, '/hubs/presence');
const RS = '\u001e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal SignalR JSON client, the same protocol the web app speaks. */
function connect(who) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HUB}?access_token=${encodeURIComponent(who.token)}`);
    const events = [];
    let ready = false;
    ws.onopen = () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
    ws.onerror = (e) => reject(new Error(`socket error ${e.message ?? ''}`));
    ws.onclose = (e) => {
      if (!ready) reject(new Error(`closed ${e.code}`));
    };
    ws.onmessage = (e) => {
      for (const part of String(e.data).split(RS)) {
        if (!part) continue;
        const m = JSON.parse(part);
        if (!ready) {
          ready = true;
          if (m.error) return reject(new Error(m.error));
          resolve({
            ws,
            events,
            view: (v) =>
              ws.send(JSON.stringify({ type: 1, target: 'UpdateView', arguments: [v] }) + RS),
            close: () => ws.close(),
          });
        } else if (m.type === 1) events.push(m.target);
      }
    };
  });
}
const online = async () => ok('presence list', await owner.get('/presence'));
const find = async (id) => (await online()).find((p) => p.userId === id);

// ------------------------------------------------------------------ presence
console.log("== who's online");
eq("sales staff can't see it", (await karim.get('/presence')).status, 403);
let bad = null;
try {
  await connect({ token: 'not-a-token' });
} catch (e) {
  bad = e;
}
check('the hub refuses a connection without a valid sign-in', bad !== null);
const watcher = await connect(owner);
const k1 = await connect(karim);
await sleep(300);
let k = await find(karim.user.id);
check('a signed-in person shows up', !!k, await online());
eq(
  'with name, role and branch',
  [k?.fullName, k?.role, !!k?.branchName],
  [karim.user.fullName, 'SALES', true],
);
eq('one window, a browser', [k?.windows.length, k?.windows[0]?.device], [1, 'BROWSER']);
check('the owner was told', watcher.events.includes('presence:changed'), watcher.events);
k1.view('sales');
await sleep(300);
eq('the screen they are on', (await find(karim.user.id))?.currentView, 'sales');
k1.view('<script>alert(1)</script>');
await sleep(300);
eq('a screen name is cleaned', (await find(karim.user.id))?.currentView, 'scriptalert1script');
const k2 = await connect(karim);
await sleep(300);
k2.view('inventory');
await sleep(300);
k = await find(karim.user.id);
eq('two windows, one person', [k?.windows.length, k?.currentView], [2, 'inventory']);
const monaWatch = await connect(mona);
await sleep(300);
const before = monaWatch.events.length;
k1.close();
await sleep(400);
eq('one window closed', (await find(karim.user.id))?.windows.length, 1);
eq("people who can't see presence aren't told", monaWatch.events.length, before);
k2.close();
await sleep(400);
check('all windows closed: offline', !(await find(karim.user.id)));
monaWatch.close();
watcher.close();

// ------------------------------------------------------------------ backups
console.log('== backups');
eq("admin-level staff can't back up", (await mona.get('/backups')).status, 403);
eq(
  'nor download',
  (await karim.post('/backups/download', { passphrase: 'long enough pass' })).status,
  403,
);
const status = ok('status', await owner.get('/backups'));
eq(
  'short passphrase refused',
  (await owner.post('/backups/download', { passphrase: 'short' })).data?.code,
  'bad_passphrase',
);
const passphrase = process.env.SKB_BACKUP_PASSPHRASE ?? 'correct horse battery';
const res = await fetch(`${BASE}/backups/download`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
  body: JSON.stringify({ passphrase }),
});
eq('download', res.status, 200);
const bytes = new Uint8Array(await res.arrayBuffer());
eq('an encrypted SKB backup', new TextDecoder().decode(bytes.slice(0, 8)), 'SKBBAK1\n');
check('with content', bytes.length > 1000, bytes.length);
check(
  'named for the moment',
  /^attachment; filename=skb-\d{8}-\d{6}\.skbak/.test(res.headers.get('content-disposition') ?? ''),
  res.headers.get('content-disposition'),
);
check('nothing readable inside', !new TextDecoder().decode(bytes).includes('owner@skb.local'));
if (process.env.BACKUP_OUT) writeFileSync(process.env.BACKUP_OUT, bytes);
const audit = ok('audited', await owner.get('/audit?resource=backup&action=download'));
eq('by the owner', audit.items[0]?.actorId, owner.user.id);

if (status.automatic) {
  console.log('== automatic backups');
  check(
    'a folder, an hour, how many to keep',
    status.folder && status.hour >= 0 && status.keep >= 1,
    status,
  );
  const r1 = ok('back up now', await owner.post('/backups/run'));
  await sleep(1100);
  const r2 = ok('and again', await owner.post('/backups/run'));
  await sleep(1100);
  ok('and again', await owner.post('/backups/run'));
  const s = ok('status', await owner.get('/backups'));
  eq('last run recorded', [!!s.lastRunAt, s.lastError], [true, null]);
  eq(`only the newest ${s.keep} kept`, s.files.length, Math.min(s.keep, s.files.length));
  check(
    'newest first',
    s.files.every((f, i, a) => i === 0 || a[i - 1].name > f.name),
    s.files,
  );
  check('the oldest went', !s.files.some((f) => f.name === r1.name) || s.keep >= 3, s.files);
  const got = await fetch(`${BASE}/backups/files/${s.files[0].name}`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  eq('a stored backup downloads', got.status, 200);
  eq('same size', (await got.arrayBuffer()).byteLength, s.files[0].size);
  eq(
    'no other file',
    (await owner.get(`/backups/files/${encodeURIComponent('..\\appsettings.json')}`)).status,
    404,
  );
  eq("admin-level staff can't take one", (await mona.get(`/backups/files/${r2.name}`)).status, 403);
} else {
  console.log('  (no backup folder on this server: automatic backups not checked)');
  eq(
    'back up now needs a folder',
    (await owner.post('/backups/run')).data?.code,
    'no_backup_folder',
  );
}

summary('system');
