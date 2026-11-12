import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  type AppNotification,
  type DailySummaryData,
  type NotificationKind,
  type SummaryFigure,
} from '@skb/shared';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import {
  useDeleteNotification,
  useNotificationPrefs,
  useNotifications,
  useReadNotification,
  useSaveNotificationPrefs,
} from '../../lib/queries';
import { onNotify } from '../../lib/presence';
import { useQueryClient } from '@tanstack/react-query';
import {
  askDevice,
  deviceState,
  showDevice,
  showUnread,
  type DeviceState,
} from '../../lib/deviceNotify';
import {
  notificationDetail,
  notificationLink,
  notificationTitle,
} from '../../lib/notificationText';

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

type View = 'list' | 'settings' | { summary: AppNotification };

/**
 * The bell: my notifications, worded from their kind, newest first with older ones on request,
 * a count of unread ones (also on the tab's title and the app's icon), and a pop-up with a chime
 * when one arrives — and a system notification (its kind only) while the app is in the background.
 * Opening one marks it read and goes to its document; the daily summary opens here. My own
 * choices (which kinds, sound, this device) are kept on the server.
 */
export function NotificationBell() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [pages, setPages] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data } = useNotifications(pages, unreadOnly);
  const { data: prefs } = useNotificationPrefs();
  const read = useReadNotification();
  const remove = useDeleteNotification();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const box = useRef<HTMLDivElement>(null);
  const unread = data?.unread ?? 0;
  const qc = useQueryClient();
  const [popup, setPopup] = useState<AppNotification | null>(null);
  const seen = useRef<string | null | undefined>(undefined);

  // Told at once over the live connection (owner, 2026-10-02): read the bell again.
  useEffect(
    () =>
      onNotify(() => {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['notifications'] }), 600);
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['notifications'] }), 3000);
      }),
    [qc],
  );

  useEffect(() => showUnread(unread), [unread]);
  useEffect(() => () => showUnread(0), []);

  function go(n: AppNotification) {
    if (!n.read) read.mutate(n.id);
    if (n.kind === 'DAILY_SUMMARY') {
      setOpen(true);
      setView({ summary: n });
      return;
    }
    setOpen(false);
    const to = notificationLink(n);
    if (to) navigate(to);
  }

  // The newest one, if new since the app opened: a pop-up, a chime, a system notification.
  useEffect(() => {
    const top = data?.items?.[0];
    if (!data || unreadOnly) return;
    if (seen.current === undefined) {
      seen.current = top?.id ?? null; // what was there on opening the app is not new
      return;
    }
    if (top && top.id !== seen.current && !top.read) {
      seen.current = top.id;
      setPopup(top);
      if (prefs?.sound !== false) chime();
      if (prefs?.device !== false)
        showDevice(t('app.name'), notificationTitle(top, t), top.id, () => go(top));
      const id = setTimeout(() => setPopup(null), 7000);
      return () => clearTimeout(id);
    }
    // go and t change with every render; the effect is about new data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = data?.items ?? [];

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
            {notificationTitle(popup, t)}
          </span>
          <span className="mt-1 block text-xs text-muted">
            {notificationDetail(popup, t, locale)}
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
        onClick={() => {
          setOpen((o) => !o);
          setView('list');
        }}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tnum">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)]">
          {view === 'settings' ? (
            <BellSettings onBack={() => setView('list')} />
          ) : typeof view === 'object' ? (
            <Summary n={view.summary} onBack={() => setView('list')} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <span className="text-sm font-semibold">{t('notify.title')}</span>
                <span className="flex items-center gap-3">
                  {unread > 0 && (
                    <button
                      className="text-xs text-brand hover:underline"
                      onClick={() => read.mutate('all')}
                    >
                      {t('notify.readAll')}
                    </button>
                  )}
                  <button
                    className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg"
                    aria-label={t('notify.settings')}
                    title={t('notify.settings')}
                    onClick={() => setView('settings')}
                  >
                    <Icon name="settings" size={15} />
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs">
                <label className="flex items-center gap-1.5 text-muted">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => {
                      setUnreadOnly(e.target.checked);
                      setPages(1);
                    }}
                  />
                  {t('notify.unreadOnly')}
                </label>
                {items.some((n) => n.read) && (
                  <button
                    className="text-muted hover:text-destructive hover:underline"
                    onClick={() => remove.mutate('read')}
                  >
                    {t('notify.clearRead')}
                  </button>
                )}
              </div>
              <ul className="max-h-[60vh] divide-y divide-[var(--c-line)] overflow-auto">
                {items.length === 0 && (
                  <li className="p-4 text-sm text-muted">{t('notify.empty')}</li>
                )}
                {items.map((n) => (
                  <li key={n.id} className={`group flex ${n.read ? '' : 'bg-brand-soft/40'}`}>
                    <button
                      onClick={() => go(n)}
                      className="block min-w-0 flex-1 px-3 py-2.5 text-start hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />}
                        {notificationTitle(n, t)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {notificationDetail(n, t, locale)}
                      </span>
                      {n.message && (
                        <span className="mt-0.5 block text-xs text-destructive">{n.message}</span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {n.actorName && <>{n.actorName} · </>}
                        {formatDateTime(n.createdAt, locale)}
                      </span>
                    </button>
                    <button
                      className="shrink-0 px-2 text-faint opacity-60 hover:text-destructive group-hover:opacity-100"
                      aria-label={t('notify.delete')}
                      title={t('notify.delete')}
                      onClick={() => remove.mutate(n.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
                {data?.more && (
                  <li>
                    <button
                      className="block w-full px-3 py-2 text-center text-xs text-brand hover:bg-surface-2"
                      onClick={() => setPages((p) => p + 1)}
                    >
                      {t('notify.more')}
                    </button>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { t, rtl } = useT();
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <button
        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={t('notify.back')}
        onClick={onBack}
      >
        <span className={rtl ? '' : 'rotate-180'}>➜</span>
      </button>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}

/** Which kinds I am told of, the chime, and system notifications on this device. */
function BellSettings({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  const { data: prefs } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const [device, setDevice] = useState<DeviceState>(deviceState());
  const off = new Set<NotificationKind>(prefs?.off ?? []);
  const always = new Set<NotificationKind>(prefs?.alwaysOn ?? []);
  const toggle = (k: NotificationKind) => {
    const next = new Set(off);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    save.mutate({ off: [...next] });
  };
  return (
    <div>
      <Header title={t('notify.settings')} onBack={onBack} />
      <div className="max-h-[60vh] space-y-3 overflow-auto p-3 text-sm">
        <label className="flex items-center justify-between gap-2">
          <span>{t('notify.sound')}</span>
          <input
            type="checkbox"
            checked={prefs?.sound !== false}
            onChange={(e) => save.mutate({ sound: e.target.checked })}
          />
        </label>
        <div className="space-y-1.5">
          <label className="flex items-center justify-between gap-2">
            <span>{t('notify.device')}</span>
            <input
              type="checkbox"
              checked={prefs?.device !== false}
              disabled={device === 'unsupported'}
              onChange={(e) => save.mutate({ device: e.target.checked })}
            />
          </label>
          {device === 'default' && prefs?.device !== false && (
            <button
              className="rounded-md border border-line px-2.5 py-1 text-xs text-brand hover:bg-surface-2"
              onClick={() => void askDevice().then(setDevice)}
            >
              {t('notify.deviceAllow')}
            </button>
          )}
          {device === 'denied' && <p className="text-xs text-muted">{t('notify.deviceBlocked')}</p>}
          {device === 'unsupported' && (
            <p className="text-xs text-muted">{t('notify.deviceUnsupported')}</p>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">{t('notify.kinds')}</p>
          <ul className="space-y-1">
            {(prefs?.offered ?? []).map((k) => (
              <li key={k}>
                <label className="flex items-center justify-between gap-2">
                  <span>{t(`notify.${k}`)}</span>
                  {always.has(k) ? (
                    <span className="text-[11px] text-faint">{t('notify.alwaysOn')}</span>
                  ) : (
                    <input type="checkbox" checked={!off.has(k)} onChange={() => toggle(k)} />
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** The daily summary, as it was worked out for me. */
function Summary({ n, onBack }: { n: AppNotification; onBack: () => void }) {
  const { t, locale } = useT();
  const d = (n.data ?? {}) as unknown as DailySummaryData;
  const money = (v: number) => formatMoney(v, 'EGP', locale);
  const fig = (label: string, f?: SummaryFigure | null) =>
    f ? (
      <div className="flex items-baseline justify-between gap-2 py-1" key={label}>
        <span>
          {label}{' '}
          <span className="text-[11px] text-faint tnum">
            ({t('notify.sum.count').replace('{n}', formatNumber(f.count, locale))})
          </span>
        </span>
        <span className="font-semibold tnum">{money(f.total)}</span>
      </div>
    ) : null;
  return (
    <div>
      <Header
        title={`${t('notify.DAILY_SUMMARY')} · ${d.day ? formatDate(d.day, locale) : ''}`}
        onBack={onBack}
      />
      <div className="max-h-[60vh] divide-y divide-[var(--c-line)] overflow-auto px-3 py-1 text-sm">
        {fig(t('notify.sum.sales'), d.sales)}
        {fig(t('notify.sum.returns'), d.returns)}
        {fig(t('notify.sum.collected'), d.collected)}
        {fig(t('notify.sum.expenses'), d.expenses)}
        {d.boxes && d.boxes.length > 0 && (
          <div className="py-1">
            <p className="text-xs font-semibold text-muted">{t('notify.sum.boxes')}</p>
            {d.boxes.map((b) => (
              <div key={b.name} className="flex justify-between gap-2 py-0.5">
                <span className="truncate">{b.name}</span>
                <span className="tnum">{money(b.balance)}</span>
              </div>
            ))}
          </div>
        )}
        {fig(t('notify.sum.chequesIn'), d.cheques?.receivable)}
        {fig(t('notify.sum.chequesOut'), d.cheques?.payable)}
        {d.stock && (
          <>
            <div className="flex justify-between gap-2 py-1">
              <span>{t('notify.sum.stockOut')}</span>
              <span className="font-semibold tnum">{formatNumber(d.stock.out, locale)}</span>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <span>{t('notify.sum.stockLow')}</span>
              <span className="font-semibold tnum">{formatNumber(d.stock.low, locale)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
