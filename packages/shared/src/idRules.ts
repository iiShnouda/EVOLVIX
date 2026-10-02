/**
 * What a phone number and a national ID look like in the company's country (owner, 2026-10-02):
 * digits only, the lengths and starts each country's carriers use, the national ID as that country
 * issues it. The server checks the same (SKB.Api IdRules) — this is for telling the person as
 * they type. Numbers are kept as typed.
 */

interface PhoneRule {
  code: string;
  trunk: boolean;
  national: RegExp;
}

const PHONES: Record<string, PhoneRule> = {
  EG: { code: '20', trunk: true, national: /^(01[0125]\d{8}|0[2-9]\d{7,8}|1\d{4})$/ },
  SA: { code: '966', trunk: true, national: /^(05\d{8}|01\d{7}|9200\d{5})$/ },
  AE: { code: '971', trunk: true, national: /^(05\d{8}|0[2-9]\d{7}|800\d{3,7})$/ },
  QA: { code: '974', trunk: false, national: /^[3-7]\d{7}$/ },
  KW: { code: '965', trunk: false, national: /^[2569]\d{7}$/ },
  BH: { code: '973', trunk: false, national: /^[1-9]\d{7}$/ },
  OM: { code: '968', trunk: false, national: /^[279]\d{7}$/ },
  JO: { code: '962', trunk: true, national: /^(07[789]\d{7}|0[2-6]\d{7})$/ },
  MA: { code: '212', trunk: true, national: /^0[5-7]\d{8}$/ },
  DZ: { code: '213', trunk: true, national: /^(0[5-7]\d{8}|0[2-4]\d{7})$/ },
  TR: { code: '90', trunk: true, national: /^0[2-5]\d{9}$/ },
  US: { code: '1', trunk: false, national: /^[2-9]\d{9}$/ },
  GB: { code: '44', trunk: true, national: /^0\d{9,10}$/ },
};

/** An example of a right number, to show as the field's hint. */
export const PHONE_EXAMPLE: Record<string, string> = {
  EG: '01012345678',
  SA: '0512345678',
  AE: '0501234567',
  QA: '33123456',
  KW: '51234567',
  BH: '36123456',
  OM: '91234567',
  JO: '0791234567',
  MA: '0612345678',
  DZ: '0551234567',
  TR: '05321234567',
  US: '2025550123',
  GB: '07400123456',
};

const SEPARATORS = /[\s\-(). ]/g;

export type IdProblem = 'phone_letters' | 'bad_phone' | 'bad_national_id';

/** Null when the phone number is right for the country (or empty), else why not. */
export function phoneProblem(
  country: string | undefined,
  raw: string | null | undefined,
): IdProblem | null {
  const text = (raw ?? '').replace(SEPARATORS, '');
  if (!text) return null;
  const intl = text.startsWith('+') || text.startsWith('00');
  const digits = text.startsWith('+')
    ? text.slice(1)
    : text.startsWith('00')
      ? text.slice(2)
      : text;
  if (!/^\d+$/.test(digits)) return 'phone_letters';
  const rule = PHONES[(country ?? '').toUpperCase()];
  if (!rule) return digits.length >= 6 && digits.length <= 15 ? null : 'bad_phone';
  if (!intl && rule.national.test(digits)) return null;
  if (digits.startsWith(rule.code)) {
    const rest = digits.slice(rule.code.length);
    if (rule.national.test(rule.trunk ? `0${rest}` : rest)) return null;
  }
  return intl && !digits.startsWith(rule.code) && digits.length >= 8 && digits.length <= 15
    ? null
    : 'bad_phone';
}

/** Only what a phone number may hold, as it is typed: digits, spaces, dashes and a leading +. */
export const phoneTyping = (v: string) => v.replace(/[^\d+\s-]/g, '').replace(/(?!^)\+/g, '');

const IDS: Record<string, RegExp> = {
  SA: /^[12]\d{9}$/,
  AE: /^784\d{12}$/,
  QA: /^[23]\d{10}$/,
  KW: /^[123]\d{11}$/,
  BH: /^\d{9}$/,
  OM: /^\d{6,9}$/,
  JO: /^\d{10}$/,
  MA: /^[A-Z]{1,2}\d{5,6}$/,
  DZ: /^\d{18}$/,
  US: /^\d{9}$/,
  GB: /^[A-Z]{2}\d{6}[A-D]$/,
};
const EG_GOVERNORATES = new Set([
  1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33,
  34, 35, 88,
]);

/** The Egyptian 14 digits: century, birth date, governorate, serial, check digit. */
function egyptian(id: string): boolean {
  if (!/^[23]\d{13}$/.test(id)) return false;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
    return false;
  if (Date.UTC(year, month - 1, day) > Date.now()) return false;
  return EG_GOVERNORATES.has(Number(id.slice(7, 9)));
}

function turkish(id: string): boolean {
  if (!/^[1-9]\d{10}$/.test(id)) return false;
  const d = [...id].map(Number);
  let tenth = ((d[0]! + d[2]! + d[4]! + d[6]! + d[8]!) * 7 - (d[1]! + d[3]! + d[5]! + d[7]!)) % 10;
  if (tenth < 0) tenth += 10;
  return d[9] === tenth && d[10] === d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
}

/** Null when the national ID is right for the country (or empty), else 'bad_national_id'. */
export function nationalIdProblem(
  country: string | undefined,
  raw: string | null | undefined,
): IdProblem | null {
  const id = (raw ?? '').replace(SEPARATORS, '').toUpperCase();
  if (!id) return null;
  const c = (country ?? '').toUpperCase();
  const ok =
    c === 'EG'
      ? egyptian(id)
      : c === 'TR'
        ? turkish(id)
        : IDS[c]
          ? IDS[c]!.test(id)
          : /^[A-Z0-9]{5,20}$/.test(id);
  return ok ? null : 'bad_national_id';
}

/** How many characters the country's national ID has, where it is fixed (for the field). */
export const NATIONAL_ID_LENGTH: Record<string, number> = {
  EG: 14,
  SA: 10,
  AE: 15,
  QA: 11,
  KW: 12,
  BH: 9,
  JO: 10,
  DZ: 18,
  TR: 11,
  US: 9,
};

/** The fingerprint device's number for a person: digits only. */
export const deviceIdOk = (raw: string | null | undefined) =>
  !raw?.trim() || /^\d{1,10}$/.test(raw.trim());
