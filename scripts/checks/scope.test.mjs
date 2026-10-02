// "All branches" is only the branches a person may open (owner, 2026-10-02): someone working in
// one branch sees that branch's documents, money, warehouses and the branch itself — never another
// branch's, whatever filter they pick. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const main = owner.user.branchId;
const other = ok('another branch', await owner.post('/branches', { name: `Scope ${tag}`, code: `SC${tag}`.toUpperCase().slice(0, 10) }));
const there = owner.at(other.id);
const cust = ok('a customer', await owner.post('/parties', { name: `ScopeCust ${tag}`, types: ['CUSTOMER'], address: 'Cairo' }));
const boxThere = (await owner.get('/money-accounts')).data.find((a) => a.branchId === other.id && a.kind === 'CASH_BOX');
const r = ok(
  'money taken in the other branch',
  await there.post('/receipts', { partyId: cust.id, lines: [{ method: 'CASH', accountId: boxThere.id, amount: 700 }] }),
);

const person = ok(
  'an accountant who works in the main branch only',
  await owner.post('/staff', { fullName: `One ${tag}`, email: `one.${tag}@skb.local`, password: 'Str0ngPass!', role: 'ACCOUNTANT', branchId: main }),
);
ok('…only there', await owner.put(`/staff/${person.id}/access`, { allBranches: false, branchIds: [] }));
ok('…and may see branches', await owner.put(`/staff/${person.id}/permissions`, { granted: ['branches:view'] }));
const one = await login(`one.${tag}@skb.local`, 'Str0ngPass!');

const branches = ok('branches', await one.get('/branches'));
eq('only their branch', branches.map((b) => b.id), [main]);
const warehouses = ok('warehouses', await one.get('/warehouses'));
check('only their warehouses', warehouses.every((w) => w.branchId === main), warehouses.map((w) => w.branchName));
const accounts = ok('money accounts', await one.get('/money-accounts'));
check('only their accounts', accounts.every((a) => a.branchId === main));
const vouchers = ok('vouchers, all branches', await one.get('/vouchers?pageSize=100'));
check("not the other branch's receipt", !JSON.stringify(vouchers).includes(r.number));
const filtered = ok('vouchers of the other branch', await one.get(`/vouchers?branchId=${other.id}&pageSize=100`));
check('still nothing of it', !JSON.stringify(filtered).includes(r.number));
const sales = ok('sales of the other branch', await one.get(`/sales/invoices?branchId=${other.id}`));
eq('none', sales.items.length, 0);
eq("can't work in the other branch", (await one.at(other.id).post('/receipts', { partyId: cust.id, lines: [{ method: 'CASH', accountId: boxThere.id, amount: 1 }] })).status >= 400, true);
const ownerBranches = ok("the owner's branches", await owner.get('/branches'));
check('the owner sees both', ownerBranches.some((b) => b.id === other.id) && ownerBranches.some((b) => b.id === main));

summary('scope');
