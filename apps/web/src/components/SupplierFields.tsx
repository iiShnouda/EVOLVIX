import { useT } from '../lib/i18n';
import { useParties } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

/**
 * An item's / model's main supplier (a factory is a supplier) and that supplier's own code for it.
 * `supplierId` "" means none. A closed supplier still shows when it is the current one.
 */
export function SupplierFields({
  supplierId,
  supplierCode,
  currentName,
  onSupplier,
  onCode,
  disabled,
}: {
  supplierId: string;
  supplierCode: string;
  /** Name of the saved supplier, shown even if it is no longer in the open list. */
  currentName?: string | null;
  onSupplier: (id: string) => void;
  onCode: (code: string) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const suppliers = useParties({ page: 1, pageSize: 100, type: 'SUPPLIER', active: true });
  const rows = suppliers.data?.items ?? [];
  const missing = supplierId && !rows.some((p) => p.id === supplierId);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted">{t('catalog.supplier')}</span>
        <select
          className={field}
          value={supplierId}
          disabled={disabled}
          onChange={(e) => onSupplier(e.target.value)}
        >
          <option value="">{t('catalog.noSupplier')}</option>
          {missing && <option value={supplierId}>{currentName ?? supplierId}</option>}
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted">{t('catalog.supplierCode')}</span>
        <input
          className={field}
          dir="auto"
          maxLength={64}
          value={supplierCode}
          disabled={disabled}
          onChange={(e) => onCode(e.target.value)}
        />
      </label>
    </div>
  );
}
