// A person's money access (owner, 2026-11-10): no cash box at all, or a cash box with only the
// last days of what went through it — in statements, vouchers, handovers and cheques — holding
// from their next request; nobody gives more than they have. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASSWORD = `Money-${tag}-Check1`;
const owner = await login('owner@skb.local');
const today = companyToday();
const day = (n) => addDays(today, n);
const branchId = owner.user.branchId;
const box = ok(
  'box',
  await owner.post('/money-accounts', {
    branchId,
    name: `MBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 100000,
  }),
);
const cust = ok(
  'customer',
  await owner.post('/parties', { name: `MCust ${tag}`, types: ['CUSTOMER'] }),
);
const receipt = (who, amount, extra = {}) =>
  who.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: box.id, amount }],
    ...extra,
  });
const old = ok('receipt 60 days ago', await receipt(owner, 1000, { documentDate: day(-60) }));
const recent = ok('receipt 5 days ago', await receipt(owner, 2000, { documentDate: day(-5) }));
const oldCheque = ok(
  'a cheque',
  await owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: `M1${tag}`,
    amount: 500,
    dueDate: day(30),
  }),
);
const doneCheque = ok(
  'another, cancelled',
  await owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: `M2${tag}`,
    amount: 700,
    dueDate: day(30),
  }),
);
ok('cancel it', await owner.post(`/notes/${doneCheque.id}/cancel`, {}));

const person = ok(
  'a cashier',
  await owner.post('/staff', {
    fullName: `Cashier ${tag}`,
    email: `cashier-${tag}@skb.local`,
    password: PASSWORD,
    role: 'ACCOUNTANT',
    branchId,
  }),
);
const access = (body) =>
  owner.put(`/staff/${person.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    ...body,
  });
let p = await login(person.email, PASSWORD);

console.log('== everything, as before');
eq(
  'sees the box',
  (await p.get('/money-accounts')).data.some((a) => a.id === box.id),
  true,
);
eq('and its old voucher', (await p.get(`/vouchers/${old.id}`)).status, 200);

console.log('== no money accounts at all');
let r = ok('none', await access({ noMoneyAccounts: true }));
eq('kept on the person', [r.noMoneyAccounts, r.moneyAccountIds], [true, []]);
eq('no account is listed, at once', (await p.get('/money-accounts')).data, []);
eq('no statement', (await p.get(`/money-accounts/${box.id}/movements`)).status, 404);
eq('cannot take money into the box', (await receipt(p, 100)).data?.code, 'account_not_found');
p = await login(person.email, PASSWORD);
eq('their sign-in says so', p.user.moneyAccountIds, []);
const box2 = ok(
  'a new box',
  await owner.post('/money-accounts', { branchId, name: `MBox2 ${tag}`, kind: 'CASH_BOX' }),
);
eq('a new box does not reach them', (await p.get('/money-accounts')).data, []);
eq(
  'still none on the record',
  (await owner.get('/staff')).data.find((s) => s.id === person.id).noMoneyAccounts,
  true,
);

console.log('== a box, with the last 30 days only');
eq(
  'a bad number of days',
  (await access({ moneyAccountIds: [box.id], moneyHistoryDays: 0 })).data?.code,
  'bad_history_days',
);
r = ok('one box, 30 days', await access({ moneyAccountIds: [box.id], moneyHistoryDays: 30 }));
eq('kept', [r.noMoneyAccounts, r.moneyHistoryDays, r.moneyAccountIds], [false, 30, [box.id]]);
p = await login(person.email, PASSWORD);
eq('in the sign-in', p.user.moneyHistoryDays, 30);
const boxes = (await p.get('/money-accounts')).data;
eq(
  'only that box',
  boxes.map((a) => a.id),
  [box.id],
);
eq(
  'what it holds now still shows',
  boxes[0].balance,
  (await owner.get('/money-accounts')).data.find((a) => a.id === box.id).balance,
);
let st = ok(
  'statement asked from 90 days ago',
  await p.get(`/money-accounts/${box.id}/movements?from=${day(-90)}&to=${today}`),
);
eq('starts 30 days ago', [st.from, st.earliest], [day(-30), day(-30)]);
check('the old receipt is not listed', !st.movements.some((m) => m.reference === old.number));
check(
  'the recent one is',
  st.movements.some((m) => m.reference === recent.number),
);
eq('the balance before it counts the old receipt', st.opening, 1000);
eq('closing = the balance', st.closing, boxes[0].balance);
st = ok(
  'a period wholly before',
  await p.get(`/money-accounts/${box.id}/movements?from=${day(-90)}&to=${day(-50)}`),
);
eq('is the first day they see', [st.from, st.to, st.movements.length], [day(-30), day(-30), 0]);
const list = (await p.get('/vouchers?pageSize=100')).data.items.map((v) => v.id);
check('vouchers: recent, not old', list.includes(recent.id) && !list.includes(old.id));
eq('the old voucher is not found', (await p.get(`/vouchers/${old.id}`)).status, 404);
eq('nor cancelled', (await p.post(`/vouchers/${old.id}/cancel`, {})).status, 404);
eq('the owner still sees it', (await owner.get(`/vouchers/${old.id}`)).status, 200);
const ledgerBox = (await owner.get('/ledger/accounts')).data.find(
  (a) => a.moneyAccountId === box.id,
);
const ls = ok(
  "the box's ledger account",
  await p.get(`/ledger/accounts/${ledgerBox.id}/statement?from=${day(-90)}&to=${today}`),
);
eq('starts there too', ls.from, day(-30));

console.log('== cheques: open ones and recent steps');
ok('7 days', await access({ moneyAccountIds: [box.id], moneyHistoryDays: 7 }));
let notes = (await p.get('/notes?pageSize=100')).data.items.map((n) => n.id);
check("sees today's cheques", notes.includes(oldCheque.id) && notes.includes(doneCheque.id));

console.log('== nobody gives more than they have');
const other = ok(
  'another person',
  await owner.post('/staff', {
    fullName: `Other ${tag}`,
    email: `other-${tag}@skb.local`,
    password: PASSWORD,
    role: 'SALES',
    branchId,
  }),
);
ok(
  'the cashier may set access',
  await owner.put(`/staff/${person.id}/permissions`, { granted: ['staff:access'], revoked: [] }),
);
const give = (body) =>
  p.put(`/staff/${other.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [box.id],
    ...body,
  });
eq('not all the history', (await give({})).data?.code, 'over_your_history');
eq('not more days', (await give({ moneyHistoryDays: 30 })).data?.code, 'over_your_history');
ok('their own or fewer', await give({ moneyHistoryDays: 7 }));
ok(
  'or no money accounts',
  await give({ noMoneyAccounts: true, moneyAccountIds: [], moneyHistoryDays: 3 }),
);
eq(
  'never every account',
  (await give({ moneyAccountIds: [], moneyHistoryDays: 3 })).data?.code,
  'not_your_account',
);

console.log('== back to everything');
r = ok('all again', await access({}));
eq('cleared', [r.noMoneyAccounts, r.moneyHistoryDays], [false, null]);
eq('the old voucher is back', (await p.get(`/vouchers/${old.id}`)).status, 200);
check(
  'and the new box',
  (await p.get('/money-accounts')).data.some((a) => a.id === box2.id),
);
ok('close the people', await owner.put(`/staff/${person.id}`, { isActive: false }));
ok('both', await owner.put(`/staff/${other.id}`, { isActive: false }));

process.exit(summary('moneyaccess') ? 1 : 0);
