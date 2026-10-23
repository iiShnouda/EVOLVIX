// Phones and national IDs as the company's country has them, more named phones, the password the
// owner keeps as a reminder, and removing people (owner, 2026-10-02). Runs against BASE (Egypt).
import { login, check, eq, ok, summary } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
ok('the company is in Egypt', await owner.put('/settings', { country: 'EG' }));
const branch = owner.user.branchId;

console.log('== customers and suppliers');
const party = (extra) =>
  owner.post('/parties', {
    name: `Id ${tag} ${Math.random()}`,
    types: ['CUSTOMER'],
    address: 'Cairo',
    ...extra,
  });
eq(
  'letters in a phone refused',
  (await party({ phone: '0100abc4567' })).data?.code,
  'phone_letters',
);
eq('too short for Egypt', (await party({ phone: '0100123' })).data?.code, 'bad_phone');
eq('not a mobile prefix', (await party({ phone: '01412345678' })).data?.code, 'bad_phone');
ok('a mobile (11 digits)', await party({ phone: '01012345678' }));
ok('with the country code (12 digits)', await party({ phone: '201112345678' }));
ok('international form', await party({ phone: '+20 122 345 6789' }));
ok('a Cairo landline', await party({ phone: '02 2345 6789' }));
eq('a bad extra number', (await party({ otherPhones: ['0155'] })).data?.code, 'bad_phone');
const named = ok(
  'more numbers, each named',
  await party({
    phone: '01012345678',
    otherPhones: ['01512345678', '01212345678', '01112345678'],
    otherPhoneLabels: ['WhatsApp', 'Home', 'Brother'],
  }),
);
eq('their names', named.otherPhoneLabels, ['WhatsApp', 'Home', 'Brother']);
eq(
  'a national ID with a bad date',
  (await party({ nationalId: '29013451234567' })).data?.code,
  'bad_national_id',
);
eq(
  'a national ID too short',
  (await party({ nationalId: '2900101123' })).data?.code,
  'bad_national_id',
);
eq(
  'a national ID with an unknown governorate',
  (await party({ nationalId: '29001019912345' })).data?.code,
  'bad_national_id',
);
const withId = ok('a right Egyptian national ID', await party({ nationalId: '29001010112345' }));
eq('kept', withId.nationalId, '29001010112345');
ok('another country: Saudi Arabia', await owner.put('/settings', { country: 'SA' }));
eq(
  'an Egyptian mobile is not Saudi',
  (await party({ phone: '01012345678' })).data?.code,
  'bad_phone',
);
ok('…but with its country code it is a foreign number', await party({ phone: '+201012345678' }));
ok('a Saudi mobile', await party({ phone: '0512345678' }));
eq(
  'an Egyptian ID is not Saudi',
  (await party({ nationalId: '29001010112345' })).data?.code,
  'bad_national_id',
);
ok('a Saudi ID', await party({ nationalId: '1012345678' }));
ok('back to Egypt', await owner.put('/settings', { country: 'EG' }));

console.log('== staff: phones, the kept password, removing');
const base = { password: 'Str0ngPass!', role: 'SALES', branchId: branch };
eq(
  'a bad phone refused',
  (
    await owner.post('/staff', {
      ...base,
      fullName: `S ${tag}`,
      email: `s0.${tag}@skb.local`,
      phone: '0100',
    })
  ).data?.code,
  'bad_phone',
);
const s1 = ok(
  'a person with numbers and a kept password',
  await owner.post('/staff', {
    ...base,
    fullName: `S1 ${tag}`,
    email: `s1.${tag}@skb.local`,
    phone: '01012345678',
    otherPhones: ['01512345678'],
    otherPhoneLabels: ['WhatsApp'],
    rememberPassword: true,
  }),
);
check('marked as kept', s1.hasPasswordNote === true);
eq('the WhatsApp number', [s1.otherPhones, s1.otherPhoneLabels], [['01512345678'], ['WhatsApp']]);
const note = ok('the owner reads it back', await owner.get(`/staff/${s1.id}/password-note`));
eq('the password', note.password, 'Str0ngPass!');
eq('an accountant may not', (await mona.get(`/staff/${s1.id}/password-note`)).status, 403);
const audit = (await owner.get('/audit?pageSize=20')).data;
check(
  'reading it is logged',
  JSON.stringify(audit).includes('read_password'),
  audit?.items?.slice?.(0, 2),
);
ok(
  'a new password, not kept',
  await owner.put(`/staff/${s1.id}`, { password: 'N3wPassword!', rememberPassword: false }),
);
eq('nothing kept now', (await owner.get(`/staff/${s1.id}/password-note`)).status, 404);
// Deleting the kept password on its own, without a new one (owner, 2026-10-23).
ok('kept again', await owner.put(`/staff/${s1.id}`, { password: 'N3wPassword2!', rememberPassword: true }));
eq('readable', (await owner.get(`/staff/${s1.id}/password-note`)).status, 200);
const forgot = ok('deleted alone', await owner.put(`/staff/${s1.id}`, { rememberPassword: false }));
eq('…the list says none is kept', forgot.hasPasswordNote, false);
eq('…and none can be read', (await owner.get(`/staff/${s1.id}/password-note`)).status, 404);
ok('removed (nothing done under it)', await owner.del(`/staff/${s1.id}`), 204);
check('gone', !(await owner.get('/staff')).data.some((x) => x.id === s1.id));
const s2 = ok(
  'an accountant',
  await owner.post('/staff', {
    ...base,
    role: 'ACCOUNTANT',
    fullName: `S2 ${tag}`,
    email: `s2.${tag}@skb.local`,
  }),
);
const worker = await login(`s2.${tag}@skb.local`, 'Str0ngPass!');
const box = (await owner.get('/money-accounts')).data.find(
  (a) => a.isDefault && a.kind === 'CASH_BOX' && a.branchId === branch,
);
ok(
  'who takes some money',
  await worker.post('/receipts', {
    partyId: named.id,
    lines: [{ method: 'CASH', accountId: box.id, amount: 100 }],
  }),
);
eq('someone with work stays', (await owner.del(`/staff/${s2.id}`)).data?.code, 'in_use');
eq('not yourself', (await owner.del(`/staff/${owner.user.id}`)).data?.code, 'own_account');

console.log('== employees');
const emp = (extra) =>
  owner.post('/payroll/employees', {
    name: `E ${tag} ${Math.random()}`,
    monthlySalary: 500000,
    ...extra,
  });
eq(
  'letters in the device number refused',
  (await emp({ deviceUserId: 'a12' })).data?.code,
  'bad_device_id',
);
eq(
  'a bad national ID',
  (await emp({ nationalId: '12345678901234' })).data?.code,
  'bad_national_id',
);
eq('a bad phone', (await emp({ phone: '0123' })).data?.code, 'bad_phone');
const e1 = ok(
  'an employee with right numbers',
  await emp({
    deviceUserId: String(Date.now()).slice(-7),
    nationalId: '30101010112345',
    phone: '01012345678',
    otherPhones: ['0223456789'],
    otherPhoneLabels: ['Home'],
  }),
);
eq('the home phone', e1.otherPhoneLabels, ['Home']);
ok('removed (no attendance or pay)', await owner.del(`/payroll/employees/${e1.id}`), 204);

summary('ids');
