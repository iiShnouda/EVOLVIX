import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  toMinor,
  type CashHandover,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { TableColumns } from '../components/TableColumns';
import { useDeviceInfo } from '../lib/device';
import { useCashHandovers, useHandoverBoxes, useHandoverStep, useSendCash } from '../lib/queries';

const input =
  'h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand';

type Side = '' | 'in' | 'out';
const SIDES: { key: Side; label: TranslationKey }[] = [
  { key: 'in', label: 'hand.incoming' },
  { key: 'out', label: 'hand.outgoing' },
  { key: '', label: 'hand.all' },
];
const STATUS_TONE: Record<CashHandover['status'], Tone> = {
  SENT: 'warning',
  RECEIVED: 'positive',
  CANCELLED: 'neutral',
};

/**
 * Cash handovers (owner, 2026-10-02): a warehouse's box hands its cash to the branch's box, a
 * branch's box to the company's main box. The sender sends it; it stays held in the box until
 * whoever holds the next box confirms it arrived, then it moves. Either side may call it off.
 */
export function HandoversPage() {
  const { t } = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const side = (params.get('side') ?? (can('cash:handover_receive') ? 'in' : 'out')) as Side;
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useCashHandovers(side, status, { from, to });
  const { deviceClass } = useDeviceInfo();

  return (
    <div className="space-y-5">
      <PageHeader title={t('hand.title')} />
      {can('cash:handover_send') && <SendCard initialFrom={params.get('from') ?? ''} />}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          className="flex flex-wrap gap-1 rounded-[var(--radius-app)] border border-line bg-surface p-1"
        >
          {SIDES.map((x) => (
            <button
              key={x.key || 'all'}
              role="tab"
              aria-selected={side === x.key}
              onClick={() => setParams({ side: x.key }, { replace: true })}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors ${
                side === x.key ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
              }`}
            >
              {t(x.label)}
            </button>
          ))}
        </div>
        <label className="block shrink-0">
          <span className="mb-0.5 block text-xs text-muted">{t('common.status')}</span>
          <select
            className="h-9 rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
            value={status}
            aria-label={t('common.status')}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('hand.all')}</option>
            {(['SENT', 'RECEIVED', 'CANCELLED'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`hand.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block shrink-0">
          <span className="mb-0.5 block text-xs text-muted">{t('money.from')}</span>
          <input
            type="date"
            className="h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block shrink-0">
          <span className="mb-0.5 block text-xs text-muted">{t('money.to')}</span>
          <input
            type="date"
            className="h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {list.isLoading ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <Card>
          <EmptyState title={t('hand.none')} icon="receipts" />
        </Card>
      ) : deviceClass === 'desktop' ? (
        <HandoverTable rows={list.data} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((h) => (
            <HandoverCard key={h.id} h={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function SendCard({ initialFrom }: { initialFrom: string }) {
  const { t, locale } = useT();
  const boxes = useHandoverBoxes();
  const send = useSendCash();
  const [fromId, setFromId] = useState(initialFrom);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const list = boxes.data ?? [];
  const box = list.find((b) => b.id === fromId) ?? list[0];
  const available = box ? (box.balance ?? 0) - (box.held ?? 0) : 0;
  const minor = toMinor(Number(amount) || 0);
  const money = (v: number) => (box ? formatMoney(v, box.currency, locale) : '');

  if (boxes.isLoading) return null;
  if (!list.length)
    return (
      <Card>
        <p className="text-sm text-muted">{t('hand.noBoxes')}</p>
      </Card>
    );

  async function submit() {
    if (!box) return;
    setDone(false);
    try {
      await send.mutateAsync({
        fromAccountId: box.id,
        amount: minor,
        notes: notes.trim() || undefined,
      });
      setAmount('');
      setNotes('');
      setDone(true);
    } catch {
      /* shown below */
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">{t('hand.send')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('hand.from')}</span>
          <select
            className={input}
            value={box?.id ?? ''}
            onChange={(e) => {
              setFromId(e.target.value);
              setDone(false);
            }}
          >
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.branchName}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-xs text-muted">{t('hand.to')}</span>
          <p className="flex h-10 items-center truncate rounded-[var(--radius-app)] bg-surface-2 px-3 text-sm">
            {box?.upToName}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">
            {t('common.amount')} · {t('hand.available')}:{' '}
            <span className="tnum">{money(available)}</span>
          </span>
          <input
            className={`${input} tnum`}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            aria-invalid={minor > available}
            onChange={(e) => {
              setAmount(e.target.value);
              setDone(false);
            }}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t('invoice.notes')}</span>
          <input
            className={input}
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {!!box?.held && (
        <p className="mt-2 text-xs text-muted">
          {t('money.held')}: <span className="tnum">{money(box.held)}</span>
        </p>
      )}
      {send.error && <p className="mt-2 text-sm text-destructive">{errorText(t, send.error)}</p>}
      {done && <p className="mt-2 text-sm text-positive">{t('hand.sent')}</p>}
      <div className="mt-3 flex justify-end">
        <Button
          icon="check"
          loading={send.isPending}
          disabled={!box || minor <= 0 || minor > available}
          onClick={() => void submit()}
        >
          {t('hand.send')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Every handover in columns (owner, 2026-11-10: "everything in columns, they show the detail
 * better"): number, from which box and branch, to which, the amount, its state, who sent it and
 * when, who received or called it off and when, why, the notes and the transfer voucher.
 */
function HandoverTable({ rows }: { rows: CashHandover[] }) {
  const { t, locale } = useT();
  const [cancelling, setCancelling] = useState<CashHandover | null>(null);
  const step = useHandoverStep();
  const when = (iso: string | null | undefined) =>
    iso ? `${formatDate(iso, locale)} ${formatTime(iso, locale)}` : '';
  const total = rows.reduce((sum, h) => sum + (h.status === 'CANCELLED' ? 0 : h.amount), 0);
  const cell = 'p-2 align-top';
  return (
    <Card padded={false} className="overflow-hidden">
      {step.error && <p className="p-3 text-sm text-destructive">{errorText(t, step.error)}</p>}
      <TableColumns id="handovers" className="pt-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className={`${cell} text-start font-medium`}>{t('hand.number')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.from')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.fromBranch')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.to')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.toBranch')}</th>
                <th className={`${cell} text-end font-medium`}>{t('common.amount')}</th>
                <th className={`${cell} text-start font-medium`}>{t('common.status')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.sentBy')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.sentAt')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.doneBy')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.doneAt')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.reason')}</th>
                <th className={`${cell} text-start font-medium`}>{t('invoice.notes')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.voucher')}</th>
                <th className={`${cell} text-start font-medium`}>{t('hand.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {rows.map((h) => (
                <tr key={h.id} className="hover:bg-surface-2/60">
                  <td className={`${cell} whitespace-nowrap tnum`}>
                    <bdi>{h.number}</bdi>
                  </td>
                  <td className={cell}>{h.fromAccountName}</td>
                  <td className={`${cell} text-muted`}>{h.fromBranchName}</td>
                  <td className={cell}>{h.toAccountName}</td>
                  <td className={`${cell} text-muted`}>{h.toBranchName}</td>
                  <td
                    className={`${cell} whitespace-nowrap text-end font-semibold tnum ${h.status === 'CANCELLED' ? 'text-faint line-through' : ''}`}
                  >
                    {formatMoney(h.amount, h.currency, locale)}
                  </td>
                  <td className={cell}>
                    <Badge tone={STATUS_TONE[h.status]}>{t(`hand.status.${h.status}`)}</Badge>
                  </td>
                  <td className={cell}>{h.sentByName}</td>
                  <td className={`${cell} whitespace-nowrap tnum`}>{when(h.sentAt)}</td>
                  <td className={cell}>{h.doneByName ?? ''}</td>
                  <td className={`${cell} whitespace-nowrap tnum`}>{when(h.doneAt)}</td>
                  <td className={`${cell} text-muted`}>
                    <bdi>{h.reason ?? ''}</bdi>
                  </td>
                  <td className={`${cell} text-muted`}>
                    <bdi>{h.notes ?? ''}</bdi>
                  </td>
                  <td className={`${cell} whitespace-nowrap tnum`}>
                    <bdi>{h.voucherNumber ?? ''}</bdi>
                  </td>
                  <td className={`${cell} whitespace-nowrap`} data-noprint>
                    <div className="flex gap-1">
                      {h.canReceive && (
                        <Button
                          size="sm"
                          icon="check"
                          loading={step.isPending}
                          onClick={() => step.mutate({ id: h.id, step: 'receive' })}
                        >
                          {t('hand.receive')}
                        </Button>
                      )}
                      {h.canCancel && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(h)}>
                          {t('hand.cancel')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-2 font-semibold">
              <tr>
                <td className={cell}>{t('ledger.total')}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={`${cell} whitespace-nowrap text-end tnum`}>
                  {rows[0] ? formatMoney(total, rows[0].currency, locale) : ''}
                </td>
                {Array.from({ length: 9 }, (_, i) => (
                  <td key={i} className={cell} />
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </TableColumns>
      {cancelling && <CancelSheet h={cancelling} step={step} onClose={() => setCancelling(null)} />}
    </Card>
  );
}

function CancelSheet({
  h,
  step,
  onClose,
}: {
  h: CashHandover;
  step: ReturnType<typeof useHandoverStep>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title={`${t('hand.cancel')} ${h.number}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <p className="text-sm">{t('hand.cancelAsk')}</p>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs text-muted">{t('hand.reason')}</span>
        <input
          className={input}
          value={reason}
          maxLength={300}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          loading={step.isPending}
          onClick={() =>
            step.mutate(
              { id: h.id, step: 'cancel', reason: reason.trim() || undefined },
              { onSuccess: onClose },
            )
          }
        >
          {t('hand.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}

function HandoverCard({ h }: { h: CashHandover }) {
  const { t, locale } = useT();
  const step = useHandoverStep();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium tnum">
            <bdi>{h.number}</bdi>
          </p>
          <p className="mt-0.5 text-sm">
            {h.fromAccountName} <span className="text-muted">({h.fromBranchName})</span>
            <span className="mx-1 text-muted">{locale === 'ar' ? '←' : '→'}</span>
            {h.toAccountName} <span className="text-muted">({h.toBranchName})</span>
          </p>
        </div>
        <Badge tone={STATUS_TONE[h.status]}>{t(`hand.status.${h.status}`)}</Badge>
      </div>
      <p className="mt-2 text-xl font-semibold tnum">{formatMoney(h.amount, h.currency, locale)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">{t('hand.sentBy')}</dt>
        <dd>
          {h.sentByName} · <span className="tnum">{formatDateTime(h.sentAt, locale)}</span>
        </dd>
        {h.doneByName && (
          <>
            <dt className="text-muted">{t('hand.doneBy')}</dt>
            <dd>
              {h.doneByName}
              {h.doneAt && (
                <>
                  {' '}
                  · <span className="tnum">{formatDateTime(h.doneAt, locale)}</span>
                </>
              )}
            </dd>
          </>
        )}
        {h.notes && (
          <>
            <dt className="text-muted">{t('invoice.notes')}</dt>
            <dd>
              <bdi>{h.notes}</bdi>
            </dd>
          </>
        )}
        {h.reason && (
          <>
            <dt className="text-muted">{t('hand.reason')}</dt>
            <dd>
              <bdi>{h.reason}</bdi>
            </dd>
          </>
        )}
        {h.voucherNumber && (
          <>
            <dt className="text-muted">{t('hand.voucher')}</dt>
            <dd className="tnum">
              <bdi>{h.voucherNumber}</bdi>
            </dd>
          </>
        )}
      </dl>
      {step.error && <p className="mt-2 text-sm text-destructive">{errorText(t, step.error)}</p>}
      {(h.canReceive || h.canCancel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {h.canReceive && (
            <Button
              size="sm"
              icon="check"
              loading={step.isPending}
              onClick={() => step.mutate({ id: h.id, step: 'receive' })}
            >
              {t('hand.receive')}
            </Button>
          )}
          {h.canCancel && (
            <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
              {t('hand.cancel')}
            </Button>
          )}
        </div>
      )}
      {cancelling && (
        <Sheet
          title={t('hand.cancel')}
          onClose={() => setCancelling(false)}
          closeLabel={t('common.close')}
        >
          <p className="text-sm">{t('hand.cancelAsk')}</p>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-muted">{t('hand.reason')}</span>
            <input
              className={input}
              value={reason}
              maxLength={300}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={step.isPending}
              onClick={() =>
                step.mutate(
                  { id: h.id, step: 'cancel', reason: reason.trim() || undefined },
                  { onSuccess: () => setCancelling(false) },
                )
              }
            >
              {t('hand.cancel')}
            </Button>
          </div>
        </Sheet>
      )}
    </Card>
  );
}
