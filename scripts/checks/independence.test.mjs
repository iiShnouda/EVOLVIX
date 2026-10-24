// Every permission stands alone (owner, 2026-10-23: "nobody needs anything else opened; everything
// is separate"): a person with the NONE role starts with nothing, and given one permission can do
// exactly that one thing — not the view next to it, not the action beside it. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';
const branchId = owner.user.branchId;

const person = async (name) => {
  const email = `${name}.${tag}@skb.local`;
  const staff = ok(
    `add ${name} with no role`,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email,
      password: PASS,
      role: 'NONE',
      branchId,
    }),
  );
  return { staff, email };
};
const solo = await person('solo');
const other = await person('other');

/** The person holding exactly these permissions, signed in again so their token has them. */
const only = async (permissions) => {
  ok(
    `only ${permissions.join(', ') || 'nothing'}`,
    await owner.put(`/staff/${solo.staff.id}/permissions`, { granted: permissions, revoked: [] }),
  );
  return login(solo.email, PASS);
};

console.log('== no role: nothing at all');
let me = await only([]);
eq('no permissions', me.user.permissions, []);
eq('the role is NONE', me.user.role, 'NONE');
for (const path of [
  '/dashboard',
  '/sales/invoices',
  '/purchases/invoices',
  '/parties',
  '/inventory/items',
  '/notes',
  '/ledger/accounts',
  '/staff',
  '/vouchers',
]) {
  eq(`${path} refused`, (await me.get(path)).status, 403);
}
ok('the company settings are read by everyone', await me.get('/settings'));
ok('so are the units items are counted in', await me.get('/units'));

console.log('== one dashboard card');
me = await only(['dashboard:kpi_sales']);
const dash = ok('the dashboard opens', await me.get('/dashboard'));
eq(
  'with that card alone',
  dash.kpis.map((k) => k.key),
  ['kpi.revenue'],
);
eq('no chart, no recent documents', [dash.trend.length, dash.recentDocuments.length], [0, 0]);
const more = ok('the other cards are asked for', await me.get('/dashboard/more'));
eq(
  'and none of them comes',
  [more.month, more.today, more.topItems, more.accounts, more.stockValue],
  [null, null, null, null, null],
);
eq('the sales list stays shut', (await me.get('/sales/invoices')).status, 403);

console.log('== a list without the one beside it');
me = await only(['sales:returns_view']);
ok('sales returns open', await me.get('/sales/returns'));
eq('sales invoices do not', (await me.get('/sales/invoices')).status, 403);
me = await only(['sales:view']);
ok('sales invoices open', await me.get('/sales/invoices'));
eq('sales returns do not', (await me.get('/sales/returns')).status, 403);

console.log('== a report on its own permission');
me = await only(['ledger:trial_balance']);
ok('the trial balance opens without costs:view', await me.get('/ledger/trial-balance'));
eq(
  'the income statement and balance sheet do not',
  [
    (await me.get('/ledger/income-statement')).status,
    (await me.get('/ledger/balance-sheet')).status,
  ],
  [403, 403],
);

console.log('== one part of the settings');
const settings = ok('settings', await owner.get('/settings'));
me = await only(['settings:pricing']);
ok(
  'the prices part changes',
  await me.put('/settings', { defaultMarkupPercent: settings.defaultMarkupPercent + 1 }),
);
const refused = await me.put('/settings', { companyName: `Other ${tag}` });
eq('the company part does not', [refused.status, refused.data?.part], [403, 'settings:company']);
ok(
  'back as it was',
  await owner.put('/settings', { defaultMarkupPercent: settings.defaultMarkupPercent }),
);

console.log('== add without change or delete');
me = await only(['units:create']);
const unit = ok('a unit is added', await me.post('/units', { name: `Box ${tag}`, pieces: 6 }));
eq('it is not renamed', (await me.put(`/units/${unit.id}`, { name: `Crate ${tag}` })).status, 403);
eq('nor closed', (await me.put(`/units/${unit.id}`, { isActive: false })).status, 403);
eq('nor deleted', (await me.del(`/units/${unit.id}`)).status, 403);
ok('the owner deletes it', await owner.del(`/units/${unit.id}`), [200, 204]);

console.log('== the customers, not the suppliers');
me = await only(['parties:create_customer']);
ok('a customer is added', await me.post('/parties', { name: `Cust ${tag}`, types: ['CUSTOMER'] }));
eq(
  'a supplier is not',
  (await me.post('/parties', { name: `Sup ${tag}`, types: ['SUPPLIER'] })).status,
  403,
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `Cust2 ${tag}`, types: ['CUSTOMER'] }),
);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `Sup2 ${tag}`, types: ['SUPPLIER'] }),
);
me = await only(['statement:customers']);
ok("a customer's statement opens", await me.get(`/ledger/parties/${customer.id}/statement`));
eq("a supplier's does not", (await me.get(`/ledger/parties/${supplier.id}/statement`)).status, 403);

console.log('== money accounts: making one is not seeing what they hold');
me = await only(['money_accounts:create']);
const bank = ok(
  'a bank account is added',
  await me.post('/money-accounts', { name: `Bank ${tag}`, kind: 'BANK', branchId }),
);
const listed = ok('the accounts are listed to choose from', await me.get('/money-accounts'));
check(
  'without what is in them',
  listed.length > 0 && listed.every((a) => a.balance === null),
  listed.slice(0, 2),
);
eq('it is not changed', (await me.put(`/money-accounts/${bank.id}`, { name: 'x' })).status, 403);
me = await only(['money:accounts']);
check(
  'seeing the accounts shows what they hold',
  (await me.get('/money-accounts')).data.every((a) => typeof a.balance === 'number'),
);
ok('the owner deletes it', await owner.del(`/money-accounts/${bank.id}`), [200, 204]);

console.log('== stock totals without the rows');
me = await only(['inventory:total_items']);
const stock = ok('the stock list opens', await me.get('/inventory/items?pageSize=5'));
eq('no rows', stock.items.length, 0);
check('the count of items', typeof stock.totals.items === 'number', stock.totals);
eq(
  'not the other totals',
  [stock.totals.quantity, stock.totals.saleValue, stock.totals.supplyValue, stock.totals.sold],
  [null, null, null, null],
);

console.log('== one change to a person');
me = await only(['staff:password']);
ok('a new password is set', await me.put(`/staff/${other.staff.id}`, { password: 'An0therPass!' }));
ok('it works', await login(other.email, 'An0therPass!').then(() => ({ status: 200 })));
eq(
  'the role is not changed',
  (await me.put(`/staff/${other.staff.id}`, { role: 'SALES' })).status,
  403,
);
const renamed = await me.put(`/staff/${other.staff.id}`, { fullName: `Renamed ${tag}` });
check('nor the name', renamed.status === 403 || renamed.data?.fullName === `other ${tag}`, renamed);

console.log('== cleaning up');
ok('remove solo', await owner.del(`/staff/${solo.staff.id}`), [200, 204]);
ok('remove other', await owner.del(`/staff/${other.staff.id}`), [200, 204]);

summary('independence');
