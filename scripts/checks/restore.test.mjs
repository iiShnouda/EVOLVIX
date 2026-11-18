// Restoring a backup from the owner's page (owner, 2026-11-16): owner only; upload one or pick an
// automatic one (by name only); its contents before anything changes; a wrong passphrase, a file that
// isn't a backup and one from a newer version are refused; a typed confirmation; then a safety backup,
// the restored data in place of the current one (kept aside), everyone signed out, and the audit.
// It REPLACES the server's data: run it only on a throwaway database, with the server started with
// Backup__Folder. With PG_URL (default the dev database server) the kept database is dropped after.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';
import { zip, upload } from './zipfile.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASS = 'restore-check-passphrase';
let owner = await login('owner@skb.local');
const mona = await login('mona@skb.local');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('== permissions');
eq("an accountant can't see it", (await mona.get('/backups/restore')).status, 403);
eq(
  '…nor upload',
  (await upload(BASE, mona, '/backups/restore/upload', Buffer.from('x'), 'x.skbak')).status,
  403,
);
const options = ok('the owner sees it', await owner.get('/backups/restore'));
eq('it can be done on this server', options.unavailable, null);

console.log('== the file');
const r = await fetch(`${BASE}/backups/download`, {
  method: 'POST',
  headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ passphrase: PASS }),
});
const backup = Buffer.from(await r.arrayBuffer());
check('a backup to restore', r.ok && backup.length > 1000, r.status);
const later = ok(
  'a customer added after the backup',
  await owner.post('/parties', { name: `After backup ${tag}`, types: ['CUSTOMER'] }),
);

const staged = ok(
  'upload it',
  await upload(BASE, owner, '/backups/restore/upload', backup, 'mine.skbak'),
);
eq('…named and encrypted', [staged.name, staged.encrypted], ['mine.skbak', true]);
const wrong = await owner.post(`/backups/restore/${staged.id}/inspect`, {
  passphrase: 'not the passphrase',
});
eq('a wrong passphrase', [wrong.status, wrong.data?.code], [400, 'wrong_passphrase']);
const contents = ok(
  'its contents',
  await owner.post(`/backups/restore/${staged.id}/inspect`, { passphrase: PASS }),
);
check(
  'rows per table',
  contents.totalRows > 0 && contents.tables.some((t) => t.name === 'Parties' && t.rows > 0),
  contents,
);
check('its date and version', !!contents.createdAt && !!contents.migration, contents);
eq(
  "someone else can't use the upload",
  (await mona.post(`/backups/restore/${staged.id}/inspect`, { passphrase: PASS })).status,
  403,
);

const notOne = ok(
  'a file that is not a backup',
  await upload(BASE, owner, '/backups/restore/upload', Buffer.from('hello there'), 'x.skbak'),
);
eq(
  '…is refused',
  (await owner.post(`/backups/restore/${notOne.id}/inspect`, {})).data?.code,
  'not_a_backup',
);
const future = zip({
  'manifest.json': JSON.stringify({
    format: 'skb-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    migration: '29991231000000_Future',
    appVersion: null,
    tables: [],
  }),
});
const newer = ok(
  'a backup from a newer version',
  await upload(BASE, owner, '/backups/restore/upload', future, 'future.zip'),
);
eq('…not encrypted', newer.encrypted, false);
eq(
  '…is refused when looked at',
  (await owner.post(`/backups/restore/${newer.id}/inspect`, {})).data?.code,
  'backup_newer',
);
eq(
  '…and when restored',
  (await owner.post(`/backups/restore/${newer.id}`, { confirm: 'RESTORE' })).data?.code,
  'backup_newer',
);

eq('an upload can be dropped', (await owner.del(`/backups/restore/${notOne.id}`)).status, 204);
await owner.del(`/backups/restore/${newer.id}`);

console.log('== automatic backups');
const run = await owner.post('/backups/run');
if (run.status === 200) {
  const picked = ok(
    'pick an automatic one by name',
    await owner.post('/backups/restore/pick', { name: run.data.name }),
  );
  eq('…its name', picked.name, run.data.name);
  check(
    '…listed',
    ok('options', await owner.get('/backups/restore')).files.some((f) => f.name === run.data.name),
  );
} else console.log('  (no backup folder: automatic backups skipped)');
eq(
  'a path is never taken',
  (await owner.post('/backups/restore/pick', { name: '../../etc/passwd' })).status,
  404,
);

console.log('== restore');
const noConfirm = await owner.post(`/backups/restore/${staged.id}`, {
  passphrase: PASS,
  confirm: 'yes',
});
eq('without the confirmation', [noConfirm.status, noConfirm.data?.code], [400, 'restore_confirm']);
const started = ok(
  'restore',
  await owner.post(`/backups/restore/${staged.id}`, { passphrase: PASS, confirm: 'RESTORE' }),
  202,
);
let job = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const j = await fetch(`${BASE}/backups/restore/jobs/${started.jobId}`);
  if (j.ok) {
    job = await j.json();
    if (job.state !== 'running') break;
  }
}
eq('it finished', job?.state, 'done');
check(
  'a safety backup was taken first',
  run.status !== 200 || /^skb-\d{8}-\d{6}\./.test(job?.safetyBackup ?? ''),
  job,
);
check('the previous data is kept aside', /_before_\d{14}$/.test(job?.keptDatabase ?? ''), job);
eq(
  'an unknown job',
  (await fetch(`${BASE}/backups/restore/jobs/${crypto.randomUUID()}`)).status,
  404,
);

const stale = await fetch(`${BASE}/parties`, {
  headers: { authorization: `Bearer ${owner.token}` },
});
eq('everyone is signed out', stale.status, 401);
owner = await login('owner@skb.local');
eq(
  'the customer added after the backup is gone',
  (await owner.get(`/parties/${later.id}`)).status,
  404,
);
const log = ok('the log', await owner.get('/audit?action=restore&pageSize=5'));
check(
  'the restore is in the log',
  log.items.some((e) => e.resource === 'backup' && e.resourceId === 'mine.skbak'),
  log.items,
);

// The kept database is removed again (a real server keeps it for the owner).
if (job?.keptDatabase) {
  try {
    const { default: pg } = await import('pg');
    const c = new pg.Client({
      connectionString:
        process.env.PG_URL ?? 'postgres://skb:skb_dev_password@localhost:5432/postgres',
    });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${job.keptDatabase.replace(/"/g, '')}" WITH (FORCE)`);
    await c.end();
  } catch (e) {
    console.log(`  (could not drop ${job.keptDatabase}: ${e.message})`);
  }
}

summary('restore');
