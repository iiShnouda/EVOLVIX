// Cash boxes up the chain (owner, 2026-10-02): every warehouse has its own box, handed up to its
// branch's box, and each branch's box to the company's main box. Cash sent up is held in the box
// until someone holding the next box confirms it arrived (then it moves as a transfer), or either
// side calls it off. A manager may still just pull money from a box. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT in the main branch, sees every branch
const accounts = async (who = owner) => (await who.get('/money-accounts')).data;
const main = (await accounts()).find((a) => a.isMain);
check('there is a main cash box', !!main && main.kind === 'CASH_BOX', main);

console.log('== a new branch: its box and its store\'s box');
const branch = ok('a branch', await owner.post('/branches', { name: `Hand ${tag}`, code: `HN${tag}`.toUpperCase().slice(0, 10) }));
const mine = (await accounts()).filter((a) => a.branchId === branch.id);
const box = mine.find((a) => a.isDefault);
const storeBox = mine.find((a) => a.warehouseId);
check('the branch has its box', !!box, mine);
check("…and its store's own box", !!storeBox && storeBox.kind === 'CASH_BOX', mine);
eq("the store's box goes up to the branch's", storeBox.upToId, box.id);
eq("the branch's box goes up to the main box", box.upToId, main.id);
eq('the main box goes nowhere', main.upToId ?? null, null);
const wh = ok('another warehouse', await owner.post('/warehouses', { branchId: branch.id, name: `Back store ${tag}` }));
const whBox = (await accounts()).find((a) => a.warehouseId === wh.id);
check('…gets its own box too', !!whBox && whBox.name.startsWith('Back store'), whBox);
eq(
  'one box per warehouse',
  (await owner.post('/money-accounts', { name: `Second ${tag}`, kind: 'CASH_BOX', branchId: branch.id, warehouseId: wh.id })).data?.code,
  'warehouse_has_box',
);
ok('money in the store box', await owner.put(`/money-accounts/${storeBox.id}`, { openingBalance: 50000 }));

console.log('== the store keeper sends it up');
const staff = async (role, email) => {
  const s = ok(`a ${role}`, await owner.post('/staff', { fullName: `${role} ${tag}`, email, password: 'Str0ngPass!', role, branchId: branch.id }));
  ok('…in that branch only', await owner.put(`/staff/${s.id}/access`, { allBranches: false, branchIds: [] }));
  return s;
};
await staff('INVENTORY', `keep.${tag}@skb.local`);
await staff('ACCOUNTANT', `boss.${tag}@skb.local`);
const keeper = await login(`keep.${tag}@skb.local`, 'Str0ngPass!');
const manager = await login(`boss.${tag}@skb.local`, 'Str0ngPass!');
const boxes = ok("the keeper's boxes", await keeper.get('/cash-handovers/boxes'));
check('their store box is there, going to the branch', boxes.some((b) => b.id === storeBox.id && b.upToId === box.id), boxes);
check('nothing of another branch', boxes.every((b) => b.branchId === branch.id), boxes);
eq('not more than it holds', (await keeper.post('/cash-handovers', { fromAccountId: storeBox.id, amount: 60000 })).data?.code, 'insufficient_funds');
eq('not nothing', (await keeper.post('/cash-handovers', { fromAccountId: storeBox.id, amount: 0 })).data?.code, 'bad_amount');
const h1 = ok('send 300', await keeper.post('/cash-handovers', { fromAccountId: storeBox.id, amount: 30000, notes: 'Friday cash' }));
eq('on its way', h1.status, 'SENT');
eq('to the branch box', h1.toAccountId, box.id);
check('numbered', /^HND-\d{4}-\d+$/.test(h1.number), h1.number);
let sb = (await accounts()).find((a) => a.id === storeBox.id);
eq('still in the box…', sb.balance, 50000);
eq('…but held', sb.held, 30000);
eq('only the rest can be sent', (await keeper.post('/cash-handovers', { fromAccountId: storeBox.id, amount: 20001 })).data?.code, 'insufficient_funds');
eq(
  "held cash can't be spent",
  (await owner.post('/cash-transfers', { fromAccountId: storeBox.id, toAccountId: box.id, amount: 25000 })).data?.code,
  'insufficient_funds',
);
ok('a manager pulls 50 without asking', await owner.post('/cash-transfers', { fromAccountId: storeBox.id, toAccountId: box.id, amount: 5000 }));
eq("the keeper can't confirm it", (await keeper.post(`/cash-handovers/${h1.id}/receive`)).status, 403);

console.log('== the branch manager confirms it arrived');
const told = (await manager.get('/notifications')).data.items.find((n) => n.documentId === h1.id);
check('the manager was told', told?.kind === 'CASH_SENT' && told.amount === 30000, told);
const karim = await login('karim@skb.local'); // SALES: may not confirm cash
check('sales staff were not', !(await karim.get('/notifications')).data.items.some((n) => n.documentId === h1.id));
const inbox = ok('cash coming in', await manager.get('/cash-handovers?side=in&status=SENT'));
check('…lists it, to be confirmed', inbox.some((h) => h.id === h1.id && h.canReceive), inbox);
const r1 = ok('arrived', await manager.post(`/cash-handovers/${h1.id}/receive`));
eq('received', r1.status, 'RECEIVED');
check('moved by a transfer voucher', !!r1.voucherNumber, r1);
eq('only once', (await manager.post(`/cash-handovers/${h1.id}/receive`)).data?.code, 'already_done');
sb = (await accounts()).find((a) => a.id === storeBox.id);
eq('the store box: 500 − 50 − 300', sb.balance, 15000);
eq('nothing held now', sb.held, 0);
let bb = (await accounts()).find((a) => a.id === box.id);
eq('the branch box: 50 + 300', bb.balance, 35000);
check(
  'the keeper hears it arrived',
  (await keeper.get('/notifications')).data.items.some((n) => n.documentId === h1.id && n.kind === 'CASH_RECEIVED'),
);

console.log('== the branch sends up to the main box');
const mainBefore = (await accounts()).find((a) => a.id === main.id).balance;
const h2 = ok('send 350 up', await manager.post('/cash-handovers', { fromAccountId: box.id, amount: 35000 }));
eq('to the main box', h2.toAccountId, main.id);
eq("the branch manager can't confirm the main box's", (await manager.post(`/cash-handovers/${h2.id}/receive`)).status, 404);
check(
  'the main box holder was told',
  (await mona.get('/notifications')).data.items.some((n) => n.documentId === h2.id && n.kind === 'CASH_SENT'),
);
const c2 = ok("it didn't come: called off", await mona.post(`/cash-handovers/${h2.id}/cancel`, { reason: 'Not here' }));
eq('cancelled', c2.status, 'CANCELLED');
eq("…and can't arrive after", (await mona.post(`/cash-handovers/${h2.id}/receive`)).data?.code, 'already_done');
bb = (await accounts()).find((a) => a.id === box.id);
eq('free to use again', bb.held, 0);
check(
  'the sender hears why',
  (await manager.get('/notifications')).data.items.some((n) => n.documentId === h2.id && n.kind === 'CASH_CANCELLED' && n.message === 'Not here'),
);
const h3 = ok('sent again', await manager.post('/cash-handovers', { fromAccountId: box.id, amount: 35000 }));
ok('arrived at the main box', await mona.post(`/cash-handovers/${h3.id}/receive`));
eq('the main box got it', (await accounts()).find((a) => a.id === main.id).balance, mainBefore + 35000);
eq('the main box sends nowhere', (await owner.post('/cash-handovers', { fromAccountId: main.id, amount: 100 })).data?.code, 'nowhere_to_send');
const bank = (await accounts()).find((a) => a.kind === 'BANK');
if (bank) eq('a bank account is not handed over', (await owner.post('/cash-handovers', { fromAccountId: bank.id, amount: 100 })).data?.code, 'nowhere_to_send');

console.log('== the sender may call it off');
const h4 = ok('send 10', await keeper.post('/cash-handovers', { fromAccountId: storeBox.id, amount: 1000 }));
ok('changed their mind', await keeper.post(`/cash-handovers/${h4.id}/cancel`, {}));
eq('held released', (await accounts()).find((a) => a.id === storeBox.id).held, 0);
const outbox = ok("the keeper's list", await keeper.get('/cash-handovers?side=out'));
check('…shows theirs', outbox.some((h) => h.id === h1.id) && outbox.some((h) => h.id === h4.id && h.status === 'CANCELLED'));
eq("sales staff see none of it", (await karim.get('/cash-handovers')).status, 403);
eq("a box cash went through can't be deleted", (await owner.del(`/money-accounts/${storeBox.id}`)).data?.code, 'in_use');

console.log('== the owner picks the main box');
const other = ok('another cash box', await owner.post('/money-accounts', { name: `Safe ${tag}`, kind: 'CASH_BOX', branchId: owner.user.branchId }));
eq("an accountant can't make it the main", (await mona.put(`/money-accounts/${other.id}`, { isMain: true })).status, 403);
ok('the owner makes it the main', await owner.put(`/money-accounts/${other.id}`, { isMain: true }));
let all = await accounts();
eq('only one main box', all.filter((a) => a.isMain).map((a) => a.id), [other.id]);
eq('branch boxes now go up to it', all.find((a) => a.id === box.id).upToId, other.id);
eq("can't close the main box", (await owner.put(`/money-accounts/${other.id}`, { isActive: false })).data?.code, 'is_main');
eq("can't delete it", (await owner.del(`/money-accounts/${other.id}`)).data?.code, 'is_main');
ok('back as it was', await owner.put(`/money-accounts/${main.id}`, { isMain: true }));
eq('the main box again', (await accounts()).filter((a) => a.isMain).map((a) => a.id), [main.id]);
ok('the spare box removed', await owner.del(`/money-accounts/${other.id}`), [204]);

summary('handovers');
