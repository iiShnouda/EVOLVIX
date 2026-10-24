// Sales departments (owner decision 2026-09-30): a department (قسم) is a group of categories. A
// department's sales people sell only its items, even from a shared warehouse; every sale belongs to
// one department. Also: each person's discount limit (theirs, else the company's; the owner has none),
// counted on a line's own discount plus its share of the invoice discount. Runs against BASE.
import { login, check, eq, ok, summary, companyToday, sellDiscounted } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const PASS = 'Str0ngPass!';

const person = async (role, name) => {
  const email = `${name}.${tag}@skb.local`;
  const staff = ok(
    `add ${role}`,
    await owner.post('/staff', { fullName: `${name} ${tag}`, email, password: PASS, role, branchId: owner.user.branchId }),
  );
  return { ...staff, email };
};
const access = (who, p, body) =>
  who.put(`/staff/${p.id}/access`, { allBranches: null, branchIds: [], warehouseIds: [], moneyAccountIds: [], ...body });

console.log('== departments');
const men = ok('men’s department', await owner.post('/departments', { name: `Men ${tag}` }));
const inner = ok('underwear department', await owner.post('/departments', { name: `Inner ${tag}` }));
eq('no two with one name', (await owner.post('/departments', { name: `men ${tag}` })).data?.code, 'duplicate_name');
eq('a name is needed', (await owner.post('/departments', { name: ' ' })).data?.code, 'bad_name');
check('listed', (await owner.get('/departments')).data.some((d) => d.id === men.id && d.isActive));

const catMen = ok('a category in men’s', await owner.post('/categories', { name: `Shirts ${tag}`, departmentId: men.id }));
eq('it says so', [catMen.departmentId, catMen.departmentName], [men.id, `Men ${tag}`]);
const catInner = ok('a category in underwear', await owner.post('/categories', { name: `Vests ${tag}`, departmentId: inner.id }));
const catFree = ok('a category of no department', await owner.post('/categories', { name: `Bags ${tag}` }));
eq('unknown department refused', (await owner.post('/categories', { name: `X ${tag}`, departmentId: owner.user.id })).data?.code, 'department_not_found');
const moved = ok('moved to underwear', await owner.put(`/categories/${catFree.id}`, { departmentId: inner.id }));
eq('…moved', moved.departmentId, inner.id);
eq('…and out again', ok('out', await owner.put(`/categories/${catFree.id}`, { departmentId: '' })).departmentId, null);
check('name kept', (await owner.get('/categories')).data.find((c) => c.id === catFree.id)?.name === `Bags ${tag}`);

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const levels = (await owner.get('/price-levels')).data;
const saleLevel = levels.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === owner.user.branchId);
const supplier = ok('a supplier', await owner.post('/parties', { name: `DepSup ${tag}`, types: ['SUPPLIER'] }));
const customer = ok('a customer', await owner.post('/parties', { name: `DepCust ${tag}`, types: ['CUSTOMER'] }));
const item = async (name, cat) =>
  ok(
    name,
    await owner.post('/products', {
      name: `${name} ${tag}`,
      categoryId: cat.id,
      units: [{ unitId: piece.id, factor: 1 }],
      prices: [{ unitId: piece.id, priceLevelId: saleLevel.id, price: 1000 }],
    }),
  );
const shirt = await item('Shirt', catMen);
const vest = await item('Vest', catInner);
const bag = await item('Bag', catFree);
ok(
  'stock bought',
  await owner.post('/purchases/invoices', {
    partyId: supplier.id,
    warehouseId: wh.id,
    taxPercent: 0,
    lines: [shirt, vest, bag].map((p) => ({ productId: p.id, quantity: 100, unitCost: 500 })),
  }),
);
const line = (p, extra = {}) => ({ productId: p.id, quantity: 1, unitPrice: 1000, ...extra });
const sell = (who, lines, extra = {}) =>
  who.post('/sales/invoices', { partyId: customer.id, warehouseId: wh.id, taxPercent: 0, lines, ...extra });
// Discounts are given from the customer's invoices once the sale is made (owner, 2026-10-24).
const sellGiven = (who, lines, extra = {}) =>
  sellDiscounted(who, who, { partyId: customer.id, warehouseId: wh.id, taxPercent: 0, lines, ...extra });

console.log('== selling in a department');
const s1 = ok('owner sells in men’s: a shirt and a bag', await sell(owner, [line(shirt), line(bag)], { departmentId: men.id }));
eq('the invoice is men’s', [s1.departmentId, s1.departmentName], [men.id, `Men ${tag}`]);
const wrong = await sell(owner, [line(vest)], { departmentId: men.id });
eq('a vest is not men’s', [wrong.status, wrong.data?.code], [400, 'not_in_department']);
const s0 = ok('without a department (as before)', await sell(owner, [line(vest)]));
eq('…of none', s0.departmentId, null);
const listed = async (who, q) => (await who.get(`/sales/invoices?pageSize=100&${q}`)).data.items.map((x) => x.id);
check('men’s list', (await listed(owner, `departmentId=${men.id}`)).includes(s1.id));
check('…without the other', !(await listed(owner, `departmentId=${men.id}`)).includes(s0.id));
check('“none” list', (await listed(owner, 'departmentId=none')).includes(s0.id));
eq('in the summary', (await owner.get(`/sales/invoices?search=${s1.number}`)).data.items[0].departmentName, `Men ${tag}`);

console.log('== a men’s sales person');
const rep = await person('SALES', 'rep');
const given = ok('only men’s', await access(owner, rep, { departmentIds: [men.id] }));
eq('the staff record says so', given.departmentIds, [men.id]);
let r = await login(rep.email, PASS);
eq('it is in their sign-in', r.user.departmentIds, [men.id]);
const auto = ok('sells without choosing: men’s', await sell(r, [line(shirt), line(bag)]));
eq('…it is men’s', auto.departmentId, men.id);
const other = await sell(r, [line(vest)], { departmentId: inner.id });
eq('not underwear', [other.status, other.data?.code], [403, 'not_your_department']);
eq('nor a vest in men’s', (await sell(r, [line(vest)])).data?.code, 'not_in_department');
const found = async (who, p) =>
  (await who.get(`/products?search=${encodeURIComponent(p.name)}`)).data.some((x) => x.id === p.id);
check('finds shirts', await found(r, shirt));
check('finds items of no department', await found(r, bag));
check('not vests', !(await found(r, vest)));
check('the owner finds vests', await found(owner, vest));
check('asking for men’s items hides vests from the owner too', !(await owner.get(`/products?search=${encodeURIComponent(vest.name)}&departmentId=${men.id}`)).data.some((x) => x.id === vest.id));
eq('owner’s underwear sale hidden', (await r.get(`/sales/invoices/${ok('owner sells in underwear', await sell(owner, [line(vest)], { departmentId: inner.id })).id}`)).status, 404);
const theirs = await listed(r, '');
check('their list: men’s and none, not underwear', theirs.includes(s1.id) && theirs.includes(s0.id));
const ret = ok('a return of a men’s sale', await owner.post(`/sales/invoices/${auto.id}/returns`, { lines: [{ lineId: auto.lines[0].id, quantity: 1 }] }));
eq('…is men’s too', ret.departmentId, men.id);

ok('both departments', await access(owner, rep, { departmentIds: [men.id, inner.id] }));
r = await login(rep.email, PASS);
eq('now they must choose', (await sell(r, [line(shirt)])).data?.code, 'department_required');
ok('…and can sell underwear', await sell(r, [line(vest)], { departmentId: inner.id }));
ok('underwear closed', await owner.put(`/departments/${inner.id}`, { isActive: false }));
eq('a closed department takes no sales', (await sell(owner, [line(vest)], { departmentId: inner.id })).data?.code, 'department_not_found');
ok('reopened', await owner.put(`/departments/${inner.id}`, { isActive: true }));
ok('all departments again', await access(owner, rep, { departmentIds: [] }));
r = await login(rep.email, PASS);
eq('no departments in the sign-in', r.user.departmentIds ?? null, null);
ok('sells without one', await sell(r, [line(vest)]));

console.log('== performance by department');
const perf = (await owner.get(`/analytics/performance?by=department&from=${companyToday()}&to=${companyToday()}`)).data;
eq('by department', perf.by, 'department');
check('a men’s row', perf.rows.some((x) => x.id === men.id && x.name === `Men ${tag}` && x.netSales > 0), perf.rows);
check('and one for no department', perf.rows.some((x) => x.id === '00000000-0000-0000-0000-000000000000'));

console.log('== discount limits');
const settings = (await owner.get('/settings')).data;
eq('no company limit at first', settings.maxDiscountPercent, 100);
ok('company limit 10%', await owner.put('/settings', { maxDiscountPercent: 10 }));
const seller = await person('SALES', 'seller');
ok('may give discounts', await owner.put(`/staff/${seller.id}/permissions`, { granted: ['sales:discount', 'sales:discount_line'] }));
let s = await login(seller.email, PASS);
eq('the company’s limit in their sign-in', s.user.maxDiscountPercent, 10);
ok('10% of a line', await sellGiven(s, [line(shirt, { quantity: 2, discount: 200 })]));
const over = await sellGiven(s, [line(shirt, { quantity: 2, discount: 201 })]);
eq('a bit more refused', [over.status, over.data?.code], [400, 'discount_over_limit']);
eq(
  'an invoice discount counts too (6% + 5%)',
  (await sellGiven(s, [line(shirt, { discount: 60 })], { charges: [{ kind: 'DISCOUNT', percent: 5 }] })).data?.code,
  'discount_over_limit',
);
ok('4% + 5% is fine', await sellGiven(s, [line(shirt, { discount: 40 })], { charges: [{ kind: 'DISCOUNT', percent: 5 }] }));
ok('owner: no limit', await sellGiven(owner, [line(shirt, { discount: 400 })]));
eq('owner’s sign-in has none', owner.user.maxDiscountPercent ?? null, null);

const own = ok('their own limit 20%', await access(owner, seller, { maxDiscountPercent: 20 }));
eq('on the staff record', own.maxDiscountPercent, 20);
s = await login(seller.email, PASS);
ok('15% now', await sellGiven(s, [line(shirt, { discount: 150 })]));
eq('21% not', (await sellGiven(s, [line(shirt, { discount: 210 })])).data?.code, 'discount_over_limit');
eq('a limit over 100% refused', (await access(owner, seller, { maxDiscountPercent: 101 })).data?.code, 'bad_percent');

// Someone with a limit can't give a bigger one.
const boss = await person('ADMIN', 'boss');
ok('boss: 10% (the company’s)', await access(owner, boss, {}));
const b = await login(boss.email, PASS);
eq('boss can’t give 20%', (await access(b, seller, { maxDiscountPercent: 20 })).data?.code, 'over_your_limit');
ok('…but 5%', await access(b, seller, { maxDiscountPercent: 5 }));
eq('…nor none (100%)', (await access(b, seller, { maxDiscountPercent: 100 })).data?.code, 'over_your_limit');
ok('company limit back to none', await owner.put('/settings', { maxDiscountPercent: 100 }));
// The company's limit is in everyone's sign-in and holds at once (owner, 2026-10-24).
ok('…at once the boss (on the company’s) may give it too', await access(b, seller, {}));

process.exit(summary('departments') ? 1 : 0);
