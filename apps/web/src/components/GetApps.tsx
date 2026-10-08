import { useT } from '../lib/i18n';

/** Running inside the SKB Android/Windows app, or installed to the home screen already. */
function insideApp(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return /SKBAndroid|SKBDesktop/.test(ua) || standalone;
}

/**
 * Where to get SKB as an app: the Android and Windows apps (served by this server, so they always
 * match it) and, for iPhone/iPad, adding the site to the home screen. Hidden inside the apps.
 */
export function GetApps({ compact }: { compact?: boolean }) {
  const { t } = useT();
  if (insideApp()) return null;

  const items = [
    {
      key: 'android',
      label: t('apps.android'),
      hint: t('apps.androidHint'),
      href: '/downloads/Evolvix-Android.apk',
    },
    {
      key: 'windows',
      label: t('apps.windows'),
      hint: t('apps.windowsHint'),
      href: '/downloads/Evolvix-Windows.zip',
    },
    { key: 'iphone', label: t('apps.iphone'), hint: t('apps.iphoneHint'), href: null },
  ];

  if (compact) {
    return (
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{t('apps.title')}:</span>
        {items.map((i) =>
          i.href ? (
            <a
              key={i.key}
              href={i.href}
              download
              className="font-medium text-brand hover:underline"
            >
              {i.label}
            </a>
          ) : (
            <span key={i.key} title={i.hint}>
              {i.label} — {t('apps.iphoneShort')}
            </span>
          ),
        )}
      </p>
    );
  }

  return (
    <ul className="space-y-3 text-sm">
      {items.map((i) => (
        <li key={i.key}>
          {i.href ? (
            <a href={i.href} download className="font-medium text-brand hover:underline">
              {i.label}
            </a>
          ) : (
            <span className="font-medium">{i.label}</span>
          )}
          <span className="block text-xs text-muted">{i.hint}</span>
        </li>
      ))}
    </ul>
  );
}
