import {
  NATIONAL_ID_LENGTH,
  PHONE_EXAMPLE,
  nationalIdProblem,
  phoneProblem,
  phoneTyping,
  type TranslationKey,
} from '@skb/shared';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCompanySettings } from '../lib/queries';

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand aria-[invalid=true]:border-destructive';

/** The company's country: phones and national IDs follow its rules (owner, 2026-10-02). */
export function useCompanyCountry(): string {
  return useCompanySettings().data?.country ?? 'EG';
}

/** One phone number: only digits (and +, spaces, dashes) can be typed; checked for the country. */
export function PhoneInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { t } = useT();
  const country = useCompanyCountry();
  const problem = phoneProblem(country, value);
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        className={`${input} tnum`}
        dir="ltr"
        inputMode="tel"
        maxLength={20}
        placeholder={PHONE_EXAMPLE[country] ?? ''}
        value={value}
        aria-invalid={!!problem}
        onChange={(e) => onChange(phoneTyping(e.target.value))}
      />
      {problem && (
        <span className="mt-0.5 block text-xs text-destructive">
          {t(`error.${problem}` as TranslationKey)}
        </span>
      )}
    </label>
  );
}

export interface NamedPhone {
  phone: string;
  label: string;
}

/** What a number is: suggested names, any other may be typed. */
const KINDS: TranslationKey[] = ['phone.mobile', 'phone.whatsapp', 'phone.home', 'phone.work'];

/**
 * More phone numbers, each with what it is — WhatsApp, home, a relative's… (owner, 2026-10-02:
 * "more than two, each with a name"), up to `max`, each checked like the main one.
 */
export function PhoneList({
  value,
  onChange,
  max = 5,
  listId,
}: {
  value: NamedPhone[];
  onChange: (v: NamedPhone[]) => void;
  max?: number;
  /** A unique id for the names' suggestions on this page. */
  listId: string;
}) {
  const { t } = useT();
  const country = useCompanyCountry();
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 block text-xs text-muted">{t('parties.otherPhones')}</legend>
      <datalist id={listId}>
        {KINDS.map((k) => (
          <option key={k} value={t(k)} />
        ))}
      </datalist>
      <div className="space-y-2">
        {value.map((p, i) => {
          const problem = phoneProblem(country, p.phone);
          return (
            <div key={i}>
              <div className="flex gap-2">
                <input
                  className={`${input} tnum`}
                  dir="ltr"
                  inputMode="tel"
                  maxLength={20}
                  placeholder={PHONE_EXAMPLE[country] ?? ''}
                  value={p.phone}
                  aria-invalid={!!problem}
                  aria-label={`${t('parties.otherPhones')} ${i + 1}`}
                  onChange={(e) =>
                    onChange(
                      value.map((x, j) =>
                        j === i ? { ...x, phone: phoneTyping(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <input
                  className={input}
                  list={listId}
                  value={p.label}
                  maxLength={60}
                  placeholder={t('parties.phoneLabel')}
                  aria-label={t('parties.phoneLabel')}
                  onChange={(e) =>
                    onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="close"
                  aria-label={t('parties.removePhone')}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                />
              </div>
              {problem && (
                <span className="mt-0.5 block text-xs text-destructive">
                  {t(`error.${problem}` as TranslationKey)}
                </span>
              )}
            </div>
          );
        })}
        {value.length < max && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => onChange([...value, { phone: '', label: '' }])}
          >
            {t('parties.addPhone')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** A national ID, checked as the company's country issues it. */
export function NationalIdInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { t } = useT();
  const country = useCompanyCountry();
  const problem = nationalIdProblem(country, value);
  const length = NATIONAL_ID_LENGTH[country];
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        className={`${input} tnum`}
        dir="ltr"
        inputMode={length ? 'numeric' : 'text'}
        maxLength={length ?? 20}
        value={value}
        aria-invalid={!!problem}
        onChange={(e) =>
          onChange(length ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase())
        }
      />
      {problem && (
        <span className="mt-0.5 block text-xs text-destructive">{t('error.bad_national_id')}</span>
      )}
    </label>
  );
}

/** Any of these phones or the ID wrong for the country (to hold the save). */
export const anyIdProblem = (country: string, phones: string[], nationalId?: string) =>
  phones.some((p) => !!phoneProblem(country, p)) || !!nationalIdProblem(country, nationalId);
