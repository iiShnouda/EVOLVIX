import { confirm } from '../lib/confirm';
import { ItemLink } from '../components/ItemLink';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DocumentActivity } from '../components/DocumentActivity';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  type StockTransfer,
  type TransferStatus,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ApiError } from '../lib/api';
import { useAuth } from '../stores/auth';
import {
  useCompanySettings,
  useFinishTransfer,
  usePageSize,
  useTransfer,
  useTransfers,
} from '../lib/queries';
import { Pager } from '../components/Pager';
import { TableColumns } from '../components/TableColumns';
import { errorText } from '../lib/errors';
import { ReportActions } from '../components/ReportActions';
import { useReportTools } from '../lib/report';

type Tab = 'open' | 'all';

const STATUS_TONE: Record<TransferStatus, Tone> = {
  SENT: 'warning',
  RECEIVED: 'positive',
  CANCELLED: 'neutral',
};

/**
 * Transfer permits (التحويلات / إذن تحويل): goods on the way between warehouses and the history of
 * every transfer. The receiving side confirms receipt; the sending side may cancel while the goods
 * are still on the way. `?tab=all` shows every permit; `?doc=<id>` opens one.
 */
export function TransfersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // No goods "in transit" (owner decision 2026-10-01): every permit is listed; the list of permits
  // still on the way shows only while older ones wait to be received.
  // Its own key (the inventory page's tabs use `tab`).
  const tab: Tab = params.get('tt') === 'open' ? 'open' : 'all';
  const waiting = useTransfers({ page: 1, status: 'SENT' });
  const anyWaiting = (waiting.data?.total ?? 0) > 0;
  const canSend = useAuth((s) => s.user?.permissions ?? []).includes('inventory:transfer');
  const currency = useCompanySettings().data?.currency ?? 'EGP';

  const [size, setSize] = usePageSize('transfers', 50);
  const [page, setPage] = useState(1);
  const list = useTransfers({ page, pageSize: size, status: tab === 'open' ? 'SENT' : undefined });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / size));
  // A transfer opens on its own page (owner, 2026-10-19); old `?doc=` links still land there.
  const linkedId = params.get('doc');
  useEffect(() => {
    if (linkedId) navigate(`/inventory/transfers/${linkedId}`, { replace: true });
  }, [linkedId, navigate]);
  const rows = list.data?.items ?? [];

  function switchTab(next: Tab) {
    const q = new URLSearchParams(params);
    if (next === 'open') q.set('tt', 'open');
    else q.delete('tt');
    setParams(q, { replace: true });
  }

  return (
    <div className="space-y-5">
      {embedded ? (
        canSend && (
          <div className="flex justify-end">
            <Button size="sm" icon="plus" onClick={() => navigate('/inventory/transfers/new')}>
              {t('transfer.new')}
            </Button>
          </div>
        )
      ) : (
        <PageHeader
          title={t('transfer.title')}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon="close" onClick={() => navigate('/inventory')}>
                {t('itemCard.back')}
              </Button>
              {canSend && (
                <Button size="sm" icon="plus" onClick={() => navigate('/inventory/transfers/new')}>
                  {t('transfer.new')}
                </Button>
              )}
            </div>
          }
        />
      )}

      {anyWaiting && (
        <div
          role="tablist"
          className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {(['all', 'open'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => switchTab(k)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(k === 'open' ? 'transfer.tabOpen' : 'transfer.tabAll')}
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 flex justify-end">
          <Pager
            page={Math.min(page, pages)}
            size={size}
            pages={pages}
            onPage={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        </div>
        <Card padded={false} className="h-fit overflow-hidden">
          {list.isLoading ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner size={26} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('transfer.none')} icon="inventory" />
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {rows.map((tr) => (
                <li key={tr.id}>
                  <TransferRow
                    transfer={tr}
                    currency={currency}
                    onSelect={() => navigate(`/inventory/transfers/${tr.id}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * One transfer on its own page (owner, 2026-10-19): what moved, from where to where, with print,
 * "Edit transfer" for whoever may (inventory:transfer_edit), receive or call back, and its activity log.
 */
export function TransferPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('transfer.permit')}
        action={
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            onClick={() => navigate('/inventory/transfers')}
          >
            {t('transfer.back')}
          </Button>
        }
      />
      <Card padded={false} className="overflow-hidden">
        <TransferDetail id={id ?? null} currency={currency} />
      </Card>
      {id && (
        <Card>
          <DocumentActivity id={id} />
        </Card>
      )}
    </div>
  );
}

function TransferRow({
  transfer: tr,
  currency,
  onSelect,
}: {
  transfer: StockTransfer;
  currency: string;
  onSelect: () => void;
}) {
  const { t, locale } = useT();
  const seeCosts = useCan()('costs:view'); // goods move at cost: the owner's unless given
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 p-4 text-start transition-colors hover:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium tnum">{tr.number}</span>
          <Badge tone={STATUS_TONE[tr.status]}>{t(`transfer.status.${tr.status}`)}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-sm">
          {tr.fromWarehouseName} <span className="inline-block text-muted flip-rtl">→</span>{' '}
          {tr.toWarehouseName}
        </span>
        <span className="text-xs text-muted tnum">{formatDateTime(tr.createdAt, locale)}</span>
      </span>
      <span className="text-end tnum">
        <span className="block text-sm font-semibold">{formatNumber(tr.quantity, locale)}</span>
        {seeCosts && (
          <span className="text-xs text-muted">{formatMoney(tr.value, currency, locale)}</span>
        )}
      </span>
    </button>
  );
}

function TransferDetail({
  id,
  currency,
  onClose,
}: {
  id: string | null;
  currency: string;
  onClose?: () => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const seeCosts = can('costs:view');
  const detail = useTransfer(id);
  const finish = useFinishTransfer();
  const error = finish.error as ApiError | null;
  const tr = detail.data;
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);

  if (!id) return <EmptyState title={t('transfer.pick')} icon="inventory" />;
  if (detail.isLoading || !tr) {
    return (
      <div className="grid place-items-center py-16 text-muted">
        <Spinner size={24} />
      </div>
    );
  }

  async function act(action: 'receive' | 'cancel') {
    if (
      action === 'cancel' &&
      !(await confirm({ message: t('transfer.cancelConfirm'), danger: true }))
    )
      return;
    try {
      await finish.mutateAsync({ id: tr!.id, action });
    } catch {
      /* shown below */
    }
  }

  return (
    <div ref={paper}>
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted">{t('transfer.permit')}</p>
          <p className="text-lg font-semibold tnum">{tr.number}</p>
          <Badge tone={STATUS_TONE[tr.status]}>{t(`transfer.status.${tr.status}`)}</Badge>
        </div>
        <div data-noprint className="flex flex-wrap items-center justify-end gap-1">
          {tr.status !== 'CANCELLED' && can('inventory:transfer_edit') && (
            <Button
              size="sm"
              variant="secondary"
              icon="edit"
              onClick={() => navigate(`/inventory/transfers/${tr.id}/edit`)}
            >
              {t('transfer.edit')}
            </Button>
          )}
          <ReportActions
            scope="transfers"
            onPrint={() =>
              report.print(
                paper.current,
                `${t('transfer.permit')} ${tr.number}`,
                formatDateTime(tr.createdAt, locale),
              )
            }
          />
          {onClose && (
            <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-b border-line p-4 text-sm">
        <div>
          <dt className="text-xs text-muted">{t('transfer.from')}</dt>
          <dd className="font-medium">{tr.fromWarehouseName}</dd>
          <dd className="text-xs text-muted">{tr.fromBranchName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('transfer.to')}</dt>
          <dd className="font-medium">{tr.toWarehouseName}</dd>
          <dd className="text-xs text-muted">{tr.toBranchName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('transfer.sentBy')}</dt>
          <dd>{tr.createdByName}</dd>
          <dd className="text-xs text-muted tnum">{formatDateTime(tr.createdAt, locale)}</dd>
        </div>
        {tr.receivedAt && (
          <div>
            <dt className="text-xs text-muted">{t('transfer.receivedBy')}</dt>
            <dd>{tr.receivedByName}</dd>
            <dd className="text-xs text-muted tnum">{formatDateTime(tr.receivedAt, locale)}</dd>
          </div>
        )}
        {tr.cancelledAt && (
          <div>
            <dt className="text-xs text-muted">{t('transfer.cancelledBy')}</dt>
            <dd>{tr.cancelledByName}</dd>
            <dd className="text-xs text-muted tnum">{formatDateTime(tr.cancelledAt, locale)}</dd>
          </div>
        )}
        {tr.notes && <p className="col-span-2 text-sm text-muted">{tr.notes}</p>}
      </dl>

      <TableColumns id="transfers.lines">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-3 text-start font-medium">{t('inventory.products')}</th>
              <th className="p-3 text-end font-medium">{t('inventory.qty')}</th>
              {seeCosts && <th className="p-3 text-end font-medium">{t('inventory.value')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--c-line)]">
            {tr.lines.map((l) => (
              <tr key={l.id}>
                <td className="p-3">
                  <ItemLink id={l.productId} name={l.productName} />
                </td>
                <td className="p-3 text-end tnum">{formatNumber(l.quantity, locale)}</td>
                {seeCosts && (
                  <td className="p-3 text-end tnum">{formatMoney(l.value, currency, locale)}</td>
                )}
              </tr>
            ))}
            <tr className="bg-surface-2 font-semibold">
              <td className="p-3">{t('common.total')}</td>
              <td className="p-3 text-end tnum">{formatNumber(tr.quantity, locale)}</td>
              {seeCosts && (
                <td className="p-3 text-end tnum">{formatMoney(tr.value, currency, locale)}</td>
              )}
            </tr>
          </tbody>
        </table>
      </TableColumns>

      {(tr.canReceive || tr.canCancel) && (
        <div data-noprint className="flex flex-wrap gap-2 border-t border-line p-4">
          {tr.canReceive && (
            <Button icon="check" loading={finish.isPending} onClick={() => act('receive')}>
              {t('transfer.receive')}
            </Button>
          )}
          {tr.canCancel && (
            <Button variant="secondary" loading={finish.isPending} onClick={() => act('cancel')}>
              {t('transfer.cancel')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="mx-4 mb-4 rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
          {errorText(t, error)}
        </p>
      )}
    </div>
  );
}
