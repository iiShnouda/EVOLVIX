import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  formatDateTime,
  formatMoney,
  toMinor,
  type CashHandover,
  type TranslationKey,
} from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
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
  const list = useCashHandovers(side, status);

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
      </div>
      {list.isLoading ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <Card>
          <EmptyState title={t('hand.none')} icon="receipts" />
        </Card>
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
