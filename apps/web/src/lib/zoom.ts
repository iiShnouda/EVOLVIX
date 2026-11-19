import { useEffect } from 'react';
import { usePrefs } from '../stores/prefs';

/**
 * The app's own zoom (owner, 2026-11-18), like the browser's: 70%–150%, kept on this device as a
 * UI preference. It sets the root font size (index.css: every size is in rem), so the page keeps
 * the screen's whole width and lays itself out again: smaller shows more, bigger wraps. The
 * breakpoints and the device class (lib/device.ts) follow the width in zoomed pixels.
 * public/boot.js sets it before the first paint; printing ignores it.
 */
export const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** A zoom kept in range and on a step; anything unknown is 100%. */
export function cleanZoom(z: unknown): number {
  const n = typeof z === 'number' && Number.isFinite(z) ? z : 1;
  return ZOOM_STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1);
}

/** The zoom the page shows now. */
export function currentZoom(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(document.documentElement.style.getPropertyValue('--app-zoom'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** The page's width in its own (zoomed) pixels: what the layout has to fill. */
export function layoutWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth / currentZoom();
}

/** The next step in or out (dir +1 / -1). */
export function stepZoom(z: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.indexOf(cleanZoom(z) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]!;
}

/**
 * Asks the browser to measure the breakpoints again. Chrome can keep a container query's answer
 * worked out in the browser's own rem (16px) from the first layout, before the zoomed root font
 * size; switching the container off and on makes it use the zoomed one.
 */
function remeasure(): void {
  const root = document.documentElement;
  root.style.containerType = 'normal';
  void root.offsetWidth;
  root.style.removeProperty('container-type');
}

function apply(z: number): void {
  const root = document.documentElement;
  if (z === 1) root.style.removeProperty('--app-zoom');
  else root.style.setProperty('--app-zoom', String(z));
  remeasure();
  // The layout's width changed without the window's: let what measures it (device class, charts) know.
  window.dispatchEvent(new Event('resize'));
}

/**
 * Applies the zoom preference and takes Ctrl/⌘ with + − 0 from the browser's (and the Windows
 * app's) own zoom, which would shrink the page instead of laying it out again.
 */
export function useAppZoom(): void {
  const zoom = usePrefs((s) => s.zoom);
  useEffect(() => {
    if (cleanZoom(zoom) !== currentZoom()) apply(cleanZoom(zoom));
    else remeasure();
  }, [zoom]);
  useEffect(() => {
    // The first paint's answer, and again once the fonts are in.
    let frame = requestAnimationFrame(remeasure);
    void document.fonts?.ready.then(() => {
      frame = requestAnimationFrame(remeasure);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const { zoom: z, setZoom } = usePrefs.getState();
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') setZoom(stepZoom(z, 1));
      else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')
        setZoom(stepZoom(z, -1));
      else if (e.key === '0' || e.code === 'Numpad0') setZoom(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
