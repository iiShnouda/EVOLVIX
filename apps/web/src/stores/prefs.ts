import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { directionForLocale, type Locale, type ThemeMode } from '@skb/shared';

interface PrefsState {
  locale: Locale;
  theme: ThemeMode;
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

/** Apply locale (dir/lang) and theme to the <html> element. */
export function applyDocumentPrefs(locale: Locale, theme: ThemeMode): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionForLocale(locale);
  root.setAttribute('data-theme', resolveTheme(theme));
}
