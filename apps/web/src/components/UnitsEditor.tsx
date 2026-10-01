import type { UnitOfMeasure } from '@skb/shared';
import { Button } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

/**
 * One unit of an item in an editor: which unit, how many base units it holds, its barcode. The
 * first row is always the base unit (it holds 1); the rest are larger units.
 */
export interface UnitRow {
  unitId: string;
  factor: number;
  barcode: string;
}

/**
 * The units an item (or model) comes in: its base unit — the smallest one, in which stock is
 * counted — and larger ones that hold a number of base units (carton = 24 pieces), each with an
 * optional barcode. `baseLocked` keeps the base unit once stock has moved in it; `barcodesOnly`
 * (a size/color of a model) lets only the barcodes change.
 */
export function UnitsEditor({
  units,
  rows,
  onChange,
  withBarcodes = true,
  baseLocked = false,
  barcodesOnly = false,
}: {
  units: UnitOfMeasure[];
  rows: UnitRow[];
  onChange: (rows: UnitRow[]) => void;
  withBarcodes?: boolean;
  baseLocked?: boolean;
  barcodesOnly?: boolean;
}) {
  const { t } = useT();
  const base = rows[0] ?? { unitId: '', factor: 1, barcode: '' };
  const larger = rows.slice(1);
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? '';
  const used = new Set(rows.map((r) => r.unitId));
  // Closed units stay listed where an item already uses them.
  const options = (current: string) =>
    units.filter((u) => u.id === current || (u.isActive && !used.has(u.id)));

  function update(row: UnitRow, patch: Partial<UnitRow>) {
    onChange(rows.map((r) => (r === row ? { ...r, ...patch } : r)));
  }
  function setBase(patch: Partial<UnitRow>) {
    if (rows.length > 0) update(base, { ...patch, factor: 1 });
    else onChange([{ ...base, ...patch, factor: 1 }]);
  }

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${withBarcodes ? 'sm:grid-cols-2' : ''}`}>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('item.baseUnit')}</span>
          <select
            className={field}
            value={base.unitId}
            disabled={baseLocked || barcodesOnly}
            onChange={(e) => setBase({ unitId: e.target.value })}
          >
            <option value="">{t('item.pickUnit')}</option>
            {options(base.unitId).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {baseLocked && (
            <span className="mt-0.5 block text-xs text-faint">{t('item.baseLocked')}</span>
          )}
        </label>
        {withBarcodes && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('item.barcode')}</span>
            <input
              className={`${field} tnum`}
              dir="ltr"
              value={base.barcode}
              onChange={(e) => setBase({ barcode: e.target.value })}
            />
          </label>
        )}
      </div>

      {larger.map((row, i) => (
        <div
          key={i}
          className={`grid items-end gap-2 rounded-[var(--radius-app)] border border-line p-2 ${
            withBarcodes
              ? 'grid-cols-2 sm:grid-cols-[1fr_140px_1fr_auto]'
              : 'grid-cols-[1fr_140px_auto]'
          }`}
        >
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('item.largerUnit')}</span>
            <select
              className={field}
              value={row.unitId}
              disabled={barcodesOnly}
              onChange={(e) => update(row, { unitId: e.target.value })}
            >
              <option value="">{t('item.pickUnit')}</option>
              {options(row.unitId).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">
              {t('item.holds')} ({nameOf(base.unitId)})
            </span>
            <input
              type="number"
              min={2}
              max={100000}
              className={`${field} tnum`}
              value={row.factor || ''}
              disabled={barcodesOnly}
              onChange={(e) =>
                update(row, { factor: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
          </label>
          {withBarcodes && (
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-0.5 block text-xs text-muted">{t('item.barcode')}</span>
              <input
                className={`${field} tnum`}
                dir="ltr"
                value={row.barcode}
                onChange={(e) => update(row, { barcode: e.target.value })}
              />
            </label>
          )}
          {!barcodesOnly && (
            <button
              type="button"
              className="grid h-9 w-9 place-items-center justify-self-end rounded-[var(--radius-app)] text-faint hover:bg-surface-2 hover:text-destructive"
              aria-label={t('item.removeUnit')}
              title={t('item.removeUnit')}
              onClick={() => onChange(rows.filter((r) => r !== row))}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      ))}

      {!barcodesOnly && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="plus"
          disabled={!base.unitId}
          onClick={() =>
            onChange([
              ...rows,
              { unitId: '', factor: Math.max(2, ...rows.map((r) => r.factor * 2)), barcode: '' },
            ])
          }
        >
          {t('item.addUnit')}
        </Button>
      )}
    </div>
  );
}

/** Rows ready for the API: the base unit holds 1, units picked, barcodes trimmed (empty = none). */
export function unitRowsToInput(rows: UnitRow[], withBarcodes = true) {
  return rows
    .map((r, i) => ({ ...r, factor: i === 0 ? 1 : r.factor }))
    .filter((r) => r.unitId)
    .map((r) => ({
      unitId: r.unitId,
      factor: r.factor,
      barcode: withBarcodes && r.barcode.trim() ? r.barcode.trim() : undefined,
    }));
}

/** Every unit picked and every larger unit holding at least 2 base units. */
export function unitRowsValid(rows: UnitRow[]) {
  return rows.length > 0 && rows.every((r, i) => r.unitId && (i === 0 || r.factor >= 2));
}
