import { formatDate, formatMonth, type Locale } from '@skb/shared';

/**
 * Date boxes show their day in numbers, day/month/year, like every other date (owner, 2026-11-10).
 * A browser draws an <input type="date"> in its own way (month names on an iPhone, the month
 * first on many computers), so every date and month box on any page gets `data-shown` with the
 * app's text, and index.css draws that over the browser's own (where the browser allows it; else
 * its own text stays). Nothing on a page needs a change: boxes are found as they appear, and kept
 * up as their value or the screen language changes.
 */
const BOXES = 'input[type="date"], input[type="month"]';

function paint(box: HTMLInputElement, locale: Locale) {
  const v = box.value;
  const shown = !v ? '' : box.type === 'month' ? formatMonth(v, locale) : formatDate(v, locale);
  if (box.getAttribute('data-shown') !== shown) box.setAttribute('data-shown', shown);
}

export function watchDateBoxes() {
  const locale = (): Locale => (document.documentElement.lang === 'en' ? 'en' : 'ar');
  const isBox = (n: unknown): n is HTMLInputElement =>
    n instanceof HTMLInputElement && (n.type === 'date' || n.type === 'month');
  const all = () =>
    document.querySelectorAll<HTMLInputElement>(BOXES).forEach((b) => paint(b, locale()));
  // Typed or picked: at once.
  const changed = (e: Event) => isBox(e.target) && paint(e.target, locale());
  document.addEventListener('input', changed, true);
  document.addEventListener('change', changed, true);
  // New boxes, and values set by the page (React keeps the value attribute with the value).
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (isBox(r.target)) paint(r.target, locale());
        continue;
      }
      r.addedNodes.forEach((n) => {
        if (isBox(n)) paint(n, locale());
        else if (n instanceof Element)
          n.querySelectorAll<HTMLInputElement>(BOXES).forEach((b) => paint(b, locale()));
      });
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['value', 'type'],
  });
  // The screen language.
  new MutationObserver(all).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
  all();
}
