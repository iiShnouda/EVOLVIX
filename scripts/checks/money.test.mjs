// Money (DOMAIN.md step 5): money accounts, receipts and payments with allocation to invoices,
// expenses, transfers, cancelling, paid-now / refunds / carrier settlements through accounts, the
// no-negative rule, permissions, branch scoping and races. Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const sara = await login('sara@skb.local'); // INVENTORY, other branch

const branches = (await owner.get('/branches')).data;
const mainId = owner.user.branchId;
const otherId = branches.find((b) => b.id !== mainId).id;
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === mainId);
const acct = async (id) => (await owner.get('/money-accounts')).data.find((a) => a.id === id);
const bal = async (id) => (await acct(id)).balance;
const party = async (id) => (await owner.get(`/parties/${id}`)).data;
const inv = async (id, scope = 'sales') => (await owner.get(`/${scope}/invoices/${id}`)).data;

console.log('== money accounts');
eq("sales staff can't see money", (await karim.get('/money-accounts')).status, 403);
eq("store staff can't see money", (await sara.get('/money-accounts')).status, 403);
const all = ok('list accounts', await owner.get('/money-accounts'));
const mainBox = all.find((a) => a.branchId === mainId && a.isDefault);
check(
  'each branch has a default cash box',
  branches
    .filter((b) => b.isActive !== false)
    .every((b) => all.some((a) => a.branchId === b.id && a.isDefault && a.kind === 'CASH_BOX')),
  all,
);
const A = (body) => owner.post('/money-accounts', { branchId: mainId, ...body });
const box = ok(
  'add a cash box with an opening balance',
  await A({ name: `Box ${tag}`, kind: 'CASH_BOX', openingBalance: 100000 }),
);
eq('opening balance', [box.balance, box.isDefault, box.kind], [100000, false, 'CASH_BOX']);
const bank = ok(
  'add a bank account',
  await A({ name: `Bank ${tag}`, kind: 'bank', bankName: ' CIB ', number: '100-200' }),
);
eq('bank details', [bank.bankName, bank.number, bank.balance], ['CIB', '100-200', 0]);
const wallet = ok(
  'add a wallet (accountant)',
  await mona.post('/money-accounts', {
    branchId: mainId,
    name: `Wallet ${tag}`,
    kind: 'WALLET',
    number: '0100',
  }),
);
const staff = (await owner.get('/staff')).data;
const karimId = staff.find((s) => s.email === 'karim@skb.local').id;
const custody = ok(
  'driver custody',
  await A({ name: `Custody ${tag}`, kind: 'CUSTODY', custodianId: karimId }),
);
eq('custodian named', custody.custodianName, 'Karim Sales');
eq(
  'custody needs a holder',
  (await A({ name: `C2 ${tag}`, kind: 'CUSTODY' })).data?.code,
  'custodian_not_found',
);
eq(
  'duplicate name',
  (await A({ name: `box ${tag}`, kind: 'CASH_BOX' })).data?.code,
  'duplicate_name',
);
eq('unknown kind', (await A({ name: `X ${tag}`, kind: 'SAFE' })).data?.code, 'bad_kind');
eq(
  'negative opening',
  (await A({ name: `X ${tag}`, kind: 'CASH_BOX', openingBalance: -1 })).data?.code,
  'bad_amount',
);
eq(
  'only a cash box is default',
  (await A({ name: `X ${tag}`, kind: 'BANK', isDefault: true })).data?.code,
  'bad_default',
);
eq('no name', (await A({ name: ' ', kind: 'BANK' })).data?.code, 'bad_name');
eq(
  'unknown branch',
  (
    await owner.post('/money-accounts', {
      branchId: '00000000-0000-0000-0000-000000000000',
      name: 'x',
      kind: 'BANK',
    })
  ).data?.code,
  'branch_not_found',
);
eq(
  "sales can't add accounts",
  (await karim.post('/money-accounts', { branchId: mainId, name: 'x', kind: 'BANK' })).status,
  403,
);
let st = ok('statement', await owner.get(`/money-accounts/${box.id}/movements`));
eq(
  'statement of the opening',
  [
    st.opening,
    st.totalIn,
    st.totalOut,
    st.closing,
    st.movements.map((m) => [m.seq, m.kind, m.amount, m.balanceAfter]),
  ],
  [0, 100000, 0, 100000, [[1, 'OPENING', 100000, 100000]]],
);
eq(
  'bad range',
  (await owner.get(`/money-accounts/${box.id}/movements?from=2026-02-01&to=2026-01-01`)).data?.code,
  'bad_range',
);

// Parties and items to trade with.
const P = async (name, types) =>
  ok(`party ${name}`, await owner.post('/parties', { name: `${name} ${tag}`, types }));
const cust = await P('Cust', ['CUSTOMER']),
  cust2 = await P('Cust2', ['CUSTOMER']),
  supp = await P('Supp', ['SUPPLIER']);
const item = ok(
  'item',
  await owner.post('/products', {
    name: `MoneyItem ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 1000 }],
  }),
);
ok(
  'stock in (unpaid)',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 500, unitCost: 500 }],
  }),
);
const sell = (who, body, qty = 1, partyId = cust.id) =>
  who.post('/sales/invoices', {
    partyId,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: qty, unitPrice: 1000 }],
    ...body,
  });

console.log('== paid now lands in an account');
const mainBefore = await bal(mainBox.id);
const s0 = ok('sale paid now (default cash box)', await sell(owner, { paidAmount: 500 }));
eq(
  'paid into the branch cash box',
  [s0.paidAccountName, await bal(mainBox.id)],
  [mainBox.name, mainBefore + 500],
);
const s3 = ok(
  'sale paid now into a chosen box',
  await sell(owner, { paidAmount: 1000, paidAccountId: box.id }, 3),
);
eq('box got it', [await bal(box.id), s3.paidAccountId], [101000, box.id]);
eq(
  'unknown account',
  (await sell(owner, { paidAmount: 100, paidAccountId: '00000000-0000-0000-0000-000000000000' }))
    .data?.code,
  'account_not_found',
);
const s1 = ok('sale 1 unpaid', await sell(owner, {}, 10));
const s2 = ok('sale 2 unpaid', await sell(owner, {}, 5));
const open = ok('open invoices', await owner.get(`/parties/${cust.id}/open-invoices?side=sales`));
eq(
  'outstanding per invoice',
  open.map((o) => [o.number, o.outstanding]),
  [
    [s0.number, 500],
    [s3.number, 2000],
    [s1.number, 10000],
    [s2.number, 5000],
  ],
);

console.log('== receipts');
const R = (who, body) => who.post('/receipts', { partyId: cust.id, ...body });
const custBefore = (await party(cust.id)).balance;
eq(
  "cash can't go to a bank",
  (await R(owner, { lines: [{ method: 'CASH', accountId: bank.id, amount: 100 }] })).data?.code,
  'method_mismatch',
);
eq(
  'allocated more than received',
  (
    await R(owner, {
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
      allocations: [{ documentId: s1.id, amount: 101 }],
    })
  ).data?.code,
  'over_allocated',
);
eq(
  'more than owed on the invoice',
  (
    await R(owner, {
      lines: [{ method: 'CASH', accountId: box.id, amount: 20000 }],
      allocations: [{ documentId: s3.id, amount: 2001 }],
    })
  ).data?.code,
  'over_outstanding',
);
eq(
  "another customer's invoice",
  (
    await owner.post('/receipts', {
      partyId: cust2.id,
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
      allocations: [{ documentId: s1.id, amount: 100 }],
    })
  ).data?.code,
  'invoice_not_found',
);
eq(
  'zero amount',
  (await R(owner, { lines: [{ method: 'CASH', accountId: box.id, amount: 0 }] })).data?.code,
  'bad_amount',
);
eq('no lines', (await R(owner, { lines: [] })).data?.code, 'bad_amount');
eq(
  'unknown method',
  (await R(owner, { lines: [{ method: 'GOLD', accountId: box.id, amount: 1 }] })).data?.code,
  'bad_method',
);
eq(
  'no party',
  (await owner.post('/receipts', { lines: [{ method: 'CASH', accountId: box.id, amount: 1 }] }))
    .data?.code,
  'party_not_found',
);
eq(
  "sales staff can't take receipts",
  (await R(karim, { lines: [{ method: 'CASH', accountId: box.id, amount: 1 }] })).status,
  403,
);
eq('nothing moved yet', [(await party(cust.id)).balance, await bal(box.id)], [custBefore, 101000]);
const r1 = ok(
  'receipt: part cash, part InstaPay, settling two invoices',
  await R(mona, {
    lines: [
      { method: 'CASH', accountId: box.id, amount: 12000 },
      { method: 'INSTAPAY', accountId: bank.id, amount: 3000, reference: ' TX-99 ' },
    ],
    allocations: [
      { documentId: s1.id, amount: 10000 },
      { documentId: s2.id, amount: 2000 },
    ],
    notes: 'weekly',
  }),
);
check('numbered RCV-', /^RCV-\d{4}-\d{6}$/.test(r1.number), r1.number);
eq(
  'receipt totals',
  [
    r1.type,
    r1.status,
    r1.amount,
    r1.unallocated,
    r1.lines.map((l) => [l.method, l.amount, l.reference]),
  ],
  [
    'RECEIPT',
    'POSTED',
    15000,
    3000,
    [
      ['CASH', 12000, null],
      ['INSTAPAY', 3000, 'TX-99'],
    ],
  ],
);
eq('money in', [await bal(box.id), await bal(bank.id)], [113000, 3000]);
eq('customer owes less', (await party(cust.id)).balance, custBefore - 15000);
eq('invoice 1 paid', [(await inv(s1.id)).status, (await inv(s1.id)).paidAmount], ['PAID', 10000]);
eq(
  'invoice 2 part paid',
  [(await inv(s2.id)).status, (await inv(s2.id)).paidAmount],
  ['PARTIALLY_PAID', 2000],
);
eq(
  'open invoices after',
  (await owner.get(`/parties/${cust.id}/open-invoices`)).data.map((o) => o.outstanding),
  [500, 2000, 3000],
);
const r2 = ok(
  'receipt on account only',
  await R(owner, { lines: [{ method: 'MOBILE_WALLET', accountId: wallet.id, amount: 700 }] }),
);
eq('all on account', [r2.unallocated, await bal(wallet.id)], [700, 700]);

console.log('== payments');
const pur = ok(
  'purchase unpaid',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 20, unitCost: 500 }],
  }),
);
const Pay = (who, body) => who.post('/payments', { partyId: supp.id, ...body });
const suppBefore = (await party(supp.id)).balance;
const boxBefore = await bal(box.id);
eq(
  'more than the box holds',
  (await Pay(owner, { lines: [{ method: 'CASH', accountId: box.id, amount: boxBefore + 1 }] })).data
    ?.code,
  'insufficient_funds',
);
eq('nothing paid', [(await party(supp.id)).balance, await bal(box.id)], [suppBefore, boxBefore]);
eq(
  "a sales invoice isn't paid by a payment",
  (
    await Pay(owner, {
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
      allocations: [{ documentId: s2.id, amount: 100 }],
    })
  ).data?.code,
  'invoice_not_found',
);
const p1 = ok(
  'pay the supplier part',
  await Pay(owner, {
    lines: [{ method: 'CASH', accountId: box.id, amount: 6000 }],
    allocations: [{ documentId: pur.id, amount: 6000 }],
  }),
);
check('numbered PAY-', /^PAY-/.test(p1.number), p1.number);
eq('money out', await bal(box.id), boxBefore - 6000);
eq('we owe less', (await party(supp.id)).balance, suppBefore + 6000);
eq(
  'purchase part paid',
  [(await inv(pur.id, 'purchases')).status, (await inv(pur.id, 'purchases')).paidAmount],
  ['PARTIALLY_PAID', 6000],
);
eq(
  'open purchase invoices',
  (await owner.get(`/parties/${supp.id}/open-invoices?side=purchases`)).data.find(
    (o) => o.documentId === pur.id,
  ).outstanding,
  4000,
);
eq(
  'purchase paid now beyond the box',
  (
    await owner.post('/purchases/invoices', {
      partyId: supp.id,
      warehouseId: wh.id,
      taxPercent: 0,
      paidAmount: 999999999,
      paidAccountId: box.id,
      lines: [{ productId: item.id, quantity: 1, unitCost: 999999999 }],
    })
  ).data?.code,
  'insufficient_funds',
);
const pp = ok(
  'purchase paid now from the box',
  await owner.post('/purchases/invoices', {
    partyId: supp.id,
    warehouseId: wh.id,
    taxPercent: 0,
    paidAmount: 1000,
    paidAccountId: box.id,
    lines: [{ productId: item.id, quantity: 2, unitCost: 500 }],
  }),
);
eq('paid from the box', [pp.status, await bal(box.id)], ['PAID', boxBefore - 7000]);

console.log('== expenses');
const cats = ok('expense categories', await owner.get('/expense-categories'));
check('starter categories', cats.length >= 5, cats.length);
const rent = ok('add a category', await owner.post('/expense-categories', { name: `Rent ${tag}` }));
const sub = ok(
  'add a sub-category',
  await owner.post('/expense-categories', { name: `Shop rent ${tag}`, parentId: rent.id }),
);
eq('sub under main', sub.parentName, `Rent ${tag}`);
eq(
  'duplicate category',
  (await owner.post('/expense-categories', { name: `rent ${tag}` })).data?.code,
  'duplicate_name',
);
eq(
  'no sub under a sub',
  (await owner.post('/expense-categories', { name: `X ${tag}`, parentId: sub.id })).data?.code,
  'category_not_found',
);
eq(
  "sales can't add categories",
  (await karim.post('/expense-categories', { name: `Y ${tag}` })).status,
  403,
);
const E = (body) => owner.post('/expenses', { categoryId: sub.id, ...body });
const b0 = await bal(box.id);
const e1 = ok(
  'pay rent from the box',
  await E({ lines: [{ method: 'CASH', accountId: box.id, amount: 2500 }], notes: 'September' }),
);
eq(
  'expense',
  [e1.type, e1.categoryName, e1.amount, await bal(box.id)],
  ['EXPENSE', `Shop rent ${tag}`, 2500, b0 - 2500],
);
eq(
  'no category',
  (await owner.post('/expenses', { lines: [{ method: 'CASH', accountId: box.id, amount: 1 }] }))
    .data?.code,
  'category_not_found',
);
eq(
  'an expense settles no invoice',
  (
    await E({
      lines: [{ method: 'CASH', accountId: box.id, amount: 1 }],
      allocations: [{ documentId: pur.id, amount: 1 }],
    })
  ).data?.code,
  'bad_allocation',
);
eq(
  'expense beyond the wallet',
  (await E({ lines: [{ method: 'MOBILE_WALLET', accountId: wallet.id, amount: 701 }] })).data?.code,
  'insufficient_funds',
);

console.log('== transfers');
const T = (who, body) => who.post('/cash-transfers', body);
const b1 = await bal(box.id),
  k1 = await bal(bank.id);
const t1 = ok(
  'deposit at the bank',
  await T(owner, { fromAccountId: box.id, toAccountId: bank.id, amount: 5000 }),
);
check('numbered CTR-', /^CTR-/.test(t1.number), t1.number);
eq(
  'moved',
  [await bal(box.id), await bal(bank.id), t1.fromAccountName, t1.toAccountName],
  [b1 - 5000, k1 + 5000, box.name, bank.name],
);
eq(
  'same account',
  (await T(owner, { fromAccountId: box.id, toAccountId: box.id, amount: 1 })).data?.code,
  'same_account',
);
eq(
  'more than it holds',
  (await T(owner, { fromAccountId: wallet.id, toAccountId: box.id, amount: 701 })).data?.code,
  'insufficient_funds',
);
eq(
  'zero',
  (await T(owner, { fromAccountId: box.id, toAccountId: bank.id, amount: 0 })).data?.code,
  'bad_amount',
);
eq(
  "sales can't move money",
  (await T(karim, { fromAccountId: box.id, toAccountId: bank.id, amount: 1 })).status,
  403,
);

console.log('== cancelling');
const cb = (await party(cust.id)).balance,
  cbox = await bal(box.id),
  cbank = await bal(bank.id);
const c1 = ok('cancel the receipt', await mona.post(`/vouchers/${r1.id}/cancel`));
eq(
  'cancelled',
  [c1.status, !!c1.cancelledAt, c1.cancelledByName],
  ['CANCELLED', true, 'Mona Accountant'],
);
eq('money back out', [await bal(box.id), await bal(bank.id)], [cbox - 12000, cbank - 3000]);
eq('customer owes it again', (await party(cust.id)).balance, cb + 15000);
eq(
  'invoices unpaid again',
  [
    (await inv(s1.id)).status,
    (await inv(s1.id)).paidAmount,
    (await inv(s2.id)).status,
    (await inv(s2.id)).paidAmount,
  ],
  ['CONFIRMED', 0, 'CONFIRMED', 0],
);
eq('cancel twice', (await owner.post(`/vouchers/${r1.id}/cancel`)).data?.code, 'already_cancelled');
eq("sales can't cancel", (await karim.post(`/vouchers/${r2.id}/cancel`)).status, 403);
// Money already spent can't be un-received.
const t2 = ok(
  'box to wallet',
  await T(owner, { fromAccountId: box.id, toAccountId: wallet.id, amount: 1000 }),
);
ok(
  'spend the wallet',
  await E({
    lines: [{ method: 'MOBILE_WALLET', accountId: wallet.id, amount: await bal(wallet.id) }],
  }),
);
eq(
  "can't cancel a transfer whose money is spent",
  (await owner.post(`/vouchers/${t2.id}/cancel`)).data?.code,
  'insufficient_funds',
);
eq('still posted', (await owner.get(`/vouchers/${t2.id}`)).data.status, 'POSTED');
const pc = ok('cancel the payment', await owner.post(`/vouchers/${p1.id}/cancel`));
eq(
  'supplier owed again, invoice unpaid',
  [
    (await party(supp.id)).balance - suppBefore,
    (await inv(pur.id, 'purchases')).paidAmount,
    (await inv(pur.id, 'purchases')).status,
  ],
  [0, 0, 'CONFIRMED'],
);
check(
  'cancelled payment listed',
  (await owner.get('/vouchers?type=PAYMENT&status=CANCELLED&pageSize=100')).data.items.some(
    (v) => v.id === pc.id,
  ),
);

console.log('== refunds and carrier settlements');
const line = (await inv(s3.id)).lines[0];
const rb = await bal(box.id);
const ret = ok(
  'sales return with cash back from the box',
  await owner.post(`/sales/invoices/${s3.id}/returns`, {
    lines: [{ lineId: line.id, quantity: 1 }],
    refundAmount: 1000,
    refundAccountId: box.id,
  }),
);
eq('refund left the box', [await bal(box.id), ret.paidAccountId], [rb - 1000, box.id]);
const empty = ok('an empty cash box', await A({ name: `Empty ${tag}`, kind: 'CASH_BOX' }));
eq(
  'refund from an empty box',
  (
    await owner.post(`/sales/invoices/${s3.id}/returns`, {
      lines: [{ lineId: line.id, quantity: 1 }],
      refundAmount: 1000,
      refundAccountId: empty.id,
    })
  ).data?.code,
  'insufficient_funds',
);
const pline = (await inv(pur.id, 'purchases')).lines[0];
const pr = ok(
  'purchase return, supplier pays back',
  await owner.post(`/purchases/invoices/${pur.id}/returns`, {
    lines: [{ lineId: pline.id, quantity: 1 }],
    refundAmount: 500,
    refundAccountId: box.id,
  }),
);
eq('refund came in', [await bal(box.id), pr.paidAccountId], [rb - 1000 + 500, box.id]);
const carrier = await P('Courier', ['CARRIER']);
const cs = ok(
  'sale with a courier',
  await sell(owner, { deliveryMethod: 'SHIPPING_COMPANY', carrierId: carrier.id }, 2),
);
const shp = ok(
  'parcel',
  await owner.post('/shipments', { carrierId: carrier.id, invoiceIds: [cs.id] }),
);
eq(
  "COD parcel invoice can't take a receipt",
  (
    await R(owner, {
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
      allocations: [{ documentId: cs.id, amount: 100 }],
    })
  ).data?.code,
  'on_cod_parcel',
);
check(
  'open invoices flag the parcel',
  (await owner.get(`/parties/${cust.id}/open-invoices`)).data.find((o) => o.documentId === cs.id)
    ?.onCodParcel === true,
);
ok('delivered', await owner.post(`/shipments/${shp.id}/delivered`));
const sb = await bal(box.id);
const settlement = ok(
  'courier pays into the box',
  await owner.post('/carrier-settlements', {
    carrierId: carrier.id,
    shipmentIds: [shp.id],
    fees: 100,
    received: 1900,
    accountId: box.id,
  }),
);
eq('settlement cash landed', [await bal(box.id), settlement.accountName], [sb + 1900, box.name]);

console.log('== editing and closing accounts');
eq(
  'rename',
  (await owner.put(`/money-accounts/${box.id}`, { name: `Box2 ${tag}` })).data?.name,
  `Box2 ${tag}`,
);
eq(
  'close with money in it',
  (await owner.put(`/money-accounts/${bank.id}`, { isActive: false })).data?.code,
  'has_balance',
);
const madeDefault = ok(
  'make the box the branch default',
  await owner.put(`/money-accounts/${box.id}`, { isDefault: true }),
);
eq('default moved', [madeDefault.isDefault, (await acct(mainBox.id)).isDefault], [true, false]);
const s5 = ok('paid now goes to the new default', await sell(owner, { paidAmount: 300 }));
eq('into the new default', s5.paidAccountId, box.id);
eq(
  "can't just unset the default",
  (await owner.put(`/money-accounts/${box.id}`, { isDefault: false })).data?.code,
  'is_default',
);
eq(
  "can't close the default",
  (await owner.put(`/money-accounts/${empty.id}`, { isDefault: true }),
  (await owner.put(`/money-accounts/${empty.id}`, { isActive: false })).data?.code),
  'is_default',
);
ok('main box default again', await owner.put(`/money-accounts/${mainBox.id}`, { isDefault: true }));
const fresh = ok('an unused box', await A({ name: `Fresh ${tag}`, kind: 'CASH_BOX' }));
eq('nothing moved yet', fresh.hasMovements, false);
const opened = ok(
  'give it its opening balance',
  await owner.put(`/money-accounts/${fresh.id}`, { openingBalance: 4200 }),
);
eq('opening set', [opened.balance, opened.hasMovements], [4200, true]);
eq(
  'only once',
  (await owner.put(`/money-accounts/${fresh.id}`, { openingBalance: 100 })).data?.code,
  'has_movements',
);
eq(
  'negative opening refused',
  (await owner.put(`/money-accounts/${empty.id}`, { openingBalance: -5 })).data?.code,
  'bad_amount',
);
const closed = ok(
  'close the empty box',
  await owner.put(`/money-accounts/${empty.id}`, { isActive: false }),
);
eq('closed', closed.isActive, false);
eq(
  'a closed account takes nothing',
  (await R(owner, { lines: [{ method: 'CASH', accountId: empty.id, amount: 100 }] })).data?.code,
  'account_not_found',
);
eq(
  "a bank can't be default",
  (await owner.put(`/money-accounts/${bank.id}`, { isDefault: true })).data?.code,
  'bad_default',
);

console.log('== statement adds up');
st = ok('box statement today', await owner.get(`/money-accounts/${box.id}/movements`));
eq('closing = balance', st.closing, await bal(box.id));
let run = st.opening,
  chain = true;
for (const m of st.movements) {
  run += m.amount;
  if (m.balanceAfter !== run) chain = false;
}
check("each line's balance follows the last", chain, st.movements.slice(0, 5));
check(
  'seq has no gaps',
  st.movements.every((m, i) => i === 0 || m.seq === st.movements[i - 1].seq + 1),
);
check(
  'kinds recorded',
  [
    'OPENING',
    'SALE_PAID',
    'RECEIPT',
    'PAYMENT',
    'PURCHASE_PAID',
    'EXPENSE',
    'TRANSFER_OUT',
    'CANCELLATION',
    'SALES_REFUND',
    'PURCHASE_REFUND',
    'CARRIER_SETTLEMENT',
  ].every((k) => st.movements.some((m) => m.kind === k)),
  [...new Set(st.movements.map((m) => m.kind))],
);

console.log('== races');
const raceBox = ok(
  'a box with 100.00',
  await A({ name: `Race ${tag}`, kind: 'CASH_BOX', openingBalance: 10000 }),
);
const pay70 = () =>
  Pay(owner, { lines: [{ method: 'CASH', accountId: raceBox.id, amount: 7000 }] });
const races = await Promise.all([pay70(), pay70(), pay70()]);
eq('only one 70.00 payment fits in 100.00', races.map((r) => r.status).sort(), [201, 400, 400]);
eq('the box never went below zero', await bal(raceBox.id), 3000);
const s6 = ok('invoice for the race', await sell(owner, {}, 3));
const rc = () =>
  R(owner, {
    lines: [{ method: 'CASH', accountId: box.id, amount: 3000 }],
    allocations: [{ documentId: s6.id, amount: 3000 }],
  });
const rr = await Promise.all([rc(), rc()]);
eq('an invoice is settled once', rr.map((r) => r.status).sort(), [201, 400]);
eq('the other was told', rr.find((r) => r.status === 400).data?.code, 'over_outstanding');
const cb2 = (await party(cust2.id)).balance;
const many = await Promise.all([1, 2, 3, 4].map(() => sell(owner, {}, 1, cust2.id)));
eq(
  'four sales to one customer at once',
  many.map((m) => m.status),
  [201, 201, 201, 201],
);
eq('no sale lost from the balance', (await party(cust2.id)).balance - cb2, 4000);

console.log('== branch scoping');
const email = `cashier.${tag}@skb.local`;
const cashier = ok(
  'a cashier in the other branch',
  await owner.post('/staff', {
    fullName: `Cashier ${tag}`,
    email,
    password: 'Str0ngPass!',
    role: 'SALES',
    branchId: otherId,
  }),
);
ok(
  'give receipts',
  await owner.put(`/staff/${cashier.id}/permissions`, {
    granted: ['receipts:view', 'receipts:create'],
  }),
);
const cash = await login(email, 'Str0ngPass!');
const seen = ok('cashier lists accounts', await cash.get('/money-accounts'));
check(
  'only their branch',
  seen.length > 0 && seen.every((a) => a.branchId === otherId),
  seen.map((a) => a.branchName),
);
eq(
  "can't use a main-branch box",
  (
    await cash.post('/receipts', {
      partyId: cust.id,
      lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
    })
  ).data?.code,
  'account_not_found',
);
eq(
  "can't see main-branch invoices",
  (await cash.get(`/parties/${cust.id}/open-invoices`)).data.length,
  0,
);
const otherBox = seen.find((a) => a.isDefault);
const cr = ok(
  'cashier takes a receipt in their branch',
  await cash.post('/receipts', {
    partyId: cust.id,
    lines: [{ method: 'CASH', accountId: otherBox.id, amount: 100 }],
  }),
);
check(
  'cashier sees only their vouchers',
  (await cash.get('/vouchers?pageSize=100')).data.items.every(
    (v) => v.branchName === cr.branchName,
  ),
);
eq('main-branch voucher hidden', (await cash.get(`/vouchers/${r2.id}`)).status, 404);
eq(
  "can't add accounts",
  (await cash.post('/money-accounts', { branchId: otherId, name: 'x', kind: 'BANK' })).status,
  403,
);

console.log('== dashboard');
const dash = ok('dashboard', await owner.get('/dashboard'));
const cashKpi = dash.kpis.find(
  (k) => k.labelKey === 'kpi.cashPosition' || k.key === 'kpi.cashPosition',
);
const sum = (await owner.get('/money-accounts')).data
  .filter((a) => a.isActive)
  .reduce((s, a) => s + a.balance, 0);
eq('cash position = money accounts', cashKpi?.value, sum);
eq('signed out', (await fetch(`${BASE}/money-accounts`)).status, 401);

process.exit(summary('money') ? 1 : 0);
