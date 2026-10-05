import { useState } from 'react';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  type ItemLife,
  type ItemLifeLine,
  type TranslationKey,
} from '@skb/shared';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { Spinner } from './ui';
import { TableColumns } from './TableColumns';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useItemLife } from '../lib/queries';
import { CodeName } from './CodeName';

type Tab = 'summary' | 'purchases' | 'sales' | 'returns' | 'prices';

/**
 * The item's card while making an invoice (owner, 2026-10-02): its whole story from the supplier to
 * the customer — purchases with the supplier's discount, sales with their price and discount, returns,
 * how its price moved from invoice to invoice, its margin and where it is now. Each part shows only
 * for the permission it needs; the server leaves out what the person may not see.
 */
export function ItemLifeSheet({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { t, locale } = useT();
  const life = useItemLife(productId);
  const seeCosts = useCan()('costs:view');
  const [tab, setTab] = useState<Tab>('summary');
  const data = life.data;
  const money = (v: number | null | undefined) =>
    v == null ? '–' : formatMoney(v, data?.currency ?? 'EGP', locale);

  const tabs: { key: Tab; label: TranslationKey; show: boolean }[] = [
    { key: 'summary', label: 'life.summary', show: true },
    { key: 'purchases', label: 'life.purchases', show: !!data?.purchases },
    { key: 'sales', label: 'life.sales', show: !!data?.sales },
    { key: 'returns', label: 'life.returns', show: !!data?.returns },
    {
      key: 'prices',
      label: 'life.prices',
      show: !!data?.prices && (!!data?.sales || !!data?.purchases),
    },
  ];

  return (
    <Sheet
      title={data ? `${data.name} · ${data.sku}` : t('itemCard.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide="full"
      fill
    >
      {life.isLoading || !data ? (
        <div className="grid place-items-center py-16 text-muted">
          {life.isError ? t('common.errorTitle') : <Spinner size={24} />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-line pb-2">
            {tabs
              .filter((x) => x.show)
              .map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setTab(x.key)}
                  className={`rounded-[var(--radius-app)] px-3 py-1.5 text-sm font-medium ${tab === x.key ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2'}`}
                >
                  {t(x.label)}
                </button>
              ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'summary' && <Summary data={data} money={money} seeCosts={seeCosts} />}
            {tab === 'purchases' && data.purchases && (
              <Lines id="life.purchases" rows={data.purchases} money={money} party="supplier" />
            )}
            {tab === 'sales' && data.sales && (
              <Lines id="life.sales" rows={data.sales} money={money} party="customer" profit />
            )}
            {tab === 'returns' && data.returns && (
              <Lines id="life.returns" rows={data.returns} money={money} party="any" withType />
            )}
            {tab === 'prices' && <Prices data={data} money={money} />}
          </div>
        </div>
      )}
    </Sheet>
  );

  function Summary({
    data,
    money,
    seeCosts,
  }: {
    data: ItemLife;
    money: (v: number | null | undefined) => string;
    seeCosts: boolean;
  }) {
    const x = data.totals;
    const tile = (label: TranslationKey, value: string, tone = '') => (
      <div className="rounded-[var(--radius-app)] border border-line bg-surface p-3">
        <div className="text-xs text-muted">{t(label)}</div>
        <div className={`mt-1 text-lg font-semibold tnum ${tone}`}>{value}</div>
      </div>
    );
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          {data.supplierName && (
            <span>
              {t('finder.supplier')}: <b className="text-fg">{data.supplierName}</b>
            </span>
          )}
          {data.departmentName && (
            <span>
              {t('finder.category')}: <b className="text-fg">{data.departmentName}</b>
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {tile('life.salePrice', money(x.salePrice))}
          {seeCosts && tile('life.lastCost', money(x.lastCost))}
          {seeCosts &&
            tile(
              'life.margin',
              x.marginPercent == null ? '–' : `${formatNumber(x.marginPercent, locale)}%`,
              (x.marginPercent ?? 0) < 0 ? 'text-destructive' : 'text-positive',
            )}
          {tile('life.bought', formatNumber(x.bought, locale))}
          {tile('life.sold', formatNumber(x.sold, locale))}
          {tile('life.returnedIn', formatNumber(x.returnedByCustomers, locale))}
          {tile('life.returnedOut', formatNumber(x.returnedToSuppliers, locale))}
          {tile('life.soldValue', money(x.soldValue))}
          {seeCosts && tile('life.boughtValue', money(x.boughtValue))}
          {seeCosts &&
            tile(
              'life.profit',
              money(x.profit),
              (x.profit ?? 0) < 0 ? 'text-destructive' : 'text-positive',
            )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('life.whereNow')}</h3>
          {data.stock.length === 0 ? (
            <p className="text-sm text-muted">{t('common.empty')}</p>
          ) : (
            <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
              {data.stock.map((w) => (
                <li key={w.warehouseId} className="flex justify-between px-3 py-2 text-sm">
                  <span>
                    {w.name} <span className="text-muted">· {w.branchName}</span>
                  </span>
                  <span className="font-semibold tnum">{formatNumber(w.quantity, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  function Lines({
    id,
    rows,
    money,
    party,
    profit,
    withType,
  }: {
    id: string;
    rows: ItemLifeLine[];
    money: (v: number | null | undefined) => string;
    party: 'supplier' | 'customer' | 'any';
    profit?: boolean;
    withType?: boolean;
  }) {
    if (rows.length === 0)
      return <p className="p-4 text-center text-sm text-muted">{t('common.empty')}</p>;
    const th = 'px-2 py-2 font-medium';
    return (
      <TableColumns id={id}>
        <table className="w-full whitespace-nowrap text-[13px]">
          <thead className="sticky top-0 z-10 border-b border-line bg-surface-2 text-xs text-muted">
            <tr>
              <th className={`${th} text-start`}>{t('life.date')}</th>
              <th className={`${th} text-start`}>{t('life.number')}</th>
              {withType && <th className={`${th} text-start`}>{t('life.kind')}</th>}
              <th className={`${th} text-start`}>
                {t(
                  party === 'supplier'
                    ? 'finder.supplier'
                    : party === 'customer'
                      ? 'life.customer'
                      : 'life.party',
                )}
              </th>
              <th className={`${th} text-end`}>{t('col.qty')}</th>
              <th className={`${th} text-end`}>{t('col.price')}</th>
              <th className={`${th} text-end`}>{t('col.discount')}</th>
              <th className={`${th} text-end`}>{t('life.netPiece')}</th>
              {profit && seeCosts && <th className={`${th} text-end`}>{t('col.cost')}</th>}
              {profit && seeCosts && <th className={`${th} text-end`}>{t('life.profit')}</th>}
              <th className={`${th} text-start`}>{t('list.warehouse')}</th>
              <th className={`${th} text-start`}>{t('life.by')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {rows.map((r, i) => (
              <tr key={`${r.documentId}-${i}`} className="hover:bg-surface-2">
                <td className="px-2 py-1.5 tnum">{formatDateTime(r.date, locale)}</td>
                <td className="px-2 py-1.5 tnum">
                  {r.number}
                  {r.edited && (
                    <span className="ms-1 text-xs text-warning">({t('status.EDITED')})</span>
                  )}
                </td>
                {withType && (
                  <td className="px-2 py-1.5">
                    {t(r.type === 'SALES_RETURN' ? 'life.fromCustomer' : 'life.toSupplier')}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <CodeName code={r.partyCode} name={r.partyName ?? ''} />
                </td>
                <td className="px-2 py-1.5 text-end tnum">
                  {formatNumber(r.quantity, locale)}
                  {r.bonus && <span className="ms-1 text-xs text-positive">{t('life.bonus')}</span>}
                </td>
                <td className="px-2 py-1.5 text-end tnum">{money(r.unitPrice)}</td>
                <td className="px-2 py-1.5 text-end tnum text-warning">
                  {(r.discount ?? 0) > 0 ? `−${money(r.discount)}` : ''}
                </td>
                <td className="px-2 py-1.5 text-end font-semibold tnum">{money(r.net)}</td>
                {profit && seeCosts && (
                  <td className="px-2 py-1.5 text-end tnum">{money(r.unitCost)}</td>
                )}
                {profit && seeCosts && (
                  <td
                    className={`px-2 py-1.5 text-end tnum ${(r.profit ?? 0) < 0 ? 'text-destructive' : 'text-positive'}`}
                  >
                    {money(r.profit)}
                  </td>
                )}
                <td className="px-2 py-1.5 text-muted">{r.warehouseName}</td>
                <td className="px-2 py-1.5 text-muted">{r.staffName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableColumns>
    );
  }

  /** The net price of one piece on each invoice, oldest first, and how it moved from the one before. */
  function Prices({
    data,
    money,
  }: {
    data: ItemLife;
    money: (v: number | null | undefined) => string;
  }) {
    const series = (rows: ItemLifeLine[] | null | undefined) =>
      (rows ?? [])
        .filter((r) => !r.bonus && r.net != null)
        .slice()
        .reverse()
        .map((r, i, all) => ({
          r,
          net: r.net ?? 0,
          before: i > 0 ? (all[i - 1]!.net ?? 0) : null,
        }));
    const block = (title: TranslationKey, rows: ItemLifeLine[] | null | undefined) => {
      const list = series(rows);
      if (!rows) return null;
      return (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t(title)}</h3>
          {list.length === 0 ? (
            <p className="text-sm text-muted">{t('common.empty')}</p>
          ) : (
            <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line text-sm">
              {list
                .slice()
                .reverse()
                .map(({ r, net, before }, i) => {
                  const up = before != null && net > before;
                  const down = before != null && net < before;
                  return (
                    <li key={`${r.documentId}-${i}`} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-40 shrink-0 text-muted tnum">
                        {formatDateTime(r.date, locale)}
                      </span>
                      <span className="w-32 shrink-0 tnum">{r.number}</span>
                      <span className="min-w-0 flex-1">
                        <CodeName code={r.partyCode} name={r.partyName ?? ''} truncate />
                      </span>
                      <span className="font-semibold tnum">{money(r.net)}</span>
                      <span
                        className={`flex w-28 items-center justify-end gap-1 text-xs tnum ${up ? 'text-positive' : down ? 'text-destructive' : 'text-muted'}`}
                      >
                        {before == null ? (
                          t('life.first')
                        ) : up || down ? (
                          <>
                            <Icon name="chevronDown" size={14} className={up ? 'rotate-180' : ''} />
                            {money(Math.abs(net - before))}
                          </>
                        ) : (
                          t('life.same')
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      );
    };
    return (
      <div className="space-y-4">
        {block('life.salePrices', data.sales)}
        {seeCosts && block('life.buyPrices', data.purchases)}
      </div>
    );
  }
}
