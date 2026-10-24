/**
 * Country & currency reference data for the Settings screen.
 *
 * NOTE on minor units: money is stored as integer minor units with a fixed 100
 * (2 decimals) — see money.ts. Currencies whose real minor unit is not 2 decimals
 * (KWD/BHD/OMR/JOD/TND = 3, JPY = 0) are marked with `decimals` here for the future
 * per-currency refactor; today the app treats every currency as 2-decimal for storage.
 */

export interface CountryOption {
  /** ISO 3166-1 alpha-2 code. */
  code: string;
  nameEn: string;
  nameAr: string;
  /** Default/base currency for the country. */
  currency: string;
  /** Typical standard VAT/GST rate (%). The owner can override with their own. */
  vat: number;
  /** The time zone suggested for the country (one of TIME_ZONES). */
  timeZone: string;
}

export interface CurrencyOption {
  /** ISO 4217 code. */
  code: string;
  nameEn: string;
  nameAr: string;
  symbol: string;
  /** Real minor-unit decimals (see note above). */
  decimals: number;
}

/** Currencies offered in the picker. Ordered with the region's common ones first. */
export const CURRENCIES: CurrencyOption[] = [
  { code: 'EGP', nameEn: 'Egyptian Pound', nameAr: 'جنيه مصري', symbol: 'ج.م', decimals: 2 },
  { code: 'SAR', nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'ر.س', decimals: 2 },
  { code: 'AED', nameEn: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'د.إ', decimals: 2 },
  { code: 'QAR', nameEn: 'Qatari Riyal', nameAr: 'ريال قطري', symbol: 'ر.ق', decimals: 2 },
  { code: 'KWD', nameEn: 'Kuwaiti Dinar', nameAr: 'دينار كويتي', symbol: 'د.ك', decimals: 3 },
  { code: 'BHD', nameEn: 'Bahraini Dinar', nameAr: 'دينار بحريني', symbol: 'د.ب', decimals: 3 },
  { code: 'OMR', nameEn: 'Omani Rial', nameAr: 'ريال عماني', symbol: 'ر.ع', decimals: 3 },
  { code: 'JOD', nameEn: 'Jordanian Dinar', nameAr: 'دينار أردني', symbol: 'د.أ', decimals: 3 },
  { code: 'USD', nameEn: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', decimals: 2 },
  { code: 'EUR', nameEn: 'Euro', nameAr: 'يورو', symbol: '€', decimals: 2 },
  { code: 'GBP', nameEn: 'British Pound', nameAr: 'جنيه إسترليني', symbol: '£', decimals: 2 },
  { code: 'TRY', nameEn: 'Turkish Lira', nameAr: 'ليرة تركية', symbol: '₺', decimals: 2 },
  { code: 'MAD', nameEn: 'Moroccan Dirham', nameAr: 'درهم مغربي', symbol: 'د.م', decimals: 2 },
  { code: 'DZD', nameEn: 'Algerian Dinar', nameAr: 'دينار جزائري', symbol: 'دج', decimals: 2 },
];

/**
 * The currencies amounts can be kept in (owner, 2026-10-24): two decimals, as every amount is stored
 * in hundredths. A 3-decimal one (KWD, BHD, OMR, JOD) would lose its last digit, so it isn't offered.
 */
export const MONEY_CURRENCIES: CurrencyOption[] = CURRENCIES.filter((c) => c.decimals === 2);

/** Countries offered in the picker, each suggesting a currency + a typical VAT. */
export const COUNTRIES: CountryOption[] = [
  {
    code: 'EG',
    nameEn: 'Egypt',
    nameAr: 'مصر',
    currency: 'EGP',
    vat: 14,
    timeZone: 'Africa/Cairo',
  },
  {
    code: 'SA',
    nameEn: 'Saudi Arabia',
    nameAr: 'السعودية',
    currency: 'SAR',
    vat: 15,
    timeZone: 'Asia/Riyadh',
  },
  {
    code: 'AE',
    nameEn: 'United Arab Emirates',
    nameAr: 'الإمارات',
    currency: 'AED',
    vat: 5,
    timeZone: 'Asia/Dubai',
  },
  { code: 'QA', nameEn: 'Qatar', nameAr: 'قطر', currency: 'QAR', vat: 0, timeZone: 'Asia/Qatar' },
  {
    code: 'KW',
    nameEn: 'Kuwait',
    nameAr: 'الكويت',
    currency: 'KWD',
    vat: 0,
    timeZone: 'Asia/Kuwait',
  },
  {
    code: 'BH',
    nameEn: 'Bahrain',
    nameAr: 'البحرين',
    currency: 'BHD',
    vat: 10,
    timeZone: 'Asia/Bahrain',
  },
  { code: 'OM', nameEn: 'Oman', nameAr: 'عُمان', currency: 'OMR', vat: 5, timeZone: 'Asia/Muscat' },
  {
    code: 'JO',
    nameEn: 'Jordan',
    nameAr: 'الأردن',
    currency: 'JOD',
    vat: 16,
    timeZone: 'Asia/Amman',
  },
  {
    code: 'MA',
    nameEn: 'Morocco',
    nameAr: 'المغرب',
    currency: 'MAD',
    vat: 20,
    timeZone: 'Africa/Casablanca',
  },
  {
    code: 'DZ',
    nameEn: 'Algeria',
    nameAr: 'الجزائر',
    currency: 'DZD',
    vat: 19,
    timeZone: 'Africa/Algiers',
  },
  {
    code: 'TR',
    nameEn: 'Türkiye',
    nameAr: 'تركيا',
    currency: 'TRY',
    vat: 20,
    timeZone: 'Europe/Istanbul',
  },
  {
    code: 'US',
    nameEn: 'United States',
    nameAr: 'الولايات المتحدة',
    currency: 'USD',
    vat: 0,
    timeZone: 'America/New_York',
  },
  {
    code: 'GB',
    nameEn: 'United Kingdom',
    nameAr: 'المملكة المتحدة',
    currency: 'GBP',
    vat: 20,
    timeZone: 'Europe/London',
  },
  {
    code: 'EU',
    nameEn: 'Eurozone',
    nameAr: 'منطقة اليورو',
    currency: 'EUR',
    vat: 20,
    timeZone: 'Europe/Berlin',
  },
];

export interface TimeZoneOption {
  /** IANA id, e.g. "Africa/Cairo". */
  id: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Time zones offered in Settings. Business days (today, report periods, daily cash, months) follow
 * the company's zone. Mirrors `CompanyClock.Zones` on the server.
 */
export const TIME_ZONES: TimeZoneOption[] = [
  { id: 'Africa/Cairo', nameEn: 'Cairo', nameAr: 'القاهرة' },
  { id: 'Asia/Riyadh', nameEn: 'Riyadh', nameAr: 'الرياض' },
  { id: 'Asia/Dubai', nameEn: 'Dubai', nameAr: 'دبي' },
  { id: 'Asia/Qatar', nameEn: 'Doha', nameAr: 'الدوحة' },
  { id: 'Asia/Kuwait', nameEn: 'Kuwait', nameAr: 'الكويت' },
  { id: 'Asia/Bahrain', nameEn: 'Manama', nameAr: 'المنامة' },
  { id: 'Asia/Muscat', nameEn: 'Muscat', nameAr: 'مسقط' },
  { id: 'Asia/Amman', nameEn: 'Amman', nameAr: 'عمّان' },
  { id: 'Asia/Baghdad', nameEn: 'Baghdad', nameAr: 'بغداد' },
  { id: 'Asia/Beirut', nameEn: 'Beirut', nameAr: 'بيروت' },
  { id: 'Africa/Khartoum', nameEn: 'Khartoum', nameAr: 'الخرطوم' },
  { id: 'Africa/Tripoli', nameEn: 'Tripoli', nameAr: 'طرابلس' },
  { id: 'Africa/Tunis', nameEn: 'Tunis', nameAr: 'تونس' },
  { id: 'Africa/Algiers', nameEn: 'Algiers', nameAr: 'الجزائر' },
  { id: 'Africa/Casablanca', nameEn: 'Casablanca', nameAr: 'الدار البيضاء' },
  { id: 'Europe/Istanbul', nameEn: 'Istanbul', nameAr: 'إسطنبول' },
  { id: 'Europe/London', nameEn: 'London', nameAr: 'لندن' },
  { id: 'Europe/Berlin', nameEn: 'Berlin', nameAr: 'برلين' },
  { id: 'America/New_York', nameEn: 'New York', nameAr: 'نيويورك' },
  { id: 'UTC', nameEn: 'UTC', nameAr: 'التوقيت العالمي' },
];

export function findCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
export function findCurrency(code: string): CurrencyOption | undefined {
  return CURRENCIES.find((c) => c.code === code);
}
