import { useState } from 'react';
import { formatMoney, formatNumber, type SalesDocument } from '@skb/shared';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';

/**
 * An increase never shows to the customer (owner, 2026-11-20), who may be looking at the screen: the
 * prices show with it in them, and the increase itself — what was added, and by whom — shows only to
 * whoever may see increases (`sales:see_increases`), and only after a small toggle that starts off.
 * Whoever types an increase opens the same toggle to type it.
 */
export function useIncreaseView(mayGive = false) {
  const can = useCan();
  const may = can('sales:see_increases');
  const [shown, setShown] = useState(false);
  return { may, available: may || mayGive, shown: (may || mayGive) && shown, setShown };
}

/** The small eye that shows or hides the increases (off by default). */
export function IncreasesToggle({
  on,
  onChange,
  className = '',
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  const { t } = useT();
  const label = t(on ? 'increases.hide' : 'increases.show');
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`inline-grid size-8 shrink-0 place-items-center rounded-[var(--radius-app)] text-faint hover:bg-surface-2 hover:text-muted ${on ? 'bg-surface-2 text-muted' : ''} ${className}`}
    >
      <Icon name={on ? 'eye' : 'eyeOff'} size={16} />
    </button>
  );
}

/**
 * What was added to an invoice, and who added each (for whoever may see increases): each item's
 * increase as typed, then the invoice's own.
 */
export function IncreaseDetails({ doc }: { doc: SalesDocument }) {
  const { t, locale } = useT();
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const lines = doc.lines.filter((l) => (l.increase ?? 0) > 0);
  const own = doc.charges.filter((c) => c.kind === 'INCREASE' && c.amount > 0);
  if (lines.length === 0 && own.length === 0)
    return <p className="text-xs text-faint">{t('increases.none')}</p>;
  const typed = (rate?: number | null, fixed?: number | null, piece?: number | null) =>
    [
      rate ? `${formatNumber(rate, locale)}%` : '',
      fixed ? money(fixed) : '',
      piece ? `${money(piece)} ${t('invoice.perPiece')}` : '',
    ]
      .filter(Boolean)
      .join(' + ');
  return (
    <div className="rounded-[var(--radius-app)] border border-dashed border-line p-2 text-xs">
      <p className="mb-1 font-medium text-muted">{t('increases.title')}</p>
      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{l.productName}</span>
              <span className="text-faint tnum">
                {typed(l.increaseRate, l.increaseFixed, l.increasePiece)}
                {l.increaseBy ? ` · ${t('increases.by')} ${l.increaseBy}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-positive tnum">+{money(l.increase ?? 0)}</span>
          </li>
        ))}
        {own.map((c, i) => (
          <li key={`c${i}`} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block">{t('increases.onInvoice')}</span>
              <span className="text-faint tnum">
                {typed(
                  c.rate,
                  c.rate == null && c.perPiece == null ? c.fixedAmount : null,
                  c.perPiece,
                )}
                {c.by ? ` · ${t('increases.by')} ${c.by}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-positive tnum">+{money(c.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
