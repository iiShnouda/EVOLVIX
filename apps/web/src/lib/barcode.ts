/**
 * Barcodes drawn in the browser for labels (owner, 2026-10-06), no library: EAN-13 for 13-digit
 * codes (the in-store ones the server gives start 20) and Code 128 for anything else typed in plain
 * Latin letters and digits (a maker's code, an item code). Returns the bars as modules: '1' = bar.
 */

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

export function ean13Check(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13Check(code.slice(0, 12)) === Number(code[12]);
}

function ean13(code: string): string {
  const d = code.split('').map(Number);
  const parity = PARITY[d[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]!];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]!];
  return bits + '101';
}

// Code 128 bar/space widths for values 0–106 (106 = stop, with its final bar).
const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 ' +
  '122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 ' +
  '322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 ' +
  '112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 ' +
  '331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 ' +
  '411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

function widthsToBits(widths: string): string {
  let bits = '';
  [...widths].forEach((w, i) => (bits += (i % 2 === 0 ? '1' : '0').repeat(Number(w))));
  return bits;
}

/** Code 128: set C (digit pairs) for an even run of digits, else set B. Null if a character can't go in. */
function code128(text: string): string | null {
  if (![...text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)) return null;
  const values: number[] = [];
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    values.push(105);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values.push(104);
    for (const c of text) values.push(c.charCodeAt(0) - 32);
  }
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(check, 106);
  return values.map((v) => widthsToBits(C128[v]!)).join('');
}

export interface Bars {
  bits: string;
  kind: 'EAN13' | 'CODE128';
}

/** The bars for a code, or null when it can't be drawn (e.g. Arabic letters). */
export function barsFor(code: string): Bars | null {
  const c = code.trim();
  if (!c) return null;
  if (isEan13(c)) return { bits: ean13(c), kind: 'EAN13' };
  const bits = code128(c);
  return bits ? { bits, kind: 'CODE128' } : null;
}
