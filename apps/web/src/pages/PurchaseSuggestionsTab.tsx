import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  departmentFitsSeason,
  formatMoney,
  formatNumber,
  itemSeasonYears,
  parseDepartmentSeason,
  type PurchaseSuggestionsQuery,
} from '@skb/shared';
import { Card, EmptyState, Spinner } from '../components/ui';
import { ReportActions } from '../components/ReportActions';
import { DeptSeasonSelect } from '../components/DeptSeasonSelect';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useDepartments, usePurchaseSuggestions, useSeasons } from '../lib/queries';
import { useAuth } from '../stores/auth';

const small =
  'h-9 min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/**
 * What to buy again (owner, 2026-11-18): each item's stock, what sold in the last days and how long
 * the stock lasts at that pace, with a suggested quantity to cover the days asked; most urgent first,
 * by supplier, so the owner sees what to order from each factory.
 */
export function PurchaseSuggestionsTab() {
  const { t, locale } = useT();
  const [q, setQ] = useState<PurchaseSuggestionsQuery>({ days: 30, target: 30, all: false });
  const set = (patch: Partial<PurchaseSuggestionsQuery>) => setQ((x) => ({ ...x, ...patch }));
  const [params, setParams] = useSearchParams();
  const season = parseDepartmentSeason(params.get('season'));
  const seasons = useSeasons().data ?? [];
  const years = itemSeasonYears(seasons, season);
  const yearParam = Number(params.get('year')) || undefined;
  const year =
    yearParam && (seasons.length === 0 || years.includes(yearParam)) ? yearParam : undefined;
  const setAddress = (key: string, v?: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(key, v);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const allDepartments = useDepartments().data ?? [];
  const mine = useAuth((s) => s.user?.departmentIds ?? null);
  const departments = allDepartments.filter(
    (d) =>
      d.isActive && (!mine?.length || mine.includes(d.id)) && departmentFitsSeason(d.name, season),
  );
  const asked = { ...q, season, year };
  const { data, isLoading } = usePurchaseSuggestions(asked);
  // The suppliers to choose from: those with something in what is asked.
  const choices = usePurchaseSuggestions({ ...asked, supplierId: undefined }).data?.groups ?? [];
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const seeCosts = !(data?.hidden ?? []).includes('costs');
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  const supplierLabel = (g: { id: string; name: string }) =>
    g.id === 'none' ? t('assort.noSupplier') : g.name;

  const title = t('analytics.tabPurchaseSuggestions');
  const subtitle = [
    `${t('buy.days')}: ${n(q.days)}`,
    `${t('buy.target')}: ${n(q.target)}`,
    ...(season
      ? [`${t(season === 'SUMMER' ? 'dash.summer' : 'dash.winter')}${year ? ` ${year}` : ''}`]
      : year
        ? [String(year)]
        : []),
  ].join(' · ');
  const header = [
    t('assort.supplier'),
    t('analytics.item'),
    t('assort.stock'),
    t('assort.sold'),
    t('buy.daily'),
    t('buy.daysLeft'),
    t('inventory.reorder'),
    t('buy.suggested'),
    ...(seeCosts ? [t('buy.cost'), t('buy.value')] : []),
  ];
  const dayInput = (value: number, onChange: (v: number) => void, label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        className={`${small} w-24`}
        type="number"
        min={1}
        max={365}
        value={value}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (v >= 1 && v <= 365) onChange(v);
        }}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {dayInput(q.days, (days) => set({ days }), t('buy.days'))}
          {dayInput(q.target, (target) => set({ target }), t('buy.target'))}
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={q.all}
              onChange={(e) => set({ all: e.target.checked })}
            />
            {t('buy.all')}
          </label>
        </div>
        <ReportActions
          scope="reports"
          disabled={!data}
          onPrint={() => report.print(paper.current, title, subtitle)}
          onExcel={() =>
            data &&
            report.excel(
              title,
              subtitle,
              header,
              data.groups.flatMap((g) =>
                g.rows.map((r) => [
                  supplierLabel(g),
                  `${r.sku} ${r.name}`,
                  r.stock,
                  r.soldQty,
                  r.dailyAverage,
                  r.daysLeft ?? '',
                  r.reorderLevel,
                  r.suggested,
                  ...(seeCosts ? [{ money: r.cost }, { money: r.value }] : []),
                ]),
              ),
              [
                t('ledger.total'),
                '',
                '',
                '',
                '',
                '',
                '',
                data.suggested,
                ...(seeCosts ? ['', { money: data.value }] : []),
              ],
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('assort.supplier')}
          className={`${small} max-w-[14rem] flex-1 sm:flex-none`}
          value={q.supplierId ?? ''}
          onChange={(e) => set({ supplierId: e.target.value || undefined })}
        >
          <option value="">{t('assort.allSuppliers')}</option>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {supplierLabel(g)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('invoice.department')}
          className={`${small} max-w-[12rem] flex-1 sm:flex-none`}
          value={q.departmentId ?? ''}
          onChange={(e) => set({ departmentId: e.target.value || undefined })}
        >
          <option value="">{t('assort.allDepartments')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <DeptSeasonSelect
          className={`${small} max-w-[10rem] flex-1 sm:flex-none`}
          value={season}
          label={t('assort.season')}
          onChange={(v) => {
            setAddress('season', v);
            const picked = allDepartments.find((d) => d.id === q.departmentId);
            if (picked && !departmentFitsSeason(picked.name, v)) set({ departmentId: undefined });
          }}
        />
        <select
          aria-label={t('assort.year')}
          className={`${small} max-w-[8rem] flex-1 sm:flex-none`}
          value={year ?? ''}
          onChange={(e) => setAddress('year', e.target.value || undefined)}
        >
          <option value="">{t('assort.allYears')}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : (
        <div ref={paper} className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              [t('assort.items'), n(data.items)],
              [t('buy.suggested'), n(data.suggested)],
              ...(seeCosts ? [[t('buy.value'), m(data.value)]] : []),
            ].map(([label, value]) => (
              <Card key={label} className="!p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-0.5 font-semibold tnum">{value}</p>
              </Card>
            ))}
          </div>
          {data.groups.length === 0 ? (
            <Card>
              <EmptyState title={t('buy.empty')} icon="inventory" />
            </Card>
          ) : (
            data.groups.map((g) => (
              <Card key={g.id} padded={false} className="overflow-x-auto">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
                  <h3 className="font-semibold">
                    {g.code && <span className="me-1 text-xs text-faint tnum">{g.code}</span>}
                    {supplierLabel(g)}
                  </h3>
                  <p className="text-sm text-muted">
                    {t('assort.items')}: <span className="tnum">{n(g.items)}</span> ·{' '}
                    {t('buy.suggested')}:{' '}
                    <span className="font-semibold text-fg tnum">{n(g.suggested)}</span>
                    {seeCosts && (
                      <>
                        {' '}
                        · {t('buy.value')}: <span className="tnum">{m(g.value)}</span>
                      </>
                    )}
                  </p>
                </div>
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      {header.slice(1).map((h, i) => (
                        <th
                          key={h}
                          className={`px-2 py-2 font-normal ${i === 0 ? 'px-3 text-start' : 'text-end'}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="max-w-[18rem] px-3 py-1.5 font-medium">
                          <span className="block truncate">
                            {r.name} <span className="text-xs text-faint">{r.sku}</span>
                          </span>
                          {r.department && (
                            <span className="block truncate text-xs font-normal text-muted">
                              {r.department}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-end tnum">{n(r.stock)}</td>
                        <td className="px-2 py-1.5 text-end tnum">{n(r.soldQty)}</td>
                        <td className="px-2 py-1.5 text-end tnum">{n(r.dailyAverage)}</td>
                        <td
                          className={`px-2 py-1.5 text-end tnum ${
                            r.daysLeft !== null && r.daysLeft < 7
                              ? 'font-semibold text-destructive'
                              : ''
                          }`}
                        >
                          {r.daysLeft === null ? '–' : n(r.daysLeft)}
                        </td>
                        <td className="px-2 py-1.5 text-end tnum">{n(r.reorderLevel)}</td>
                        <td className="px-2 py-1.5 text-end font-semibold tnum">
                          {n(r.suggested)}
                        </td>
                        {seeCosts && (
                          <>
                            <td className="px-2 py-1.5 text-end tnum">{m(r.cost)}</td>
                            <td className="px-2 py-1.5 text-end tnum">{m(r.value)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
