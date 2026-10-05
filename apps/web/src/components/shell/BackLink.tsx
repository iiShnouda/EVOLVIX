import { useEffect, useRef, useState } from 'react';
import { useNavigate, type Location } from 'react-router-dom';
import { NAV_ITEMS, type TranslationKey } from '@skb/shared';
import { Icon } from '../Icon';
import { useT } from '../../lib/i18n';
import { isFromMenu, isTabSwitch } from '../../lib/tabs';

/** Pages that are not in the menu, by the start of their path, and their name. */
const EXTRA_PAGES: [string, TranslationKey][] = [
  ['/sales/new', 'dashboard.newInvoice'],
  ['/sales/together', 'together.title'],
  ['/receipts/move', 'move.title'],
  ['/notes/receive', 'notes.receive'],
  ['/notes/issue', 'notes.issue'],
];

/** The name of the page at a path: its menu item, or one of the pages above. */
export function pageName(path: string, t: (k: TranslationKey) => string): string | null {
  if (/^\/parties\/[^/]+\/account/.test(path)) return t('account.statement');
  const extra = EXTRA_PAGES.find(([p]) => path === p || path.startsWith(`${p}/`));
  if (extra) return t(extra[1]);
  const item = [...NAV_ITEMS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((i) =>
      i.path === '/' ? path === '/' : path === i.path || path.startsWith(`${i.path}/`),
    );
  return item ? t(item.labelKey) : null;
}

/**
 * "Back to <page>" (owner, 2026-10-02, refined 2026-10-05): only when a button on a page led to
 * this one — never for a page opened from the menu. Each tab keeps its own way back, and going
 * back returns to exactly where the person was (with its filters).
 */
export function BackLink({ location }: { location: Location }) {
  const { t } = useT();
  const navigate = useNavigate();
  // The pages visited in this tab, oldest first (the same page with other filters is one entry).
  const trail = useRef<{ path: string; full: string }[]>([]);
  const [from, setFrom] = useState<{ path: string; full: string } | null>(null);

  useEffect(() => {
    if (isTabSwitch(location.state)) return;
    const here = { path: location.pathname, full: location.pathname + location.search };
    const stack = trail.current;
    const top = stack[stack.length - 1];
    if (isFromMenu(location.state)) stack.splice(0, stack.length, here);
    else if (stack.length >= 2 && stack[stack.length - 2]!.path === here.path) stack.pop();
    else if (top?.path === here.path) stack[stack.length - 1] = here;
    else stack.push(here);
    if (stack.length > 30) stack.shift();
    setFrom(stack.length >= 2 ? stack[stack.length - 2]! : null);
  }, [location.pathname, location.search, location.state]);

  if (!from || from.path === location.pathname) return null;
  const name = pageName(from.path, t);
  if (!name) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(from.full)}
      className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-brand hover:bg-brand-soft"
    >
      <Icon name="chevronRight" size={16} className="rotate-180" />
      {t('nav.backTo')} {name}
    </button>
  );
}
