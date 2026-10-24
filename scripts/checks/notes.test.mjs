// Cheques & promissory notes (DOMAIN.md step 7): receiving and issuing (with invoices), deposit
// portfolios, collecting, paying, bouncing, endorsing, cancelling — each step's balances, money and
// journal entry — plus permissions, branch scoping and a race. Runs against BASE.
import { BASE, login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const mainId = owner.user.branchId;
const branches = (await owner.get('/branches')).data;
const otherId = branches.find((b) => b.id !== mainId).id;
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === mainId);
const party = async (id) => (await owner.get(`/parties/${id}`)).data;
const money = async (id) =>
  (await owner.get('/money-accounts')).data.find((a) => a.id === id).balance;
const inv = async (id, scope = 'sales') => (await owner.get(`/${scope}/invoices/${id}`)).data;
const noteEntries = async (ref) =>
  (await owner.get('/ledger/entries?source=NOTE&pageSize=100')).data.items
    .filter((e) => e.number === ref)
    .reverse() // the journal lists newest first; steps are read oldest first
    .map((e) => e.lines.map((l) => [l.accountCode.split('-')[0], l.debit, l.credit]).sort());
const today = companyToday();

// Parties, money, goods.
const P = async (name, types) =>
  ok(`party ${name}`, await owner.post('/parties', { name: `${name} ${tag}`, types }));
const cust = await P('NCust', ['CUSTOMER']),
  supp = await P('NSupp', ['SUPPLIER']),
  supp2 = await P('NSupp2', ['SUPPLIER']);
const bank = ok(
  'bank',
  await owner.post('/money-accounts', { branchId: mainId, name: `NBank ${tag}`, kind: 'BANK' }),
);
const box = ok(
  'box',
  await owner.post('/money-accounts', {
    branchId: mainId,
    name: `NBox ${tag}`,
    kind: 'CASH_BOX',
    openingBalance: 100000,
  }),
);
const emptyBox = ok(
  'empty box',
  await owner.post('/money-accounts', {
    branchId: mainId,
    name: `NEmpty ${tag}`,
    kind: 'CASH_BOX',
  }),
);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `NItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);
const pur = ok(
  'purchase (unpaid)',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 100, unitCost: 1000 }],
  }),
);
const sale = (qty) =>
  owner.post('/sales/invoices', {
    partyId: cust.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: qty, unitPrice: 2000 }],
  });
const s1 = ok('sale 1 (100.00)', await sale(5));
const s2 = ok('sale 2 (60.00)', await sale(3));

console.log('== permissions');
eq("sales staff can't see notes", (await karim.get('/notes')).status, 403);
eq("sales staff can't receive", (await karim.post('/notes/receive', {})).status, 403);
ok('accountant lists notes', await mona.get('/notes'));

console.log('== receive');
const R = (body) =>
  owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: '100200',
    amount: 5000,
    dueDate: today,
    bankName: 'CIB',
    ...body,
  });
eq('unknown kind', (await R({ kind: 'BOND' })).data?.code, 'bad_kind');
eq('no number', (await R({ serialNumber: ' ' })).data?.code, 'bad_serial');
eq('zero amount', (await R({ amount: 0 })).data?.code, 'bad_amount');
eq('no due date', (await R({ dueDate: 'soon' })).data?.code, 'bad_date');
eq('no party', (await R({ partyId: null })).data?.code, 'party_not_found');
eq(
  'invoices beyond the note',
  (await R({ allocations: [{ documentId: s1.id, amount: 5001 }] })).data?.code,
  'over_allocated',
);
eq(
  'beyond what is owed',
  (await R({ amount: 20000, allocations: [{ documentId: s1.id, amount: 10001 }] })).data?.code,
  'over_outstanding',
);
eq(
  "a purchase invoice isn't settled by a received note",
  (await R({ allocations: [{ documentId: pur.id, amount: 100 }] })).data?.code,
  'invoice_not_found',
);
const cb0 = (await party(cust.id)).balance;
const n1 = ok(
  'cheque settling sale 1',
  await R({
    serialNumber: 'CH-1',
    amount: 10000,
    dueDate: '2026-12-31',
    drawer: 'Cust owner',
    allocations: [{ documentId: s1.id, amount: 10000 }],
  }),
);
check('numbered NR-', /^NR-\d{4}-\d{6}$/.test(n1.ref), n1.ref);
eq(
  'in hand',
  [n1.status, n1.direction, n1.kind, n1.dueDate, n1.allocations.length, n1.events.length],
  ['IN_HAND', 'RECEIVABLE', 'CHEQUE', '2026-12-31', 1, 1],
);
eq('customer owes less', (await party(cust.id)).balance, cb0 - 10000);
eq(
  'invoice paid by the cheque',
  [(await inv(s1.id)).status, (await inv(s1.id)).paidAmount],
  ['PAID', 10000],
);
eq(
  'entry: notes receivable ← customer',
  (await noteEntries(n1.ref))[0],
  [
    ['1107', 10000, 0],
    ['1103', 0, 10000],
  ].sort(),
);
const n2 = ok(
  'promissory note, overdue',
  await R({
    kind: 'PROMISSORY_NOTE',
    serialNumber: 'PN-7',
    amount: 3000,
    dueDate: '2026-01-10',
    guarantor: 'Guarantor X',
  }),
);
eq('overdue flagged', n2.overdue, true);
const n3 = ok(
  'third cheque, part of sale 2',
  await R({
    serialNumber: 'CH-3',
    amount: 4000,
    allocations: [{ documentId: s2.id, amount: 4000 }],
  }),
);
const n4 = ok('fourth cheque', await R({ serialNumber: 'CH-4', amount: 2500 }));
const sum = ok('summary', await owner.get('/notes/summary'));
check(
  'summary counts open and overdue',
  sum.receivableOpen >= 19500 && sum.receivableOverdue >= 3000,
  sum,
);

console.log('== deposit and collect');
const D = (body) => owner.post('/notes/deposit', body);
eq(
  'deposit into a cash box',
  (await D({ noteIds: [n1.id], accountId: box.id })).data?.code,
  'account_not_found',
);
eq('no notes', (await D({ noteIds: [], accountId: bank.id })).data?.code, 'no_notes');
const pf = ok(
  'deposit two cheques at the bank',
  await D({ noteIds: [n1.id, n3.id], accountId: bank.id }),
);
check('portfolio numbered PF-', /^PF-\d{4}-\d{6}$/.test(pf.number), pf.number);
eq(
  'portfolio holds them',
  [pf.count, pf.total, pf.refs.sort()],
  [2, 14000, [n1.ref, n3.ref].sort()],
);
let n1d = (await owner.get(`/notes/${n1.id}`)).data;
eq(
  'under collection at the bank',
  [n1d.status, n1d.accountName, n1d.portfolioNumber],
  ['UNDER_COLLECTION', `NBank ${tag}`, pf.number],
);
eq(
  'entry: under collection ← receivable',
  (await noteEntries(n1.ref))[1],
  [
    ['1108', 10000, 0],
    ['1107', 0, 10000],
  ].sort(),
);
eq(
  'deposited twice',
  (await D({ noteIds: [n1.id], accountId: bank.id })).data?.code,
  'bad_transition',
);
check(
  'portfolios listed',
  (await owner.get('/portfolios')).data.some((p) => p.id === pf.id),
);
const b0 = await money(bank.id);
const race = await Promise.all([
  owner.post(`/notes/${n1.id}/collect`, {}),
  mona.post(`/notes/${n1.id}/collect`, {}),
]);
eq('collected once when clicked twice', race.map((r) => r.status).sort(), [200, 400]);
eq('money landed in the deposit bank', await money(bank.id), b0 + 10000);
eq(
  'entry: bank ← under collection',
  (await noteEntries(n1.ref))[2],
  [
    ['1102', 10000, 0],
    ['1108', 0, 10000],
  ].sort(),
);
n1d = (await owner.get(`/notes/${n1.id}`)).data;
eq(
  'history',
  n1d.events.map((e) => e.toStatus),
  ['IN_HAND', 'UNDER_COLLECTION', 'COLLECTED'],
);
const x0 = await money(box.id);
ok(
  'cash a cheque in hand into the box',
  await owner.post(`/notes/${n4.id}/collect`, { accountId: box.id }),
);
eq('box got it', await money(box.id), x0 + 2500);
eq(
  'an in-hand cheque needs an account',
  (await owner.post(`/notes/${n2.id}/collect`, {})).data?.code,
  'account_not_found',
);

console.log('== bounce, endorse, cancel');
const cb1 = (await party(cust.id)).balance;
ok(
  'the deposited cheque bounced',
  await owner.post(`/notes/${n3.id}/bounce`, { remark: 'No funds' }),
);
eq('customer owes it again', (await party(cust.id)).balance, cb1 + 4000);
eq(
  'its invoice is open again',
  [(await inv(s2.id)).status, (await inv(s2.id)).paidAmount],
  ['CONFIRMED', 0],
);
eq(
  'entry: customer ← under collection',
  (await noteEntries(n3.ref))[2],
  [
    ['1103', 4000, 0],
    ['1108', 0, 4000],
  ].sort(),
);
eq('bounce twice', (await owner.post(`/notes/${n3.id}/bounce`, {})).data?.code, 'bad_transition');
const sb0 = (await party(supp.id)).balance;
eq(
  'endorse back to the same customer',
  (await owner.post(`/notes/${n2.id}/endorse`, { partyId: cust.id })).data?.code,
  'party_not_found',
);
const en = ok(
  'endorse the promissory note to the supplier',
  await owner.post(`/notes/${n2.id}/endorse`, { partyId: supp.id }),
);
eq('endorsed', [en.status, en.endorsedToName], ['ENDORSED', `NSupp ${tag}`]);
eq('we owe the supplier less', (await party(supp.id)).balance, sb0 + 3000);
eq(
  'entry: supplier ← receivable',
  (await noteEntries(n2.ref))[1],
  [
    ['2101', 3000, 0],
    ['1107', 0, 3000],
  ].sort(),
);
eq(
  "a collected note can't be endorsed",
  (await owner.post(`/notes/${n1.id}/endorse`, { partyId: supp.id })).data?.code,
  'bad_transition',
);
const n5 = ok('a cheque to give back', await R({ serialNumber: 'CH-5', amount: 1500 }));
const cb2 = (await party(cust.id)).balance;
ok('given back', await owner.post(`/notes/${n5.id}/cancel`, {}));
eq('as if never received', (await party(cust.id)).balance, cb2 + 1500);
eq(
  'a cancelled note stays cancelled',
  (await owner.post(`/notes/${n5.id}/collect`, { accountId: box.id })).data?.code,
  'bad_transition',
);

console.log('== issue and pay');
const I = (body) =>
  owner.post('/notes/issue', {
    partyId: supp.id,
    kind: 'CHEQUE',
    serialNumber: 'OUR-1',
    amount: 6000,
    dueDate: '2026-11-30',
    ...body,
  });
eq(
  "a sales invoice isn't paid by our note",
  (await I({ allocations: [{ documentId: s2.id, amount: 100 }] })).data?.code,
  'invoice_not_found',
);
const sb1 = (await party(supp.id)).balance;
const p1 = ok(
  'our cheque to the supplier for the purchase',
  await I({ allocations: [{ documentId: pur.id, amount: 6000 }] }),
);
check('numbered NP-', /^NP-\d{4}-\d{6}$/.test(p1.ref), p1.ref);
eq('issued', p1.status, 'ISSUED');
eq('we owe less', (await party(supp.id)).balance, sb1 + 6000);
eq(
  'purchase part paid',
  [(await inv(pur.id, 'purchases')).status, (await inv(pur.id, 'purchases')).paidAmount],
  ['PARTIALLY_PAID', 6000],
);
eq(
  'entry: supplier ← notes payable',
  (await noteEntries(p1.ref))[0],
  [
    ['2101', 6000, 0],
    ['2103', 0, 6000],
  ].sort(),
);
eq(
  'deposit our own cheque',
  (await D({ noteIds: [p1.id], accountId: bank.id })).data?.code,
  'bad_transition',
);
eq(
  'pay from an empty box',
  (await owner.post(`/notes/${p1.id}/pay`, { accountId: emptyBox.id })).data?.code,
  'insufficient_funds',
);
eq('still issued', (await owner.get(`/notes/${p1.id}`)).data.status, 'ISSUED');
const x1 = await money(box.id);
ok('paid from the box', await owner.post(`/notes/${p1.id}/pay`, { accountId: box.id }));
eq('money left the box', await money(box.id), x1 - 6000);
eq(
  'entry: notes payable ← box',
  (await noteEntries(p1.ref))[1],
  [
    ['2103', 6000, 0],
    ['1101', 0, 6000],
  ].sort(),
);
eq(
  'pay twice',
  (await owner.post(`/notes/${p1.id}/pay`, { accountId: box.id })).data?.code,
  'bad_transition',
);
const p2 = ok(
  'a second note, bounced',
  await I({
    serialNumber: 'OUR-2',
    amount: 2000,
    allocations: [{ documentId: pur.id, amount: 2000 }],
  }),
);
const sb2 = (await party(supp.id)).balance;
ok('our note bounced', await owner.post(`/notes/${p2.id}/bounce`, {}));
eq('we owe it again', (await party(supp.id)).balance, sb2 - 2000);
eq('the purchase is owed again', (await inv(pur.id, 'purchases')).paidAmount, 6000);
const p3 = ok(
  'a third note, withdrawn',
  await I({ serialNumber: 'OUR-3', amount: 700, partyId: supp2.id }),
);
ok('withdrawn', await owner.post(`/notes/${p3.id}/cancel`, {}));
eq('supplier 2 back to zero', (await party(supp2.id)).balance, 0);

console.log('== guards');
eq(
  'manual entry on notes accounts refused',
  (
    await owner.post('/ledger/entries', {
      description: 'x',
      lines: [
        {
          accountId: (await owner.get('/ledger/accounts')).data.find(
            (a) => a.systemKey === 'NOTES_RECEIVABLE',
          ).id,
          debit: 1,
        },
        {
          accountId: (await owner.get('/ledger/accounts')).data.find(
            (a) => a.systemKey === 'CAPITAL',
          ).id,
          credit: 1,
        },
      ],
    })
  ).data?.code,
  'stock_account',
);
const list = ok('receivable list', await owner.get('/notes?direction=RECEIVABLE&pageSize=100'));
check(
  'only receivable',
  list.items.every((n) => n.direction === 'RECEIVABLE'),
);
check(
  'open filter',
  (await owner.get('/notes?open=true&pageSize=100')).data.items.every((n) =>
    ['IN_HAND', 'UNDER_COLLECTION', 'ISSUED'].includes(n.status),
  ),
);
const email = `notes.${tag}@skb.local`;
const other = ok(
  'a person in the other branch',
  await owner.post('/staff', {
    fullName: `Notes ${tag}`,
    email,
    password: 'Str0ngPass!',
    role: 'SALES',
    branchId: otherId,
  }),
);
ok(
  'let them see notes',
  await owner.put(`/staff/${other.id}/permissions`, {
    granted: ['notes:view_receivable', 'notes:view_payable'],
  }),
);
const o = await login(email, 'Str0ngPass!');
eq('main-branch note hidden from the other branch', (await o.get(`/notes/${n1.id}`)).status, 404);
check('nor listed', !(await o.get('/notes?pageSize=100')).data.items.some((n) => n.id === n1.id));
eq('signed out', (await fetch(`${BASE}/notes`)).status, 401);

process.exit(summary('notes') ? 1 : 0);
