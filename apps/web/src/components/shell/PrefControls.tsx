import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { resolveTheme, usePrefs } from '../../stores/prefs';

/** Language + theme controls, usable before and after sign-in. */
export function PrefControls({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const { locale, toggleLocale, theme, setTheme } = usePrefs();
  const effective = resolveTheme(theme);

  const cycleTheme = () => setTheme(effective === 'dark' ? 'light' : 'dark');

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={toggleLocale}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        title={t('pref.language')}
        aria-label={t('pref.language')}
      >
        <Icon name="globe" size={18} />
        {!compact && <span>{locale === 'en' ? 'EN' : 'ع'}</span>}
      </button>
      <button
        onClick={cycleTheme}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        title={t('pref.theme')}
        aria-label={t('pref.theme')}
      >
        <Icon name={effective === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
    </div>
  );
}
