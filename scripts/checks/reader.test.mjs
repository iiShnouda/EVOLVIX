// The item-name reader (packages/shared/src/nameReader.ts); no server needed. Build @skb/shared first.
import { readItemName, fold, outline } from '../../packages/shared/dist/index.js';
const departments = [
  { id: 'D1', name: 'داخلي' },
  { id: 'D2', name: 'خارجي' },
];
const groups = [
  { id: 'M', name: 'رجالي', departmentId: 'D1', parentId: null, keywords: [] },
  { id: 'W', name: 'حريمي', departmentId: 'D1', parentId: null, keywords: ['نسائي'] },
  { id: 'V', name: 'فانلة', departmentId: 'D1', parentId: 'M', keywords: ['فنيله'] },
  { id: 'HS', name: 'نصف كم', departmentId: 'D1', parentId: 'V', keywords: ['نص كم', 'نص'] },
  { id: 'BR', name: 'حمالات', departmentId: 'D1', parentId: 'W', keywords: ['حماله'] },
];
const sizes = [
  { id: 'SM', name: 'M' },
  { id: 'SL', name: 'L' },
  { id: 'SXL', name: 'XL' },
];
const colors = [
  { id: 'CB', name: 'أسود' },
  { id: 'CW', name: 'أبيض' },
];
const cases = [
  ['ادم فنيله ريجالي نص م M', { departmentId: 'D1', groupId: 'HS', sizeId: 'SM' }],
  ['ادم فانله نص كم XL اسود', { departmentId: 'D1', groupId: 'HS', sizeId: 'SXL', colorId: 'CB' }],
  ['فانلة ادم L', { departmentId: 'D1', groupId: 'V', sizeId: 'SL' }],
  ['حمالات صدر ابيض', { departmentId: 'D1', groupId: 'BR', colorId: 'CW' }],
  ['بنطلون داخلي', { departmentId: 'D1' }],
  ['شيء آخر', {}],
];
let bad = 0;
for (const [name, want] of cases) {
  const got = readItemName(name, { departments, groups, sizes, colors });
  const clean = Object.fromEntries(Object.entries(got).filter(([, v]) => v));
  const norm = (o) =>
    JSON.stringify(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  const ok = norm(clean) === norm(want);
  if (!ok) bad++;
  console.log(ok ? 'OK ' : 'BAD', name, JSON.stringify(clean));
}
console.log(fold('فانلةٌ أحمــر ٣٨'), outline('ريجالي'), outline('رجالي'));
process.exit(bad);
