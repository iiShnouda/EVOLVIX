// A discount or an increase on the sales invoice screen (owner, 2026-11-19): on an item or on the
// whole invoice, as a percent or as an amount — eight boxes, each its own permission, on a new
// invoice, a changed one and a pending one. The order: the item's increase on its price, then its
// discount on what that comes to; then the invoice's increase, then its discount. An increase is
// sales (it raises the invoice and the customer's debt); a discount keeps to the person's limit and
// never goes below cost. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const saleLevel = (await owner.get('/price-levels')).data.find(
  (l) => l.side === 'SALE' && l.isDefault,
);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const cat = ok('a category', await owner.post('/categories', { name: `Adj ${tag}` }));
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `AdjSup ${tag}`, types: ['SUPPLIER'] }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `AdjCust ${tag}`, types: ['CUSTOMER'] }),
);
const item = ok(
  'an item at 100.00',
  await owner.post('/products', {
    name: `Jacket ${tag}`,
    categoryId: cat.id,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 10000 }],
  }),
);
ok(
  '200 bought at 60.00',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [{ productId: item.id, quantity: 200, unitCost: 6000 }],
  }),
);
eq(
  'a purchase takes no increase',
  (
    await owner.post('/purchases/invoices', {
      partyId: supplier.id,
      warehouseId: wh.id,
      lines: [{ productId: item.id, quantity: 1, unitCost: 6000 }],
      charges: [{ kind: 'INCREASE', percent: 5 }],
    })
  ).data?.code,
  'bad_charge',
);

/** A sale of `qty` at 100.00 with these line boxes and invoice charges. */
const sale = (line = {}, charges = [], qty = 2, extra = {}) => ({
  partyId: customer.id,
  warehouseId: wh.id,
  charges,
  lines: [{ productId: item.id, quantity: qty, unitPrice: 10000, ...line }],
  ...extra,
});

// The eight boxes: the permission, what is typed, and the line total it makes on 2 × 100.00.
const BOXES = [
  ['sales:discount_line_pct', 'discount_line_pct_not_allowed', { discountPercent: 10 }, [], 18000],
  [
    'sales:discount_line_amount',
    'discount_line_amount_not_allowed',
    { discountAmount: 500 },
    [],
    19500,
  ],
  ['sales:increase_line_pct', 'increase_line_pct_not_allowed', { increasePercent: 10 }, [], 22000],
  [
    'sales:increase_line_amount',
    'increase_line_amount_not_allowed',
    { increaseAmount: 500 },
    [],
    20500,
  ],
  [
    'sales:discount_pct',
    'discount_pct_not_allowed',
    {},
    [{ kind: 'DISCOUNT', percent: 10 }],
    18000,
  ],
  [
    'sales:discount_amount',
    'discount_amount_not_allowed',
    {},
    [{ kind: 'DISCOUNT', amount: 500 }],
    19500,
  ],
  [
    'sales:increase_pct',
    'increase_pct_not_allowed',
    {},
    [{ kind: 'INCREASE', percent: 10 }],
    22000,
  ],
  [
    'sales:increase_amount',
    'increase_amount_not_allowed',
    {},
    [{ kind: 'INCREASE', amount: 500 }],
    20500,
  ],
];
const ALL = BOXES.map((b) => b[0]);

console.log('== the roles');
const karim = await login('karim@skb.local');
check(
  'a seller may increase an item (they could raise a price)',
  ['sales:increase_line_pct', 'sales:increase_line_amount'].every((p) =>
    karim.user.permissions.includes(p),
  ),
);
check(
  '…but not the whole invoice, nor give a discount',
  [
    'sales:increase_pct',
    'sales:increase_amount',
    'sales:discount_pct',
    'sales:discount_amount',
    'sales:discount_line_pct',
    'sales:discount_line_amount',
  ].every((p) => !karim.user.permissions.includes(p)),
);
check(
  'the old discount permissions are gone',
  !karim.user.permissions.some((p) => p === 'sales:discount' || p === 'sales:discount_line'),
);

console.log('== each box is its own permission');
const sellerEmail = `adj.${tag}@skb.local`;
const sellerStaff = ok(
  'a seller',
  await owner.post('/staff', {
    fullName: `Adj ${tag}`,
    email: sellerEmail,
    password: PASS,
    role: 'SALES',
    branchId: owner.user.branchId,
  }),
);
/** The seller holding exactly these of the eight (the role's own two increases taken away unless named). */
const only = async (granted, extra = []) => {
  ok(
    `only ${granted.join(', ') || 'none of them'}`,
    await owner.put(`/staff/${sellerStaff.id}/permissions`, {
      granted: [...granted, ...extra],
      revoked: ALL.filter((p) => !granted.includes(p)),
    }),
  );
  return login(sellerEmail, PASS);
};

for (const [perm, , line, charges, total] of BOXES) {
  const who = await only([perm]);
  check(`${perm}: held alone`, ALL.filter((p) => who.user.permissions.includes(p)).join() === perm);
  const r = ok(
    `${perm}: its box on a new invoice`,
    await who.post('/sales/invoices', sale(line, charges)),
  );
  if (r) {
    eq(`${perm}: …comes to ${total / 100}`, r.grandTotal, total);
  }
  for (const [other, code, oLine, oCharges] of BOXES) {
    if (other === perm) continue;
    const refused = await who.post('/sales/invoices', sale(oLine, oCharges));
    eq(`${perm}: not ${other}`, [refused.status, refused.data?.code], [403, code]);
  }
}
const none = await only([]);
eq(
  'with none of them, a plain sale still goes',
  (await none.post('/sales/invoices', sale())).status,
  201,
);
eq(
  '…a zero box needs nothing',
  (await none.post('/sales/invoices', sale({ increasePercent: 0, increaseAmount: 0 }))).status,
  201,
);

console.log('== percents and amounts');
eq(
  'a percent above 100 is refused',
  (await owner.post('/sales/invoices', sale({ discountPercent: 101 }))).data?.code,
  'bad_percent',
);
eq(
  '…with more than 2 decimals too',
  (await owner.post('/sales/invoices', sale({ increasePercent: 1.234 }))).data?.code,
  'bad_percent',
);
eq(
  'a negative amount is refused',
  (await owner.post('/sales/invoices', sale({ increaseAmount: -1 }))).data?.code,
  'bad_amount',
);
eq(
  'a discount over the line is refused',
  (await owner.post('/sales/invoices', sale({ discountAmount: 30000 }))).data?.code,
  'bad_price',
);
eq(
  'free goods take none',
  (
    await owner.post(
      '/sales/invoices',
      sale({}, [], 1, {
        lines: [
          { productId: item.id, quantity: 1, unitPrice: 0, isBonus: true, increaseAmount: 100 },
        ],
      }),
    )
  ).data?.code,
  'bad_bonus',
);

console.log('== all of them, in order (worked example)');
// 2 × 100.00 = 200.00; item +10% (20.00) + 3.00 = 223.00; −5% (11.15) − 2.00 = 209.85;
// invoice +2% (4.20) + 1.00 = 215.05; −10% (21.51) − 0.54 = 193.00.
const customerBefore = (await owner.get(`/parties/${customer.id}`)).data.balance;
const all = ok(
  'the owner types every box',
  await owner.post(
    '/sales/invoices',
    sale({ increasePercent: 10, increaseAmount: 300, discountPercent: 5, discountAmount: 200 }, [
      { kind: 'INCREASE', percent: 2 },
      { kind: 'INCREASE', amount: 100 },
      { kind: 'DISCOUNT', percent: 10 },
      { kind: 'DISCOUNT', amount: 54 },
    ]),
  ),
);
const L = all.lines[0];
eq('the item: +23.00, −13.15', [L.increase, L.discount], [2300, 1315]);
eq(
  '…as typed',
  [L.increaseRate, L.increaseFixed, L.discountRate, L.discountFixed],
  [10, 300, 5, 200],
);
eq('…its share of the invoice’s +5.20 and −22.05', [L.docIncrease, L.docDiscount], [520, 2205]);
eq('…what it brings in', L.lineTotal - L.docDiscount, 19300);
eq(
  'the invoice’s rows, in order',
  all.charges.map((c) => [c.kind, c.rate ?? c.fixedAmount, c.amount]),
  [
    ['INCREASE', 2, 420],
    ['INCREASE', 100, 100],
    ['DISCOUNT', 10, 2151],
    ['DISCOUNT', 54, 54],
  ],
);
eq('the totals', [all.subtotal, all.discountTotal, all.grandTotal], [22820, 3520, 19300]);
eq(
  'the customer owes it',
  (await owner.get(`/parties/${customer.id}`)).data.balance - customerBefore,
  19300,
);
const entries =
  (await owner.get('/ledger/entries?source=SALES_INVOICE&pageSize=100')).data.items ?? [];
const entry = entries.find((e) => e.sourceId === all.id);
check('it is in the journal', !!entry);
if (entry) {
  const sales = entry.lines
    .filter((l) => l.accountCode === '4101')
    .reduce((s, l) => s + l.credit - l.debit, 0);
  eq('sales is what it came to, the increases in it, the discounts out', sales, 19300);
  eq(
    'the journal balances',
    entry.lines.reduce((s, l) => s + l.debit - l.credit, 0),
    0,
  );
}
eq('profit on the net', all.profitTotal, 19300 - 12000);

console.log('== limits and cost');
await only(['sales:discount_line_pct', 'sales:increase_line_pct', 'sales:discount_pct']);
ok(
  'a 10% limit',
  await owner.put(`/staff/${sellerStaff.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    maxDiscountPercent: 10,
  }),
);
const limited = await login(sellerEmail, PASS);
ok('10% off is within it', await limited.post('/sales/invoices', sale({ discountPercent: 10 })));
eq(
  '11% is not',
  (await limited.post('/sales/invoices', sale({ discountPercent: 11 }))).data?.code,
  'discount_over_limit',
);
eq(
  '…nor 6% on the item and 5% on the invoice',
  (
    await limited.post(
      '/sales/invoices',
      sale({ discountPercent: 6 }, [{ kind: 'DISCOUNT', percent: 5 }]),
    )
  ).data?.code,
  'discount_over_limit',
);
ok(
  'an increase is not a discount: +50% has no limit',
  await limited.post('/sales/invoices', sale({ increasePercent: 50 })),
);
ok(
  '…10% off the raised price is within it',
  await limited.post('/sales/invoices', sale({ increasePercent: 20, discountPercent: 10 })),
);
ok(
  'no limit again',
  await owner.put(`/staff/${sellerStaff.id}/access`, {
    allBranches: null,
    branchIds: [],
    warehouseIds: [],
    moneyAccountIds: [],
    maxDiscountPercent: null,
  }),
);
const free = await only([
  'sales:discount_line_pct',
  'sales:increase_line_pct',
  'sales:discount_amount',
]);
eq(
  'below cost is refused (45% off: 110.00 for 120.00)',
  (await free.post('/sales/invoices', sale({ discountPercent: 45 }))).data?.code,
  'below_cost',
);
eq(
  '…on the invoice too',
  (await free.post('/sales/invoices', sale({}, [{ kind: 'DISCOUNT', amount: 9000 }]))).data?.code,
  'below_cost',
);
const lifted = await free.post(
  '/sales/invoices',
  sale({ increasePercent: 10, discountPercent: 45 }, [], 2, { overrideFloor: true }),
);
check('…but an increase counts: +10% then 45% off is 121.00', lifted.data?.code !== 'below_cost');

console.log('== changing an invoice');
const base = ok(
  'the owner sells with 10% off the item and +5% on the invoice',
  await owner.post(
    '/sales/invoices',
    sale({ discountPercent: 10 }, [{ kind: 'INCREASE', percent: 5 }]),
  ),
);
eq('…189.00', base.grandTotal, 18900);
const editor = await only([], ['sales:edit']);
const same = ok(
  'someone without them keeps both while changing the quantity',
  await editor.put(
    `/sales/invoices/${base.id}`,
    sale({ discountPercent: 10 }, [{ kind: 'INCREASE', percent: 5 }], 3),
  ),
);
eq('…3 × 100.00 −10% +5% = 283.50', same.grandTotal, 28350);
eq(
  '…not another percent',
  (
    await editor.put(
      `/sales/invoices/${base.id}`,
      sale({ discountPercent: 12 }, [{ kind: 'INCREASE', percent: 5 }], 3),
    )
  ).data?.code,
  'discount_line_pct_not_allowed',
);
eq(
  '…nor taking the increase off',
  (await editor.put(`/sales/invoices/${base.id}`, sale({ discountPercent: 10 }, [], 3))).data?.code,
  'increase_pct_not_allowed',
);
const changer = await only(['sales:increase_pct'], ['sales:edit']);
const less = ok(
  'whoever may increase the invoice takes it off',
  await changer.put(`/sales/invoices/${base.id}`, sale({ discountPercent: 10 }, [], 3)),
);
eq('…270.00', less.grandTotal, 27000);

console.log('== a pending invoice and its approval');
const order = await only(['sales:increase_line_amount'], ['sales:order']);
const o1 = ok(
  'saved with 5.00 on the item',
  await order.post('/sales/orders', sale({ increaseAmount: 500 })),
);
eq('…205.00, waiting', [o1.grandTotal, o1.status], [20500, 'PENDING']);
const accEmail = `adjacc.${tag}@skb.local`;
ok(
  'an accountant',
  await owner.post('/staff', {
    fullName: `AdjAcc ${tag}`,
    email: accEmail,
    password: PASS,
    role: 'ACCOUNTANT',
    branchId: owner.user.branchId,
  }),
);
const accountant = await login(accEmail, PASS);
check(
  'the accountant has all eight',
  ALL.every((p) => accountant.user.permissions.includes(p)),
);
const approved = ok(
  'approved, with 10% off the item now',
  await accountant.post(`/sales/orders/${o1.id}/approve`, {
    lineDiscounts: [{ lineId: o1.lines[0].id, discount: 0, percent: 10 }],
  }),
);
eq(
  '…the increase stays, the discount on the raised price',
  [approved.type, approved.lines[0].increase, approved.lines[0].discount, approved.grandTotal],
  ['SALES_INVOICE', 500, 2050, 18450],
);
const o2 = ok(
  'another, with +2% on the invoice by the owner',
  await owner.post('/sales/orders', sale({}, [{ kind: 'INCREASE', percent: 2 }])),
);
const a2 = ok('approved as it is', await accountant.post(`/sales/orders/${o2.id}/approve`, {}));
eq('…204.00', [a2.grandTotal, a2.charges.find((c) => c.kind === 'INCREASE')?.amount], [20400, 400]);

console.log('== the customer’s invoices');
const pctOnly = await only(['sales:discount_line_pct', 'sales:discount_pct']);
const c1 = ok(
  'a percent off an item there',
  await pctOnly.post(`/sales/invoices/${base.id}/line-discounts`, {
    lines: [{ lineId: less.lines[0].id, discount: 0, percent: 20 }],
  }),
);
eq('…20% of 300.00, kept as typed', [c1.lines[0].discount, c1.lines[0].discountRate], [6000, 20]);
eq(
  '…not an amount',
  (
    await pctOnly.post(`/sales/invoices/${base.id}/line-discounts`, {
      lines: [{ lineId: less.lines[0].id, discount: 100 }],
    })
  ).data?.code,
  'discount_line_amount_not_allowed',
);
eq(
  '…nor an amount off the invoice',
  (await pctOnly.post(`/sales/invoices/${base.id}/discount`, { amount: 100 })).data?.code,
  'discount_amount_not_allowed',
);
const c2 = ok(
  'a percent off the invoice',
  await pctOnly.post(`/sales/invoices/${base.id}/discount`, { percent: 5 }),
);
eq('…240.00 − 5% = 228.00', c2.grandTotal, 22800);
const amtOnly = await only(['sales:discount_amount']);
eq(
  'an amount-only person can’t give a percent',
  (await amtOnly.post(`/sales/invoices/${base.id}/discount`, { percent: 6 })).data?.code,
  'discount_pct_not_allowed',
);
const inc = ok(
  'an invoice with +10% on the invoice',
  await owner.post('/sales/invoices', sale({}, [{ kind: 'INCREASE', percent: 10 }])),
);
const inc2 = ok(
  '…10.00 off its item there',
  await owner.post(`/sales/invoices/${inc.id}/line-discounts`, {
    lines: [{ lineId: inc.lines[0].id, discount: 1000 }],
  }),
);
eq(
  '…its increase is worked out again: (200 − 10) + 10% = 209.00',
  [inc2.grandTotal, inc2.lines[0].docIncrease],
  [20900, 1900],
);

console.log('== what prints');
const shown = ok('read back', await owner.get(`/sales/invoices/${all.id}`));
eq(
  'each line’s increase and discount, and its share of the invoice’s',
  [shown.lines[0].increase, shown.lines[0].discount, shown.lines[0].docIncrease],
  [2300, 1315, 520],
);
eq(
  'the item’s amount without the invoice’s share',
  shown.lines[0].lineTotal - shown.lines[0].docIncrease,
  20985,
);
eq(
  'the invoice’s increase and discount rows',
  shown.charges.map((c) => c.kind),
  ['INCREASE', 'INCREASE', 'DISCOUNT', 'DISCOUNT'],
);
eq(
  'subtotal shown (without the invoice’s increase) + rows = total',
  shown.subtotal - shown.lines[0].docIncrease - shown.lines[0].discount + 520 - 2205,
  shown.grandTotal,
);

process.exit(summary('invoiceadjust') ? 1 : 0);
