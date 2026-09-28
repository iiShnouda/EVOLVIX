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

/** Countries offered in the picker, each suggesting a currency + a typical VAT. */
export const COUNTRIES: CountryOption[] = [
  { code: 'EG', nameEn: 'Egypt', nameAr: 'مصر', currency: 'EGP', vat: 14 },
  { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية', currency: 'SAR', vat: 15 },
  { code: 'AE', nameEn: 'United Arab Emirates', nameAr: 'الإمارات', currency: 'AED', vat: 5 },
  { code: 'QA', nameEn: 'Qatar', nameAr: 'قطر', currency: 'QAR', vat: 0 },
  { code: 'KW', nameEn: 'Kuwait', nameAr: 'الكويت', currency: 'KWD', vat: 0 },
  { code: 'BH', nameEn: 'Bahrain', nameAr: 'البحرين', currency: 'BHD', vat: 10 },
  { code: 'OM', nameEn: 'Oman', nameAr: 'عُمان', currency: 'OMR', vat: 5 },
  { code: 'JO', nameEn: 'Jordan', nameAr: 'الأردن', currency: 'JOD', vat: 16 },
  { code: 'MA', nameEn: 'Morocco', nameAr: 'المغرب', currency: 'MAD', vat: 20 },
  { code: 'DZ', nameEn: 'Algeria', nameAr: 'الجزائر', currency: 'DZD', vat: 19 },
  { code: 'TR', nameEn: 'Türkiye', nameAr: 'تركيا', currency: 'TRY', vat: 20 },
  { code: 'US', nameEn: 'United States', nameAr: 'الولايات المتحدة', currency: 'USD', vat: 0 },
  { code: 'GB', nameEn: 'United Kingdom', nameAr: 'المملكة المتحدة', currency: 'GBP', vat: 20 },
  { code: 'EU', nameEn: 'Eurozone', nameAr: 'منطقة اليورو', currency: 'EUR', vat: 20 },
];

export function findCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
export function findCurrency(code: string): CurrencyOption | undefined {
  return CURRENCIES.find((c) => c.code === code);
}
