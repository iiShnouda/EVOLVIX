// Sales reps' commission (owner, 2026-11-18): rules (a percent of net sales or of collections, for
// every department or one, from a day on), the report per rep — sales, returns, net, collected and
// the commission, with the invoices behind it — after discounts and without tax, adding a month's
// commission to the payroll of the employee the rep is (once), permissions and scoping by branch and
// department. Makes its own reps, items and customer, so it can run again. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, addDays, sellDiscounted } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const PASS = `Commission-${tag}-Check1`;
const owner = await login('owner@skb.local');
const sure = owner.confirmed();
const mona = await login('mona@skb.local'); // ACCOUNTANT: commission by default
const karim = await login('karim@skb.local'); // SALES: none of it
const today = companyToday();
const [Y, M] = today.split('-').map(Number);
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = addDays(
  `${Y + (M === 12 ? 1 : 0)}-${String((M % 12) + 1).padStart(2, '0')}-01`,
  -1,
);

console.log('== setup');
const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find(
  (w) => w.isDefault && w.branchId === owner.user.branchId,
);
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.kind === 'CASH_BOX' && a.branchId === owner.user.branchId && a.isActive !== false,
);
const supplier = ok(
  'a supplier',
  await owner.post('/parties', { name: `CSup ${tag}`, types: ['SUPPLIER'] }),
);
const customer = ok(
  'a customer',
  await owner.post('/parties', { name: `CCust ${tag}`, types: ['CUSTOMER'] }),
);
const rep = async (name) =>
  ok(
    `rep ${name}`,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email: `${name.toLowerCase()}.${tag}@skb.local`,
      password: PASS,
      role: 'SALES',
      branchId: owner.user.branchId,
    }),
  );
const R1 = await rep('Rami');
const R2 = await rep('Reda');
const E1 = ok(
  'Rami is an employee too',
  await owner.post('/payroll/employees', {
    name: `Rami ${tag}`,
    branchId: owner.user.branchId,
    monthlySalary: 400000,
    staffId: R1.id,
  }),
);
const dA = ok('department A', await owner.post('/departments', { name: `CA ${tag}` }));
const dB = ok('department B', await owner.post('/departments', { name: `CB ${tag}` }));
const gA = ok('its group', await owner.post('/groups', { departmentId: dA.id, name: `GA ${tag}` }));
const gB = ok('its group', await owner.post('/groups', { departmentId: dB.id, name: `GB ${tag}` }));
const item = async (name, groupId, price) =>
  ok(
    `item ${name}`,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: groupId,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price }],
    }),
  );
const IA = await item('ComA', gA.id, 1000);
const IB = await item('ComB', gB.id, 2000);
ok(
  'stock in',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [
      { productId: IA.id, quantity: 100, unitCost: 500 },
      { productId: IB.id, quantity: 100, unitCost: 1000 },
    ],
  }),
);

console.log('== permissions');
const rule = (who, body) => who.post('/commission/rules', body);
eq("sales staff can't set rules", (await rule(karim, { repId: R1.id })).status, 403);
eq('…nor see the report', (await karim.get('/commission/report')).status, 403);
eq(
  '…nor add it to the payroll',
  (await karim.post('/commission/payroll', { repId: R1.id, year: Y, month: M })).status,
  403,
);

console.log('== rules');
const base = { repId: R1.id, basis: 'NET_SALES', percent: 5, startDate: addDays(today, -40) };
eq('a rep', (await rule(mona, { ...base, repId: 'x' })).data?.code, 'rep_not_found');
eq(
  'net sales or collections',
  (await rule(mona, { ...base, basis: 'PROFIT' })).data?.code,
  'bad_basis',
);
for (const percent of [0, 101, 1.234])
  eq(`not ${percent}%`, (await rule(mona, { ...base, percent })).data?.code, 'bad_percent');
const r1 = ok('Rami: 5% of net sales, every department', await rule(mona, base));
eq(
  'kept',
  [r1.repName, r1.basis, r1.percentBp, r1.departmentId, r1.startDate, r1.employeeId],
  [R1.fullName, 'NET_SALES', 500, null, addDays(today, -40), E1.id],
);
eq('once per rep, department and day', (await rule(mona, base)).data?.code, 'rule_exists');
const r1b = ok(
  'Rami: 10% in department B',
  await rule(mona, { ...base, percent: 10, departmentId: dB.id }),
);
const later = ok(
  'Rami: 50% from tomorrow (not yet)',
  await rule(mona, { ...base, percent: 50, startDate: addDays(today, 1) }),
);
ok(
  'Reda: 2% of what is collected',
  await rule(mona, {
    repId: R2.id,
    basis: 'COLLECTIONS',
    percent: 2,
    startDate: addDays(today, -40),
  }),
);
const changed = ok(
  'changed to 60%',
  await mona.put(`/commission/rules/${later.id}`, { percent: 60 }),
);
eq('changed', changed.percentBp, 6000);
const rules = ok('the rules', await mona.get(`/commission/rules?repId=${R1.id}`));
eq('three for Rami', rules.length, 3);
check('department B named', rules.find((r) => r.id === r1b.id)?.departmentName === dB.name, rules);
const opts = ok('reps and departments', await mona.get('/commission/options'));
eq(
  'Rami is linked to his employee, Reda to none',
  [R1.id, R2.id].map((id) => opts.reps.find((r) => r.id === id)?.employeeId ?? null),
  [E1.id, null],
);

console.log('== sales, returns and collections');
// Rami, department A: 10 × 10.00, 10% off, 14% tax → 90.00 net of discounts, without tax.
const inv1 = ok(
  'Rami sells in A: 100.00 less 10%, plus 14% tax',
  await sellDiscounted(owner, owner, {
    partyId: customer.id,
    warehouseId: wh.id,
    repId: R1.id,
    departmentId: dA.id,
    lines: [{ productId: IA.id, quantity: 10, unitPrice: 1000 }],
    charges: [
      { kind: 'DISCOUNT', percent: 10 },
      { kind: 'TAX', percent: 14 },
    ],
  }),
);
eq('tax on top', [inv1.subtotal - inv1.discountTotal, inv1.taxTotal > 0], [9000, true]);
const inv2 = ok(
  'Rami sells in B: 5 × 20.00',
  await owner.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    repId: R1.id,
    departmentId: dB.id,
    taxPercent: 0,
    lines: [{ productId: IB.id, quantity: 5, unitPrice: 2000 }],
  }),
);
const inv3 = ok(
  'Reda sells in A: 10 × 10.00, 30.00 paid at once',
  await owner.post('/sales/invoices', {
    partyId: customer.id,
    warehouseId: wh.id,
    repId: R2.id,
    departmentId: dA.id,
    taxPercent: 0,
    paidAmount: 3000,
    paidAccountId: box.id,
    lines: [{ productId: IA.id, quantity: 10, unitPrice: 1000 }],
  }),
);
ok(
  'a receipt settles 40.00 of it',
  await owner.post('/receipts', {
    partyId: customer.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 4000 }],
    allocations: [{ documentId: inv3.id, amount: 4000 }],
  }),
);
const ret = ok(
  '2 of Rami’s A items come back (18.00 after the discount)',
  await sure.post('/sales/returns', {
    partyId: customer.id,
    warehouseId: wh.id,
    invoiceId: inv1.id,
    lines: [{ productId: IA.id, unitId: piece.id, quantity: 2 }],
  }),
);

console.log('== the report');
const report = async (who, q = `from=${today}&to=${today}`) =>
  ok('report', await who.get(`/commission/report?${q}`));
const rowOf = (rep, r) => r.rows.find((x) => x.repId === rep.id);
let rep1 = rowOf(R1, await report(mona));
const expected1 = {
  sales: 9000 + 10000,
  returns: 1800,
  net: 19000 - 1800,
  collected: 0,
  commission: 450 + 1000 - 90,
  invoices: 2,
};
eq(
  'Rami: 5% of A (less the return), 10% of B; the rule from tomorrow not yet',
  Object.fromEntries(Object.keys(expected1).map((k) => [k, rep1?.[k]])),
  expected1,
);
eq('linked to his employee', rep1.employeeId, E1.id);
const rep2 = rowOf(R2, await report(mona));
eq(
  'Reda: 2% of the 70.00 collected (paid at once and by receipt), not of the sale',
  [rep2.sales, rep2.net, rep2.collected, rep2.commission, rep2.employeeId],
  [10000, 10000, 7000, 140, null],
);
const items = ok(
  'what is behind Rami’s',
  await mona.get(`/commission/report/${R1.id}/items?from=${today}&to=${today}`),
);
eq(
  'two invoices and the return, each with its percent',
  items
    .map((i) => [i.kind, i.number, i.amount, i.percentBp, i.commission])
    .sort((a, b) => a[1].localeCompare(b[1])),
  [
    ['SALE', inv1.number, 9000, 500, 450],
    ['SALE', inv2.number, 10000, 1000, 1000],
    ['RETURN', ret.number, -1800, 500, -90],
  ].sort((a, b) => a[1].localeCompare(b[1])),
);
eq(
  'the return names the invoice it came from',
  items.find((i) => i.kind === 'RETURN')?.reference,
  inv1.number,
);
eq(
  'a day before: nothing',
  rowOf(R1, await report(mona, `from=${addDays(today, -1)}&to=${addDays(today, -1)}`)),
  undefined,
);
eq(
  'the last day before the first',
  (await mona.get(`/commission/report?from=${today}&to=${addDays(today, -1)}`)).data?.code,
  'bad_range',
);

console.log('== scoping');
const person = async (name, access) => {
  const email = `${name}.${tag}@skb.local`;
  const p = ok(
    name,
    await owner.post('/staff', {
      fullName: `${name} ${tag}`,
      email,
      password: PASS,
      role: 'NONE',
      branchId: access.branchId ?? owner.user.branchId,
    }),
  );
  ok(
    '…the report only',
    await owner.put(`/staff/${p.id}/permissions`, {
      granted: ['reports:commission', 'commission:setup'],
    }),
  );
  if (access.departmentIds)
    ok(
      '…of one department',
      await owner.put(`/staff/${p.id}/access`, {
        allBranches: null,
        branchIds: [],
        warehouseIds: [],
        moneyAccountIds: [],
        departmentIds: access.departmentIds,
      }),
    );
  return login(email, PASS);
};
const onlyB = await person('cdeptb', { departmentIds: [dB.id] });
const seenB = rowOf(R1, await report(onlyB));
eq(
  'department B only: the B invoice',
  [seenB?.sales, seenB?.returns, seenB?.commission],
  [10000, 0, 1000],
);
eq('…and not Reda’s A sale', rowOf(R2, await report(onlyB)), undefined);
eq(
  '…sees the rules of department B only',
  ok('rules', await onlyB.get(`/commission/rules?repId=${R1.id}`)).map((r) => r.id),
  [r1b.id],
);
eq(
  '…and can’t set one for every department',
  (await rule(onlyB, { ...base, startDate: addDays(today, -3) })).data?.code,
  'department_not_found',
);
const otherBranch = ok('another branch', await owner.post('/branches', { name: `CBr ${tag}` }));
const elsewhere = await person('cbranch', { branchId: otherBranch.id });
eq(
  'another branch sees none of it',
  [rowOf(R1, await report(elsewhere)), rowOf(R2, await report(elsewhere))],
  [undefined, undefined],
);
eq(
  '…nor a branch not theirs',
  (await elsewhere.get(`/commission/report?branchId=${owner.user.branchId}`)).data?.code,
  'branch_not_found',
);

console.log("== into the month's payroll");
eq(
  'Reda is no employee',
  (await mona.post('/commission/payroll', { repId: R2.id, year: Y, month: M })).data?.code,
  'not_linked',
);
eq(
  'not a month to come',
  (await mona.post('/commission/payroll', { repId: R1.id, year: Y + 1, month: M })).data?.code,
  'future_month',
);
const monthly = `from=${monthStart}&to=${monthEnd}`;
eq('not added yet', rowOf(R1, await report(mona, monthly)).addedToPayroll, false);
const added = await Promise.all([
  mona.post('/commission/payroll', { repId: R1.id, year: Y, month: M }),
  owner.post('/commission/payroll', { repId: R1.id, year: Y, month: M }),
]);
eq('added once, even at the same moment', added.map((r) => r.status).sort(), [200, 400]);
const done = added.find((r) => r.status === 200).data;
eq(
  'his month’s commission, to his employee',
  [done.employeeId, done.amount],
  [E1.id, expected1.commission],
);
eq(
  'not twice',
  (await mona.post('/commission/payroll', { repId: R1.id, year: Y, month: M })).data?.code,
  'already_added',
);
const adj = ok('the month’s bonuses', await mona.get(`/payroll/adjustments?year=${Y}&month=${M}`));
const bonus = adj.find((a) => a.employeeId === E1.id && a.commission);
eq('a bonus marked as commission', [bonus?.kind, bonus?.amount], ['BONUS', expected1.commission]);
eq('the report says so', rowOf(R1, await report(mona, monthly)).addedToPayroll, true);
const audit = ok('audited', await owner.get('/audit?resource=commission_rule'));
check(
  'rules made and changed',
  ['create', 'update'].every((a) => audit.items.some((e) => e.action === a)),
);
const audit2 = ok('audited', await owner.get('/audit?resource=payroll_adjustment'));
check(
  'the commission added',
  audit2.items.some((e) => e.action === 'commission' && e.resourceId === bonus?.id),
  audit2.items.slice(0, 3),
);
eq(
  'taken back from the payroll',
  (await mona.post(`/payroll/adjustments/${bonus.id}/cancel`)).status,
  204,
);
eq(
  '…so it can be added again',
  (await mona.post('/commission/payroll', { repId: R1.id, year: Y, month: M })).status,
  200,
);
eq('a rule deleted', (await mona.del(`/commission/rules/${later.id}`)).status, 204);

summary('commission');
