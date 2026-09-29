// Staff & permissions checks: people, roles, per-person grants/revokes, and the safety rules
// (no self-escalation, owners protected, no self-lockout). Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const karim = await login('karim@skb.local'); // SALES
const tryLogin = async (email, password) =>
  (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).status;

console.log('== lists');
const staff = ok('owner lists staff', await owner.get('/staff'));
check('seeded staff listed', staff.length >= 4, staff.map((s) => s.email));
const me = staff.find((s) => s.email === 'owner@skb.local');
eq('owner has every permission', me.permissions.length, (await owner.get('/permissions')).data.length);
eq('sales cannot list staff', (await karim.get('/staff')).status, 403);
eq('accountant cannot list staff', (await mona.get('/staff')).status, 403);
const roles = ok('roles', await owner.get('/roles'));
eq('owner role not editable', roles.find((r) => r.role === 'OWNER').editable, false);
check('sales role has no change_price', !roles.find((r) => r.role === 'SALES').permissions.includes('sales:change_price'));
const perms = ok('permission catalog', await owner.get('/permissions'));
check('permissions grouped', perms.every((p) => p.group && p.key.startsWith(p.group + ':')), perms.slice(0, 3));

console.log('== add staff');
const branches = (await owner.get('/branches')).data;
const email = `seller.${tag}@skb.local`;
const base = { fullName: `Seller ${tag}`, email, password: 'Str0ngPass!', role: 'SALES', branchId: branches[0].id };
eq('bad email', (await owner.post('/staff', { ...base, email: 'nope' })).data?.code, 'bad_email');
eq('weak password', (await owner.post('/staff', { ...base, password: 'short' })).data?.code, 'weak_password');
eq('bad role', (await owner.post('/staff', { ...base, role: 'KING' })).data?.code, 'bad_role');
eq('bad branch', (await owner.post('/staff', { ...base, branchId: '00000000-0000-0000-0000-000000000001' })).data?.code, 'branch_not_found');
eq('no name', (await owner.post('/staff', { ...base, fullName: ' ' })).data?.code, 'bad_name');
const seller = ok('owner adds a salesperson', await owner.post('/staff', base));
eq('duplicate email', (await owner.post('/staff', { ...base, email: email.toUpperCase() })).data?.code, 'duplicate_email');
eq('sales cannot add staff', (await karim.post('/staff', { ...base, email: `x${tag}@skb.local` })).status, 403);
let s1 = await login(email, 'Str0ngPass!');
eq('new person gets role permissions', s1.user.permissions.includes('sales:create') && !s1.user.permissions.includes('sales:change_price'), true);

console.log('== per-person permissions');
const parties = (await owner.get('/parties?pageSize=100')).data.items;
const cust = parties.find((p) => p.types.includes('CUSTOMER'));
const item = (await owner.get('/products?limit=50')).data.find((p) => p.stockOnHand > 5 && p.units.length && !p.modelId);
const sale = (who, price) => who.post('/sales/invoices', { partyId: cust.id, taxPercent: 0, lines: [{ productId: item.id, quantity: 1, unitPrice: price }] });
const levelPrice = item.units[0].prices.find((p) => p.source)?.price ?? item.salePrice;
eq('seller cannot change price yet', (await sale(s1, levelPrice + 500)).data?.code, 'price_not_allowed');
eq('sales cannot manage permissions', (await karim.put(`/staff/${seller.id}/permissions`, { granted: ['sales:change_price'] })).status, 403);
eq('unknown permission', (await owner.put(`/staff/${seller.id}/permissions`, { granted: ['sales:fly'] })).data?.code, 'unknown_permission');
eq('both grant and revoke', (await owner.put(`/staff/${seller.id}/permissions`, { granted: ['sales:return'], revoked: ['sales:return'] })).data?.code, 'bad_permissions');
let sd = ok('grant change_price, revoke parties:edit', await owner.put(`/staff/${seller.id}/permissions`, { granted: ['sales:change_price'], revoked: ['parties:edit'] }));
check('effective has grant, lacks revoke', sd.permissions.includes('sales:change_price') && !sd.permissions.includes('parties:edit'), sd.permissions);
s1 = await login(email, 'Str0ngPass!');
check('token carries new permissions', s1.user.permissions.includes('sales:change_price'), s1.user.permissions);
ok('seller now sells at another price', await sale(s1, levelPrice + 500));
eq('own permissions refused', (await owner.put(`/staff/${me.id}/permissions`, { granted: [] })).data?.code, 'owner_fixed');

console.log('== roles');
eq('owner role fixed', (await owner.put('/roles/OWNER', { permissions: [] })).data?.code, 'owner_fixed');
const acct = roles.find((r) => r.role === 'ACCOUNTANT');
const r1 = ok('remove sales:return from accountants', await owner.put('/roles/ACCOUNTANT', { permissions: acct.permissions.filter((p) => p !== 'sales:return') }));
eq('role marked custom', r1.custom, true);
const mona2 = await login('mona@skb.local');
check('accountant lost sales:return', !mona2.user.permissions.includes('sales:return'));
const inv = (await owner.get('/sales/invoices?pageSize=5')).data.items[0];
const invd = (await owner.get(`/sales/invoices/${inv.id}`)).data;
eq('accountant return now refused', (await mona2.post(`/sales/invoices/${inv.id}/returns`, { lines: [{ lineId: invd.lines[0].id, quantity: 1 }] })).status, 403);
const r2 = ok('reset accountant role', await owner.post('/roles/ACCOUNTANT/reset'));
eq('back to default', [r2.custom, r2.permissions.includes('sales:return')], [false, true]);
check('mona gets it back at next sign-in', (await login('mona@skb.local')).user.permissions.includes('sales:return'));

console.log('== admins can\'t escalate or touch owners');
const adminEmail = `admin.${tag}@skb.local`;
ok('owner adds an admin', await owner.post('/staff', { ...base, email: adminEmail, role: 'ADMIN', fullName: `Admin ${tag}` }));
const admin = await login(adminEmail, 'Str0ngPass!');
check('admin has no audit:view', !admin.user.permissions.includes('audit:view'));
eq('admin cannot add an owner', (await admin.post('/staff', { ...base, email: `o.${tag}@skb.local`, role: 'OWNER' })).data?.code, 'owner_only');
eq('admin cannot edit the owner', (await admin.put(`/staff/${me.id}`, { phone: '1' })).data?.code, 'owner_only');
eq('admin cannot promote to owner', (await admin.put(`/staff/${seller.id}`, { role: 'OWNER' })).data?.code, 'owner_only');
eq('admin cannot grant what they lack', (await admin.put(`/staff/${seller.id}/permissions`, { granted: ['audit:view'] })).data?.code, 'not_your_permission');
eq('admin cannot give a role what they lack', (await admin.put('/roles/SALES', { permissions: [...roles.find((r) => r.role === 'SALES').permissions, 'audit:view'] })).data?.code, 'not_your_permission');
eq('admin cannot edit own role', (await admin.put('/roles/ADMIN', { permissions: [] })).data?.code, 'own_role');
ok('admin may grant what they hold', await admin.put(`/staff/${seller.id}/permissions`, { granted: ['sales:change_price', 'sales:return'], revoked: [] }));

console.log('== self-lockout and deactivation');
eq('cannot deactivate yourself', (await owner.put(`/staff/${me.id}`, { isActive: false })).data?.code, 'own_account');
eq('cannot change own role', (await owner.put(`/staff/${me.id}`, { role: 'ADMIN' })).data?.code, 'own_role');
ok('reset seller password', await owner.put(`/staff/${seller.id}`, { password: 'N3wPassword!' }));
eq('old password refused', await tryLogin(email, 'Str0ngPass!'), 401);
eq('new password works', await tryLogin(email, 'N3wPassword!'), 200);
sd = ok('change branch and name', await owner.put(`/staff/${seller.id}`, { branchId: branches[1]?.id ?? branches[0].id, fullName: `Seller ${tag} B` }));
eq('branch changed', sd.branchId, branches[1]?.id ?? branches[0].id);
ok('deactivate seller', await owner.put(`/staff/${seller.id}`, { isActive: false }));
eq('deactivated person cannot sign in', await tryLogin(email, 'N3wPassword!'), 401);
ok('reactivate seller', await owner.put(`/staff/${seller.id}`, { isActive: true }));
eq('reactivated can sign in', await tryLogin(email, 'N3wPassword!'), 200);
const audit = (await owner.get('/staff')).data.find((x) => x.id === seller.id);
eq('granted list kept', [...audit.granted].sort(), ['sales:change_price', 'sales:return']);

process.exit(summary('staff') ? 1 : 0);
