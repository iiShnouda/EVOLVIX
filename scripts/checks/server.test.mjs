// The owner's server pages (owner, 2026-10-10/11): the monitor (the machine and each part of the
// server) and updates (a new version, what it brings, updating). The owner's alone: not the admin's.
// Runs against BASE. The updates checks need the server started with Updates__Folder=<dir> and this
// run given UPDATES_DIR=<the same dir> (they play the server's updater by writing its files there);
// with System__Cgroups pointing at a fake control-group tree (see PROJECT_MAP.md) each part's figures
// are checked too.
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { login, check, eq, ok, summary } from './lib.mjs';

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

// ------------------------------------------------------------------ the monitor
console.log('== monitor');
const m = ok('the owner sees it', await owner.get('/system/monitor'));
eq('not the admin', (await admin.get('/system/monitor')).status, 403);
eq('nor sales', (await karim.get('/system/monitor')).status, 403);
check(
  'the machine: cores, memory, its system',
  m.machine.cores > 0 && m.machine.memoryTotal > 0 && m.machine.system.length > 0,
  m.machine,
);
check('the processor named', typeof m.machine.processor === 'string');
const parts = m.services.map((s) => s.key);
check(
  'each part listed (app and database at least)',
  parts.includes('app') && parts.includes('db'),
  parts,
);
check(
  'only the known parts',
  parts.every((p) => ['app', 'db', 'assistant', 'speech', 'voice'].includes(p)),
  parts,
);
const app = m.services.find((s) => s.key === 'app');
check('the app runs, with its memory', app.running && app.memoryBytes > 0, app);
check(
  'a figure is a share of the machine',
  m.services.every((s) => s.cpuPercent == null || (s.cpuPercent >= 0 && s.cpuPercent <= 100)),
);
check(
  'no paths or settings in it',
  !/\/(home|etc|var|backups|host)\b|Password|Secret/i.test(JSON.stringify(m)),
);

// ------------------------------------------------------------------ updates
console.log('== updates');
const u0 = ok('the owner sees updates', await owner.get('/system/updates'));
eq('not the admin', (await admin.get('/system/updates')).status, 403);
eq('nor sales', (await karim.get('/system/updates')).status, 403);
eq(
  'nor may they ask for one',
  [
    (await admin.post('/system/updates/check')).status,
    (await admin.post('/system/updates/apply')).status,
  ],
  [403, 403],
);
eq('the running version is the newest of its notes', u0.version, u0.installed[0]?.version);
check(
  'its notes in both languages',
  u0.installed[0].features.every((f) => f.ar && f.en),
  u0.installed[0],
);
eq('the same version on the monitor', m.app.version, u0.version);

const dir = process.env.UPDATES_DIR;
if (!dir) {
  console.log(
    '  (UPDATES_DIR not given: start the API with Updates__Folder=<dir> and pass UPDATES_DIR=<dir>)',
  );
  eq(
    'updates off where the server has no updater',
    [u0.enabled, (await owner.post('/system/updates/check')).data?.code],
    [false, 'updates_off'],
  );
} else {
  const file = (n) => join(dir, n);
  const status = (s) =>
    writeFileSync(
      file('status.json'),
      JSON.stringify({
        state: 'idle',
        step: null,
        error: null,
        behind: 0,
        checkedAt: '2026-10-11T05:00:00Z',
        startedAt: null,
        finishedAt: null,
        ...s,
      }),
    );
  const [maj, min] = u0.version.split('.').map(Number);
  const next = `${maj}.${min + 1}.0`;
  rmSync(file('request'), { force: true });

  status({ behind: 0 });
  writeFileSync(file('latest-release-notes.json'), JSON.stringify({ releases: u0.installed }));
  let u = ok('read', await owner.get('/system/updates'));
  eq('up to date', [u.enabled, u.available, u.coming.length, u.state], [true, false, 0, 'idle']);
  eq('nothing to update to', (await owner.post('/system/updates/apply')).data?.code, 'up_to_date');

  // The server's updater found a newer version.
  status({ behind: 3 });
  writeFileSync(
    file('latest-release-notes.json'),
    JSON.stringify({
      releases: [
        { version: 'not-a-version', features: [{ ar: 'x', en: 'x' }] },
        {
          version: next,
          date: '2026-10-20',
          features: [
            { ar: 'ميزة', en: 'A feature' },
            { ar: '', en: 'half' },
          ],
          fixes: [{ ar: 'إصلاح', en: 'A fix' }],
          apps: { windows: '9.9.9', ios: '1.0' },
        },
        ...u0.installed,
      ],
    }),
  );
  u = ok('read again', await owner.get('/system/updates'));
  eq(
    'a new version is there',
    [u.available, u.behind, u.coming.map((r) => r.version)],
    [true, 3, [next]],
  );
  eq(
    'what it brings (lines in both languages only)',
    [u.coming[0].features.length, u.coming[0].fixes[0].ar],
    [1, 'إصلاح'],
  );
  eq('apps it ships (known ones)', u.coming[0].apps, { windows: '9.9.9' });

  eq('look again', (await owner.post('/system/updates/check')).status, 202);
  eq('asked the updater for a check', readFileSync(file('request'), 'utf8'), 'check');
  eq('waiting for it', (await owner.get('/system/updates')).data.state, 'waiting');
  eq(
    'one thing at a time',
    (await owner.post('/system/updates/apply')).data?.code,
    'update_running',
  );
  rmSync(file('request'));

  const a = await owner.post('/system/updates/apply');
  eq('update', a.status, 202);
  eq('asked the updater to update', readFileSync(file('request'), 'utf8'), 'update');
  rmSync(file('request'));
  status({ state: 'updating', step: 'build', behind: 3, startedAt: new Date().toISOString() });
  eq(
    'building',
    [
      (await owner.get('/system/updates')).data.state,
      (await owner.get('/system/updates')).data.step,
    ],
    ['updating', 'build'],
  );
  status({
    state: 'updating',
    step: 'build',
    behind: 3,
    startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  });
  eq(
    'an update that never finished',
    [
      (await owner.get('/system/updates')).data.state,
      (await owner.get('/system/updates')).data.error,
    ],
    ['failed', 'timed_out'],
  );
  status({ state: 'failed', error: 'build_failed', behind: 0 });
  writeFileSync(file('latest-release-notes.json'), JSON.stringify({ releases: u0.installed }));
  eq('a failed update can be tried again', (await owner.post('/system/updates/apply')).status, 202);
  rmSync(file('request'));
  status({ state: 'failed', error: '<script>', step: 'rm -rf' });
  u = (await owner.get('/system/updates')).data;
  eq('only known codes are passed on', [u.error, u.step], [null, null]);

  // A request nobody picks up: the updater isn't running.
  status({ behind: 1 });
  writeFileSync(file('request'), 'check');
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(file('request'), old, old);
  eq(
    'the updater not running',
    [
      (await owner.get('/system/updates')).data.state,
      (await owner.get('/system/updates')).data.error,
    ],
    ['failed', 'updater_not_running'],
  );
  rmSync(file('request'));

  writeFileSync(file('status.json'), '{not json');
  eq("a status it can't read: off", (await owner.get('/system/updates')).data.enabled, false);
  status({ behind: 0 });
  check('a request never left behind by this run', !existsSync(file('request')));

  const audit = ok('audit', await owner.get('/audit?page=1&pageSize=50'));
  check(
    'asking and updating are in the activity log',
    JSON.stringify(audit.items ?? audit).includes('system_update'),
  );
}

summary('server');
