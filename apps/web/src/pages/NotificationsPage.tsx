import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  companyDay,
  companyToday,
  formatClock,
  formatDate,
  formatNumber,
  NOTIFICATION_KINDS,
  type AppNotification,
  type NotificationFilter,
  type NotificationKind,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { MultiSelect } from '../components/MultiSelect';
import { Detail, KindIcon, SummaryBody } from '../components/shell/NotificationBell';
import { useT } from '../lib/i18n';
import { confirm } from '../lib/confirm';
import {
  useDeleteNotifications,
  useMarkNotifications,
  useNotificationFeed,
  useNotificationPlaces,
  useNotificationPrefs,
  useReadNotification,
} from '../lib/queries';
import { dayHeading, notificationLink, notificationTitle } from '../lib/notificationText';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** `b:<id>`, `d:<id>` or `w:<id>`: one branch, department or store. */
type Place = string;

/**
 * All my notifications, old and new, by company day (owner, 2026-11-18: "a page where I see the old
 * and new ones and can delete them, by day, and in each day its things"): Today, Yesterday, then the
 * date; within a day newest first, each with its kind and opening its document. Filters: unread,
 * kinds (only those I may be sent), a period, and a place among those my notifications came from
 * that I may still see. Read/unread and delete one, several, a day, the read ones, or all before a
 * day. Pages load as the list scrolls; nothing is kept on the device.
 */
export function NotificationsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(false);
  const [kinds, setKinds] = useState<NotificationKind[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [place, setPlace] = useState<Place>('');
  const [olderThan, setOlderThan] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [openSummary, setOpenSummary] = useState<string | null>(null);

  const filter: NotificationFilter = useMemo(() => {
    const [k, id] = place.split(':');
    return {
      unread: unread || undefined,
      kinds: kinds.length ? kinds : undefined,
      from: from || undefined,
      to: to || undefined,
      branchId: k === 'b' ? id : undefined,
      departmentId: k === 'd' ? id : undefined,
      warehouseId: k === 'w' ? id : undefined,
    };
  }, [unread, kinds, from, to, place]);

  const feed = useNotificationFeed(filter);
  const { data: prefs } = useNotificationPrefs();
  const { data: places } = useNotificationPlaces();
  const mark = useMarkNotifications();
  const read = useReadNotification();
  const remove = useDeleteNotifications();

  const pages = feed.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const first = pages[0];
  const total = first?.total ?? 0;
  const unreadAll = first?.unread ?? 0;

  // A choice made under other filters does not carry over.
  useEffect(() => setChosen(new Set()), [filter]);

  const days = useMemo(() => {
    const out: { day: string; items: AppNotification[] }[] = [];
    for (const n of items) {
      const day = n.day ?? companyDay(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(n);
      else out.push({ day, items: [n] });
    }
    return out;
  }, [items]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of places?.branches ?? []) m.set(x.id, x.name);
    for (const x of places?.departments ?? []) m.set(x.id, x.name);
    for (const x of places?.warehouses ?? []) m.set(x.id, x.name);
    return m;
  }, [places]);

  // The next page loads as the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    if (!hasNextPage || !end.current) return;
    const watch = new IntersectionObserver(
      (seen) => {
        if (seen.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    watch.observe(end.current);
    return () => watch.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  const kindOptions = (prefs?.offered?.length ? prefs.offered : [...NOTIFICATION_KINDS]).map(
    (k) => ({ value: k, label: t(`notify.${k}`) }),
  );
  const hasPlaces =
    !!places && places.branches.length + places.departments.length + places.warehouses.length > 0;
  const filtered = unread || kinds.length > 0 || !!from || !!to || !!place;
  const fill = (text: string, n: number | string) => text.replace('{n}', String(n));

  function toggle(ids: string[], on: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function open(n: AppNotification) {
    if (!n.read) read.mutate(n.id);
    if (n.kind === 'DAILY_SUMMARY') {
      setOpenSummary((s) => (s === n.id ? null : n.id));
      return;
    }
    const link = notificationLink(n);
    if (link) navigate(link);
  }

  async function deleteChosen() {
    const ids = [...chosen];
    if (
      !(await confirm({
        message: fill(t('notify.deleteSelectedConfirm'), formatNumber(ids.length, locale)),
        danger: true,
      }))
    )
      return;
    remove.mutate({ ids }, { onSuccess: () => setChosen(new Set()) });
  }

  async function deleteRead() {
    if (!(await confirm({ message: t('notify.clearReadConfirm'), danger: true }))) return;
    remove.mutate({ readOnly: true });
  }

  async function deleteOlder() {
    if (!olderThan) return;
    const message = t('notify.deleteOlderConfirm').replace('{date}', formatDate(olderThan, locale));
    if (!(await confirm({ message, danger: true }))) return;
    remove.mutate({ before: olderThan }, { onSuccess: () => setOlderThan('') });
  }

  const placeLabel = (n: AppNotification) =>
    [n.branchId, n.warehouseId]
      .map((id) => (id ? names.get(id) : undefined))
      .filter((x): x is string => !!x)
      .join(' · ');

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('nav.notifications')}
        subtitle={[
          fill(t('notify.count'), formatNumber(total, locale)),
          unreadAll ? fill(t('notify.unreadCount'), formatNumber(unreadAll, locale)) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {unreadAll > 0 && (
              <Button variant="secondary" size="sm" onClick={() => read.mutate('all')}>
                {t('notify.readAll')}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => void deleteRead()}>
              {t('notify.clearRead')}
            </Button>
          </div>
        }
      />

      <Card padded={false} className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[auto_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <span className="mb-0.5 hidden text-xs text-muted lg:block">&nbsp;</span>
            <span className="inline-flex h-9 rounded-[var(--radius-app)] border border-line p-0.5 text-sm">
              {[false, true].map((u) => (
                <button
                  key={String(u)}
                  className={`rounded px-3 ${unread === u ? 'bg-surface-2 font-semibold' : 'text-muted hover:text-fg'}`}
                  aria-pressed={unread === u}
                  onClick={() => setUnread(u)}
                >
                  {u ? t('notify.unreadOnly') : t('common.all')}
                </button>
              ))}
            </span>
          </div>
          <MultiSelect
            className="col-span-2 lg:col-span-1"
            label={t('notify.filter.kinds')}
            options={kindOptions}
            value={kinds}
            onChange={(v) => setKinds(v as NotificationKind[])}
          />
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('notify.filter.from')}</span>
            <input
              type="date"
              className={field}
              value={from}
              max={to || companyToday()}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('notify.filter.to')}</span>
            <input
              type="date"
              className={field}
              value={to}
              min={from || undefined}
              max={companyToday()}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {hasPlaces && (
            <label className="col-span-2 block lg:col-span-1">
              <span className="mb-0.5 block text-xs text-muted">{t('notify.filter.place')}</span>
              <select className={field} value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">{t('notify.filter.allPlaces')}</option>
                {(
                  [
                    ['b', 'notify.place.branches', places.branches],
                    ['d', 'notify.place.departments', places.departments],
                    ['w', 'notify.place.warehouses', places.warehouses],
                  ] as const
                ).map(([k, label, list]) =>
                  list.length ? (
                    <optgroup key={k} label={t(label)}>
                      {list.map((x) => (
                        <option key={x.id} value={`${k}:${x.id}`}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
            </label>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          {filtered ? (
            <button
              className="text-sm text-brand hover:underline"
              onClick={() => {
                setUnread(false);
                setKinds([]);
                setFrom('');
                setTo('');
                setPlace('');
              }}
            >
              {t('notify.clearFilters')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted">{t('notify.deleteOlder')}</span>
              <input
                type="date"
                className={field}
                value={olderThan}
                max={companyToday()}
                onChange={(e) => setOlderThan(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              icon="trash"
              className="h-9"
              disabled={!olderThan}
              onClick={() => void deleteOlder()}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Card>

      {feed.isLoading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon="bell" title={filtered ? t('notify.noMatch') : t('notify.empty')} />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.length > 0 && (
            <label className="flex items-center gap-2 px-1 text-sm text-muted">
              <input
                type="checkbox"
                checked={items.every((n) => chosen.has(n.id))}
                onChange={(e) =>
                  toggle(
                    items.map((n) => n.id),
                    e.target.checked,
                  )
                }
              />
              {t('notify.selectAll')}
            </label>
          )}
          {days.map(({ day, items: dayItems }) => {
            const all = dayItems.every((n) => chosen.has(n.id));
            return (
              <section key={day} data-day={day}>
                <div className="mb-1.5 flex items-center gap-2 px-1 py-1">
                  <input
                    type="checkbox"
                    aria-label={t('notify.selectDay')}
                    title={t('notify.selectDay')}
                    checked={all}
                    onChange={(e) =>
                      toggle(
                        dayItems.map((n) => n.id),
                        e.target.checked,
                      )
                    }
                  />
                  <h2 className="text-sm font-semibold">{dayHeading(day, t, locale)}</h2>
                  <span className="text-xs text-faint tnum">
                    {fill(t('notify.count'), formatNumber(dayItems.length, locale))}
                  </span>
                </div>
                <Card padded={false} className="divide-y divide-[var(--c-line)] overflow-hidden">
                  {dayItems.map((n) => (
                    <div
                      key={n.id}
                      data-notification={n.kind}
                      className={n.read ? '' : 'bg-brand-soft/30'}
                    >
                      <div className="group flex items-start gap-2 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="mt-2.5"
                          aria-label={notificationTitle(n, t)}
                          checked={chosen.has(n.id)}
                          onChange={(e) => toggle([n.id], e.target.checked)}
                        />
                        <button
                          className="flex min-w-0 flex-1 items-start gap-2.5 rounded text-start"
                          onClick={() => open(n)}
                        >
                          <KindIcon n={n} size={36} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span
                                className={`text-sm ${n.read ? 'font-medium' : 'font-semibold'}`}
                              >
                                {notificationTitle(n, t)}
                              </span>
                              {placeLabel(n) && (
                                <span className="text-[11px] text-faint">{placeLabel(n)}</span>
                              )}
                            </span>
                            <Detail n={n} />
                          </span>
                        </button>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5 text-xs text-faint tnum">
                            {!n.read && (
                              <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
                            )}
                            {formatClock(n.createdAt, locale)}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <button
                              className="grid h-7 w-7 place-items-center rounded text-faint hover:bg-surface-2 hover:text-fg"
                              title={n.read ? t('notify.markUnread') : t('notify.markRead')}
                              aria-label={n.read ? t('notify.markUnread') : t('notify.markRead')}
                              onClick={() => mark.mutate({ ids: [n.id], read: !n.read })}
                            >
                              <Icon name={n.read ? 'eyeOff' : 'eye'} size={15} />
                            </button>
                            <button
                              className="grid h-7 w-7 place-items-center rounded text-faint hover:bg-surface-2 hover:text-destructive"
                              title={t('notify.delete')}
                              aria-label={t('notify.delete')}
                              onClick={() => remove.mutate({ ids: [n.id] })}
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          </span>
                        </span>
                      </div>
                      {openSummary === n.id && (
                        <SummaryBody
                          n={n}
                          className="mx-3 mb-3 rounded-md bg-surface-2 px-3 py-1"
                        />
                      )}
                    </div>
                  ))}
                </Card>
              </section>
            );
          })}
          <div ref={end} className="grid place-items-center py-4">
            {isFetchingNextPage && <Spinner size={18} />}
          </div>
        </div>
      )}
      {chosen.size > 0 && (
        <div className="sticky bottom-[calc(var(--bottom-bar,0px)+0.75rem)] z-10 mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-app)] border border-brand/40 bg-surface px-3 py-2 shadow-[var(--shadow-card)]">
          <span className="text-sm font-semibold">
            {fill(t('notify.selected'), formatNumber(chosen.size, locale))}
          </span>
          <span className="ms-auto flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => mark.mutate({ ids: [...chosen], read: true })}
            >
              {t('notify.markRead')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => mark.mutate({ ids: [...chosen], read: false })}
            >
              {t('notify.markUnread')}
            </Button>
            <Button variant="danger" size="sm" icon="trash" onClick={() => void deleteChosen()}>
              {t('notify.deleteSelected')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setChosen(new Set())}>
              {t('common.cancel')}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
