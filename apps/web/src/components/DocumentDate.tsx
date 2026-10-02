import { companyToday } from '@skb/shared';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * The day a document happened, when it is written later (owner, 2026-10-02): a supplier's invoice
 * entered late, money moved yesterday and written today. Only for people with documents:backdate
 * (the server checks again, and refuses the future and a locked period); when it was really
 * entered is kept on the document. `value` is yyyy-mm-dd, today by default.
 */
export function DocumentDateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (day: string) => void;
  className?: string;
}) {
  const { t } = useT();
  const can = useCan();
  if (!can('documents:backdate')) return null;
  const today = companyToday();
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-0.5 block text-xs text-muted">{t('doc.date')}</span>
      <input
        type="date"
        className={`${field} tnum ${value !== today ? 'border-warning' : ''}`}
        max={today}
        value={value}
        onChange={(e) => onChange(e.target.value || today)}
      />
      {value !== today && (
        <span className="mt-0.5 block text-[11px] text-warning">{t('doc.dateEarlier')}</span>
      )}
    </label>
  );
}

/** The day to send: none when it is today (the server dates it now). */
export const dayToSend = (day: string) => (day && day !== companyToday() ? day : undefined);
