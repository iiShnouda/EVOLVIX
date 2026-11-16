import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  companyToday,
  departmentFitsSeason,
  formatDate,
  formatMoney,
  formatNumber,
  parseDepartmentSeason,
  type AssortmentQuery,
  type AssortmentRow,
} from '@skb/shared';
import { Button, Card, EmptyState, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ReportActions } from '../components/ReportActions';
import { TableColumns } from '../components/TableColumns';
import { DeptSeasonSelect } from '../components/DeptSeasonSelect';
import { useT } from '../lib/i18n';
import { useReportTools } from '../lib/report';
import { useAssortment, useDepartments, useGroups, useSeasons } from '../lib/queries';
import { useAuth } from '../stores/auth';

const small =
  'h-9 min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/**
 * Items by supplier and by department (owner, 2026-11-11: "what each supplier supplies and to which
 * department; only the knitwear factories' goods, or only men's, and the departments' analysis"):
 * suppliers, the department tree a level at a time, or items, with what sold, came back, earned,
 * was bought and is in stock. A supplier opens to its items, a department to its groups.
 */
export function AssortmentTab() {
  const { t, locale } = useT();
  const [q, setQ] = useState<AssortmentQuery>(() => ({
    by: 'supplier',
    from: `${companyToday().slice(0, 7)}-01`,
    to: companyToday(),
    supplierIds: [],
  }));
  const set = (patch: Partial<AssortmentQuery>) => setQ((x) => ({ ...x, ...patch }));
  // The departments' season (owner, 2026-11-16), kept in the address like the analytics tab.
  const [params, setParams] = useSearchParams();
  const season = parseDepartmentSeason(params.get('season'));
  const allDepartments = useDepartments().data ?? [];
  const setSeason = (v?: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set('season', v);
        else next.delete('season');
        return next;
      },
      { replace: true },
    );
    // A department of the other season is let go.
    const picked = allDepartments.find((d) => d.id === q.departmentId);
    if (picked && !departmentFitsSeason(picked.name, parseDepartmentSeason(v)))
      set({ departmentId: undefined, groupId: undefined });
  };
  const { data, isLoading } = useAssortment({ ...q, season });
  // The suppliers to choose from: those with items in what is asked, apart from the suppliers chosen.
  const choices =
    useAssortment({ ...q, season, by: 'supplier', supplierIds: [] }).data?.rows ?? [];
  const mine = useAuth((s) => s.user?.departmentIds ?? null);
  const departments = allDepartments.filter(
    (d) =>
      d.isActive &&
      (!mine?.length || mine.includes(d.id)) &&
      departmentFitsSeason(d.name, season),
  );
  const groupList = useGroups().data;
  const seasons = (useSeasons().data ?? []).filter((s) => s.isActive);
  const [picking, setPicking] = useState(false);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const hidden = new Set(data?.hidden ?? []);
  const m = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);

  // A group's name with the groups above it, for the group list of the department chosen.
  const groupOptions = useMemo(() => {
    const groups = groupList ?? [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    const pathOf = (id: string): string[] => {
      const g = byId.get(id);
      return g ? [...(g.parentId ? pathOf(g.parentId) : []), g.name] : [];
    };
    return groups
      .filter((g) => g.isActive && g.departmentId === q.departmentId)
      .map((g) => ({ id: g.id, name: pathOf(g.id).join(' › ') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groupList, q.departmentId]);

  const nameOf = (r: AssortmentRow) =>
    r.kind === 'NO_SUPPLIER'
      ? t('assort.noSupplier')
      : r.kind === 'NO_DEPARTMENT'
        ? t('assort.noDepartment')
        : r.kind === 'DIRECT'
          ? t('assort.direct')
          : r.name;
  /** A row opens what is under it: a supplier its items, a department or group its groups (else items). */
  const open = (r: AssortmentRow) => {
    if (r.kind === 'SUPPLIER' || r.kind === 'NO_SUPPLIER')
      set({ by: 'item', supplierIds: [r.kind === 'SUPPLIER' ? r.id : 'none'] });
    else if (r.kind === 'DEPARTMENT')
      set(
        r.hasChildren
          ? { departmentId: r.id, groupId: undefined }
          : { by: 'item', departmentId: r.id, groupId: undefined },
      );
    else if (r.kind === 'GROUP')
      set(r.hasChildren ? { groupId: r.id } : { by: 'item', groupId: r.id });
    else if (r.kind === 'DIRECT') set({ by: 'item' });
  };
  const opens = (r: AssortmentRow) => r.kind !== 'ITEM' && r.kind !== 'NO_DEPARTMENT';

  type Col = {
    key: string;
    label: string;
    value: (r: AssortmentRow) => string | number;
    money?: boolean;
    show: boolean;
  };
  const allCols: Col[] = [
    { key: 'items', label: t('assort.items'), value: (r) => r.items, show: q.by !== 'item' },
    { key: 'sold', label: t('assort.sold'), value: (r) => r.soldQty, show: true },
    { key: 'returned', label: t('assort.returned'), value: (r) => r.returnedQty, show: true },
    {
      key: 'net',
      label: t('assort.netSales'),
      value: (r) => r.netSales,
      money: true,
      show: true,
    },
    {
      key: 'profit',
      label: t('assort.profit'),
      value: (r) => r.profit,
      money: true,
      show: !hidden.has('profit'),
    },
    { key: 'bought', label: t('assort.bought'), value: (r) => r.purchasedQty, show: true },
    {
      key: 'purchases',
      label: t('assort.purchases'),
      value: (r) => r.purchases,
      money: true,
      show: !hidden.has('purchases'),
    },
    { key: 'stock', label: t('assort.stock'), value: (r) => r.stockQty, show: true },
    {
      key: 'value',
      label: t('assort.stockValue'),
      value: (r) => r.stockValue,
      money: true,
      show: !hidden.has('costs'),
    },
  ];
  const cols = allCols.filter((c) => c.show);
  const detailLabel =
    q.by === 'supplier' ? t('assort.departments') : q.by === 'item' ? t('assort.place') : null;
  const firstLabel =
    q.by === 'supplier'
      ? t('assort.supplier')
      : q.by === 'item'
        ? t('analytics.item')
        : t('assort.place');
  const views = [
    ['supplier', t('assort.bySupplier')],
    ['department', t('assort.byDepartment')],
    ['item', t('assort.byItem')],
  ] as const;
  const title = `${t('analytics.tabAssortment')} — ${views.find(([v]) => v === q.by)?.[1] ?? ''}`;
  const period = `${formatDate(q.from, locale)} – ${formatDate(q.to, locale)}`;
  const chosen = q.supplierIds.map((id) =>
    id === 'none' ? t('assort.noSupplier') : (choices.find((c) => c.id === id)?.name ?? ''),
  );
  const subtitle = [
    period,
    ...(data?.path ?? []).map((p) => p.name),
    ...(chosen.length ? [chosen.join('، ')] : []),
  ].join(' · ');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('report.from')}</span>
            <input
              className={small}
              type="date"
              value={q.from}
              max={q.to}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('report.to')}</span>
            <input
              className={small}
              type="date"
              value={q.to}
              min={q.from}
              onChange={(e) => e.target.value && set({ to: e.target.value })}
            />
          </label>
          <div className="flex gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1">
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={q.by === v}
                onClick={() => set({ by: v })}
                className={`h-7 rounded-lg px-3 text-sm font-medium ${
                  q.by === v ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
              [firstLabel, ...(detailLabel ? [detailLabel] : []), ...cols.map((c) => c.label)],
              data.rows.map((r) => [
                q.by === 'item' && r.code ? `${r.code} ${nameOf(r)}` : nameOf(r),
                ...(detailLabel ? [r.detail ?? ''] : []),
                ...cols.map((c) => (c.money ? { money: c.value(r) as number } : c.value(r))),
              ]),
              [
                t('ledger.total'),
                ...(detailLabel ? [''] : []),
                ...cols.map((c) =>
                  c.money ? { money: c.value(data.total) as number } : c.value(data.total),
                ),
              ],
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon="parties" onClick={() => setPicking(true)}>
          {q.supplierIds.length
            ? `${t('assort.suppliers')} (${formatNumber(q.supplierIds.length, locale)})`
            : t('assort.allSuppliers')}
        </Button>
        <select
          aria-label={t('invoice.department')}
          className={`${small} max-w-[12rem] flex-1 sm:flex-none`}
          value={q.departmentId ?? ''}
          onChange={(e) => set({ departmentId: e.target.value || undefined, groupId: undefined })}
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
          onChange={setSeason}
        />
        {q.departmentId && groupOptions.length > 0 && (
          <select
            aria-label={t('assort.group')}
            className={`${small} max-w-[14rem] flex-1 sm:flex-none`}
            value={q.groupId ?? ''}
            onChange={(e) => set({ groupId: e.target.value || undefined })}
          >
            <option value="">{t('assort.allGroups')}</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {seasons.length > 0 && (
          <select
            aria-label={t('assort.season')}
            className={`${small} max-w-[10rem] flex-1 sm:flex-none`}
            value={q.seasonId ?? ''}
            onChange={(e) => set({ seasonId: e.target.value || undefined })}
          >
            <option value="">{t('assort.allSeasons')}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {(q.departmentId || q.supplierIds.length > 0) && (
        <nav className="flex flex-wrap items-center gap-1 text-sm" data-noprint>
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => set({ departmentId: undefined, groupId: undefined, supplierIds: [] })}
          >
            {t('assort.allDepartments')}
          </button>
          {(data?.path ?? []).map((p, i, all) => (
            <span key={p.id} className="flex items-center gap-1">
              <Icon name="chevronRight" size={12} className="text-faint rtl:rotate-180" />
              {i === all.length - 1 ? (
                <span className="font-medium">{p.name}</span>
              ) : (
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() =>
                    set(
                      p.kind === 'DEPARTMENT'
                        ? { departmentId: p.id, groupId: undefined }
                        : { groupId: p.id },
                    )
                  }
                >
                  {p.name}
                </button>
              )}
            </span>
          ))}
          {chosen.length > 0 && (
            <span className="flex min-w-0 items-center gap-1 text-muted">
              <Icon name="chevronRight" size={12} className="text-faint rtl:rotate-180" />
              <span className="truncate">{chosen.join('، ')}</span>
            </span>
          )}
        </nav>
      )}

      {isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : (
        <div ref={paper} className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t('assort.items'), n(data.total.items)],
              [t('assort.netSales'), m(data.total.netSales)],
              ...(hidden.has('profit') ? [] : [[t('assort.profit'), m(data.total.profit)]]),
              [t('assort.stock'), n(data.total.stockQty)],
            ].map(([label, value]) => (
              <Card key={label} className="!p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-0.5 font-semibold tnum">{value}</p>
              </Card>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <Card>
              <EmptyState title={t('analytics.empty')} icon="inventory" />
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <TableColumns id={`analytics.assortment.${q.by}`}>
                <table className="w-full min-w-[52rem] text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start font-normal">{firstLabel}</th>
                      {detailLabel && (
                        <th className="px-2 py-2 text-start font-normal">{detailLabel}</th>
                      )}
                      {cols.map((c) => (
                        <th key={c.key} className="px-2 py-2 text-end font-normal">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.rows.map((r) => (
                      <tr
                        key={`${r.kind}-${r.id}`}
                        className={opens(r) ? 'hover:bg-surface-2' : ''}
                      >
                        <td className="max-w-[16rem] px-3 py-1.5 font-medium">
                          {opens(r) ? (
                            <button
                              type="button"
                              className="flex max-w-full items-center gap-1 text-start hover:text-brand hover:underline"
                              onClick={() => open(r)}
                            >
                              <span className="truncate">
                                {r.code && r.kind === 'SUPPLIER' && (
                                  <span className="me-1 text-xs text-faint tnum">{r.code}</span>
                                )}
                                {nameOf(r)}
                              </span>
                              <Icon
                                name="chevronRight"
                                size={12}
                                className="shrink-0 text-faint rtl:rotate-180"
                              />
                            </button>
                          ) : (
                            <span className="block truncate">
                              {nameOf(r)}{' '}
                              {r.code && <span className="text-xs text-faint">{r.code}</span>}
                            </span>
                          )}
                          {q.by === 'item' && r.supplier && (
                            <span className="block truncate text-xs font-normal text-muted">
                              {r.supplier}
                            </span>
                          )}
                        </td>
                        {detailLabel && (
                          <td className="max-w-[14rem] truncate px-2 py-1.5 text-xs text-muted">
                            {r.detail || '–'}
                          </td>
                        )}
                        {cols.map((c) => (
                          <td
                            key={c.key}
                            className={`px-2 py-1.5 text-end tnum ${c.key === 'net' ? 'font-medium' : ''} ${
                              c.key === 'profit' && r.profit < 0 ? 'text-destructive' : ''
                            }`}
                          >
                            {c.money ? m(c.value(r) as number) : n(c.value(r) as number)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-line bg-surface-2 font-semibold">
                    <tr>
                      <td className="px-3 py-2">{t('ledger.total')}</td>
                      {detailLabel && <td />}
                      {cols.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-end tnum">
                          {c.money
                            ? m(c.value(data.total) as number)
                            : n(c.value(data.total) as number)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </TableColumns>
            </Card>
          )}
        </div>
      )}

      {picking && (
        <SupplierChooser
          suppliers={choices}
          chosen={q.supplierIds}
          onChange={(ids) => set({ supplierIds: ids })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** Pick any number of suppliers (e.g. every knitwear factory), with a search. */
function SupplierChooser({
  suppliers,
  chosen,
  onChange,
  onClose,
}: {
  suppliers: AssortmentRow[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const word = search.trim().toLowerCase();
  const list = suppliers
    .map((s) => ({
      id: s.id,
      name: s.kind === 'NO_SUPPLIER' ? t('assort.noSupplier') : s.name,
      code: s.code,
    }))
    .filter((s) => !word || s.name.toLowerCase().includes(word) || s.code === word)
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <Sheet title={t('assort.suppliers')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            className={`${small} flex-1`}
            value={search}
            placeholder={t('assort.searchSupplier')}
            onChange={(e) => setSearch(e.target.value)}
          />
          {chosen.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>
              {t('assort.clear')}
            </Button>
          )}
        </div>
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {list.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-app)] px-2 py-2 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(s.id)}
                  onChange={() => toggle(s.id)}
                />
                {s.code && <span className="text-xs text-faint tnum">{s.code}</span>}
                <span className="min-w-0 truncate">{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
