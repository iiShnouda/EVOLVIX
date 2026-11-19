import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  type Party,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import {
  Filter,
  FilterPanel,
  filterField,
  useKeptFilters,
  useSettled,
} from '../components/FilterPanel';
import { TableColumns } from '../components/TableColumns';
import { ReportActions } from '../components/ReportActions';
import { PartyPicker } from '../components/PartyPicker';
import { Pager } from '../components/Pager';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { confirm } from '../lib/confirm';
import { useReportTools } from '../lib/report';
import { useDeviceInfo } from '../lib/device';
import { useAuth } from '../stores/auth';
import { useWorkBranch, useWorkBranchStore } from '../stores/workBranch';
import { queryClient } from '../lib/queryClient';
import { usePurchaseOrder, usePurchaseOrders, usePurchaseOrderStep } from '../lib/purchaseOrders';

export const PO_TONE: Record<PurchaseOrderStatus, Tone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PARTLY_RECEIVED: 'warning',
  RECEIVED: 'positive',
  CANCELLED: 'neutral',
};
const STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'SENT',
  'PARTLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
];

const FILTERS = { search: '', status: '', partyId: '', partyName: '', from: '', to: '', item: '' };

/**
 * Purchase orders to factories (owner, 2026-11-18): by supplier, status and period with the detailed
 * search, every order in columns (the person picks which), and the list printed or saved as Excel.
 */
export function PurchaseOrdersPage() {
  const { t, locale } = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { deviceClass } = useDeviceInfo();
  const [f, keep, clear] = useKeptFilters('skb.list.purchaseOrders', FILTERS);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const search = useSettled(f.search.trim());
  const item = useSettled(f.item.trim());
  const list = usePurchaseOrders({
    page,
    pageSize: size,
    search,
    item,
    status: f.status === 'OPEN' ? '' : f.status,
    open: f.status === 'OPEN',
    partyId: f.partyId,
    from: f.from,
    to: f.to,
  });
  const data = list.data;
  const money = (v: number) => formatMoney(v, data?.currency ?? 'EGP', locale);
  const n = (v: number) => formatNumber(v, locale);
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const detailed = [f.status, f.partyId, f.from || f.to, f.item].filter(Boolean).length;
  const title = t('po.title');
  const subtitle = [
    f.partyName,
    f.status
      ? f.status === 'OPEN'
        ? t('po.open')
        : t(`po.status.${f.status as PurchaseOrderStatus}`)
      : '',
    f.from || f.to ? `${f.from} – ${f.to}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const header = [
    t('po.number'),
    t('po.date'),
    t('po.expected'),
    t('po.supplier'),
    t('po.deliverTo'),
    t('po.lines'),
    t('po.newItems'),
    t('po.pieces'),
    t('po.received'),
    t('po.total'),
    t('po.status'),
    t('po.createdBy'),
    t('po.notes'),
  ];
  const cells = (o: PurchaseOrderSummary) => [
    o.number,
    o.orderDate,
    o.expectedDate ?? '',
    o.partyName,
    o.warehouseName,
    o.lines,
    o.newItems,
    o.pieces,
    o.receivedPieces,
    { money: o.total },
    t(`po.status.${o.status}`),
    o.createdByName,
    o.notes ?? '',
  ];
  const day = (d: string | null) => (d ? formatDate(d, locale) : '');

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        action={
          can('purchase_orders:create') && (
            <Button icon="plus" onClick={() => navigate('/purchase-orders/new')}>
              {t('po.new')}
            </Button>
          )
        }
      />
      <FilterPanel
        id="purchaseOrders"
        active={detailed}
        onClear={() => {
          clear();
          setPage(1);
        }}
        quick={
          <label className="block w-56 max-w-full">
            <span className="mb-0.5 block text-xs text-muted">{t('po.search')}</span>
            <input
              type="search"
              className={filterField}
              value={f.search}
              onChange={(e) => {
                keep({ search: e.target.value });
                setPage(1);
              }}
            />
          </label>
        }
        actions={
          <ReportActions
            scope="purchase_orders"
            title={title}
            disabled={!data?.items.length}
            onPrint={() => report.print(paper.current, title, subtitle)}
            onExcel={() =>
              data &&
              report.excel(title, subtitle, header, data.items.map(cells), [
                t('po.total'),
                '',
                '',
                '',
                '',
                '',
                '',
                data.pieces,
                '',
                { money: data.amount },
              ])
            }
          />
        }
      >
        <Filter label={t('po.status')}>
          <select
            className={filterField}
            value={f.status}
            onChange={(e) => {
              keep({ status: e.target.value });
              setPage(1);
            }}
          >
            <option value="">{t('po.all')}</option>
            <option value="OPEN">{t('po.open')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`po.status.${s}`)}
              </option>
            ))}
          </select>
        </Filter>
        <div className="min-w-0 sm:col-span-2">
          <PartyPicker
            type="SUPPLIER"
            value={f.partyId ? ({ id: f.partyId, name: f.partyName } as Party) : null}
            onChange={(p) => {
              keep({ partyId: p?.id ?? '', partyName: p?.name ?? '' });
              setPage(1);
            }}
            label={t('po.supplier')}
            placeholder={t('po.all')}
          />
        </div>
        <Filter label={t('money.from')}>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={f.from}
            max={f.to || undefined}
            onChange={(e) => keep({ from: e.target.value })}
          />
        </Filter>
        <Filter label={t('money.to')}>
          <input
            type="date"
            className={`${filterField} tnum`}
            value={f.to}
            min={f.from || undefined}
            onChange={(e) => keep({ to: e.target.value })}
          />
        </Filter>
        <Filter label={t('po.itemSearch')}>
          <input
            type="search"
            className={filterField}
            value={f.item}
            onChange={(e) => keep({ item: e.target.value })}
          />
        </Filter>
      </FilterPanel>

      {list.isLoading ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : !data?.items.length ? (
        <Card>
          <EmptyState title={t('po.none')} icon="purchases" />
        </Card>
      ) : (
        <div ref={paper}>
          {deviceClass === 'desktop' ? (
            <Card padded={false} className="overflow-hidden">
              <TableColumns id="purchaseOrders" className="pt-2">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="bg-surface-2 text-xs text-muted">
                      <tr>
                        {header.map((h, i) => (
                          <th
                            key={h}
                            className={`p-2 font-medium ${[5, 6, 7, 8, 9].includes(i) ? 'text-end' : 'text-start'}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--c-line)]">
                      {data.items.map((o) => (
                        <tr key={o.id} className="hover:bg-surface-2/60">
                          <td className="whitespace-nowrap p-2 tnum">
                            <Link
                              className="font-medium text-brand hover:underline"
                              to={`/purchase-orders/${o.id}`}
                            >
                              <bdi>{o.number}</bdi>
                            </Link>
                          </td>
                          <td className="whitespace-nowrap p-2 tnum">{day(o.orderDate)}</td>
                          <td className="whitespace-nowrap p-2 tnum">{day(o.expectedDate)}</td>
                          <td className="p-2">
                            <bdi>{o.partyName}</bdi>
                          </td>
                          <td className="p-2 text-muted">
                            <bdi>{o.warehouseName}</bdi>
                          </td>
                          <td className="p-2 text-end tnum">{n(o.lines)}</td>
                          <td className="p-2 text-end tnum">{o.newItems ? n(o.newItems) : ''}</td>
                          <td className="p-2 text-end tnum">{n(o.pieces)}</td>
                          <td className="p-2 text-end tnum">
                            {o.receivedPieces ? n(o.receivedPieces) : ''}
                          </td>
                          <td className="whitespace-nowrap p-2 text-end font-semibold tnum">
                            {money(o.total)}
                          </td>
                          <td className="p-2">
                            <Badge tone={PO_TONE[o.status]}>{t(`po.status.${o.status}`)}</Badge>
                          </td>
                          <td className="p-2">{o.createdByName}</td>
                          <td className="p-2 text-muted">
                            <bdi>{o.notes ?? ''}</bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-2 font-semibold">
                      <tr>
                        <td className="p-2">{t('po.total')}</td>
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                          <td key={i} className="p-2" />
                        ))}
                        <td className="p-2 text-end tnum">{n(data.pieces)}</td>
                        <td className="p-2" />
                        <td className="whitespace-nowrap p-2 text-end tnum">
                          {money(data.amount)}
                        </td>
                        <td className="p-2" />
                        <td className="p-2" />
                        <td className="p-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </TableColumns>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.items.map((o) => (
                <Link key={o.id} to={`/purchase-orders/${o.id}`} className="block">
                  <Card className="h-full transition-colors hover:border-brand/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          <bdi>{o.partyName}</bdi>
                        </p>
                        <p className="text-xs text-muted tnum">
                          <bdi>{o.number}</bdi> · {day(o.orderDate)}
                        </p>
                      </div>
                      <Badge tone={PO_TONE[o.status]}>{t(`po.status.${o.status}`)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted">
                      {t('po.lines')}: <span className="tnum">{n(o.lines)}</span> · {t('po.pieces')}
                      : <span className="tnum">{n(o.pieces)}</span>
                      {o.receivedPieces > 0 && (
                        <>
                          {' '}
                          · {t('po.received')}: <span className="tnum">{n(o.receivedPieces)}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 font-semibold tnum">{money(o.total)}</p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex justify-end">
          <Pager
            page={page}
            size={size}
            pages={Math.max(1, Math.ceil(data.total / size))}
            onPage={setPage}
            onSize={(s) => {
              setSize(s);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One purchase order: what was ordered (and of it what came in), its paper for the factory — the
 * company's letterhead, the supplier, the dates and the items with the order's own prices, nothing of
 * our costs — and what can be done with it now: change, mark sent, receive on a purchase invoice,
 * cancel.
 */
export function PurchaseOrderPage() {
  const { id } = useParams();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const order = usePurchaseOrder(id);
  const step = usePurchaseOrderStep();
  const report = useReportTools();
  const paper = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);
  const workBranch = useWorkBranch();
  const pickBranch = useWorkBranchStore((s) => s.pick);
  const [note, setNote] = useState<string | null>(null);

  if (order.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  const o = order.data;
  if (!o)
    return (
      <Card>
        <EmptyState title={errorText(t, order.error) ?? t('po.none')} icon="purchases" />
      </Card>
    );

  const money = (v: number) => formatMoney(v, o.currency, locale);
  const n = (v: number) => formatNumber(v, locale);
  const day = (d: string | null) => (d ? formatDate(d, locale) : '');
  const title = `${t('po.paperTitle')} ${o.number}`;

  const receive = () => {
    // The invoice goes to the working branch: the order's own (switched to when the person has it).
    if (workBranch !== o.branchId) {
      if (!user?.branches?.some((b) => b.id === o.branchId)) {
        setNote(t('po.otherBranch').replace('{b}', o.branchName));
        return;
      }
      pickBranch(user.id, o.branchId);
      void queryClient.invalidateQueries();
    }
    navigate(`/purchases/new?order=${o.id}`);
  };
  const cancel = async () => {
    if (!(await confirm({ message: t('po.cancelConfirm'), danger: true }))) return;
    step.mutate({ id: o.id, step: 'cancel' });
  };
  const excel = () =>
    report.excel(
      title,
      o.partyName,
      [
        '#',
        t('po.item'),
        t('po.model'),
        t('po.size'),
        t('po.color'),
        t('po.unit'),
        t('po.quantity'),
        t('po.price'),
        t('po.total'),
      ],
      o.lines.map((l) => [
        l.lineNo,
        l.name,
        l.supplierCode ?? '',
        l.sizeName ?? '',
        l.colorName ?? '',
        l.unitName ?? '',
        l.quantity,
        l.unitPrice ? { money: l.unitPrice } : '',
        l.lineTotal ? { money: l.lineTotal } : '',
      ]),
      [
        '',
        t('po.total'),
        '',
        '',
        '',
        '',
        o.lines.reduce((s, l) => s + l.quantity, 0),
        '',
        { money: o.total },
      ],
    );
  const cell = 'p-2 align-top';

  return (
    <div className="space-y-4">
      <PageHeader
        title={o.number}
        subtitle={o.partyName}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PO_TONE[o.status]}>{t(`po.status.${o.status}`)}</Badge>
            <ReportActions
              scope="purchase_orders"
              title={title}
              onPrint={() => report.print(paper.current, t('po.paperTitle'), o.number)}
              onExcel={excel}
            />
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        {o.canEdit && (
          <Button
            size="sm"
            variant="secondary"
            icon="edit"
            onClick={() => navigate(`/purchase-orders/${o.id}/edit`)}
          >
            {t('po.edit')}
          </Button>
        )}
        {o.status === 'DRAFT' && can('purchase_orders:edit') && (
          <Button
            size="sm"
            variant="secondary"
            icon="send"
            loading={step.isPending}
            onClick={() => step.mutate({ id: o.id, step: 'send' })}
          >
            {t('po.markSent')}
          </Button>
        )}
        {o.canReceive && (
          <Button size="sm" icon="purchases" onClick={receive}>
            {t('po.receive')}
          </Button>
        )}
        {o.canCancel && (
          <Button size="sm" variant="ghost" onClick={() => void cancel()}>
            {t('po.cancel')}
          </Button>
        )}
      </div>
      {(note || step.error) && (
        <p className="text-sm text-destructive">{note ?? errorText(t, step.error)}</p>
      )}

      <Card>
        <div ref={paper} className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label={t('po.supplier')}>
              <bdi>{o.partyName}</bdi>
              {o.partyCode ? (
                <span className="ms-1 text-xs text-faint tnum">{o.partyCode}</span>
              ) : null}
              {o.partyPhone && (
                <span className="block text-xs text-muted" dir="ltr">
                  {o.partyPhone}
                </span>
              )}
            </Info>
            <Info label={t('po.number')}>
              <bdi className="tnum">{o.number}</bdi>
            </Info>
            <Info label={t('po.date')}>
              <span className="tnum">{day(o.orderDate)}</span>
            </Info>
            <Info label={t('po.expected')}>
              <span className="tnum">{day(o.expectedDate)}</span>
            </Info>
            <Info label={t('po.deliverTo')}>
              <bdi>{o.warehouseName}</bdi> · <bdi>{o.branchName}</bdi>
            </Info>
            {o.departmentName && (
              <Info label={t('po.department')}>
                <bdi>{o.departmentName}</bdi>
              </Info>
            )}
            {o.notes && (
              <Info label={t('po.notes')} wide>
                <bdi>{o.notes}</bdi>
              </Info>
            )}
          </dl>
          {/* On a phone each line is a card; the table stays for the paper. */}
          <ul className="divide-y divide-[var(--c-line)] md:hidden" data-noprint>
            {o.lines.map((l) => (
              <li key={l.id} className="py-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <bdi className="font-medium">{l.name}</bdi>
                    {l.isNew && (
                      <span className="ms-1.5">
                        <Badge tone="info">{t('po.newBadge')}</Badge>
                      </span>
                    )}
                    <p className="text-xs text-muted">
                      {[
                        l.sku,
                        l.supplierCode && `${t('po.model')} ${l.supplierCode}`,
                        l.sizeName,
                        l.colorName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tnum">
                    {l.lineTotal ? money(l.lineTotal) : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted tnum">
                  {n(l.quantity)} {l.unitName ?? ''}
                  {l.unitPrice ? ` × ${money(l.unitPrice)}` : ''} · {t('po.received')}:{' '}
                  {n(l.receivedPieces)} / {n(l.pieces)}
                </p>
              </li>
            ))}
            <li className="flex justify-between py-2.5 font-semibold">
              <span>{t('po.total')}</span>
              <span className="tnum">{money(o.total)}</span>
            </li>
          </ul>
          <div className="hidden md:block print:block">
            <TableColumns id="purchaseOrder.lines">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className={`${cell} text-start font-medium`}>#</th>
                      <th className={`${cell} text-start font-medium`}>{t('po.item')}</th>
                      <th className={`${cell} text-start font-medium`}>{t('po.model')}</th>
                      <th className={`${cell} text-start font-medium`}>{t('po.size')}</th>
                      <th className={`${cell} text-start font-medium`}>{t('po.color')}</th>
                      <th className={`${cell} text-start font-medium`}>{t('po.unit')}</th>
                      <th className={`${cell} text-end font-medium`}>{t('po.quantity')}</th>
                      <th className={`${cell} text-end font-medium`}>{t('po.price')}</th>
                      <th className={`${cell} text-end font-medium`}>{t('po.total')}</th>
                      <th className={`${cell} text-end font-medium`} data-noprint>
                        {t('po.received')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-line)]">
                    {o.lines.map((l) => (
                      <tr key={l.id}>
                        <td className={`${cell} tnum text-muted`}>{l.lineNo}</td>
                        <td className={cell}>
                          <bdi className="font-medium">{l.name}</bdi>
                          {l.isNew && (
                            <span className="ms-1.5" data-noprint>
                              <Badge tone="info">{t('po.newBadge')}</Badge>
                            </span>
                          )}
                          {(l.sku || l.groupName) && (
                            <span className="block text-xs text-muted">
                              {[l.sku, l.departmentName, l.groupName].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className={`${cell} tnum`}>
                          <bdi>{l.supplierCode ?? ''}</bdi>
                        </td>
                        <td className={cell}>{l.sizeName ?? ''}</td>
                        <td className={cell}>{l.colorName ?? ''}</td>
                        <td className={cell}>{l.unitName ?? ''}</td>
                        <td className={`${cell} text-end tnum`}>{n(l.quantity)}</td>
                        <td className={`${cell} text-end tnum`}>
                          {l.unitPrice ? money(l.unitPrice) : ''}
                        </td>
                        <td className={`${cell} text-end font-semibold tnum`}>
                          {l.lineTotal ? money(l.lineTotal) : ''}
                        </td>
                        <td
                          className={`${cell} text-end tnum ${l.receivedPieces >= l.pieces ? 'text-positive' : l.receivedPieces > 0 ? 'text-warning' : 'text-faint'}`}
                          data-noprint
                        >
                          {n(l.receivedPieces)} / {n(l.pieces)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-2 font-semibold">
                    <tr>
                      <td className={cell} />
                      <td className={cell}>{t('po.total')}</td>
                      <td className={cell} />
                      <td className={cell} />
                      <td className={cell} />
                      <td className={cell} />
                      <td className={`${cell} text-end tnum`}>
                        {n(o.lines.reduce((s, l) => s + l.quantity, 0))}
                      </td>
                      <td className={cell} />
                      <td className={`${cell} text-end tnum`}>{money(o.total)}</td>
                      <td className={`${cell} text-end tnum`} data-noprint>
                        {n(o.receivedPieces)} / {n(o.pieces)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </TableColumns>
          </div>
        </div>
      </Card>

      {o.receipts.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">{t('po.receipts')}</h2>
          <ul className="space-y-1 text-sm">
            {o.receipts.map((r) => (
              <li key={r.documentId} className="flex flex-wrap gap-x-3">
                <bdi className="font-medium tnum">{r.number}</bdi>
                <span className="text-muted tnum">{day(r.date)}</span>
                <span className="text-muted">
                  {t('po.pieces')}: <span className="tnum">{n(r.pieces)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted">
        {t('po.createdBy')}: {o.createdByName} · {formatDateTime(o.createdAt, locale)}
        {o.cancelledAt && (
          <>
            {' '}
            · {t('po.status.CANCELLED')}: {o.cancelledByName} ·{' '}
            {formatDateTime(o.cancelledAt, locale)}
          </>
        )}
      </p>
    </div>
  );
}

function Info({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
