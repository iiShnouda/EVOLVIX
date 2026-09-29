// Compares two databases table by table (row count and a fingerprint of every row): the one a
// backup was taken from and the one it was restored into. Signed-in sessions aren't backed up.
// Usage: PGURL=<original> PGURL_RESTORED=<restored> node restore-check.mjs   (needs `npm i pg`)
// SKIP=AuditEntries leaves tables out (e.g. the activity log, which records the download itself).
import pg from 'pg';
import { check, eq, summary } from './lib.mjs';

const a = new pg.Client({ connectionString: process.env.PGURL });
const b = new pg.Client({ connectionString: process.env.PGURL_RESTORED });
await a.connect();
await b.connect();
const skip = new Set((process.env.SKIP ?? '').split(',').filter(Boolean));
const tables = (
  await a.query(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
     and table_name not in ('Sessions','__EFMigrationsHistory') order by 1`,
  )
).rows
  .map((r) => r.table_name)
  .filter((t) => !skip.has(t));
const print = async (db, t) =>
  (
    await db.query(
      `select count(*)::int as n, md5(coalesce(string_agg(x.r, '|' order by x.r), '')) as h
       from (select t::text as r from "${t}" t) x`,
    )
  ).rows[0];
console.log(`== ${tables.length} tables`);
let rows = 0;
for (const t of tables) {
  const [x, y] = [await print(a, t), await print(b, t)];
  rows += x.n;
  eq(`${t} (${x.n} rows)`, y, x);
}
eq(
  'no signed-in sessions came back',
  (await b.query('select count(*)::int as n from "Sessions"')).rows[0].n,
  0,
);
const mig = async (db) =>
  (await db.query('select max("MigrationId") as m from "__EFMigrationsHistory"')).rows[0].m;
eq('same database version', await mig(b), await mig(a));
check('something was compared', rows > 0, rows);
await a.end();
await b.end();
summary('restore');
