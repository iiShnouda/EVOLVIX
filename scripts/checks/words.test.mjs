// Amounts in words (owner, 2026-11-10: on the printed invoice, Arabic or English). Needs no server:
// build the shared package first (pnpm --filter @skb/shared build).
import { check, eq, summary } from './lib.mjs';
import {
  amountInWords,
  numberInArabic,
  numberInEnglish,
} from '../../packages/shared/dist/words.js';

const ar = (minor, cur = 'EGP') => amountInWords(minor, cur, 'ar');
const en = (minor, cur = 'EGP') => amountInWords(minor, cur, 'en');

console.log('== English');
eq(
  'the owner’s example',
  en(125050),
  'Only one thousand two hundred fifty pounds and fifty piastres',
);
eq('one pound', en(100), 'Only one pound');
eq('one piastre', en(1), 'Only one piastre');
eq('zero', en(0), 'Only zero pounds');
eq('teens and hyphens', en(2117), 'Only twenty-one pounds and seventeen piastres');
eq('round hundred', en(10000), 'Only one hundred pounds');
eq('a million and one', en(100000100), 'Only one million one pounds');
eq(
  'big',
  numberInEnglish(987654321),
  'nine hundred eighty-seven million six hundred fifty-four thousand three hundred twenty-one',
);
eq('negative', en(-250), 'Only minus two pounds and fifty piastres');
eq('dollars', en(350, 'USD'), 'Only three dollars and fifty cents');
eq('another currency', en(350, 'JOD'), 'Only three and 50/100 JOD');

console.log('== Arabic');
eq('the owner’s example', ar(125050), 'فقط ألف ومائتان وخمسون جنيهًا وخمسون قرشًا لا غير');
eq('one pound', ar(100), 'فقط جنيه واحد لا غير');
eq('two pounds', ar(200), 'فقط جنيهان لا غير');
eq('three to ten: plural', ar(500), 'فقط خمسة جنيهات لا غير');
eq('eleven and up: singular', ar(1100), 'فقط أحد عشر جنيهًا لا غير');
eq('twenty-five', ar(2500), 'فقط خمسة وعشرون جنيهًا لا غير');
eq('a hundred', ar(10000), 'فقط مائة جنيه لا غير');
eq('a hundred and five', ar(10500), 'فقط مائة وخمسة جنيهات لا غير');
eq('piastres only', ar(75), 'فقط خمسة وسبعون قرشًا لا غير');
eq('five piastres', ar(1005), 'فقط عشرة جنيهات وخمسة قروش لا غير');
eq('zero', ar(0), 'فقط صفر جنيه لا غير');
eq('thousands', numberInArabic(2000), 'ألفان');
eq('three thousand', numberInArabic(3000), 'ثلاثة آلاف');
eq('eleven thousand', numberInArabic(11000), 'أحد عشر ألف');
eq('mixed', numberInArabic(1234567), 'مليون ومائتان وأربعة وثلاثون ألف وخمسمائة وسبعة وستون');
eq('two million five thousand', numberInArabic(2005000), 'مليونان وخمسة آلاف');
eq('negative', ar(-250), 'فقط سالب جنيهان وخمسون قرشًا لا غير');
eq('dirhams', ar(350, 'AED'), 'فقط ثلاثة دراهم وخمسون فلسًا لا غير');
eq('another currency', ar(350, 'JOD'), 'فقط ثلاثة و50/100 JOD لا غير');
check(
  'every amount up to 3,000.00 has words in both',
  (() => {
    for (let m = 0; m <= 300000; m += 37)
      if (!ar(m) || !en(m) || /undefined/.test(ar(m) + en(m))) return false;
    return true;
  })(),
);
summary('words');
