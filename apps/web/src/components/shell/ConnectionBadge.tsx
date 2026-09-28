import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { useConnection } from '../../stores/connection';
import type { Tone } from '../ui';

const MAP: Record<
  string,
  { tone: Tone; icon: string; key: 'conn.online' | 'conn.connecting' | 'conn.offline' }
> = {
  online: { tone: 'positive', icon: 'wifi', key: 'conn.online' },
  connecting: { tone: 'warning', icon: 'wifi', key: 'conn.connecting' },
  offline: { tone: 'destructive', icon: 'wifiOff', key: 'conn.offline' },
};

const DOT: Record<Tone, string> = {
  positive: 'bg-positive',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  neutral: 'bg-faint',
  info: 'bg-info',
  brand: 'bg-brand',
};

export function ConnectionBadge({ showLabel = true }: { showLabel?: boolean }) {
  const { t } = useT();
  const state = useConnection((s) => s.state);
  const cfg = MAP[state] ?? MAP.offline!;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted"
      title={t(cfg.key)}
    >
      <span
        className={`h-2 w-2 rounded-full ${DOT[cfg.tone]} ${state === 'connecting' ? 'animate-pulse' : ''}`}
      />
      {showLabel ? <span>{t(cfg.key)}</span> : <Icon name={cfg.icon} size={14} />}
    </span>
  );
}
