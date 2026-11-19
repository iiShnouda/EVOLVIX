// A discount or an increase on the sales invoice screen (owner, 2026-11-19): on an item or on the
// whole invoice, as a percent or as an amount (on an item, an amount a piece too) — each its own
// permission, on a new invoice, a changed one and a pending one. Nothing compounds (owner,
// 2026-11-19): on an item both percents are of quantity × price, on the invoice both are of the
// items' total, so an increase and a discount net out (+10% +2.00 −5% −1.00 on 200.00 = 211.00).
// The second invoice discount is on what is left after the first; taxes on the result. An increase
// is sales (it raises the invoice and the customer's debt); the net discount keeps to the person's
// limit and never goes below cost. Runs against BASE.
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const dozen = units.find((u) => ['دستة', 'Dozen'].includes(u.name));
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
    units: [
      { unitId: piece.id, factor: 1 },
      { unitId: dozen.id, factor: 12 },
    ],
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

console.log('== nothing compounds: the owner’s example');
// On 200.00: +10% (20.00) + 2.00 and −5% (10.00) − 1.00 is a net +5% + 1.00 = 211.00.
const OWNER_LINE = {
  increasePercent: 10,
  increaseAmount: 200,
  discountPercent: 5,
  discountAmount: 100,
};
const onItem = ok('on the item', await owner.post('/sales/invoices', sale(OWNER_LINE)));
eq(
  '…+22.00 −11.00 = 211.00',
  [
    onItem.lines[0].increase,
    onItem.lines[0].discount,
    onItem.lines[0].lineTotal,
    onItem.grandTotal,
  ],
  [2200, 1100, 21100, 21100],
);
const onInvoice = ok(
  'on the invoice',
  await owner.post(
    '/sales/invoices',
    sale({}, [
      { kind: 'INCREASE', percent: 10 },
      { kind: 'INCREASE', amount: 200 },
      { kind: 'DISCOUNT', percent: 5 },
      { kind: 'DISCOUNT', amount: 100 },
    ]),
  ),
);
eq(
  '…the rows +20.00 +2.00 −10.00 −1.00, 211.00',
  [onInvoice.charges.map((c) => c.amount), onInvoice.grandTotal],
  [[2000, 200, 1000, 100], 21100],
);
eq(
  '…the line’s shares',
  [onInvoice.lines[0].docIncrease, onInvoice.lines[0].docDiscount],
  [2200, 1100],
);
eq(
  'the order typed makes no difference (discount before increase)',
  (
    await owner.post(
      '/sales/invoices',
      sale({}, [
        { kind: 'DISCOUNT', percent: 5 },
        { kind: 'DISCOUNT', amount: 100 },
        { kind: 'INCREASE', percent: 10 },
        { kind: 'INCREASE', amount: 200 },
      ]),
    )
  ).data?.grandTotal,
  21100,
);
const extra = ok(
  'the second discount is on what is left after the first',
  await owner.post(
    '/sales/invoices',
    sale({}, [
      { kind: 'INCREASE', percent: 10 },
      { kind: 'DISCOUNT', percent: 10 },
      { kind: 'EXTRA_DISCOUNT', percent: 10 },
    ]),
  ),
);
eq(
  '…200 +20 −20 = 200, then −10% = 180.00',
  [extra.charges.map((c) => c.amount), extra.grandTotal],
  [[2000, 2000, 2000], 18000],
);

console.log('== a discount or an increase a piece');
const perPiece = ok(
  '1.50 off a piece on 2 pieces',
  await owner.post('/sales/invoices', sale({ discountPerPiece: 150 })),
);
eq(
  '…3.00 off, kept as typed',
  [perPiece.lines[0].discount, perPiece.lines[0].discountPiece, perPiece.grandTotal],
  [300, 150, 19700],
);
const byDozen = ok(
  'a dozen at 1,200.00: 1.00 off a piece, +0.50 a piece, 10% off',
  await owner.post(
    '/sales/invoices',
    sale(
      {
        unitId: dozen.id,
        unitPrice: 120000,
        discountPerPiece: 100,
        increasePerPiece: 50,
        discountPercent: 10,
      },
      [],
      1,
    ),
  ),
);
eq(
  '…a piece is the smallest unit: +6.00, −12.00 −120.00 = 1,074.00',
  [byDozen.lines[0].increase, byDozen.lines[0].discount, byDozen.grandTotal],
  [600, 13200, 107400],
);
eq(
  'with the owner’s example, 1.00 off a piece more: 211.00 − 2.00',
  (await owner.post('/sales/invoices', sale({ ...OWNER_LINE, discountPerPiece: 100 }))).data
    ?.grandTotal,
  20900,
);
{
  const pctOnly = await only(['sales:discount_line_pct', 'sales:increase_line_pct']);
  eq(
    'a piece’s discount is an amount: not with the percent alone',
    (await pctOnly.post('/sales/invoices', sale({ discountPerPiece: 100 }))).data?.code,
    'discount_line_amount_not_allowed',
  );
  eq(
    '…nor a piece’s increase',
    (await pctOnly.post('/sales/invoices', sale({ increasePerPiece: 100 }))).data?.code,
    'increase_line_amount_not_allowed',
  );
  const amounts = await only(['sales:discount_line_amount', 'sales:increase_line_amount']);
  const pp = ok(
    'with the amount permission, both',
    await amounts.post('/sales/invoices', sale({ discountPerPiece: 100, increasePerPiece: 30 })),
  );
  eq('…2 × (−1.00 + 0.30) = 198.60', pp.grandTotal, 19860);
  const editor = await only([], ['sales:edit']);
  const more = ok(
    'someone without them changes the quantity: the piece’s discount follows it',
    await editor.put(
      `/sales/invoices/${pp.id}`,
      sale({ discountPerPiece: 100, increasePerPiece: 30 }, [], 3),
    ),
  );
  eq('…3 × (100.00 − 1.00 + 0.30) = 297.90', more.grandTotal, 29790);
  eq(
    '…not another amount a piece',
    (
      await editor.put(
        `/sales/invoices/${pp.id}`,
        sale({ discountPerPiece: 120, increasePerPiece: 30 }, [], 3),
      )
    ).data?.code,
    'discount_line_amount_not_allowed',
  );
  eq(
    'a negative amount a piece is refused',
    (await owner.post('/sales/invoices', sale({ discountPerPiece: -1 }))).data?.code,
    'bad_amount',
  );
  eq(
    'more off than the line is refused',
    (await owner.post('/sales/invoices', sale({ discountPerPiece: 10001 }))).data?.code,
    'bad_price',
  );
}

console.log('== all of them, with the tax (worked example)');
// 2 × 100.00 = 200.00; item +10% (20.00) + 2.00 − 5% (10.00) − 1.00 = 211.00;
// invoice on 211.00: +2% (4.22) + 1.00 − 10% (21.10) − 0.54 = 194.58; tax 14% (27.24) = 221.82.
const customerBefore = (await owner.get(`/parties/${customer.id}`)).data.balance;
const all = ok(
  'the owner types every box',
  await owner.post(
    '/sales/invoices',
    sale(OWNER_LINE, [
      { kind: 'INCREASE', percent: 2 },
      { kind: 'INCREASE', amount: 100 },
      { kind: 'DISCOUNT', percent: 10 },
      { kind: 'DISCOUNT', amount: 54 },
      { kind: 'TAX', percent: 14 },
    ]),
  ),
);
const L = all.lines[0];
eq('the item: +22.00, −11.00', [L.increase, L.discount], [2200, 1100]);
eq(
  '…as typed',
  [L.increaseRate, L.increaseFixed, L.discountRate, L.discountFixed],
  [10, 200, 5, 100],
);
eq('…its share of the invoice’s +5.22 and −21.64', [L.docIncrease, L.docDiscount], [522, 2164]);
eq('…what it brings in', L.lineTotal - L.docDiscount, 19458);
eq(
  'the invoice’s rows, in order',
  all.charges.map((c) => [c.kind, c.rate ?? c.fixedAmount, c.amount]),
  [
    ['INCREASE', 2, 422],
    ['INCREASE', 100, 100],
    ['DISCOUNT', 10, 2110],
    ['DISCOUNT', 54, 54],
    ['TAX', 14, 2724],
  ],
);
eq(
  'the totals',
  [all.subtotal, all.discountTotal, all.taxTotal, all.grandTotal],
  [22722, 3264, 2724, 22182],
);
eq(
  'the customer owes it',
  (await owner.get(`/parties/${customer.id}`)).data.balance - customerBefore,
  22182,
);
const entries =
  (await owner.get('/ledger/entries?source=SALES_INVOICE&pageSize=100')).data.items ?? [];
const entry = entries.find((e) => e.sourceId === all.id);
check('it is in the journal', !!entry);
if (entry) {
  const sales = entry.lines
    .filter((l) => l.accountCode === '4101')
    .reduce((s, l) => s + l.credit - l.debit, 0);
  eq('sales is what it came to, the increases in it, the discounts out', sales, 19458);
  eq(
    'the journal balances',
    entry.lines.reduce((s, l) => s + l.debit - l.credit, 0),
    0,
  );
}
eq('profit on the net', all.profitTotal, 19458 - 12000);

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
  '…10% off with +20% is within it',
  await limited.post('/sales/invoices', sale({ increasePercent: 20, discountPercent: 10 })),
);
ok(
  'the net discount is what counts: +5% and 14% off is 9% off',
  await limited.post('/sales/invoices', sale({ increasePercent: 5, discountPercent: 14 })),
);
eq(
  '…+5% and 16% off is 11% off',
  (await limited.post('/sales/invoices', sale({ increasePercent: 5, discountPercent: 16 }))).data
    ?.code,
  'discount_over_limit',
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
check('…but an increase counts: +10% and 45% off is 130.00', lifted.data?.code !== 'below_cost');
eq(
  '…and +5% and 45% off is 120.00, so 0.02 off the invoice is below it',
  (
    await free.post(
      '/sales/invoices',
      sale({ increasePercent: 5, discountPercent: 45 }, [{ kind: 'DISCOUNT', amount: 2 }], 2, {
        overrideFloor: true,
      }),
    )
  ).data?.code,
  'below_cost',
);

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
  '…the increase stays, the discount of 10% of 200.00',
  [approved.type, approved.lines[0].increase, approved.lines[0].discount, approved.grandTotal],
  ['SALES_INVOICE', 500, 2000, 18500],
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
  [2200, 1100, 522],
);
eq(
  'the item’s amount without the invoice’s share',
  shown.lines[0].lineTotal - shown.lines[0].docIncrease,
  21100,
);
eq(
  'the invoice’s increase, discount and tax rows',
  shown.charges.map((c) => c.kind),
  ['INCREASE', 'INCREASE', 'DISCOUNT', 'DISCOUNT', 'TAX'],
);
eq(
  'subtotal shown (without the invoice’s increase) + rows = total',
  shown.subtotal - shown.lines[0].docIncrease - shown.lines[0].discount + 522 - 2164 + 2724,
  shown.grandTotal,
);

process.exit(summary('invoiceadjust') ? 1 : 0);
