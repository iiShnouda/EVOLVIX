import { NAV_ITEMS, mayOpen, type Permission } from '@skb/shared';
import { useAuth } from '../stores/auth';

const NONE: Permission[] = [];

/**
 * Where this person starts: the first page of the menu they may open, the dashboard for most
 * (owner, 2026-10-23: nobody needs any one permission, so the dashboard may not be theirs). Someone
 * with no page at all lands on their own look (Themes), which needs none.
 */
export function useHomePath(): string {
  const permissions = useAuth((s) => s.user?.permissions ?? NONE);
  return NAV_ITEMS.find((i) => i.anyOf && mayOpen(i, permissions))?.path ?? '/themes';
}
