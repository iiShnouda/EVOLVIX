import { useEffect, useState } from 'react';
import { companyToday, formatTime, type LogEntry, type LogLevel } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, type Tone } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { saveFile } from '../lib/print';
import { useServerLog, type LogQuery } from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

const LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];
const TONE: Record<LogLevel, Tone> = {
  debug: 'neutral',
  info: 'info',
  warning: 'warning',
  error: 'destructive',
};

/**
 * The server's log, the owner's alone (owner, 2026-11-12: "logs for debugging, and I can see them in
 * the app"): a day's lines, newest first, by level, source (the server, or errors the app reported
 * from people's devices), text or request number; a line opens to its details and stack trace. The
 * server picks the file by the day; the page never sees a file name or folder.
 */
export function LogsPage() {
  const { t, locale } = useT();
  const [query, setQuery] = useState<LogQuery>({
    day: companyToday(),
    level: '',
    source: '',
    q: '',
    requestId: '',
  });
  const [text, setText] = useState('');
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);

  // Typing settles for a moment before the server is asked.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery((q) => ({ ...q, q: text.trim() })), 350);
    return () => window.clearTimeout(id);
  }, [text]);

  const log = useServerLog(query, live);
  const pages = log.data?.pages ?? [];
  const first = pages[0];
  const entries = pages.flatMap((p) => p.entries);
  const days = first?.days.length ? first.days : [query.day];
  const set = (patch: Partial<LogQuery>) => {
    setOpen(null);
    setQuery((q) => ({ ...q, ...patch }));
  };

  async function download() {
    setDownloading(true);
    setFailed(null);
    try {
      const file = await api.download(`/system/logs/download?day=${query.day}`);
      saveFile(file.name, 'text/plain', file.bytes);
    } catch (e) {
      setFailed(e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.logs')}
        action={
          <Button
            variant="secondary"
            icon="download"
            loading={downloading}
            disabled={!first?.days.includes(query.day)}
            onClick={() => void download()}
          >
            {t('logs.download')}
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted">{t('logs.day')}</span>
            <select
              className={`${field} tnum`}
              value={query.day}
              onChange={(e) => set({ day: e.target.value })}
            >
              {(days.includes(query.day) ? days : [query.day, ...days]).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">{t('logs.level')}</span>
            <select
              className={field}
              value={query.level}
              onChange={(e) => set({ level: e.target.value })}
            >
              <option value="">{t('logs.level.all')}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`logs.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">{t('logs.source')}</span>
            <select
              className={field}
              value={query.source}
              onChange={(e) => set({ source: e.target.value })}
            >
              <option value="">{t('logs.source.all')}</option>
              <option value="server">{t('logs.source.server')}</option>
              <option value="client">{t('logs.source.client')}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">{t('logs.search')}</span>
            <input
              className={field}
              dir="auto"
              type="search"
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">{t('logs.requestId')}</span>
            <input
              className={`${field} tnum`}
              dir="ltr"
              type="search"
              value={query.requestId}
              maxLength={40}
              onChange={(e) => set({ requestId: e.target.value.trim().toUpperCase() })}
            />
          </label>
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          {t('logs.live')}
          {live && log.isFetching ? <Spinner size={14} /> : null}
        </label>
        {failed || log.error ? (
          <p className="mt-2 text-sm text-destructive">{errorText(t, failed ?? log.error)}</p>
        ) : null}
      </Card>

      <Card padded={false}>
        {log.isLoading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner />
          </div>
        ) : first && !first.enabled ? (
          <EmptyState title={t('logs.off')} icon="logs" />
        ) : entries.length === 0 ? (
          <EmptyState title={t('logs.empty')} icon="logs" />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <Line
                key={e.id}
                entry={e}
                open={open === e.id}
                onToggle={() => setOpen(open === e.id ? null : e.id)}
                onRequest={(id) => set({ requestId: id })}
                time={formatTime(e.time, locale)}
              />
            ))}
          </ul>
        )}
      </Card>

      {log.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            {t('logs.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Line({
  entry: e,
  open,
  onToggle,
  onRequest,
  time,
}: {
  entry: LogEntry;
  open: boolean;
  onToggle: () => void;
  onRequest: (id: string) => void;
  time: string;
}) {
  const { t } = useT();
  const details: [string, string | null][] = [
    [t('logs.requestId'), e.requestId],
    [t('logs.user'), e.user],
    [t('logs.page'), e.route],
    [t('logs.version'), e.version],
    [t('logs.browser'), e.userAgent],
  ];
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-surface-2"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="tnum w-20 shrink-0 text-xs text-muted">{time}</span>
        <span className="w-24 shrink-0">
          <Badge tone={TONE[e.level] ?? 'neutral'}>{t(`logs.level.${e.level}`)}</Badge>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-mono text-xs text-fg" dir="ltr">
            {e.category ? <span className="text-muted">{e.category}: </span> : null}
            {e.message}
          </span>
          <span className="mt-0.5 block text-xs text-faint">
            {t(`logs.source.${e.source}`)}
            {e.user ? ` · ${e.user}` : ''}
          </span>
        </span>
        {e.exception ? <Icon name="chevronDown" size={16} /> : null}
      </button>
      {open ? (
        <div className="space-y-2 bg-surface-2 px-4 py-3 text-xs">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {details
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-all font-mono" dir="ltr">
                    {v}
                  </dd>
                </div>
              ))}
          </dl>
          {e.requestId ? (
            <Button size="sm" variant="ghost" onClick={() => onRequest(e.requestId!)}>
              {t('logs.sameRequest')}
            </Button>
          ) : null}
          {e.exception ? (
            <div>
              <p className="mb-1 text-muted">{t('logs.stack')}</p>
              <pre
                className="max-h-96 overflow-auto whitespace-pre rounded-[var(--radius-app)] border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed"
                dir="ltr"
              >
                {e.exception}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
