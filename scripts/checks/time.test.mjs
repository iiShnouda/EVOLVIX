// Company days (Settings → time zone, Africa/Cairo by default): "today", report periods, daily
// cash, statements, months, aging and the dashboard follow the company's clock, not UTC, daylight
// saving included. Moves a few documents to just before / after a company midnight (needs PGURL)
// and checks which day, month and aging bucket they land in; then switches the zone and back.
// Runs against BASE; can run again on the same database.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT: no settings:manage
const today = companyToday();
const yesterday = addDays(today, -1);

console.log('== the setting');
const s0 = ok('settings', await owner.get('/settings'));
eq('Cairo by default', s0.timeZone, 'Africa/Cairo');
eq(
  'an unknown zone is refused',
  (await owner.put('/settings', { timeZone: 'Mars/Olympus' })).data?.code,
  'bad_time_zone',
);
eq(
  'only the zones offered',
  (await owner.put('/settings', { timeZone: 'Asia/Tokyo' })).data?.code,
  'bad_time_zone',
);
eq("the accountant can't change it", (await mona.put('/settings', { timeZone: 'UTC' })).status, 403);
ok('saving other settings', await owner.put('/settings', { companyName: s0.companyName }));
eq('keeps the zone', (await owner.get('/settings')).data.timeZone, 'Africa/Cairo');

console.log('== today is the company’s day');
eq(
  'the attendance sheet opens on it',
  (await owner.get('/payroll/attendance')).data?.date,
  today,
);
eq(
  'no attendance for tomorrow',
  (await owner.put('/payroll/attendance', { date: addDays(today, 1), rows: [] })).data?.code,
  'bad_date',
);
const accounts = (await owner.get('/ledger/accounts')).data;
const capital = accounts.find((a) => a.code === '3101');
const other = accounts.find((a) => a.code === '4103');
const entry = (date) =>
  owner.post('/ledger/entries', {
    date,
    description: `Clock ${tag}`,
    lines: [
      { accountId: capital.id, debit: 100 },
      { accountId: other.id, credit: 100 },
    ],
  });
eq('a manual entry dated tomorrow is refused', (await entry(addDays(today, 1))).data?.code, 'bad_date');
const e1 = ok('a manual entry dated today', await entry(today));
eq('dated the company’s today', e1?.date?.slice(0, 10), today);

console.log('== odd days are held, not crashed on');
eq('nothing in the far future', (await owner.get('/audit?from=2999-01-01')).data?.total, 0);
for (const q of [
  '/ledger/trial-balance?from=0001-01-01&to=0001-12-31',
  '/ledger/balance-sheet?asOf=9999-12-31',
  '/reports/profitability?from=0001-01-01&to=9999-12-31',
  '/analytics/top-parties?from=9999-12-31',
  '/inventory/valuation?asOf=0001-01-01',
  '/transfers?from=0001-01-01&to=9999-12-31',
])
  eq(`answers ${q.split('?')[0]}`, (await owner.get(q)).status, 200);

if (!process.env.PGURL) {
  console.log('  (PGURL not set: documents near midnight not checked)');
  process.exit(summary('time') ? 1 : 0);
}

const { default: pg } = await import('pg');
const db = new pg.Client({ connectionString: process.env.PGURL });
await db.connect();
/** The instant a company (Cairo) day starts, plus some minutes. */
const midnight = async (day, minutes) =>
  (
    await db.query(
      `select ($1::date::timestamp at time zone 'Africa/Cairo') + ($2 || ' minutes')::interval as t`,
      [day, String(minutes)],
    )
  ).rows[0].t;
const moveDoc = async (id, at) => {
  await db.query(`update "SalesDocuments" set "IssueDate" = $2 where "Id" = $1`, [id, at]);
  await db.query(`update "JournalEntries" set "Date" = $2 where "SourceId" = $1`, [id, at]);
};

// Goods, parties, a cash box.
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
    name: `Clock ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 3000 }],
  }),
);
const supp = ok('supplier', await owner.post('/parties', { name: `TSupp ${tag}`, types: ['SUPPLIER'] }));
const c1 = ok('customer 1', await owner.post('/parties', { name: `TCust1 ${tag}`, types: ['CUSTOMER'] }));
const c2 = ok('customer 2', await owner.post('/parties', { name: `TCust2 ${tag}`, types: ['CUSTOMER'] }));
ok(
  'buy 40',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 40, unitCost: 1000 }],
  }),
);
const sell = async (party, price) =>
  ok(
    `sell at ${price}`,
    await owner.post('/sales/invoices', {
      partyId: party.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: item.id, quantity: 1, unitPrice: price }],
    }),
  );

// ------------------------------------------------------------------ days, with daylight saving
console.log('== days, with daylight saving');
// Egypt: UTC+2 in winter, UTC+3 from the last Friday of April (clocks jump 00:00 → 01:00) to the
// last Thursday of October (24:00 → 23:00).
const placed = [
  ['2024-01-15T21:30:00Z', 1100, '2024-01-15'], // 23:30 in winter
  ['2024-01-15T22:30:00Z', 1200, '2024-01-16'], // 00:30 the next day (a UTC day would say the 15th)
  ['2024-07-01T21:30:00Z', 1300, '2024-07-02'], // 00:30 in summer (+2 would say the 1st)
  ['2024-04-25T21:50:00Z', 1400, '2024-04-25'], // 23:50, just before the clocks jump
  ['2024-04-25T22:10:00Z', 1500, '2024-04-26'], // 01:10, just after (the 26th has no 00:xx)
  ['2024-10-31T21:30:00Z', 1600, '2024-10-31'], // 23:30 again, after the clocks fall back
  ['2024-10-31T22:05:00Z', 1700, '2024-11-01'], // 00:05 the next day
];
const days = [...new Set(placed.map((p) => p[2]).concat(['2024-07-01']))].sort();
const byDay = async () =>
  Object.fromEntries(
    (await owner.get('/reports/profitability?from=2024-01-01&to=2024-12-31&by=day')).data.rows.map(
      (r) => [r.key, r.revenue],
    ),
  );
const dayBefore = await byDay();
for (const [at, price] of placed) await moveDoc((await sell(c1, price)).id, at);
const custOn = async (day, party = c1) =>
  (await owner.get(`/reports/profitability?from=${day}&to=${day}&by=customer`)).data.rows.find(
    (r) => r.key === party.id,
  )?.revenue ?? 0;
for (const day of days) {
  const expected = placed.filter((p) => p[2] === day).reduce((s, p) => s + p[1], 0);
  eq(`the ${day} holds its sales`, await custOn(day), expected);
}
const report = ok(
  'a period',
  await owner.get(`/reports/profitability?from=2024-04-26&to=2024-10-31&by=customer`),
);
eq('the period echoes its days', [report.from, report.to], ['2024-04-26', '2024-10-31']);
eq(
  'from the jump to the fall back',
  report.rows.find((r) => r.key === c1.id)?.revenue,
  1500 + 1300 + 1600,
);
const dayAfter = await byDay();
for (const day of days) {
  const expected = placed.filter((p) => p[2] === day).reduce((s, p) => s + p[1], 0);
  eq(
    `grouped by day: the ${day}`,
    (dayAfter[day] ?? 0) - (dayBefore[day] ?? 0),
    expected,
  );
}

// ------------------------------------------------------------------ months and the dashboard
console.log('== months and the dashboard');
const month = today.slice(0, 7);
const firstOfMonth = `${month}-01`;
const lastMonth = addDays(firstOfMonth, -1).slice(0, 7);
const monthly = async () =>
  Object.fromEntries(
    (await owner.get('/analytics/monthly?months=3')).data.map((m) => [m.month, m.sales]),
  );
const m8 = await sell(c1, 1800);
const m0 = await monthly();
await moveDoc(m8.id, await midnight(firstOfMonth, -10));
const m1 = await monthly();
eq('10 minutes before the month: last month', [m1[lastMonth] - m0[lastMonth], m1[month] - m0[month]], [1800, -1800]);
await moveDoc(m8.id, await midnight(firstOfMonth, 10));
const m2 = await monthly();
eq('10 minutes into it: this month', [m2[lastMonth] - m0[lastMonth], m2[month] - m0[month]], [0, 0]);

const trend = async () =>
  Object.fromEntries((await owner.get('/dashboard')).data.trend.map((p) => [p.date, p.sales]));
const t9 = await sell(c1, 1900);
const t0 = await trend();
eq('the dashboard’s last day is today', Object.keys(t0).sort().at(-1), today);
await moveDoc(t9.id, await midnight(today, -10));
const t1 = await trend();
eq('10 minutes before midnight: yesterday', [t1[yesterday] - t0[yesterday], t1[today] - t0[today]], [1900, -1900]);
await moveDoc(t9.id, await midnight(today, 10));
const t2 = await trend();
eq('10 minutes after: today', [t2[yesterday] - t0[yesterday], t2[today] - t0[today]], [0, 0]);

// ------------------------------------------------------------------ aging and the statement
console.log('== aging and the customer statement');
const a1 = await sell(c2, 2100);
const a2 = await sell(c2, 2200);
const d30 = addDays(today, -30);
const d31 = addDays(today, -31);
await moveDoc(a1.id, await midnight(d30, 10)); // 30 days old in Cairo (31 in UTC)
await moveDoc(a2.id, await midnight(d30, -10)); // 31 days old
const agingRow = (await owner.get('/analytics/aging')).data.rows.find((r) => r.partyId === c2.id);
eq(
  'aged by the company’s days',
  [agingRow?.current, agingRow?.days31To60, agingRow?.total],
  [2100, 2200, 4300],
);
const stmt = async (from, to) =>
  (await owner.get(`/ledger/parties/${c2.id}/statement?from=${from}&to=${to}`)).data;
const sA = await stmt(d31, d31);
eq('the 31st day back: the older sale', [sA.opening, sA.totalDebit, sA.lines.length], [0, 2200, 1]);
const sB = await stmt(d30, d30);
eq('the 30th: the other', [sB.opening, sB.totalDebit, sB.closing], [2200, 2100, 4300]);
const sC = await stmt(addDays(today, -29), today);
eq('since then: nothing new', [sC.opening, sC.totalDebit, sC.closing], [4300, 0, 4300]);

// ------------------------------------------------------------------ the daily cash
console.log('== the daily cash');
const box = ok(
  'a cash box',
  await owner.post('/money-accounts', {
    branchId: owner.user.branchId,
    name: `TBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 0,
  }),
);
ok(
  'a receipt of 5.00',
  await owner.post('/receipts', {
    partyId: c1.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 500 }],
  }),
);
const cash = async (q = '') => (await owner.get(`/money-accounts/${box.id}/movements${q}`)).data;
const cash0 = await cash();
eq('today by default', [cash0.from, cash0.to, cash0.totalIn], [today, today, 500]);
await db.query(`update "MoneyMovements" set "CreatedAt" = $2 where "AccountId" = $1`, [
  box.id,
  await midnight(today, -10),
]);
const cash1 = await cash(`?from=${today}&to=${today}`);
eq('moved before midnight: not today', [cash1.opening, cash1.totalIn, cash1.movements.length], [500, 0, 0]);
const cash2 = await cash(`?from=${yesterday}&to=${yesterday}`);
eq('but yesterday', [cash2.opening, cash2.totalIn, cash2.closing], [0, 500, 500]);

// ------------------------------------------------------------------ the item card and valuation
console.log('== the item card and valuation');
const stockItem = ok(
  'a second item',
  await owner.post('/products', {
    name: `Clock2 ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 3000 }],
  }),
);
ok(
  'buy 5',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: stockItem.id, quantity: 5, unitCost: 1000 }],
  }),
);
await db.query(`update "StockMovements" set "CreatedAt" = $2 where "ProductId" = $1`, [
  stockItem.id,
  await midnight(today, -10),
]);
const card = async (from, to) =>
  (await owner.get(`/inventory/items/${stockItem.id}/card?from=${from}&to=${to}`)).data;
const k1 = await card(today, today);
eq('today: bought before it began', [k1.from, k1.openingBalance, k1.totalIn, k1.closingBalance], [today, 5, 0, 5]);
const k2 = await card(yesterday, yesterday);
eq('yesterday: bought that day', [k2.openingBalance, k2.totalIn, k2.movements.length], [0, 5, 1]);
const valued = async (asOf) =>
  (await owner.get(`/inventory/valuation?asOf=${asOf}`)).data.items.find((r) => r.key === stockItem.id)?.quantity ?? 0;
eq('valued at the end of yesterday', await valued(yesterday), 5);
eq('not the day before', await valued(addDays(today, -2)), 0);

// ------------------------------------------------------------------ another zone
console.log('== another time zone');
// 20:30 UTC on 1 July 2024 is 23:30 in Cairo, 00:30 on the 2nd in Dubai (UTC+4, no summer time).
const z = await sell(c1, 2500);
await moveDoc(z.id, '2024-07-01T20:30:00Z');
const julyFirst = async () => [await custOn('2024-07-01'), await custOn('2024-07-02')];
eq('in Cairo: the 1st', await julyFirst(), [2500, 1300]);
/** Every day grouped in SQL must equal the day asked for on its own. */
const agrees = async (label) => {
  const grouped = (await owner.get('/reports/profitability?from=2024-01-01&to=2024-12-31&by=day')).data.rows;
  const single = await Promise.all(
    grouped.map(async (r) => (await owner.get(`/reports/profitability?from=${r.key}&to=${r.key}`)).data.revenue),
  );
  eq(`${label}: each grouped day = that day alone`, grouped.map((r) => r.revenue), single);
};
await agrees('Cairo');
try {
  eq('switch to Dubai', (await owner.put('/settings', { timeZone: 'Asia/Dubai' })).data?.timeZone, 'Asia/Dubai');
  eq('in Dubai: the 2nd', await julyFirst(), [0, 3800]);
  await agrees('Dubai');
  ok('switch to UTC', await owner.put('/settings', { timeZone: 'UTC' }));
  eq('in UTC: the 1st, with the 00:30 one', await julyFirst(), [3800, 0]);
  await agrees('UTC');
} finally {
  eq('back to Cairo', (await owner.put('/settings', { timeZone: 'Africa/Cairo' })).data?.timeZone, 'Africa/Cairo');
}
eq('Cairo again', await julyFirst(), [2500, 1300]);
check('audit logged the change', (await owner.get('/audit?resource=settings&pageSize=5')).data.items.length > 0);

await db.end();
process.exit(summary('time') ? 1 : 0);
