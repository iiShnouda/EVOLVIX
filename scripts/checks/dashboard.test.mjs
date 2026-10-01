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

console.log('== branch, warehouse and department in the searches');
const branches = (await owner.get('/branches')).data;
const main = owner.user.branchId;
const all2 = ok('all items', await owner.get('/inventory/items'));
const inMain = ok('one branch', await owner.get(`/inventory/items?branchId=${main}`));
check('a branch holds no more than everywhere', inMain.items.reduce((s, i) => s + Math.max(0, i.stockOnHand), 0) <= all2.items.reduce((s, i) => s + Math.max(0, i.stockOnHand), 0) || all2.items.length >= 500);
const dept = (await owner.get('/departments')).data.find((d) => d.isActive && d.itemCount > 0);
if (dept) {
  const ofDept = ok('one department', await owner.get(`/inventory/items?departmentId=${dept.id}`));
  check('only that department', ofDept.totalItems <= all2.totalItems && ofDept.totalItems > 0, [ofDept.totalItems, all2.totalItems]);
}
eq("someone else's branch is refused", (await karim.get(`/inventory/items?branchId=${branches.find((b) => b.id !== karim.user.branchId)?.id}`)).status, 404);
const vouchers = ok('vouchers of one branch', await owner.get(`/vouchers?branchId=${main}`));
const mainName = branches.find((b) => b.id === main).name;
check('all from that branch', vouchers.items.every((v) => v.branchName === mainName), vouchers.items.slice(0, 2));

process.exit(summary('dashboard') ? 1 : 0);
