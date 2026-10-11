// Admin & close: the company profile printed on documents, the activity log, aging of debts and
// the year-end close — each with its permissions. Runs against BASE. With PGURL set it also backdates
// invoices to check every aging bucket (needs `npm i pg`).
//
// The year-end close can only happen once per database (a closed year stays closed), so run this
// suite last in a round; on a database where a year is already closed those checks are skipped.
import { login, check, eq, ok, summary, companyToday, dayIn } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const sara = await login('sara@skb.local'); // INVENTORY

// ------------------------------------------------------------------ company profile
console.log('== company profile');
const s0 = ok('settings', await owner.get('/settings'));
eq("store staff can't change settings", (await sara.put('/settings', { phone: '1' })).status, 403);
const profile = {
  address: `  12 Tahrir St, Cairo ${tag}  `,
  phone: '+20 2 1234 5678',
  email: `Accounts.${tag}@Example.com`,
  taxNumber: '123-456-789',
  commercialRegister: 'CR 98765',
};
const s1 = ok('save the profile', await owner.put('/settings', profile));
eq(
  'saved, trimmed, email in lower case',
  [s1.address, s1.phone, s1.email, s1.taxNumber, s1.commercialRegister],
  [
    `12 Tahrir St, Cairo ${tag}`,
    '+20 2 1234 5678',
    `accounts.${tag}@example.com`,
    '123-456-789',
    'CR 98765',
  ],
);
eq('other settings untouched', [s1.companyName, s1.currency], [s0.companyName, s0.currency]);
eq('everyone reads it', (await karim.get('/settings')).data?.taxNumber, '123-456-789');
eq(
  'bad email refused',
  (await owner.put('/settings', { email: 'not an email' })).data?.code,
  'bad_email',
);
eq(
  'long address cut to 300',
  (await owner.put('/settings', { address: 'x'.repeat(400) })).data?.address?.length,
  300,
);
const s2 = ok('clear the phone, keep the rest', await owner.put('/settings', { phone: '' }));
eq('phone cleared', s2.phone, null);
eq('tax number kept', s2.taxNumber, '123-456-789');
ok('put the profile back', await owner.put('/settings', profile));

// ------------------------------------------------------------------ activity log
console.log('== activity log');
eq("admin-level staff don't see it", (await mona.get('/audit')).status, 403);
eq("sales staff don't see it", (await karim.get('/audit')).status, 403);
eq('nor its filters', (await karim.get('/audit/facets')).status, 403);
const log = ok('owner sees it', await owner.get('/audit?resource=settings&action=update'));
check('the settings change is there', log.items.length > 0 && log.total >= 3, log);
const last = log.items[0];
eq(
  'by the owner',
  [last.actorId, last.resource, last.action],
  [owner.user.id, 'settings', 'update'],
);
check(
  'newest first',
  log.items.every((e, i, a) => i === 0 || a[i - 1].createdAt >= e.createdAt),
);
// A more detailed log (owner, 2026-10-12): the device each action came from, and a note for the ones that carry one.
check('each row names the device', log.items.every((e) => typeof e.device === 'string' && e.device.length > 0));
const sale = ok('a sale in the log', await owner.get('/audit?resource=sales_invoice&action=create&pageSize=1'));
check('a sale carries a detail (its number and total)', sale.items.length === 0 || /\d/.test(sale.items[0].details || ''), sale.items[0]);
const facets = ok('filters', await owner.get('/audit/facets'));
check(
  'filters list what happened',
  facets.resources.includes('settings') && facets.actions.includes('update'),
  facets,
);
check(
  'people by name',
  facets.actors.some((a) => a.id === owner.user.id && a.name),
  facets.actors,
);
const mine = ok('by person', await owner.get(`/audit?actorId=${owner.user.id}&pageSize=5`));
eq('page size kept', [mine.pageSize, mine.items.length <= 5], [5, true]);
check(
  'only that person',
  mine.items.every((e) => e.actorId === owner.user.id),
);
eq('page size capped', (await owner.get('/audit?pageSize=5000')).data?.pageSize, 200);
const today = companyToday();
const byDay = ok('by day', await owner.get(`/audit?from=${today}&to=${today}&resource=settings`));
check(
  'today only',
  byDay.items.every((e) => dayIn(e.createdAt) === today),
  byDay.items[0],
);
eq('nothing tomorrow', (await owner.get(`/audit?from=2999-01-01`)).data?.total, 0);
const p2 = ok('page 2', await owner.get('/audit?pageSize=2&page=2'));
const p1 = ok('page 1', await owner.get('/audit?pageSize=2&page=1'));
check(
  'pages differ',
  p1.items.length === 2 && p2.items.every((e) => !p1.items.some((x) => x.id === e.id)),
);

// ------------------------------------------------------------------ aging
console.log('== aging of debts');
eq("sales staff can't see aging", (await karim.get('/analytics/aging')).status, 403);
ok('accountant can', await mona.get('/analytics/aging?side=suppliers'));
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `Aging ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);
const cust = ok(
  'customer',
  await owner.post('/parties', { name: `ACust ${tag}`, types: ['CUSTOMER'] }),
);
const supp = ok(
  'supplier',
  await owner.post('/parties', { name: `ASupp ${tag}`, types: ['SUPPLIER'] }),
);
const box = ok(
  'cash box',
  await owner.post('/money-accounts', {
    branchId: owner.user.branchId,
    name: `ABox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 100000,
  }),
);
const buy = ok(
  'buy 30 on credit',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 30, unitCost: 1000 }],
  }),
);
const sell = (qty, paid) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paidAmount: paid,
    paidAccountId: paid ? box.id : undefined,
    lines: [{ productId: item.id, quantity: qty, unitPrice: 2000 }],
  });
const inv1 = ok('sale 1: 5 × 20.00, 30.00 paid', await sell(5, 3000));
const inv2 = ok('sale 2: 3 × 20.00 on credit', await sell(3, 0));
const inv3 = ok('sale 3: 2 × 20.00 on credit', await sell(2, 0));
ok('sale 4: paid in full', await sell(1, 2000));
const row = async (side, id) =>
  (await owner.get(`/analytics/aging?side=${side}`)).data.rows.find((r) => r.partyId === id);
let a = await row('customers', cust.id);
eq('owed on open invoices', a?.total, 7000 + 6000 + 4000);
eq('all under 30 days', [a?.current, a?.days31To60, a?.days61To90, a?.over90], [17000, 0, 0, 0]);
eq('balance = party balance', a?.balance, (await owner.get(`/parties/${cust.id}`)).data?.balance);
eq('nothing on account', a?.onAccount, 0);
const sup = await row('suppliers', supp.id);
eq(
  'we owe the supplier (shown positive)',
  [sup?.total, sup?.balance, sup?.current],
  [30000, 30000, 30000],
);
check('customers not listed as suppliers', !(await row('suppliers', cust.id)));
const receipt = ok(
  'a payment on account (not tied to an invoice)',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 1000 }],
  }),
);
a = await row('customers', cust.id);
eq(
  'an unlinked payment settles the oldest invoice first',
  [a.balance, a.total, a.onAccount],
  [16000, 16000, 0],
);
const cust2 = ok(
  'customer 2',
  await owner.post('/parties', { name: `ACredit ${tag}`, types: ['CUSTOMER'] }),
);
ok(
  'customer 2 buys 1 on credit',
  await owner.post('/sales/invoices', {
    partyId: cust2.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 1, unitPrice: 2000 }],
  }),
);
check('customer 2 owes', (await row('customers', cust2.id))?.total === 2000);
ok(
  'and pays 50.00 on account',
  await owner.post('/receipts', {
    partyId: cust2.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 5000 }],
  }),
);
check('a customer in credit owes nothing', !(await row('customers', cust2.id)));
const all = ok('totals', await owner.get('/analytics/aging'));
eq(
  'totals add the rows',
  [all.current, all.total],
  [all.rows.reduce((s, r) => s + r.current, 0), all.rows.reduce((s, r) => s + r.total, 0)],
);
check(
  'largest debt first',
  all.rows.every((r, i, xs) => i === 0 || xs[i - 1].total >= r.total),
);
void receipt;
void buy;

if (process.env.PGURL) {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.PGURL });
  await db.connect();
  const back = (id, days) =>
    db.query(
      `update "SalesDocuments" set "IssueDate" = now() - ($2 || ' days')::interval where "Id" = $1`,
      [id, String(days)],
    );
  await back(inv1.id, 45);
  await back(inv2.id, 75);
  await back(inv3.id, 120);
  await db.end();
  a = await row('customers', cust.id);
  // Now the 120-day invoice is the oldest, so the unlinked 10.00 settles part of it instead.
  eq(
    'each invoice in its bucket',
    [a.current, a.days31To60, a.days61To90, a.over90],
    [0, 7000, 6000, 3000],
  );
  eq('same total', a.total, a.current + a.days31To60 + a.days61To90 + a.over90);
} else {
  console.log('  (PGURL not set: aging buckets past 30 days not checked)');
}

// ------------------------------------------------------------------ year-end close
console.log('== year-end close');
const thisYear = Number(companyToday().slice(0, 4));
const Y = thisYear - 1;
eq(
  'only a finished year',
  (await owner.post('/ledger/close-year', { year: thisYear })).data?.code,
  'bad_year',
);
eq("accountant can't close", (await mona.post('/ledger/close-year', { year: Y })).status, 403);
eq("sales staff can't see closed years", (await karim.get('/ledger/closed-years')).status, 403);
const closed0 = ok('closed years', await mona.get('/ledger/closed-years'));
if (closed0.length > 0) {
  console.log(
    `  (year ${closed0[0].year} is already closed on this database: close checks skipped)`,
  );
} else {
  ok('unlocked', await owner.put('/ledger/lock', { lockDate: null }));
  const accounts = (await owner.get('/ledger/accounts')).data;
  const byCode = (c) => accounts.find((x) => x.code === c);
  const capital = byCode('3101'),
    retained = byCode('3103'),
    other = byCode('4103'),
    shipping = byCode('5103');
  check('chart accounts found', capital && other && shipping && retained);
  const range = (y) => `from=${y}-01-01&to=${y}-12-31`;
  const before = ok(
    'earlier years',
    await owner.get(`/ledger/income-statement?from=${Y - 4}-01-01&to=${Y - 1}-12-31`),
  );
  if (before.revenue === 0 && before.expenses === 0 && before.cogs === 0)
    eq(
      'nothing to close in an empty year',
      (await owner.post('/ledger/close-year', { year: Y - 1 })).data?.code,
      'nothing_to_close',
    );
  ok(
    `a manual entry in ${Y}: other income 1000.00, shipping 300.00`,
    await owner.post('/ledger/entries', {
      date: `${Y}-06-15`,
      description: `Last year ${tag}`,
      lines: [
        { accountId: capital.id, debit: 70000 },
        { accountId: shipping.id, debit: 30000 },
        { accountId: other.id, credit: 100000 },
      ],
    }),
  );
  const isY = ok(
    'income statement of the year',
    await owner.get(`/ledger/income-statement?${range(Y)}`),
  );
  check('the year made a profit', isY.netProfit >= 70000, isY);
  const bs0 = ok('balance sheet before', await owner.get('/ledger/balance-sheet'));
  const rowOf = (b, code) => b.rows.find((r) => r.code === code)?.amount ?? 0;

  // Two owners press "close" at once: one closes, the other is told it's closed.
  const race = await Promise.all([
    owner.post('/ledger/close-year', { year: Y }),
    owner.post('/ledger/close-year', { year: Y }),
  ]);
  eq('one close wins', race.map((r) => r.status).sort(), [201, 400]);
  const done = race.find((r) => r.status === 201)?.data;
  eq('the other: already closed', race.find((r) => r.status === 400)?.data?.code, 'already_closed');
  eq('profit moved = the year’s profit', [done?.year, done?.netProfit], [Y, isY.netProfit]);
  eq(
    'no closing an earlier year now',
    (await owner.post('/ledger/close-year', { year: Y - 1 })).data?.code,
    'already_closed',
  );

  const list = ok('listed', await owner.get('/ledger/closed-years'));
  eq(
    'the closed year',
    [list[0]?.year, list[0]?.netProfit, !!list[0]?.closedByName],
    [Y, isY.netProfit, true],
  );
  const monaList = ok('the accountant sees it too', await mona.get('/ledger/closed-years'));
  eq('…without the profit (costs:view)', [monaList[0]?.year, monaList[0]?.netProfit], [Y, 0]);
  const isAfter = ok(
    'income statement after',
    await owner.get(`/ledger/income-statement?${range(Y)}`),
  );
  eq(
    'the year’s report is unchanged',
    [isAfter.revenue, isAfter.netProfit],
    [isY.revenue, isY.netProfit],
  );
  const tb = ok('trial balance of the year', await owner.get(`/ledger/trial-balance?${range(Y)}`));
  check(
    'revenue and expenses end the year at zero movement',
    tb.rows
      .filter((r) => r.type === 'REVENUE' || r.type === 'EXPENSE')
      .every((r) => r.periodDebit === r.periodCredit),
    tb.rows.filter(
      (r) => (r.type === 'REVENUE' || r.type === 'EXPENSE') && r.periodDebit !== r.periodCredit,
    ),
  );
  const bs1 = ok('balance sheet after', await owner.get('/ledger/balance-sheet'));
  eq('still balances', bs1.assets, bs1.liabilities + bs1.equity);
  eq('assets and equity unchanged', [bs1.assets, bs1.equity], [bs0.assets, bs0.equity]);
  eq('profit moved out of "profit to date"', bs0.profitToDate - bs1.profitToDate, isY.netProfit);
  eq(
    'into retained earnings',
    rowOf(bs1, retained.code) - rowOf(bs0, retained.code),
    isY.netProfit,
  );

  const journal = ok(
    'the closing entry',
    await owner.get(`/ledger/entries?from=${Y}-12-31&to=${Y}-12-31&source=YEAR_CLOSE`),
  );
  const entry = journal.items[0];
  eq(
    'one entry on 31 December',
    [journal.items.length, entry?.date.slice(0, 10)],
    [1, `${Y}-12-31`],
  );
  eq(
    'balanced',
    entry.lines.reduce((s, l) => s + l.debit, 0),
    entry.lines.reduce((s, l) => s + l.credit, 0),
  );
  eq('not reversible by hand', entry.reversible, false);
  eq(
    "can't be reversed",
    (await owner.post(`/ledger/entries/${entry.id}/reverse`)).data?.code,
    'not_manual',
  );

  console.log('== a closed year stays locked');
  eq('locked through 31 December', (await mona.get('/ledger/lock')).data?.lockDate, `${Y}-12-31`);
  eq(
    'no entry in the closed year',
    (
      await owner.post('/ledger/entries', {
        date: `${Y}-12-30`,
        description: 'late',
        lines: [
          { accountId: capital.id, debit: 1 },
          { accountId: other.id, credit: 1 },
        ],
      })
    ).data?.code,
    'period_locked',
  );
  eq(
    "can't unlock",
    (await owner.put('/ledger/lock', { lockDate: null })).data?.code,
    'year_closed',
  );
  eq(
    "can't move the lock into it",
    (await owner.put('/ledger/lock', { lockDate: `${Y}-06-30` })).data?.code,
    'year_closed',
  );
  eq(
    'the lock can stay on 31 December',
    (await owner.put('/ledger/lock', { lockDate: `${Y}-12-31` })).data?.lockDate,
    `${Y}-12-31`,
  );
  ok(
    'this year still takes entries',
    await owner.post('/ledger/entries', {
      date: today,
      description: `This year ${tag}`,
      lines: [
        { accountId: capital.id, debit: 100 },
        { accountId: other.id, credit: 100 },
      ],
    }),
  );
  const audit = ok('audited', await owner.get('/audit?action=close_year'));
  eq(
    'by the owner',
    [audit.items[0]?.resource, audit.items[0]?.actorId],
    ['ledger', owner.user.id],
  );
}

summary('admin');
