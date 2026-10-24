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
ok(
  '…and may see branches and the books',
  await owner.put(`/staff/${person.id}/permissions`, {
    granted: ['branches:view', 'ledger:journal', 'ledger:trial_balance', 'ledger:income_statement', 'statement:customers',
      'sales:return'],
  }),
);
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
// The books too (owner, 2026-10-24; rule 11): entries of their branches only.
const range = 'from=2022-01-01';
const ownerEntry = (await owner.get(`/ledger/entries?${range}&source=VOUCHER&pageSize=100`)).data.items.find((e) => e.number === r.number);
check('the owner sees the receipt’s entry', !!ownerEntry);
const journal = ok('their journal', await one.get(`/ledger/entries?${range}&pageSize=100`));
check("not the other branch's entry", !journal.items.some((e) => e.number === r.number));
eq('…nor opened by its id', (await one.get(`/ledger/entries/${ownerEntry?.id}`)).status, 404);
const theirs = ok('the customer’s statement', await one.get(`/ledger/parties/${cust.id}/statement?${range}`));
eq('…without the other branch’s receipt', [theirs.lines.length, theirs.closing], [0, 0]);
eq('…which the owner sees', (await owner.get(`/ledger/parties/${cust.id}/statement?${range}`)).data.closing, -700);
const tb = ok('their trial balance', await one.get(`/ledger/trial-balance?${range}`));
const tbOwner = (await owner.get(`/ledger/trial-balance?${range}`)).data;
const sum = (t) => t.rows.reduce((s, x) => s + x.periodDebit, 0);
check('…smaller than the company’s', sum(tb) < sum(tbOwner), [sum(tb), sum(tbOwner)]);
eq('…and still balanced', sum(tb), tb.rows.reduce((s, x) => s + x.periodCredit, 0));
eq('closing a year needs every branch', (await one.post('/ledger/close-year', { year: 2023 })).status, 403);

// Too soon to take goods back tells nothing of another branch's invoice (owner, 2026-10-24).
{
  const whThere = (await owner.get('/warehouses')).data.find((w) => w.branchId === other.id && w.isDefault);
  const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
  const cat = (await owner.get('/categories')).data[0];
  const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
  const sup = ok('a supplier', await owner.post('/parties', { name: `ScopeSup ${tag}`, types: ['SUPPLIER'] }));
  const item = ok(
    'an item',
    await owner.post('/products', {
      name: `ScopeItem ${tag}`, categoryId: cat.id, units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
    }),
  );
  ok('bought into the other branch', await there.post('/purchases/invoices', {
    partyId: sup.id, warehouseId: whThere.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 5, unitCost: 600 }],
  }));
  const sold = ok('sold there just now', await there.post('/sales/invoices', {
    partyId: cust.id, warehouseId: whThere.id, taxPercent: 0, paymentMethod: 'CREDIT',
    lines: [{ productId: item.id, quantity: 1, unitPrice: 1000 }],
  }));
  const hours = (await owner.get('/settings')).data.returnAfterHours;
  ok('returns wait 12 hours', await owner.put('/settings', { returnAfterHours: 12 }));
  const back = await one.post(`/sales/invoices/${sold.id}/returns`, { lines: [{ lineId: sold.lines[0].id, quantity: 1 }] });
  eq('a return on it is "not found", saying nothing of when it was made', [back.status, back.data?.code, back.data?.from], [404, 'not_found', undefined]);
  eq('…while its own branch is told to wait', (await there.post(`/sales/invoices/${sold.id}/returns`, { lines: [{ lineId: sold.lines[0].id, quantity: 1 }] })).data?.code, 'return_too_soon');
  ok('the hours as they were', await owner.put('/settings', { returnAfterHours: hours }));
}

const ownerBranches = ok("the owner's branches", await owner.get('/branches'));
check('the owner sees both', ownerBranches.some((b) => b.id === other.id) && ownerBranches.some((b) => b.id === main));

summary('scope');
