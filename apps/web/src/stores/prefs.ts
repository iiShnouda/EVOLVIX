import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { directionForLocale, type Locale, type ThemeMode } from '@skb/shared';

/** The look themes (Themes page); colours, shapes and effects live in skins.css. */
export const SKINS = ['evolvix', 'ocean', 'forest', 'sunset', 'royal', 'valorant'] as const;
export type Skin = (typeof SKINS)[number];

interface PrefsState {
  locale: Locale;
  theme: ThemeMode;
  /** The look theme; a UI preference like the theme mode, so it stays on this device. */
  skin: Skin;
  setSkin: (skin: Skin) => void;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  setTheme: (theme: ThemeMode) => void;
}

/**
 * UI preferences are the ONLY thing we persist on the device (locale + theme). No business
 * data is ever stored locally — that is a security requirement of this app.
 */
export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      locale: 'en',
      theme: 'system',
      skin: 'evolvix',
      setSkin: (skin) => set({ skin }),
      setLocale: (locale) => set({ locale }),
      toggleLocale: () => set({ locale: get().locale === 'en' ? 'ar' : 'en' }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'skb.prefs' },
  ),
);

/** Resolve the effective theme (light/dark) accounting for the system preference. */
export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
}

/** Apply locale (dir/lang), theme mode and look theme to the <html> element. */
export function applyDocumentPrefs(locale: Locale, theme: ThemeMode, skin: Skin = 'evolvix'): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionForLocale(locale);
  root.setAttribute('data-theme', resolveTheme(theme));
  root.setAttribute('data-skin', SKINS.includes(skin) ? skin : 'evolvix');
  // The phone's status bar follows the theme's top bar.
  const surface = getComputedStyle(root).getPropertyValue('--c-surface').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && surface.startsWith('#')) meta.setAttribute('content', surface);
}
