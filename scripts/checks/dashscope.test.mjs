// The dashboard follows what each person may see (owner, 2026-11-11): someone given one department,
// one branch, some warehouses or some cash boxes sees only those in every card — and the branch,
// warehouse and department picked at the top narrow every card for everyone. Runs against BASE in
// two new branches of its own, so it can run again on the same database.
import { login, check, eq, ok, summary, companyToday } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASS = 'Str0ngPass!';
const owner = await login('owner@skb.local');
const today = companyToday();
const period = `from=${today}&to=${today}`;

console.log('== setup');
const A = ok('branch A', await owner.post('/branches', { name: `Dash A ${tag}` }));
const B = ok('branch B', await owner.post('/branches', { name: `Dash B ${tag}` }));
const a1 = A.warehouses[0];
const a2 = ok(
  'a second store in A',
  await owner.post('/warehouses', { branchId: A.id, name: `Dash A2 ${tag}` }),
);
const b1 = B.warehouses[0];
const men = ok('men’s', await owner.post('/departments', { name: `DMen ${tag}` }));
const women = ok('women’s', await owner.post('/departments', { name: `DWomen ${tag}` }));
const piece = (await owner.get('/units')).data.find((u) => ['قطعة', 'Piece'].includes(u.name));
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `DSup ${tag}`, types: ['SUPPLIER'] }),
);
const item = async (name, departmentId, reorderLevel = 0) =>
  ok(
    name,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      departmentId,
      reorderLevel,
      supplierId: supplier.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
    }),
  );
const shirt = await item('DShirt', men.id, 50);
const dress = await item('DDress', women.id, 50);
const buy = (where, warehouseId, lines) =>
  owner
    .at(where)
    .post('/purchases/invoices', { partyId: supplier.id, warehouseId, taxPercent: 0, lines });
// One purchase with both departments' goods: 10 shirts at 400 and 10 dresses at 600 into A1.
ok(
  'a mixed purchase into A1',
  await buy(A.id, a1.id, [
    { productId: shirt.id, quantity: 10, unitCost: 400 },
    { productId: dress.id, quantity: 10, unitCost: 600 },
  ]),
);
ok(
  'dresses into A2',
  await buy(A.id, a2.id, [{ productId: dress.id, quantity: 10, unitCost: 600 }]),
);
ok('shirts into B', await buy(B.id, b1.id, [{ productId: shirt.id, quantity: 10, unitCost: 400 }]));

const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `DCust ${tag}`, types: ['CUSTOMER'] }),
);
const farCust = ok(
  'a customer of B only',
  await owner.post('/parties', { name: `DFar ${tag}`, types: ['CUSTOMER'] }),
);
const sell = (where, partyId, warehouseId, departmentId, productId, quantity) =>
  owner.at(where).post('/sales/invoices', {
    partyId,
    warehouseId,
    departmentId,
    taxPercent: 0,
    paymentMethod: 'CREDIT',
    lines: [{ productId, quantity, unitPrice: 1000, warehouseId }],
  });
const sMen = ok(
  'men’s sale in A1: 2 shirts',
  await sell(A.id, cust.id, a1.id, men.id, shirt.id, 2),
);
const sWomen = ok(
  'women’s sale in A2: 3 dresses',
  await sell(A.id, cust.id, a2.id, women.id, dress.id, 3),
);
const sB = ok(
  'men’s sale in B: 4 shirts',
  await sell(B.id, farCust.id, b1.id, men.id, shirt.id, 4),
);
ok(
  'B’s customer over a limit',
  await owner.put(`/parties/${farCust.id}/credit-limit`, { creditLimit: 100 }),
);
ok(
  'A’s customer over a limit',
  await owner.put(`/parties/${cust.id}/credit-limit`, { creditLimit: 100 }),
);

const accounts = (await owner.get('/money-accounts')).data;
const boxA = accounts.find((x) => x.branchId === A.id && x.isDefault);
const boxA1 = accounts.find((x) => x.warehouseId === a1.id);
const boxA2 = accounts.find((x) => x.warehouseId === a2.id);
check(
  'every store has its box',
  boxA && boxA1 && boxA2,
  accounts.filter((x) => x.branchId === A.id),
);
ok(
  'money into A1’s box',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: boxA1.id, amount: 3000 }],
  }),
);
ok(
  'money into A2’s box',
  await owner.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: boxA2.id, amount: 700 }],
  }),
);
const cat = ok('an expense item', await owner.post('/expense-categories', { name: `DTea ${tag}` }));
ok(
  'an expense from A1’s box',
  await owner.post('/expenses', {
    categoryId: cat.id,
    lines: [{ method: 'CASH', accountId: boxA1.id, amount: 250 }],
  }),
);
ok(
  'an expense from A2’s box',
  await owner.post('/expenses', {
    categoryId: cat.id,
    lines: [{ method: 'CASH', accountId: boxA2.id, amount: 100 }],
  }),
);

const DASH = [
  'dashboard:kpi_sales',
  'dashboard:kpi_purchases',
  'dashboard:kpi_receivables',
  'dashboard:kpi_payables',
  'dashboard:kpi_cash',
  'dashboard:kpi_low_stock',
  'dashboard:trend',
  'dashboard:today',
  'dashboard:month',
  'dashboard:top_items',
  'dashboard:top_customers',
  'dashboard:branches',
  'dashboard:recent',
  'dashboard:accounts',
  'dashboard:notes_due',
  'dashboard:awaiting',
  'dashboard:over_limit',
  'dashboard:low_stock',
  'dashboard:stock_value',
  'profit:view',
];
const person = async (name, access, home = A.id) => {
  const email = `${name}.${tag}@skb.local`;
  const p = ok(
    `add ${name}`,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email,
      password: PASS,
      role: 'NONE',
      branchId: home,
    }),
  );
  ok(`${name}: the dashboard`, await owner.put(`/staff/${p.id}/permissions`, { granted: DASH }));
  ok(
    `${name}: access`,
    await owner.put(`/staff/${p.id}/access`, {
      allBranches: false,
      branchIds: [home],
      warehouseIds: [],
      moneyAccountIds: [],
      ...access,
    }),
  );
  return login(email, PASS);
};
const kpi = (d, key) => d.kpis.find((k) => k.key === key)?.value;
const look = async (who, q = '') => ({
  main: ok('dashboard', await who.get(`/dashboard?${period}${q}`)),
  more: ok('more', await who.get(`/dashboard/more?${period}${q}`)),
});

console.log('== the owner, branch A picked');
const oA = await look(owner, `&branchId=${A.id}`);
eq('sales of A only', kpi(oA.main, 'kpi.revenue'), 5000);
eq('purchases of A only', kpi(oA.main, 'kpi.purchases'), 4000 + 6000 + 6000);
eq(
  'today and the period agree',
  [oA.more.today.sales, oA.more.month.sales, oA.more.today.invoices],
  [5000, 5000, 2],
);
eq(
  'one branch in the ranking',
  oA.more.branches.map((b) => b.id),
  [A.id],
);
check(
  'the latest documents are A’s',
  oA.main.recentDocuments.length > 0 &&
    oA.main.recentDocuments.every((d) => d.branchName === A.name),
  oA.main.recentDocuments,
);
eq('cash: A’s boxes', kpi(oA.main, 'kpi.cashPosition'), 3000 + 700 - 250 - 100);
eq('expenses of A', oA.more.month.expenses, 350);
eq('receivables: what is owed on A’s invoices', kpi(oA.main, 'kpi.receivables'), 5000 - 3700);
eq('payables: what is owed on A’s purchases', kpi(oA.main, 'kpi.payables'), 16000);
check(
  'over the limit: A’s customer, not B’s',
  oA.more.overLimit.some((x) => x.id === cust.id) &&
    !oA.more.overLimit.some((x) => x.id === farCust.id),
  oA.more.overLimit,
);
eq('stock value of A at cost', oA.more.stockValue, 8 * 400 + 7 * 600 + 10 * 600);
const ownerAll = await look(owner);
check(
  'the whole company has more',
  kpi(ownerAll.main, 'kpi.revenue') >= 5000 + 4000 && ownerAll.more.overLimit.length >= 0,
);
const recent = oA.main.recentDocuments.find((d) => d.id === sMen.id);
eq(
  'a document says where it belongs',
  [
    recent?.branchName,
    recent?.warehouseNames,
    recent?.departmentName,
    recent?.partyName,
    recent?.staffName != null,
    !!recent?.createdAt,
  ],
  [A.name, [a1.name], men.name, cust.name, true, true],
);

console.log('== the owner, a warehouse and a department picked');
const oA2 = await look(owner, `&warehouseId=${a2.id}`);
eq('the warehouse’s sales', kpi(oA2.main, 'kpi.revenue'), 3000);
eq('the warehouse’s purchases', kpi(oA2.main, 'kpi.purchases'), 6000);
eq('its own box', kpi(oA2.main, 'kpi.cashPosition'), 600);
eq('its box’s expenses', oA2.more.month.expenses, 100);
eq('no cheques for a warehouse', oA2.more.notesDue, null);
eq('its stock', oA2.more.stockValue, 7 * 600);
eq(
  'a warehouse of another branch is refused',
  (await owner.get(`/dashboard?branchId=${B.id}&warehouseId=${a1.id}`)).data?.code,
  'warehouse_not_found',
);
const oMen = await look(owner, `&branchId=${A.id}&departmentId=${men.id}`);
eq('men’s sales of A', kpi(oMen.main, 'kpi.revenue'), 2000);
eq('men’s share of the mixed purchase', kpi(oMen.main, 'kpi.purchases'), 4000);
eq('men’s profit', oMen.more.month.profit, 2000 - 800);
eq(
  'no money for a department',
  [kpi(oMen.main, 'kpi.cashPosition'), oMen.more.accounts, oMen.more.month.expenses],
  [undefined, null, null],
);
eq('men’s items in stock', oMen.more.stockValue, 8 * 400);
check(
  'only men’s best sellers',
  oMen.more.topItems.every((x) => x.id === shirt.id),
  oMen.more.topItems,
);
check(
  'men’s documents only',
  oMen.main.recentDocuments.every(
    (d) => d.departmentName === men.name || d.type.startsWith('PURCHASE'),
  ),
  oMen.main.recentDocuments,
);
eq(
  'a department not known',
  (await owner.get(`/dashboard/more?departmentId=${owner.user.id}`)).status,
  404,
);

console.log('== a person of men’s only');
const m = await look(await person('dmen', { departmentIds: [men.id] }));
eq('men’s sales only', kpi(m.main, 'kpi.revenue'), 2000);
eq(
  '…in their branch',
  m.more.branches.map((b) => b.id),
  [A.id],
);
eq('men’s purchases only', kpi(m.main, 'kpi.purchases'), 4000);
check(
  'no women’s invoice among the latest',
  !m.main.recentDocuments.some((d) => d.id === sWomen.id) &&
    !m.main.recentDocuments.some((d) => d.id === sB.id),
  m.main.recentDocuments,
);
eq(
  'nor in the top items',
  m.more.topItems.map((x) => x.id),
  [shirt.id],
);
eq('men’s stock value', m.more.stockValue, 8 * 400);
check(
  'dresses are not low for them',
  !m.main.lowStock.some((x) => x.id === dress.id),
  m.main.lowStock,
);
const lowMen = ok(
  'men’s low items in A',
  await owner.get(`/dashboard?branchId=${A.id}&departmentId=${men.id}`),
);
check(
  'shirts low in A with what A holds',
  lowMen.lowStock.some((x) => x.id === shirt.id && x.stockOnHand === 8),
  lowMen.lowStock,
);
eq('they see their branch’s money (theirs to see)', kpi(m.main, 'kpi.cashPosition'), 3350);
eq(
  'another department refused',
  (await (await login(`dmen.${tag}@skb.local`, PASS)).get(`/dashboard?departmentId=${women.id}`))
    .status,
  404,
);

console.log('== a person of store A1 only');
const w = await look(await person('dstore', { warehouseIds: [a1.id] }));
eq('A1’s sales', kpi(w.main, 'kpi.revenue'), 2000);
eq('A1’s purchases', kpi(w.main, 'kpi.purchases'), 10000);
eq('A1’s stock', w.more.stockValue, 8 * 400 + 10 * 600);
eq('expenses from A1’s box', w.more.month.expenses, 250);
check(
  'the latest: A1’s only',
  w.main.recentDocuments.every((d) => d.warehouseNames.includes(a1.name)),
  w.main.recentDocuments,
);
eq(
  'A2 is not theirs to pick',
  (await (await login(`dstore.${tag}@skb.local`, PASS)).get(`/dashboard?warehouseId=${a2.id}`))
    .status,
  404,
);

console.log('== a person with only A2’s box, and one with no boxes');
const bx = await look(await person('dbox', { moneyAccountIds: [boxA2.id] }));
eq('cash: that box', kpi(bx.main, 'kpi.cashPosition'), 600);
eq(
  'the accounts card: that box',
  bx.more.accounts.map((x) => x.id),
  [boxA2.id],
);
eq('expenses from that box', bx.more.month.expenses, 100);
eq('sales are their branch’s', kpi(bx.main, 'kpi.revenue'), 5000);
const nb = await look(await person('dnobox', { noMoneyAccounts: true }));
eq(
  'no boxes: no cash',
  [kpi(nb.main, 'kpi.cashPosition'), nb.more.accounts, nb.more.month.expenses],
  [0, [], 0],
);

console.log('== a person of branch B, picking A');
const bp = await person('dbranch', {}, B.id);
eq(
  'branch A refused',
  (await bp.get(`/dashboard?branchId=${A.id}`)).data?.code,
  'branch_not_found',
);
const bb = await look(bp);
eq('B’s sales', kpi(bb.main, 'kpi.revenue'), 4000);
check(
  'B’s customer over the limit, not A’s',
  bb.more.overLimit.some((x) => x.id === farCust.id) &&
    !bb.more.overLimit.some((x) => x.id === cust.id),
  bb.more.overLimit,
);
eq(
  'no balances without seeing accounts',
  bb.more.overLimit.find((x) => x.id === farCust.id)?.extra ?? null,
  null,
);

console.log('== profit and loss, the same way');
const plMen = ok(
  'men’s in A',
  await owner.get(`/analytics/profit-loss?${period}&branchId=${A.id}&departmentId=${men.id}`),
);
eq(
  'what men’s sales earned',
  [plMen.total.netSales, plMen.total.cogs, plMen.total.expenses, plMen.general],
  [2000, 800, 0, null],
);
const plA2 = ok(
  'store A2',
  await owner.get(`/analytics/profit-loss?${period}&warehouseId=${a2.id}`),
);
eq('A2’s sales and its box’s expenses', [plA2.total.netSales, plA2.total.expenses], [3000, 100]);
eq(
  'another branch’s store refused',
  (await owner.get(`/analytics/profit-loss?branchId=${B.id}&warehouseId=${a2.id}`)).status,
  404,
);
const menPerson = await login(`dmen.${tag}@skb.local`, PASS);
ok(
  'the men’s person may see it',
  await owner.put(
    `/staff/${(await owner.get('/staff')).data.find((x) => x.email === `dmen.${tag}@skb.local`).id}/permissions`,
    { granted: [...DASH, 'dashboard:profit'] },
  ),
);
const plOfMen = ok(
  'their profit and loss',
  await menPerson.get(`/analytics/profit-loss?${period}`),
);
eq(
  'their department’s only',
  [plOfMen.total.netSales, plOfMen.branches.map((b) => b.id)],
  [2000, [A.id]],
);

process.exit(summary('dashscope') ? 1 : 0);
