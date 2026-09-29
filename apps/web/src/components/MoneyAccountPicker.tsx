import { formatMoney } from '@skb/shared';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useMoneyAccounts } from '../lib/queries';

/**
 * Where money paid now (or refunded) goes through. Empty = the branch's cash box, which the server
 * uses by default. Shown only to people who may see money accounts.
 */
export function MoneyAccountPicker({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  className: string;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const allowed = can('receipts:view');
  const accounts = useMoneyAccounts(allowed);
  if (!allowed) return null;
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('money.defaultAccount')}</option>
        {(accounts.data ?? [])
          .filter((a) => a.isActive)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {t(`money.kind.${a.kind}`)} · {formatMoney(a.balance, a.currency, locale)}
            </option>
          ))}
      </select>
    </label>
  );
}
