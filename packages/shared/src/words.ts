import type { Locale } from './types';

/**
 * An amount of money written out in words, for printed invoices (owner, 2026-11-10): Arabic on an
 * Arabic printout, English on an English one. Amounts are integer minor units (two decimals), as
 * everywhere. Egyptian pounds and piastres are named; so are a few other currencies; any other is
 * written with its code and the fraction as "50/100".
 */

interface CurrencyWords {
  en: { major: [string, string]; minor: [string, string] };
  /** Arabic forms of each name: one, two, 3–10 (plural), 11–99 (singular with tanween). */
  ar: { major: ArNoun; minor: ArNoun };
}
type ArNoun = [one: string, two: string, few: string, many: string];

const CURRENCIES: Record<string, CurrencyWords> = {
  EGP: {
    en: { major: ['pound', 'pounds'], minor: ['piastre', 'piastres'] },
    ar: {
      major: ['جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'],
      minor: ['قرش', 'قرشان', 'قروش', 'قرشًا'],
    },
  },
  USD: {
    en: { major: ['dollar', 'dollars'], minor: ['cent', 'cents'] },
    ar: {
      major: ['دولار', 'دولاران', 'دولارات', 'دولارًا'],
      minor: ['سنت', 'سنتان', 'سنتات', 'سنتًا'],
    },
  },
  EUR: {
    en: { major: ['euro', 'euros'], minor: ['cent', 'cents'] },
    ar: { major: ['يورو', 'يورو', 'يورو', 'يورو'], minor: ['سنت', 'سنتان', 'سنتات', 'سنتًا'] },
  },
  AED: {
    en: { major: ['dirham', 'dirhams'], minor: ['fils', 'fils'] },
    ar: {
      major: ['درهم', 'درهمان', 'دراهم', 'درهمًا'],
      minor: ['فلس', 'فلسان', 'فلوس', 'فلسًا'],
    },
  },
};

// ---------------------------------------------------------------- English

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`);
  const rest = n % 100;
  if (rest >= 20) {
    const one = rest % 10;
    parts.push(one ? `${EN_TENS[Math.floor(rest / 10)]}-${EN_ONES[one]}` : EN_TENS[rest / 10]!);
  } else if (rest > 0) parts.push(EN_ONES[rest]!);
  return parts.join(' ');
}

/** A whole number (0 and up) in English words. */
export function numberInEnglish(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return EN_ONES[0]!;
  const parts: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const group = n % 1000;
    if (group) parts.unshift(`${enBelowThousand(group)}${scale ? ` ${EN_SCALES[scale]}` : ''}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------- Arabic

const AR_ONES = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];
/** Thousands, millions…: one, two, 3–10, 11 and up. */
const AR_SCALES: ArNoun[] = [
  ['ألف', 'ألفان', 'آلاف', 'ألف'],
  ['مليون', 'مليونان', 'ملايين', 'مليون'],
  ['مليار', 'ملياران', 'مليارات', 'مليار'],
  ['تريليون', 'تريليونان', 'تريليونات', 'تريليون'],
];
const AND = ' و';

function arBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(AR_HUNDREDS[Math.floor(n / 100)]!);
  const rest = n % 100;
  if (rest >= 20) {
    const one = rest % 10;
    parts.push(
      one ? `${AR_ONES[one]}${AND}${AR_TENS[Math.floor(rest / 10)]}` : AR_TENS[rest / 10]!,
    );
  } else if (rest > 0) parts.push(AR_ONES[rest]!);
  return parts.join(AND);
}

/** A whole number (0 and up) in Arabic words. */
export function numberInArabic(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const group = n % 1000;
    if (!group) continue;
    if (scale === 0) {
      parts.unshift(arBelowThousand(group));
      continue;
    }
    const name = AR_SCALES[scale - 1]!;
    const tail = group % 100;
    if (group === 1) parts.unshift(name[0]);
    else if (group === 2) parts.unshift(name[1]);
    else if (tail >= 3 && tail <= 10) parts.unshift(`${arBelowThousand(group)} ${name[2]}`);
    else parts.unshift(`${arBelowThousand(group)} ${name[3]}`);
  }
  return parts.join(AND);
}

/** A count with its Arabic noun: "جنيه واحد", "جنيهان", "خمسة جنيهات", "خمسون جنيهًا", "مائة جنيه". */
function arCounted(n: number, noun: ArNoun): string {
  if (n === 1) return `${noun[0]} واحد`;
  if (n === 2) return noun[1];
  const tail = n % 100;
  const words = numberInArabic(n);
  if (tail >= 3 && tail <= 10) return `${words} ${noun[2]}`;
  if (tail >= 11) return `${words} ${noun[3]}`;
  return `${words} ${noun[0]}`;
}

// ---------------------------------------------------------------- money

/**
 * `minor` (integer minor units) of `currency` in words: "Only one thousand two hundred fifty pounds
 * and fifty piastres" / «فقط ألف ومائتان وخمسون جنيهًا وخمسون قرشًا لا غير».
 */
export function amountInWords(minor: number, currency: string, locale: Locale): string {
  const negative = minor < 0;
  const total = Math.round(Math.abs(minor));
  const major = Math.floor(total / 100);
  const cents = total % 100;
  const names = CURRENCIES[currency.toUpperCase()];
  if (locale === 'ar') {
    let text: string;
    if (names) {
      const parts: string[] = [];
      if (major > 0 || cents === 0)
        parts.push(major === 0 ? `صفر ${names.ar.major[0]}` : arCounted(major, names.ar.major));
      if (cents > 0) parts.push(arCounted(cents, names.ar.minor));
      text = parts.join(AND);
    } else {
      text = `${numberInArabic(major)}${cents ? `${AND}${cents}/100` : ''} ${currency}`;
    }
    return `فقط ${negative ? 'سالب ' : ''}${text} لا غير`;
  }
  let text: string;
  if (names) {
    const parts: string[] = [];
    if (major > 0 || cents === 0)
      parts.push(`${numberInEnglish(major)} ${names.en.major[major === 1 ? 0 : 1]}`);
    if (cents > 0) parts.push(`${numberInEnglish(cents)} ${names.en.minor[cents === 1 ? 0 : 1]}`);
    text = parts.join(' and ');
  } else {
    text = `${numberInEnglish(major)}${cents ? ` and ${cents}/100` : ''} ${currency}`;
  }
  return `Only ${negative ? 'minus ' : ''}${text}`;
}
