import {
  formatMoney,
  toMajor,
  type PriceCell,
  type PriceLevel,
  type PriceSource,
} from '@skb/shared';
import { useT } from '../lib/i18n';
import { TableColumns } from './TableColumns';

const field =
  'h-9 w-full min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand disabled:bg-surface-2 disabled:opacity-80';

/** Typed prices by cell, as major-unit text ("" = no own price). */
export type PriceInputs = Record<string, string>;

export const cellKey = (unitId: string, levelId: string) => `${unitId}:${levelId}`;

export interface GridUnit {
  unitId: string;
  name: string;
  factor: number;
}

/**
 * Prices of each unit at each price level, sales levels first. A cell left empty follows the rule
 * shown in grey — the model's price, the base unit × its count, or the default level's — the same
 * order the server uses (PriceBook). `saved` are the server's cells (they know a model's prices);
 * without permission the grid is read-only.
 */
export function PriceGrid({
  units,
  levels,
  inputs,
  onChange,
  saved,
  currency,
  readOnly,
}: {
  units: GridUnit[];
  levels: PriceLevel[];
  inputs: PriceInputs;
  onChange: (next: PriceInputs) => void;
  saved?: PriceCell[];
  currency: string;
  readOnly?: boolean;
}) {
  const { t, locale } = useT();
  const active = levels.filter((l) => l.isActive);
  const sides = (['SALE', 'PURCHASE'] as const)
    .map((side) => ({ side, levels: active.filter((l) => l.side === side) }))
    .filter((g) => g.levels.length > 0);
  const base = units.find((u) => u.factor === 1);
  const own = (unitId: string, levelId: string): number | null => {
    const raw = inputs[cellKey(unitId, levelId)];
    return raw === undefined || raw.trim() === '' || Number.isNaN(Number(raw))
      ? null
      : Math.round(Number(raw) * 100);
  };

  /** What an empty cell charges: inherited (model) → base × factor → default level. */
  function inherited(
    unit: GridUnit,
    level: PriceLevel,
  ): { price: number; source: PriceSource } | null {
    const at = (lv: PriceLevel): { price: number; source: PriceSource } | null => {
      const direct = own(unit.unitId, lv.id);
      if (direct !== null) return { price: direct, source: 'OWN' };
      const fromModel = saved?.find(
        (c) => c.unitId === unit.unitId && c.priceLevelId === lv.id && c.source === 'MODEL',
      );
      if (fromModel?.effective != null) return { price: fromModel.effective, source: 'MODEL' };
      if (unit.factor > 1 && base) {
        const b = own(base.unitId, lv.id);
        const bModel = saved?.find(
          (c) => c.unitId === base.unitId && c.priceLevelId === lv.id && c.source === 'MODEL',
        )?.effective;
        const basePrice = b ?? bModel ?? null;
        if (basePrice !== null) return { price: basePrice * unit.factor, source: 'BASE' };
      }
      return null;
    };
    const found = at(level);
    if (found && found.source !== 'OWN') return found;
    if (found) return null;
    const def = active.find((l) => l.side === level.side && l.isDefault);
    if (def && def.id !== level.id) {
      const viaDefault = at(def);
      if (viaDefault) return { price: viaDefault.price, source: 'DEFAULT' };
    }
    return null;
  }

  if (units.length === 0 || sides.length === 0) return null;

  return (
    <div className="space-y-3">
      {sides.map(({ side, levels: sideLevels }) => (
        <div key={side} className="overflow-hidden rounded-[var(--radius-app)] border border-line">
          <TableColumns id="prices.grid">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="w-[34%] p-2 text-start font-medium">
                    {t(side === 'SALE' ? 'item.salesLevels' : 'item.purchaseLevels')}
                  </th>
                  {units.map((u) => (
                    <th key={u.unitId} className="p-2 text-start font-medium">
                      {u.name}
                      {u.factor > 1 && <span className="font-normal tnum"> ×{u.factor}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {sideLevels.map((level) => (
                  <tr key={level.id}>
                    <td className="p-2 align-top">
                      <span className="block truncate font-medium">{level.name}</span>
                    </td>
                    {units.map((u) => {
                      const key = cellKey(u.unitId, level.id);
                      const hint = inherited(u, level);
                      return (
                        <td key={key} className="p-1.5 align-top">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            className={`${field} tnum`}
                            disabled={readOnly}
                            value={inputs[key] ?? ''}
                            placeholder={hint ? String(toMajor(hint.price)) : undefined}
                            aria-label={`${level.name} · ${u.name}`}
                            onChange={(e) => onChange({ ...inputs, [key]: e.target.value })}
                          />
                          <span className="mt-0.5 block truncate text-[11px] text-faint">
                            {inputs[key]?.trim()
                              ? t('item.source.OWN')
                              : hint
                                ? `${formatMoney(hint.price, currency, locale)} · ${t(`item.source.${hint.source}` as const)}`
                                : t('item.noPrice')}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableColumns>
        </div>
      ))}
      <p className="text-xs text-faint">
        {readOnly ? t('item.pricesReadonly') : t('item.pricesHint')}
      </p>
    </div>
  );
}

/** The own prices from saved cells, as editor inputs. */
export function inputsFrom(cells: PriceCell[] | undefined): PriceInputs {
  const out: PriceInputs = {};
  for (const c of cells ?? [])
    if (c.own != null) out[cellKey(c.unitId, c.priceLevelId)] = String(toMajor(c.own));
  return out;
}

/**
 * The price changes to send: every cell whose typed value differs from what was saved (null
 * clears an own price). Only cells of units still on the item, and of open levels.
 */
export function priceChanges(
  inputs: PriceInputs,
  saved: PriceCell[] | undefined,
  units: GridUnit[],
  levels: PriceLevel[],
) {
  const out: { unitId: string; priceLevelId: string; price: number | null }[] = [];
  for (const u of units) {
    for (const l of levels.filter((x) => x.isActive)) {
      const key = cellKey(u.unitId, l.id);
      const raw = inputs[key]?.trim() ?? '';
      const next =
        raw === '' || Number.isNaN(Number(raw)) ? null : Math.max(0, Math.round(Number(raw) * 100));
      const before =
        saved?.find((c) => c.unitId === u.unitId && c.priceLevelId === l.id)?.own ?? null;
      if (next !== before) out.push({ unitId: u.unitId, priceLevelId: l.id, price: next });
    }
  }
  return out;
}
