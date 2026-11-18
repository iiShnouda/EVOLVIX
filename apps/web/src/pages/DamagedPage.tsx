import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatNumber, type DamagedRow } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { ItemLink } from '../components/ItemLink';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';
import { useAuth } from '../stores/auth';
import { useCompanySettings, useWarehouses } from '../lib/queries';
import { useDamaged, useDamagedMove } from '../lib/returnsQueries';

const field =
  'h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/**
 * Damaged goods (owner, 2026-11-18): what customers brought back damaged, held in each branch's
 * damaged warehouse, by supplier for the claims. Each can go back to a store once repaired, be
 * written off, or go back to its supplier on a purchase return from the damaged warehouse.
 */
export function DamagedPage() {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const [branch, setBranch] = useState('');
  const [supplier, setSupplier] = useState('');
  const list = useDamaged(branch, supplier);
  const rows = list.data ?? [];
  const suppliers = [
    ...new Map(
      rows.map((r) => [r.supplierId ?? 'none', r.supplierName ?? t('damaged.noSupplier')] as const),
    ),
  ];
  // By supplier, then by warehouse: one purchase return per supplier and branch.
  const groups = [
    ...rows
      .reduce((m, r) => {
        const key = `${r.supplierId ?? ''}|${r.warehouseId}`;
        m.set(key, [...(m.get(key) ?? []), r]);
        return m;
      }, new Map<string, DamagedRow[]>())
      .values(),
  ];
  const seesCost = rows.some((r) => r.unitCost != null);

  return (
    <div className="space-y-4">
      <PageHeader title={t('damaged.title')} />
      <Card className="flex flex-wrap items-end gap-3">
        {(me?.branches?.length ?? 0) > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('list.branch')}</span>
            <select className={field} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {me?.branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('invoice.supplier')}</span>
          <select className={field} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{t('damaged.allSuppliers')}</option>
            {suppliers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {list.isFetching && <Spinner size={16} />}
      </Card>

      {list.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('damaged.empty')} icon="inventory" />
      ) : (
        groups.map((g) => {
          const first = g[0]!;
          return (
            <Card key={`${first.supplierId}|${first.warehouseId}`} padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {first.supplierName ?? t('damaged.noSupplier')}
                  </p>
                  <p className="text-xs text-muted">{first.warehouseName}</p>
                </div>
                {first.supplierId && can('purchases:return') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="purchases"
                    onClick={() =>
                      navigate(
                        `/purchases/returns/new?party=${first.supplierId}&branch=${first.branchId}&warehouse=${first.warehouseId}`,
                      )
                    }
                  >
                    {t('damaged.toSupplier')}
                  </Button>
                )}
              </div>
              <ul className="divide-y divide-[var(--c-line)]">
                {g.map((r) => (
                  <DamagedLine
                    key={r.productId}
                    row={r}
                    seesCost={seesCost}
                    money={(v) => formatMoney(v, currency, locale)}
                    number={(v) => formatNumber(v, locale)}
                  />
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}

function DamagedLine({
  row,
  seesCost,
  money,
  number,
}: {
  row: DamagedRow;
  seesCost: boolean;
  money: (v: number) => string;
  number: (v: number) => string;
}) {
  const { t } = useT();
  const can = useCan();
  const stores = (useWarehouses(true).data ?? []).filter(
    (w) => w.kind === 'STORE' && w.branchId === row.branchId,
  );
  const [qty, setQty] = useState(String(row.quantity));
  const [store, setStore] = useState('');
  const repair = useDamagedMove('repair');
  const writeOff = useDamagedMove('write-off');
  const quantity = Math.max(0, Math.floor(Number(qty) || 0));
  const valid = quantity > 0 && quantity <= row.quantity;
  const lines = [{ productId: row.productId, quantity }];
  const toStore = store || stores.find((w) => w.isDefault)?.id || stores[0]?.id || '';
  const error = repair.error ?? writeOff.error;
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1 basis-48">
        <ItemLink id={row.productId} name={row.name} code={row.sku} truncate />
        {seesCost && row.value != null && (
          <span className="block text-xs text-muted tnum">{money(row.value)}</span>
        )}
      </span>
      <Badge tone="warning">{number(row.quantity)}</Badge>
      {(can('damaged:repair') || can('returns:write_off')) && (
        <input
          type="number"
          min={1}
          max={row.quantity}
          aria-label={t('damaged.qty')}
          className={`${field} w-20 tnum`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      )}
      {can('damaged:repair') && (
        <>
          <select
            className={`${field} w-36`}
            aria-label={t('damaged.toStore')}
            value={toStore}
            onChange={(e) => setStore(e.target.value)}
          >
            {stores.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            loading={repair.isPending}
            disabled={!valid || !toStore}
            onClick={() =>
              repair.mutate({ warehouseId: row.warehouseId, toWarehouseId: toStore, lines })
            }
          >
            {t('damaged.repair')}
          </Button>
        </>
      )}
      {can('returns:write_off') && (
        <Button
          size="sm"
          variant="danger"
          loading={writeOff.isPending}
          disabled={!valid}
          onClick={async () => {
            if (
              await confirm({
                message: `${t('damaged.writeOff')}: ${row.name} × ${number(quantity)}`,
                danger: true,
                confirmText: t('damaged.writeOff'),
              })
            )
              writeOff.mutate({ warehouseId: row.warehouseId, lines });
          }}
        >
          {t('damaged.writeOff')}
        </Button>
      )}
      {error != null && <p className="w-full text-xs text-destructive">{errorText(t, error)}</p>}
    </li>
  );
}
