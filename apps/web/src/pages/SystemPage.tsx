import type { ReactNode } from 'react';
import { formatDateTime, formatNumber, type SystemMonitor } from '@skb/shared';
import { Badge, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { errorText } from '../lib/errors';
import { useSystemMonitor } from '../lib/queries';

type Tone = 'ok' | 'warn' | 'bad';

/**
 * The owner's server monitor (owner, 2026-10-10; system:monitor, the owner's alone): the machine's
 * processor, memory, disk and temperature, the app, the database, the assistant's models and the
 * backups, read again every few seconds. Figures only: nothing on the server can be run or opened
 * from here.
 */
export function SystemPage() {
  const { t, locale } = useT();
  const monitor = useSystemMonitor();
  const d = monitor.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.system')}
        subtitle={d ? `${t('sys.updated')}: ${formatDateTime(d.at, locale)}` : undefined}
      />
      {monitor.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner size={26} />
        </div>
      ) : !d ? (
        <Card className="text-sm text-destructive">{errorText(t, monitor.error)}</Card>
      ) : (
        <Body d={d} />
      )}
    </div>
  );
}

function Body({ d }: { d: SystemMonitor }) {
  const { t, locale } = useT();
  const m = d.machine;
  const memUsed = m.memoryTotal - m.memoryAvailable;
  const memPct = pct(memUsed, m.memoryTotal);
  const system = m.disks.find((x) => x.role === 'system');
  const diskPct = system ? pct(system.total - system.free, system.total) : 0;
  const bytes = (n: number) => formatBytes(n, locale);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Gauge
          icon="bolt"
          label={t('sys.cpu')}
          value={`${n(m.cpuPercent)}%`}
          detail={`${n(m.cores)} ${t('sys.cores')}`}
          percent={m.cpuPercent}
          tone={level(m.cpuPercent, 70, 90)}
        />
        <Gauge
          icon="device"
          label={t('sys.memory')}
          value={`${n(memPct)}%`}
          detail={`${bytes(memUsed)} / ${bytes(m.memoryTotal)}`}
          percent={memPct}
          tone={level(memPct, 80, 92)}
        />
        <Gauge
          icon="server"
          label={t('sys.disk')}
          value={system ? `${n(diskPct)}%` : '—'}
          detail={system ? `${t('sys.free')}: ${bytes(system.free)} / ${bytes(system.total)}` : ''}
          percent={diskPct}
          tone={level(diskPct, 80, 92)}
        />
        <Gauge
          icon="alert"
          label={t('sys.temperature')}
          value={m.temperatureC == null ? '—' : `${n(m.temperatureC)}°`}
          detail={m.temperatureC == null ? t('sys.noSensor') : t('sys.celsius')}
          percent={m.temperatureC == null ? 0 : Math.min(100, (m.temperatureC / 90) * 100)}
          tone={m.temperatureC == null ? 'ok' : level(m.temperatureC, 70, 80)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title={t('sys.machine')} icon="server">
          <Row label={t('sys.model')} value={m.model || '—'} />
          <Row label={t('sys.uptime')} value={duration(m.uptimeSeconds, t, n)} />
          <Row label={t('sys.load')} value={[m.load1, m.load5, m.load15].map((x) => n(x)).join(' · ')} ltr />
          {m.swapTotal > 0 && (
            <Row label={t('sys.swap')} value={`${bytes(m.swapTotal - m.swapFree)} / ${bytes(m.swapTotal)}`} />
          )}
          {m.disks
            .filter((x) => x.role === 'backups')
            .map((x) => (
              <Row
                key={x.role}
                label={t('sys.backupDisk')}
                value={`${t('sys.free')}: ${bytes(x.free)} / ${bytes(x.total)}`}
              />
            ))}
        </Section>

        <Section title={t('sys.app')} icon="dashboard">
          <Row label={t('sys.memory')} value={bytes(d.app.memoryBytes)} />
          <Row label={t('sys.threads')} value={n(d.app.threads)} />
          <Row label={t('sys.uptime')} value={duration(d.app.uptimeSeconds, t, n)} />
          <Row label={t('sys.version')} value={d.app.version} ltr />
        </Section>

        <Section title={t('sys.database')} icon="ledger">
          <Row label={t('sys.size')} value={bytes(d.database.sizeBytes)} />
          <Row label={t('sys.connections')} value={n(d.database.connections)} />
          <Row label={t('sys.version')} value={`PostgreSQL ${d.database.version}`} ltr />
        </Section>

        <Section title={t('sys.backups')} icon="download">
          <Row label={t('sys.count')} value={n(d.backups.count)} />
          <Row label={t('sys.size')} value={bytes(d.backups.sizeBytes)} />
          <Row
            label={t('sys.latest')}
            value={d.backups.latestAt ? formatDateTime(d.backups.latestAt, locale) : '—'}
          />
        </Section>
      </div>

      <Section title={t('nav.assistant')} icon="assistant">
        <div className="flex flex-wrap gap-1.5 pb-2">
          <Status on={d.assistant.reachable} label={t('sys.aiServer')} />
          <Status on={d.assistant.chatReady} label={t('sys.aiChat')} />
          <Status on={d.assistant.visionReady} label={t('sys.aiVision')} />
          <Status on={d.assistant.speechReady} label={t('sys.aiSpeech')} />
        </div>
        {d.assistant.models.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1.5 pe-3 text-start font-medium">{t('sys.modelName')}</th>
                  <th className="py-1.5 pe-3 text-start font-medium">{t('sys.onDisk')}</th>
                  <th className="py-1.5 text-start font-medium">{t('sys.inMemory')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-line)]">
                {d.assistant.models.map((x) => (
                  <tr key={x.name}>
                    <td className="py-1.5 pe-3 font-medium">
                      <bdi>{x.name}</bdi>
                    </td>
                    <td className="py-1.5 pe-3 tnum whitespace-nowrap">{bytes(x.sizeBytes)}</td>
                    <td className="py-1.5 tnum whitespace-nowrap">
                      {x.loaded ? bytes(x.memoryBytes) : <span className="text-faint">{t('sys.notLoaded')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Gauge({
  icon,
  label,
  value,
  detail,
  percent,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  percent: number;
  tone: Tone;
}) {
  const bar = tone === 'bad' ? 'bg-destructive' : tone === 'warn' ? 'bg-warning' : 'bg-brand';
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name={icon} size={16} />
          {label}
        </span>
      </div>
      <p className={`text-2xl font-semibold tnum ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</p>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <p className="truncate text-xs text-muted tnum">{detail}</p>
    </Card>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <Card className="space-y-1">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Icon name={icon} size={16} className="text-brand" />
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-end font-medium tnum" dir={ltr ? 'ltr' : undefined}>
        {value}
      </span>
    </div>
  );
}

function Status({ on, label }: { on: boolean; label: string }) {
  return <Badge tone={on ? 'positive' : 'neutral'}>{label}</Badge>;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((1000 * part) / total) / 10 : 0;
}

function level(value: number, warn: number, bad: number): Tone {
  return value >= bad ? 'bad' : value >= warn ? 'warn' : 'ok';
}

/** Sizes in the usual units (GB, MB, …) in both languages, kept together inside Arabic text. */
function formatBytes(n: number, locale: 'ar' | 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `\u2068${formatNumber(Math.round(v * 10) / 10, locale)} ${units[i]}\u2069`;
}

function duration(
  seconds: number,
  t: ReturnType<typeof useT>['t'],
  n: (v: number) => string,
): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${n(days)} ${t('sys.days')} ${n(hours)} ${t('sys.hours')}`;
  if (hours > 0) return `${n(hours)} ${t('sys.hours')} ${n(minutes)} ${t('sys.minutes')}`;
  return `${n(minutes)} ${t('sys.minutes')}`;
}
