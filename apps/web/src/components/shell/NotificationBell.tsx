import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  companyDay,
  companyToday,
  formatClock,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  type AppNotification,
  type Locale,
  type DailySummaryData,
  type NotificationKind,
  type SummaryFigure,
} from '@skb/shared';
import { Icon } from '../Icon';
import { Spinner } from '../ui';
import { useT } from '../../lib/i18n';
import {
  useDeleteNotification,
  useNotificationPrefs,
  useNotifications,
  useReadNotification,
  useSaveNotificationPrefs,
} from '../../lib/queries';
import { onNotify } from '../../lib/presence';
import { useDeviceInfo } from '../../lib/device';
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
  notificationLook,
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
  const { data, isFetching: fetching } = useNotifications(pages, unreadOnly);
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
      const at = e.target as Node;
      if (!box.current?.contains(at) && !panel.current?.contains(at)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = data?.items ?? [];
  const more = !!data?.more;

  // On a phone the panel is a sheet over the page (out of the top bar, so nothing floats over it),
  // between the top bar and the tab bar, whose heights the shell keeps.
  const { deviceClass } = useDeviceInfo();
  const phone = deviceClass === 'phone';
  const panel = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !phone || !box.current) return;
    const css = getComputedStyle(box.current);
    setBars({
      ['--top-bar' as string]: css.getPropertyValue('--top-bar') || '3.5rem',
      ['--bottom-bar' as string]: css.getPropertyValue('--bottom-bar') || '4rem',
    });
  }, [open, phone]);

  // Long lists load more as the list scrolls to its end.
  const list = useRef<HTMLUListElement>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open || view !== 'list' || !more || !end.current) return;
    const watch = new IntersectionObserver(
      (seen) => {
        if (seen.some((e) => e.isIntersecting) && !fetching) setPages((p) => p + 1);
      },
      { root: list.current, rootMargin: '120px' },
    );
    watch.observe(end.current);
    return () => watch.disconnect();
  }, [open, view, more, fetching, items.length]);

  return (
    <div ref={box} className="relative">
      {popup && (
        <button
          type="button"
          onClick={() => {
            setPopup(null);
            go(popup);
          }}
          className="fixed end-4 top-16 z-50 flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-[var(--radius-app)] border border-brand/40 bg-surface p-3 text-start shadow-[var(--shadow-card)]"
        >
          <KindIcon n={popup} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{notificationTitle(popup, t)}</span>
            <span className="mt-0.5 block text-xs text-muted">
              {notificationDetail(popup, t, locale)}
            </span>
            {popup.actorName && (
              <span className="mt-0.5 block text-[11px] text-faint">{popup.actorName}</span>
            )}
          </span>
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
      {open && (phone ? createPortal(sheet(), document.body) : sheet())}
    </div>
  );

  function sheet() {
    return (
      // A sheet under the top bar on a phone, a drop-down panel elsewhere: a fixed height, its
      // header stays and the list scrolls inside it (owner, 2026-11-18: it could not be scrolled).
      <div
        ref={panel}
        data-bell-panel
        style={phone ? bars : undefined}
        className="fixed inset-x-2 top-[calc(var(--top-bar,3.5rem)+0.25rem)] z-[45] flex max-h-[calc(100dvh-var(--top-bar,3.5rem)-var(--bottom-bar,4rem)-0.75rem)] flex-col overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface shadow-[var(--shadow-card)] md:absolute md:inset-x-auto md:end-0 md:top-full md:mt-2 md:max-h-[min(36rem,calc(100dvh-5rem))] md:w-[26rem]"
      >
        {view === 'settings' ? (
          <BellSettings onBack={() => setView('list')} />
        ) : typeof view === 'object' ? (
          <Summary n={view.summary} onBack={() => setView('list')} />
        ) : (
          <>
            <div className="flex-none border-b border-line">
              <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
                <span className="flex items-center gap-2">
                  <span className="text-base font-semibold">{t('notify.title')}</span>
                  {unread > 0 && (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand tnum">
                      {t('notify.unreadCount').replace('{n}', formatNumber(unread, locale))}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {unread > 0 && (
                    <button
                      className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-surface-2"
                      onClick={() => read.mutate('all')}
                    >
                      {t('notify.readAll')}
                    </button>
                  )}
                  <button
                    className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg"
                    aria-label={t('notify.settings')}
                    title={t('notify.settings')}
                    onClick={() => setView('settings')}
                  >
                    <Icon name="settings" size={16} />
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-3 pb-2 text-xs">
                <span className="inline-flex rounded-md border border-line p-0.5">
                  {[false, true].map((u) => (
                    <button
                      key={String(u)}
                      className={`rounded px-2.5 py-1 ${unreadOnly === u ? 'bg-surface-2 font-semibold text-fg' : 'text-muted hover:text-fg'}`}
                      aria-pressed={unreadOnly === u}
                      onClick={() => {
                        setUnreadOnly(u);
                        setPages(1);
                      }}
                    >
                      {u ? t('notify.unreadOnly') : t('common.all')}
                    </button>
                  ))}
                </span>
                <button
                  className="rounded px-2 py-1 font-medium text-brand hover:bg-surface-2"
                  onClick={() => {
                    setOpen(false);
                    navigate('/notifications');
                  }}
                >
                  {t('notify.all')}
                </button>
              </div>
            </div>
            <ul
              ref={list}
              className="min-h-0 flex-1 divide-y divide-[var(--c-line)] overflow-y-auto overscroll-contain"
            >
              {items.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">{t('notify.empty')}</li>
              )}
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`group flex items-stretch ${n.read ? '' : 'bg-brand-soft/30'}`}
                >
                  <button
                    onClick={() => go(n)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-start hover:bg-surface-2"
                  >
                    <KindIcon n={n} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={`text-sm leading-snug ${n.read ? 'font-medium text-fg/85' : 'font-semibold text-fg'}`}
                        >
                          {notificationTitle(n, t)}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[11px] text-faint tnum">
                          {when(n, locale)}
                        </span>
                      </span>
                      <Detail n={n} />
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
                    )}
                  </button>
                  <button
                    className="shrink-0 px-2 text-faint hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    aria-label={t('notify.delete')}
                    title={t('notify.delete')}
                    onClick={() => remove.mutate(n.id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
              {more && (
                <li ref={end} className="grid place-items-center p-3">
                  <Spinner size={16} />
                </li>
              )}
            </ul>
            {items.some((n) => n.read) && (
              <div className="flex-none border-t border-line px-3 py-1.5 text-end text-xs">
                <button
                  className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-destructive"
                  onClick={() => remove.mutate('read')}
                >
                  {t('notify.clearRead')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }
}

/** Today's show their time; older ones their day and time. */
function when(n: AppNotification, locale: Locale) {
  return (n.day ?? companyDay(n.createdAt)) === companyToday()
    ? formatClock(n.createdAt, locale)
    : formatDateTime(n.createdAt, locale);
}

/** The kind's icon in its colour (also on the notifications page). */
export function KindIcon({ n, size = 32 }: { n: AppNotification; size?: number }) {
  const look = notificationLook(n.kind);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full ${look.tone}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon name={look.icon} size={Math.round(size / 2)} />
    </span>
  );
}

/** What it is about, its note, and who did it (also on the notifications page). */
export function Detail({ n }: { n: AppNotification }) {
  const { t, locale } = useT();
  const detail = notificationDetail(n, t, locale);
  return (
    <>
      {detail && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{detail}</span>}
      {n.message && (
        <span className="mt-0.5 line-clamp-2 block text-xs text-destructive">{n.message}</span>
      )}
      {n.actorName && <span className="mt-0.5 block text-[11px] text-faint">{n.actorName}</span>}
    </>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { t, rtl } = useT();
  return (
    <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
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
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={t('notify.settings')} onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
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
  const day = (n.data as { day?: string } | null)?.day;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        title={`${t('notify.DAILY_SUMMARY')} · ${day ? formatDate(day, locale) : ''}`}
        onBack={onBack}
      />
      <SummaryBody n={n} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1" />
    </div>
  );
}

/** The daily summary's figures (the bell, and the notifications page). */
export function SummaryBody({ n, className }: { n: AppNotification; className?: string }) {
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
    <div className={`divide-y divide-[var(--c-line)] text-sm ${className ?? ''}`}>
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
  );
}
