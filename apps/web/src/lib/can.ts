import type { Permission } from '@skb/shared';
import { useAuth } from '../stores/auth';
import { usePreferences } from './queries';

const NONE: Permission[] = [];

/** The preference that shows supply prices (cost) and profit to someone allowed to see them. */
export const SHOW_COSTS_KEY = 'show:costs';

/**
 * `can('prices:edit')` — whether the signed-in user holds a permission. Only shapes the UI: the
 * server checks every request on its own.
 *
 * `costs:view` is also the person's own choice (owner, 2026-10-02): supply prices, cost and profit
 * stay hidden on every screen and printout until someone allowed to see them turns them on from
 * the account menu (so they don't show while selling in front of a customer).
 */
export function useCan(): (permission: Permission) => boolean {
  const permissions = useAuth((s) => s.user?.permissions ?? NONE);
  const prefs = usePreferences();
  const showCosts = prefs.data?.[SHOW_COSTS_KEY] === '1';
  return (permission) =>
    permissions.includes(permission) && (permission !== 'costs:view' || showCosts);
}

/** Whether the person may see costs at all (whatever they chose to show). */
export function useMaySeeCosts(): boolean {
  return useAuth((s) => s.user?.permissions ?? NONE).includes('costs:view');
}
