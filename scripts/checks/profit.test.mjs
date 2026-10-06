// Gains, losses and net profit by company, branch, warehouse and the main box's general expenses
// (GET /analytics/profit-loss): they add up, they match the ledger, expenses land where they were paid.
import { login, ok, check, eq, summary, companyToday } from './lib.mjs';

const o = await login('owner@skb.local');
const karim = await login('karim@skb.local');
const today = companyToday();
const from = today.slice(0, 8) + '01';
const q = `from=${from}&to=${today}`;
const sum = (xs, k) => xs.reduce((s, x) => s + x.figures[k], 0);
const keys = ['netSales', 'cogs', 'grossProfit', 'otherIncome', 'expenses', 'netProfit'];

check(
  'sales person may not see profit',
  (await karim.get(`/analytics/profit-loss?${q}`)).status === 403,
);
const before = ok('profit-loss', await o.get(`/analytics/profit-loss?${q}`));
const income = ok('income statement', await o.get(`/ledger/income-statement?${q}`));
eq('net profit = income statement', before.total.netProfit, income.netProfit);
// The income statement counts other income in its gross profit; here it stays apart.
eq(
  'gross profit + other income = income statement',
  before.total.grossProfit + before.total.otherIncome,
  income.grossProfit,
);
for (const k of keys)
  eq(
    `branches + general = total (${k})`,
    sum(before.branches, k) + (before.general?.[k] ?? 0),
    before.total[k],
  );
for (const b of before.branches)
  for (const k of keys)
    eq(`${b.name}: its rows add up (${k})`, sum(b.children ?? [], k), b.figures[k]);
eq(
  'general shares add up',
  before.branches.reduce((s, b) => s + b.generalShare, 0),
  -(before.general?.netProfit ?? 0),
);

// An expense from a warehouse's own box lands on that warehouse; from the main box, on general.
const accounts = ok('accounts', await o.get('/money-accounts'));
const list = accounts.items ?? accounts;
const main = list.find((a) => a.isMain);
const box = list.find((a) => a.warehouseId && a.isActive && a.kind === 'CASH_BOX');
const cats = ok('categories', await o.get('/expense-categories'));
const cat = (cats.items ?? cats).find((c) => c.isActive);
check('has main box, warehouse box and a category', !!main && !!box && !!cat);
// Money moved from the main box to a warehouse's box is neither a gain nor a loss.
ok(
  'main → warehouse box',
  await o.post('/cash-transfers', { fromAccountId: main.id, toAccountId: box.id, amount: 500 }),
);
const moved = ok('profit-loss after moving money', await o.get(`/analytics/profit-loss?${q}`));
eq('moving money changes no profit', moved.total.netProfit, before.total.netProfit);
ok(
  'expense from warehouse box',
  await o.post('/expenses', {
    categoryId: cat.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 300 }],
  }),
);
if (main.balance >= 1200)
  ok(
    'expense from main box',
    await o.post('/expenses', {
      categoryId: cat.id,
      lines: [{ method: 'CASH', accountId: main.id, amount: 700 }],
    }),
  );
const after = ok('profit-loss after', await o.get(`/analytics/profit-loss?${q}`));
const wh = (r) => r.branches.flatMap((b) => b.children ?? []).find((c) => c.id === box.warehouseId);
eq('warehouse expenses +300', wh(after).figures.expenses - wh(before).figures.expenses, 300);
if (main.balance >= 1200)
  eq('general expenses +700', after.general.expenses - before.general.expenses, 700);
eq(
  'total net profit down by the expenses',
  before.total.netProfit - after.total.netProfit,
  main.balance >= 1200 ? 1000 : 300,
);
const income2 = ok('income statement after', await o.get(`/ledger/income-statement?${q}`));
eq('still = income statement', after.total.netProfit, income2.netProfit);
check(
  'detail lines have gains and losses',
  after.lines.some((l) => l.section === 'SALES') && after.lines.some((l) => l.section === 'LOSS'),
);
summary('profit');
