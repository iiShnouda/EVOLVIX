import type { Warehouse } from '@skb/shared';
import { useT } from '../lib/i18n';
import { useWarehouses } from '../lib/queries';
import { useWorkBranch } from '../stores/workBranch';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** The warehouse a new document or count should start on: the working branch's default. */
export function pickDefaultWarehouse(list: Warehouse[], branchId?: string): Warehouse | undefined {
  const open = list.filter((w) => w.isActive);
  return (
    open.find((w) => w.isDefault && w.branchId === branchId) ??
    open.find((w) => w.branchId === branchId) ??
    open.find((w) => w.isDefault) ??
    open[0]
  );
}

export function useDefaultWarehouseId(): string {
  const branchId = useWorkBranch();
  const list = useWarehouses(true);
  return pickDefaultWarehouse(list.data ?? [], branchId)?.id ?? '';
}

/**
 * Warehouse picker. `allowAll` adds an "All warehouses" choice (value ''). Only open warehouses
 * are offered for posting; lists that filter reports also show closed ones.
 */
export function WarehouseSelect({
  value,
  onChange,
  allowAll,
  includeClosed,
  className,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  includeClosed?: boolean;
  className?: string;
  label?: string;
}) {
  const { t } = useT();
  const list = useWarehouses(!includeClosed);
  const rows = list.data ?? [];
  const showBranch = new Set(rows.map((w) => w.branchId)).size > 1;

  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-0.5 block text-xs text-muted">{label ?? t('warehouse.label')}</span>
      <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">{t('warehouse.all')}</option>}
        {!allowAll && !value && <option value="">…</option>}
        {rows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {showBranch ? ` · ${w.branchName}` : ''}
            {!w.isActive ? ` (${t('warehouse.closed')})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
