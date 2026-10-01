import type { ThemeMode } from '@skb/shared';
import { Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { SKINS, resolveTheme, usePrefs, type Skin } from '../stores/prefs';

const MODES: ThemeMode[] = ['light', 'dark', 'system'];

/**
 * Themes (owner, 2026-10-01): each person picks how the app looks: colours, shapes and effects
 * (skins.css). Every card previews its theme in the chosen light/dark mode; picking one applies it
 * at once. It is a UI preference, so it stays on this device like the light/dark choice.
 */
export function ThemesPage() {
  const { t, rtl } = useT();
  const { theme, setTheme, skin, setSkin } = usePrefs();
  const mode = resolveTheme(theme);

  return (
    <div className="space-y-5">
      <PageHeader title={t('themes.title')} />

      <Card className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{t('themes.mode')}</span>
        <div className="inline-flex rounded-[var(--radius-app)] border border-line bg-surface-2 p-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={theme === m}
              onClick={() => setTheme(m)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius-app)-2px)] px-3 text-sm ${
                theme === m ? 'bg-surface font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon name={m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'settings'} size={15} />
              {t(`themes.${m}`)}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SKINS.map((id) => (
          <SkinCard
            key={id}
            id={id}
            mode={mode}
            rtl={rtl}
            active={skin === id}
            onPick={() => setSkin(id)}
          />
        ))}
      </div>
    </div>
  );
}

function SkinCard({
  id,
  mode,
  rtl,
  active,
  onPick,
}: {
  id: Skin;
  mode: 'light' | 'dark';
  rtl: boolean;
  active: boolean;
  onPick: () => void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`group overflow-hidden rounded-[var(--radius-app)] border-2 bg-surface text-start transition-shadow hover:shadow-[var(--shadow-pop)] ${
        active ? 'border-brand' : 'border-line'
      }`}
    >
      <SkinPreview id={id} mode={mode} rtl={rtl} />
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="font-semibold">{t(`skin.${id}`)}</p>
          <p className="mt-0.5 text-xs text-muted">{t(`skin.${id}.desc`)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            active ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-muted group-hover:text-fg'
          }`}
        >
          {active ? t('themes.inUse') : t('themes.use')}
        </span>
      </div>
    </button>
  );
}

/** A small page drawn in the theme itself: side menu, title, a card and a button. */
function SkinPreview({ id, mode, rtl }: { id: Skin; mode: 'light' | 'dark'; rtl: boolean }) {
  const { t } = useT();
  return (
    <div
      data-skin-preview=""
      data-skin={id}
      data-theme={mode}
      dir={rtl ? 'rtl' : 'ltr'}
      aria-hidden="true"
      className="pointer-events-none flex h-44 select-none overflow-hidden border-b border-line"
    >
      <div data-ui="sidebar" className="w-24 shrink-0 space-y-1 border-e border-line bg-surface p-2">
        <div className="mb-2 h-2 w-12 rounded-full bg-brand" />
        {[true, false, false].map((on, i) => (
          <div
            key={i}
            data-ui="nav"
            aria-current={on ? 'page' : undefined}
            className={`flex items-center gap-1 rounded-[var(--radius-app)] px-1.5 py-1 text-[10px] ${
              on ? 'bg-brand-soft text-brand' : 'text-muted'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {on ? t('themes.sample') : <span className="h-1.5 w-8 rounded-full bg-surface-2" />}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-2 p-3">
        <p data-ui="title" className="text-base font-semibold leading-tight">
          {t('themes.sample')}
        </p>
        <div
          data-ui="card"
          className="space-y-1.5 rounded-[var(--radius-app)] border border-line bg-surface p-2.5 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium">{t('themes.sampleLine')} #1042</span>
            <span className="tnum text-positive">12,450</span>
          </div>
          <div className="h-1.5 w-3/4 rounded-full bg-surface-2" />
          <div className="h-1.5 w-1/2 rounded-full bg-surface-2" />
        </div>
        <span
          data-ui="btn"
          data-variant="primary"
          className="inline-flex h-7 items-center rounded-[var(--radius-app)] bg-brand px-3 text-[11px] font-medium text-brand-fg"
        >
          {t('themes.sampleButton')}
        </span>
      </div>
    </div>
  );
}
