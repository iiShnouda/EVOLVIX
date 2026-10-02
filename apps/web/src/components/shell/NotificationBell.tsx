import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatMoney, type AppNotification } from '@skb/shared';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { useNotifications, useReadNotification } from '../../lib/queries';
import { onNotify } from '../../lib/presence';
import { useQueryClient } from '@tanstack/react-query';

/** A short, soft two-tone chime (made on the spot; no sound file). */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((hz, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.14);
      o.stop(ctx.currentTime + i * 0.14 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* no sound is fine */
  }
}

/**
 * The bell: my notifications (a new invoice to collect: its customer and department; a pending
 * invoice to approve; mine approved or rejected), with a count of unread ones. Opening one marks it
 * read and goes to the invoice.
 */
export function NotificationBell() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { data } = useNotifications();
  const read = useReadNotification();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = data?.unread ?? 0;
  const qc = useQueryClient();
  // Told at once over the live connection (owner, 2026-10-02): read the bell again, then show the
  // newest one for a few seconds with a chime.
  const [popup, setPopup] = useState<AppNotification | null>(null);
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(
    () =>
      onNotify(() => {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['notifications'] }), 600);
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['notifications'] }), 3000);
      }),
    [qc],
  );
  useEffect(() => {
    const top = data?.items?.[0];
    if (!data) return;
    if (seen.current === undefined) {
      seen.current = top?.id ?? null; // what was there on opening the app is not new
      return;
    }
    if (top && top.id !== seen.current && !top.read) {
      seen.current = top.id;
      setPopup(top);
      chime();
      const id = setTimeout(() => setPopup(null), 7000);
      return () => clearTimeout(id);
    }
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function go(n: AppNotification) {
    if (!n.read) read.mutate(n.id);
    setOpen(false);
    if (n.kind.startsWith('CASH_'))
      navigate(n.kind === 'CASH_SENT' ? '/handovers?side=in' : '/handovers?side=out');
    else if (n.documentId)
      navigate(
        n.kind === 'ORDER_PENDING' || n.kind === 'ORDER_APPROVED' || n.kind === 'ORDER_REJECTED'
          ? `/sales?tab=orders&doc=${n.documentId}`
          : `/sales?doc=${n.documentId}`,
      );
  }

  return (
    <div ref={box} className="relative">
      {popup && (
        <button
          type="button"
          onClick={() => {
            setPopup(null);
            go(popup);
          }}
          className="fixed end-4 top-16 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-app)] border border-brand/40 bg-surface p-3 text-start shadow-[var(--shadow-card)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="bell" size={16} className="text-brand" />
            {t(`notify.${popup.kind}`)}
          </span>
          <span className="mt-1 block text-xs text-muted">
            <span className="tnum">{popup.documentNumber}</span> · {popup.partyName}
            {popup.departmentName && <> · {popup.departmentName}</>} ·{' '}
            <span className="tnum">{formatMoney(popup.amount, 'EGP', locale)}</span>
          </span>
          {popup.actorName && (
            <span className="mt-0.5 block text-[11px] text-faint">{popup.actorName}</span>
          )}
        </button>
      )}
      <button
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={t('notify.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tnum">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold">{t('notify.title')}</span>
            {unread > 0 && (
              <button
                className="text-xs text-brand hover:underline"
                onClick={() => read.mutate('all')}
              >
                {t('notify.readAll')}
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-[var(--c-line)] overflow-auto">
            {(data?.items ?? []).length === 0 && (
              <li className="p-4 text-sm text-muted">{t('notify.empty')}</li>
            )}
            {(data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => go(n)}
                  className={`block w-full px-3 py-2.5 text-start hover:bg-surface-2 ${n.read ? '' : 'bg-brand-soft/40'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />}
                    {t(`notify.${n.kind}`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    <span className="tnum">{n.documentNumber}</span> · {n.partyName} ·{' '}
                    {n.departmentName && <>{n.departmentName} · </>}
                    <span className="tnum">{formatMoney(n.amount, 'EGP', locale)}</span>
                  </span>
                  {n.message && (
                    <span className="mt-0.5 block text-xs text-destructive">{n.message}</span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {n.actorName} · {formatDate(n.createdAt, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
