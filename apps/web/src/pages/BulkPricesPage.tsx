import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatMoney,
  formatNumber,
  type BulkPriceChange,
  type BulkPriceRequest,
  type BulkPriceResult,
  type Party,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { PartyPicker } from '../components/PartyPicker';
import { GroupPicker } from '../components/GroupTree';
import { CodeName } from '../components/CodeName';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';
import {
  useBulkPriceItems,
  useBulkPrices,
  useCompanySettings,
  useDepartments,
  useGroups,
  useParty,
  useSeasons,
} from '../lib/queries';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

type Mode = '' | BulkPriceChange['mode'];

/**
 * A supplier's prices at once (owner, 2026-11-10: "when the factory raises or lowers its prices,
 * and the margin too"): pick the factory, filter and tick its items, say how the supply price and
 * the sale price change, see every item's old and new price, then apply it all together. The
 * average cost of the stock already held doesn't change: new purchases move it.
 */
export function BulkPricesPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const seeSupply = can('costs:view') || can('purchases:view') || can('purchases:create');
  const seeCost = can('costs:view');
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const money = (v?: number | null) => (v == null ? '—' : formatMoney(v, currency, locale));

  const [params, setParams] = useSearchParams();
  const supplierId = params.get('supplier') ?? '';
  const asked = useParty(supplierId || null);
  const [supplier, setSupplier] = useState<Party | null>(null);
  useEffect(() => {
    if (asked.data && supplier?.id !== asked.data.id) setSupplier(asked.data);
  }, [asked.data, supplier?.id]);

  const departments = (useDepartments().data ?? []).filter((d) => d.isActive);
  const groups = useGroups().data ?? [];
  const seasons = useSeasons().data ?? [];
  const [departmentId, setDepartmentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [search, setSearch] = useState('');
  const typed = useDeferredValue(search.trim());
  const items = useBulkPriceItems({
    supplierId,
    departmentId: departmentId || undefined,
    groupId: groupId || undefined,
    seasonId: seasonId || undefined,
    search: typed || undefined,
  });
  const rows = useMemo(() => items.data ?? [], [items.data]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A new supplier starts with nothing ticked.
  useEffect(() => setPicked(new Set()), [supplierId]);
  const shown = rows.filter((r) => picked.has(r.id));
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));

  const [supplyMode, setSupplyMode] = useState<Mode>('');
  const [supplyValue, setSupplyValue] = useState('');
  const [saleMode, setSaleMode] = useState<Mode>('');
  const [saleValue, setSaleValue] = useState('');
  const [round, setRound] = useState(1);
  const [result, setResult] = useState<BulkPriceResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const bulk = useBulkPrices();

  const change = (mode: Mode, value: string): BulkPriceChange | null =>
    mode && value.trim() !== '' && Number.isFinite(Number(value))
      ? { mode, value: Number(value) }
      : null;
  const input: BulkPriceRequest = {
    supplierId,
    productIds: shown.map((r) => r.id),
    supply: change(supplyMode, supplyValue),
    sale: change(saleMode, saleValue),
    round,
  };
  const ready = shown.length > 0 && (!!input.supply || !!input.sale);
  // A preview is for exactly what is chosen now.
  const key = JSON.stringify(input);
  const [previewKey, setPreviewKey] = useState('');
  const previewed = result && previewKey === key ? result : null;

  async function run(apply: boolean) {
    setDone(null);
    if (apply) {
      const yes = await confirm({
        message: t('bulkPrices.confirm').replace('{n}', formatNumber(shown.length, locale)),
        warning: true,
      });
      if (!yes) return;
    }
    try {
      const r = await bulk.mutateAsync({ input, apply });
      if (apply) {
        setDone(r.changed);
        setResult(null);
        setPreviewKey('');
      } else {
        setResult(r);
        setPreviewKey(key);
      }
    } catch {
      /* shown below */
    }
  }

  const modeSelect = (
    value: Mode,
    onChange: (m: Mode) => void,
    modes: BulkPriceChange['mode'][],
    label: string,
  ) => (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{label}</span>
      <select className={field} value={value} onChange={(e) => onChange(e.target.value as Mode)}>
        <option value="">{t('bulkPrices.noChange')}</option>
        {modes.map((m) => (
          <option key={m} value={m}>
            {t(`bulkPrices.${m}`)}
          </option>
        ))}
      </select>
    </label>
  );
  const valueBox = (value: string, onChange: (v: string) => void, disabled: boolean) => (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted">{t('bulkPrices.value')}</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        className={`${field} tnum`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('bulkPrices.title')}
        action={
          <Button size="sm" variant="ghost" icon="close" onClick={() => navigate('/inventory')}>
            {t('common.back')}
          </Button>
        }
      />

      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <PartyPicker
              type="SUPPLIER"
              withCode
              value={supplier}
              onChange={(p) => {
                setSupplier(p);
                setParams(p ? { supplier: p.id } : {}, { replace: true });
                setResult(null);
              }}
              label={t('invoice.supplier')}
              placeholder={t('invoice.selectSupplier')}
            />
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('item.season')}</span>
            <select
              className={field}
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
            >
              <option value="">—</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('bulkPrices.search')}</span>
            <input className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-app)] bg-surface-2 p-2">
          <span className="text-xs text-muted">{t('groups.path')}</span>
          <GroupPicker
            departments={departments}
            groups={groups}
            departmentId={departmentId}
            groupId={groupId}
            onChange={(d, g) => {
              setDepartmentId(d);
              setGroupId(g);
            }}
          />
        </div>
      </Card>

      {supplierId && (
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={allOn}
                onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
              />
              {t('bulkPrices.selectAll')}
            </label>
            <span className="text-xs text-muted tnum">
              {t('bulkPrices.selected').replace('{n}', formatNumber(shown.length, locale))} /{' '}
              {formatNumber(rows.length, locale)}
            </span>
          </div>
          {items.isLoading ? (
            <div className="grid place-items-center py-10 text-muted">
              <Spinner size={22} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('bulkPrices.empty')} icon="inventory" />
          ) : (
            <TableColumns id="bulkPrices.items">
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="w-10 p-2" />
                      <th className="p-2 text-start font-medium">{t('bulkPrices.items')}</th>
                      <th className="hidden p-2 text-start font-medium md:table-cell">
                        {t('invoice.department')}
                      </th>
                      <th className="p-2 text-end font-medium">{t('inventory.stock')}</th>
                      {seeSupply && (
                        <th className="p-2 text-end font-medium">{t('bulkPrices.supply')}</th>
                      )}
                      {seeCost && (
                        <th className="hidden p-2 text-end font-medium lg:table-cell">
                          {t('bulkPrices.avgCost')}
                        </th>
                      )}
                      <th className="p-2 text-end font-medium">{t('bulkPrices.sale')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-surface-2"
                        onClick={() =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })
                        }
                      >
                        <td className="p-2 text-center">
                          <input type="checkbox" readOnly checked={picked.has(r.id)} />
                        </td>
                        <td className="p-2">
                          <span className="block font-medium">{r.name}</span>
                          <span className="block text-xs text-muted" dir="auto">
                            <CodeName code={r.sku} name={r.supplierCode ?? ''} />
                          </span>
                        </td>
                        <td className="hidden p-2 text-muted md:table-cell">
                          {[r.departmentName, r.groupName, r.seasonName]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                        <td className="p-2 text-end tnum">{formatNumber(r.stockOnHand, locale)}</td>
                        {seeSupply && <td className="p-2 text-end tnum">{money(r.supplyPrice)}</td>}
                        {seeCost && (
                          <td className="hidden p-2 text-end text-muted tnum lg:table-cell">
                            {money(r.avgCost)}
                          </td>
                        )}
                        <td className="p-2 text-end font-medium tnum">{money(r.salePrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableColumns>
          )}
        </Card>
      )}

      {supplierId && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {seeSupply &&
              modeSelect(supplyMode, setSupplyMode, ['pct', 'amt'], t('bulkPrices.supply'))}
            {seeSupply && valueBox(supplyValue, setSupplyValue, !supplyMode)}
            {modeSelect(
              saleMode,
              setSaleMode,
              seeSupply ? ['pct', 'amt', 'margin'] : ['pct', 'amt'],
              t('bulkPrices.sale'),
            )}
            {valueBox(saleValue, setSaleValue, !saleMode)}
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('bulkPrices.round')}</span>
              <select
                className={field}
                value={round}
                onChange={(e) => setRound(Number(e.target.value))}
              >
                <option value={0}>{t('bulkPrices.roundNone')}</option>
                {[1, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {t('bulkPrices.roundTo').replace('{n}', formatMoney(n * 100, currency, locale))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {bulk.error && (
            <p className="rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
              {errorText(t, bulk.error)}
            </p>
          )}
          {done != null && (
            <p className="rounded-[var(--radius-app)] bg-positive-soft p-2 text-xs text-positive">
              {t('bulkPrices.done').replace('{n}', formatNumber(done, locale))}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              icon="search"
              disabled={!ready || bulk.isPending}
              onClick={() => run(false)}
            >
              {t('bulkPrices.preview')}
            </Button>
            <Button
              icon="check"
              loading={bulk.isPending}
              disabled={!ready || !previewed || bulk.isPending}
              onClick={() => run(true)}
            >
              {t('bulkPrices.apply')}
            </Button>
          </div>
        </Card>
      )}

      {previewed && (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t('bulkPrices.items')}</th>
                  {seeSupply && (
                    <th className="p-2 text-end font-medium" colSpan={2}>
                      {t('bulkPrices.supply')}
                    </th>
                  )}
                  <th className="p-2 text-end font-medium" colSpan={2}>
                    {t('bulkPrices.sale')}
                  </th>
                </tr>
                <tr>
                  <th />
                  {seeSupply && (
                    <th className="p-2 text-end font-normal">{t('bulkPrices.before')}</th>
                  )}
                  {seeSupply && (
                    <th className="p-2 text-end font-normal">{t('bulkPrices.after')}</th>
                  )}
                  <th className="p-2 text-end font-normal">{t('bulkPrices.before')}</th>
                  <th className="p-2 text-end font-normal">{t('bulkPrices.after')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {previewed.rows.map((r) => (
                  <tr key={r.id} className={r.changed ? '' : 'text-muted'}>
                    <td className="p-2">
                      <span className="block">{r.name}</span>
                      <span className="block text-xs text-muted" dir="ltr">
                        {r.sku}
                      </span>
                    </td>
                    {seeSupply && <td className="p-2 text-end tnum">{money(r.supplyBefore)}</td>}
                    {seeSupply && (
                      <td className="p-2 text-end font-semibold tnum">{money(r.supplyAfter)}</td>
                    )}
                    <td className="p-2 text-end tnum">{money(r.saleBefore)}</td>
                    <td className="p-2 text-end font-semibold tnum">{money(r.saleAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
