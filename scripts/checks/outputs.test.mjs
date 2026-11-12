// Print, PDF and Excel as permissions of their own on every page, and the print settings
// (owner, 2026-11-12): POST /outputs asks before a printout or file is made and logs it; a
// document's print endpoint takes ?kind=pdf; print options are saved only with print:settings,
// everyone else reads the company layout set with print:default. Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES
const mona = await login('mona@skb.local'); // ACCOUNTANT

const PAGES = {
  sales: ['print', 'pdf'],
  purchases: ['print', 'pdf'],
  inventory: ['print', 'pdf', 'excel'],
  stocktake: ['print', 'pdf'],
  transfers: ['print', 'pdf'],
  labels: ['print', 'pdf'],
  parties: ['print', 'pdf'],
  statement: ['print', 'pdf', 'excel'],
  money: ['print', 'pdf', 'excel'],
  ledger: ['print', 'pdf', 'excel'],
  payroll: ['print', 'pdf', 'excel'],
  reports: ['print', 'pdf', 'excel'],
  audit: ['print', 'pdf', 'excel'],
};
const ask = (who, page, kind) => who.post('/outputs', { page, kind, title: `check ${tag}` });

console.log('== the catalog');
const catalog = ok('permission catalog', await owner.get('/permissions')).map((p) => p.key);
for (const [page, kinds] of Object.entries(PAGES))
  for (const kind of kinds) {
    const perm = `${page}:${kind === 'excel' ? 'export' : kind}`;
    check(`${perm} exists`, catalog.includes(perm));
  }
check('print:settings exists', catalog.includes('print:settings'));
check('print:default exists', catalog.includes('print:default'));

console.log('== the owner may make every output');
for (const [page, kinds] of Object.entries(PAGES))
  for (const kind of kinds) eq(`owner ${page} ${kind}`, (await ask(owner, page, kind)).status, 204);
eq('unknown page', (await ask(owner, 'nowhere', 'print')).data?.code, 'bad_output');
eq('unknown kind', (await ask(owner, 'reports', 'word')).data?.code, 'bad_output');
eq('no Excel on invoices', (await ask(owner, 'sales', 'excel')).data?.code, 'bad_output');
const log = ok(
  'activity log',
  await owner.get(`/audit?resource=output_reports&action=pdf&pageSize=20`),
);
check(
  'a PDF of a report is in the activity log',
  log.items?.some((e) => e.details === `check ${tag}`),
  log.items?.slice(0, 2),
);

console.log('== the roles keep what they could do');
const roles = ok('roles', await owner.get('/roles'));
const role = (r) => roles.find((x) => x.role === r).permissions;
check('sales role saves invoices as PDF', role('SALES').includes('sales:pdf'));
check('viewer role saves reports as PDF', role('VIEWER').includes('reports:pdf'));
check('inventory role prints the count sheet', role('INVENTORY').includes('stocktake:print'));
check('accountant has payroll Excel', role('ACCOUNTANT').includes('payroll:export'));
check('no role but the admin changes print options', !role('SALES').includes('print:settings'));
eq('a seller may save a report? no', (await ask(karim, 'reports', 'pdf')).status, 403);
eq('a seller saves invoices as PDF', (await ask(karim, 'sales', 'pdf')).status, 204);
eq('the accountant exports the ledger', (await ask(mona, 'ledger', 'excel')).status, 204);

console.log('== one permission each');
const branches = (await owner.get('/branches')).data;
const invoices = ok('invoices', await owner.get('/sales/invoices?pageSize=5'));
const inv = (invoices.items ?? invoices)[0];
const email = `printer.${tag}@skb.local`;
const person = ok(
  'person with only some outputs',
  await owner.post('/staff', {
    fullName: `Printer ${tag}`,
    email,
    password: 'Str0ngPass!',
    role: 'NONE',
    branchId: inv?.branchId ?? branches[0].id,
  }),
);
ok(
  'grants',
  await owner.put(`/staff/${person.id}/permissions`, {
    granted: ['reports:print', 'money:export', 'sales:view', 'sales:pdf'],
    revoked: [],
  }),
  [200, 204],
);
const p = await login(email, 'Str0ngPass!');
eq('print a report', (await ask(p, 'reports', 'print')).status, 204);
eq('no PDF of a report', (await ask(p, 'reports', 'pdf')).status, 403);
eq('no Excel of a report', (await ask(p, 'reports', 'excel')).status, 403);
eq('Excel of cash and banks', (await ask(p, 'money', 'excel')).status, 204);
eq('no printing cash and banks', (await ask(p, 'money', 'print')).status, 403);
if (inv) {
  eq('no printing the invoice', (await p.post(`/sales/invoices/${inv.id}/print`, {})).status, 403);
  eq(
    'saving the invoice as PDF',
    (await p.post(`/sales/invoices/${inv.id}/print?kind=pdf`, {})).status,
    204,
  );
  eq(
    'the seller prints it',
    [204, 404].includes((await karim.post(`/sales/invoices/${inv.id}/print`, {})).status),
    true,
  );
}

console.log('== print settings');
const PAPER = 'columns:print.paper';
eq(
  'no print options without print:settings',
  (await p.put('/preferences', { key: PAPER, value: '["A5"]' })).status,
  403,
);
eq(
  'other preferences still saved',
  (await p.put('/preferences', { key: `columns:check.${tag}`, value: '["x"]' })).status,
  204,
);
eq(
  'no company layout without print:default',
  (await p.put('/preferences/print-default')).status,
  403,
);
eq(
  'owner picks A5',
  (await owner.put('/preferences', { key: PAPER, value: '["A5"]' })).status,
  204,
);
eq(
  'owner makes it the company layout',
  (await owner.put('/preferences/print-default')).status,
  204,
);
eq('the person prints on the company paper', (await p.get('/preferences')).data?.[PAPER], '["A5"]');
ok(
  'given print:settings',
  await owner.put(`/staff/${person.id}/permissions`, {
    granted: ['reports:print', 'print:settings'],
    revoked: [],
  }),
  [200, 204],
);
const p2 = await login(email, 'Str0ngPass!');
eq(
  'now saves their own',
  (await p2.put('/preferences', { key: PAPER, value: '["A4"]' })).status,
  204,
);
eq('and prints with it', (await p2.get('/preferences')).data?.[PAPER], '["A4"]');
ok(
  'taken back',
  await owner.put(`/staff/${person.id}/permissions`, { granted: ['reports:print'], revoked: [] }),
  [200, 204],
);
const p3 = await login(email, 'Str0ngPass!');
eq('back to the company paper', (await p3.get('/preferences')).data?.[PAPER], '["A5"]');
// Leave the company as it was: the owner's A4 and no company layout.
await owner.put('/preferences', { key: PAPER, value: '' });
eq('only print:default clears it', (await p3.del('/preferences/print-default')).status, 403);
eq('owner clears it', (await owner.del('/preferences/print-default')).status, 204);
eq('company layout cleared', (await p3.get('/preferences')).data?.[PAPER], undefined);

console.log(`(${BASE})`);
summary('outputs');
