import { useRef, useState, type ReactNode } from 'react';
import type { ThemeMode } from '@skb/shared';
import { Button, Card, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { CompanyMark } from '../components/CompanyBadge';
import { useT } from '../lib/i18n';
import { useBranding } from '../lib/queries';
import { backdropFromFile, setCustomBackdrop, useCustomBackdrop } from '../lib/backdrop';
import {
  BACKDROPS,
  QUICK_SHAPES,
  SKINS,
  resolveTheme,
  usePrefs,
  type QuickShape,
  type Skin,
} from '../stores/prefs';

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
                theme === m
                  ? 'bg-surface font-semibold text-fg shadow-sm'
                  : 'text-muted hover:text-fg'
              }`}
            >
              <Icon name={m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'settings'} size={15} />
              {t(`themes.${m}`)}
            </button>
          ))}
        </div>
      </Card>

      <BackdropPicker />

      <QuickShapePicker />

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

/**
 * The quick-action button's shape (owner, 2026-10-11): each card draws a small screen with the
 * button on it; picking one changes it at once.
 */
function QuickShapePicker() {
  const { t, rtl } = useT();
  const { quickShape, setQuickShape } = usePrefs();
  const side = rtl ? 'right-0' : 'left-0';
  const draw: Record<QuickShape, ReactNode> = {
    dock: (
      <span
        className={`absolute top-1/2 ${side} flex h-7 w-4 -translate-y-1/2 items-center justify-center bg-brand ${
          rtl ? 'rounded-s-lg' : 'rounded-e-lg'
        }`}
      >
        <span className="h-3 w-0.5 rounded-full bg-brand-fg/70" />
      </span>
    ),
    bubble: (
      <span
        className={`absolute top-1/2 ${rtl ? '-right-3' : '-left-3'} grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-fg shadow-md ring-2 ring-fg/10`}
      >
        <Logo size={16} className="rounded-md" />
      </span>
    ),
  };
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">{t('themes.quickShape')}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK_SHAPES.map((shape) => {
          const on = (quickShape === 'bubble' ? 'bubble' : 'dock') === shape;
          return (
            <button
              key={shape}
              type="button"
              aria-pressed={on}
              onClick={() => setQuickShape(shape)}
              className={`rounded-[var(--radius-app)] border p-2 text-start transition-colors ${
                on ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-brand/50'
              }`}
            >
              <span className="relative block h-24 overflow-hidden rounded-lg border border-line bg-surface-2">
                <span className="absolute inset-x-3 top-3 block h-2 rounded bg-line" />
                <span className="absolute inset-x-3 top-7 block h-2 w-2/3 rounded bg-line" />
                <span className="absolute inset-x-3 top-11 block h-2 w-1/2 rounded bg-line" />
                {draw[shape]}
              </span>
              <span className="mt-2 flex items-center justify-between gap-2 px-1 text-sm font-medium">
                {t(`themes.quick.${shape}`)}
                {on && <Icon name="check" size={16} className="text-brand" />}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * A picture behind every page (owner, 2026-10-01): none, the Evolvix mark, the company's logo, or
 * one from this device, which stays on the device and is never uploaded.
 */
function BackdropPicker() {
  const { t } = useT();
  const { backdrop, setBackdrop, backdropStrength, setBackdropStrength } = usePrefs();
  const custom = useCustomBackdrop();
  const hasLogo = (useBranding().data?.logoVersion ?? 0) > 0;
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(false);
    try {
      setCustomBackdrop(await backdropFromFile(file));
      setBackdrop('custom');
    } catch {
      setError(true);
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const preview = (id: (typeof BACKDROPS)[number]) =>
    id === 'evolvix' ? (
      <Logo size={44} />
    ) : id === 'company' ? (
      <CompanyMark size={44} />
    ) : id === 'custom' && custom ? (
      <img src={custom} alt="" className="h-full w-full object-cover" />
    ) : id === 'custom' ? (
      <Icon name="plus" size={22} className="text-muted" />
    ) : (
      <Icon name="close" size={20} className="text-faint" />
    );

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">{t('themes.backdrop')}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BACKDROPS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={backdrop === id}
            disabled={id === 'company' && !hasLogo}
            onClick={() => (id === 'custom' && !custom ? input.current?.click() : setBackdrop(id))}
            className={`overflow-hidden rounded-[var(--radius-app)] border-2 text-start disabled:opacity-50 ${
              backdrop === id ? 'border-brand' : 'border-line hover:border-brand/50'
            }`}
          >
            <span className="grid h-20 place-items-center overflow-hidden bg-surface-2">
              {preview(id)}
            </span>
            <span className="block px-2.5 py-2 text-sm font-medium">{t(`themes.bd.${id}`)}</span>
          </button>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" icon="plus" onClick={() => input.current?.click()}>
          {t('themes.bd.pick')}
        </Button>
        {backdrop !== 'none' && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">{t('themes.bd.strength')}</span>
            <input
              type="range"
              min={4}
              max={40}
              value={backdropStrength}
              onChange={(e) => setBackdropStrength(Number(e.target.value))}
            />
            <span className="w-10 tnum text-xs text-muted">{backdropStrength}%</span>
          </label>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{t('themes.bd.bad')}</p>}
    </Card>
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
      <div
        data-ui="sidebar"
        className="w-24 shrink-0 space-y-1 border-e border-line bg-surface p-2"
      >
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
