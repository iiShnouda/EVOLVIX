import type { CSSProperties } from 'react';
import { create } from 'zustand';
import { usePrefs } from '../stores/prefs';
import { useBranding } from './queries';
import { companyLogoUrl } from '../components/CompanyBadge';

const KEY = 'skb.backdrop';

/**
 * A background picture picked from this device. It is a look preference like the theme, so it is
 * kept only in this browser (shrunk to a small JPEG) and is never sent to the server: nothing is
 * stored as a file there and no path to one ever reaches the app.
 */
const useCustom = create<{ image: string | null; set: (image: string | null) => void }>((set) => ({
  image: (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  })(),
  set: (image) => {
    try {
      if (image) localStorage.setItem(KEY, image);
      else localStorage.removeItem(KEY);
    } catch {
      /* full or blocked storage: it shows until the app is closed */
    }
    set({ image });
  },
}));

export const useCustomBackdrop = () => useCustom((s) => s.image);
export const setCustomBackdrop = (image: string | null) => useCustom.getState().set(image);

/** A picked photo, made a small JPEG data URL (at most 1920 px). Only real images are read. */
export async function backdropFromFile(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('type');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * The page background with the chosen picture under a veil of the theme's own canvas colour, so
 * text and cards stay readable in light and dark.
 */
export function useBackdropStyle(): CSSProperties | undefined {
  const backdrop = usePrefs((s) => s.backdrop);
  const strength = usePrefs((s) => s.backdropStrength);
  const custom = useCustomBackdrop();
  const branding = useBranding();
  const logo = companyLogoUrl(branding.data?.logoVersion ?? 0);

  const url =
    backdrop === 'evolvix'
      ? '/icon.svg'
      : backdrop === 'company'
        ? logo
        : backdrop === 'custom'
          ? custom
          : null;
  if (!url) return undefined;
  const veil = `color-mix(in oklab, var(--c-canvas) ${100 - strength}%, transparent)`;
  const photo = backdrop === 'custom';
  return {
    backgroundImage: `linear-gradient(${veil}, ${veil}), url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: photo ? 'cover, cover' : 'cover, min(60vmin, 520px)',
    backgroundAttachment: 'fixed',
  };
}
