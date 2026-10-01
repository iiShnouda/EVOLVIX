// The dashboard's other widgets (owner, 2026-10-01): each part only for those who may see it.
import { login, check, eq, ok, summary } from './lib.mjs';

const owner = await login('owner@skb.local');
const karim = await login('karim@skb.local'); // SALES

const all = ok('owner sees everything', await owner.get('/dashboard/more'));
check('today, month, rankings', all.today && all.month && Array.isArray(all.topCustomers) && Array.isArray(all.topItems), all);
check('profit and stock value at cost', all.month.profit != null && all.stockValue != null, all.month);
check('money, cheques, approvals', Array.isArray(all.accounts) && all.notesDue && all.awaitingApproval != null, all);
check('at most 8 branches', all.branches.length <= 8, all.branches.length);
eq('net sales today add up', all.today.sales >= -all.today.returns, true);

const sales = ok('sales staff', await karim.get('/dashboard/more'));
eq('no profit or stock value for them', [sales.month?.profit ?? null, sales.stockValue], [null, null]);
eq('no money accounts or cheques', [sales.accounts, sales.notesDue], [null, null]);
eq('no approvals count', sales.awaitingApproval, null);

process.exit(summary('dashboard') ? 1 : 0);
