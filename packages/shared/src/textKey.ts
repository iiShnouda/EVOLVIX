/**
 * Text folded for searching and reading item names (owner, 2026-10-06). Mirrors the server's
 * `TextKey` (apps/api/src/SKB.Api/Services/TextKey.cs); keep the two in step.
 *
 * - `fold`: lower case, Arabic letter forms made one (أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي),
 *   diacritics and tatweel dropped, Arabic-Indic digits as 0–9, punctuation as spaces.
 * - `outline`: a word's consonant outline — its first letter, then the rest without ا و ي and
 *   without doubled letters — so فانلة, فنيله and فانله all read فنله.
 */

const FORMS: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ة: 'ه',
  ى: 'ي',
  ؤ: 'و',
  ئ: 'ي',
};

export function fold(text: string | null | undefined): string {
  if (!text) return '';
  let out = '';
  for (const raw of text.toLowerCase()) {
    let ch = FORMS[raw] ?? raw;
    const code = ch.charCodeAt(0);
    if (ch === 'ـ' || (code >= 0x064b && code <= 0x0652) || code === 0x0670) continue;
    if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) ch = String(code - 0x06f0);
    out += /[\p{L}\p{N}-]/u.test(ch) ? ch : ' ';
  }
  return out.split(' ').filter(Boolean).join(' ');
}

export function words(text: string | null | undefined): string[] {
  return fold(text).split(' ').filter(Boolean);
}

export function outline(word: string): string {
  if (word.length <= 2) return word;
  let out = word[0]!;
  for (const ch of word.slice(1)) {
    if (ch === 'ا' || ch === 'و' || ch === 'ي') continue;
    if (out[out.length - 1] === ch) continue;
    out += ch;
  }
  return out;
}

/** Edit distance, stopping early past `max`. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        cur[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** Slips a word of this length may have and still match. */
export const slack = (length: number) => (length >= 7 ? 2 : length >= 4 ? 1 : 0);

/** Whether two folded words are the same word, allowing a long vowel or a slipped letter. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const oa = outline(a);
  const ob = outline(b);
  if (oa.length > 2 && oa === ob) return true;
  const s = Math.min(slack(a.length), slack(b.length));
  return (
    s > 0 &&
    (distance(a, b, s) <= s || (oa.length > 2 && distance(oa, ob, s) <= s && oa.length > 3))
  );
}
