import type { LocalizedName } from '@skb/shared';
import { Badge } from './ui';
import { useT } from '../lib/i18n';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

export interface NameValues {
  ar: string;
  en: string;
}

export const namesFrom = (n?: LocalizedName | null): NameValues => ({
  ar: n?.ar ?? '',
  en: n?.en ?? '',
});

/**
 * Only what changed, so the server can tell a typed name from an untouched one (an untouched AI
 * translation keeps following its source). On create, send just the language that was typed.
 */
export function changedNames(values: NameValues, before?: LocalizedName | null) {
  const out: { nameAr?: string; nameEn?: string } = {};
  if (values.ar.trim() && values.ar.trim() !== (before?.ar ?? '')) out.nameAr = values.ar.trim();
  if (values.en.trim() && values.en.trim() !== (before?.en ?? '')) out.nameEn = values.en.trim();
  return out;
}

/**
 * Name input(s) for things named in both languages (branches, warehouses, categories, items).
 * Creating: one field, in the screen language — the other language is translated by AI after
 * saving. Editing: both fields, the screen language first, with an "AI" mark on a machine
 * translation (still editable) and a "Translating…" note while it hasn't arrived.
 */
export function NameFields({
  mode,
  values,
  onChange,
  names,
  label,
  placeholder,
  autoFocus,
}: {
  mode: 'create' | 'edit';
  values: NameValues;
  onChange: (next: NameValues) => void;
  names?: LocalizedName | null;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t, locale } = useT();
  const first: 'ar' | 'en' = locale === 'ar' ? 'ar' : 'en';
  const second: 'ar' | 'en' = first === 'ar' ? 'en' : 'ar';
  const shown: Array<'ar' | 'en'> = mode === 'create' ? [first] : [first, second];

  return (
    <div className="space-y-2">
      {shown.map((lang, i) => {
        const isAuto = names?.auto === lang;
        const waiting = !!names?.pending && names.source !== lang;
        return (
          <label key={lang} className="block">
            <span className="mb-0.5 flex items-center gap-2 text-xs text-muted">
              {mode === 'create' && label ? label : t(lang === 'ar' ? 'names.ar' : 'names.en')}
              {isAuto && !waiting && (
                <span title={t('names.aiHint')}>
                  <Badge tone="info">{t('names.ai')}</Badge>
                </span>
              )}
              {waiting && <span className="text-warning">{t('names.translating')}</span>}
            </span>
            <input
              className={field}
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              lang={lang}
              autoFocus={autoFocus && i === 0}
              placeholder={i === 0 ? placeholder : waiting ? t('names.translating') : undefined}
              value={values[lang]}
              onChange={(e) => onChange({ ...values, [lang]: e.target.value })}
            />
          </label>
        );
      })}
      {mode === 'edit' && names?.pending && (
        <p className="text-xs text-faint">{t('names.translatingHint')}</p>
      )}
    </div>
  );
}
