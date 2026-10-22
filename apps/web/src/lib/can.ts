import type { Permission } from '@skb/shared';
import { useAuth } from '../stores/auth';
import { usePreferences } from './queries';

const NONE: Permission[] = [];

/** The preference that shows profit to someone allowed to see it. */
export const SHOW_COSTS_KEY = 'show:costs';

/**
 * `can('prices:edit')` — whether the signed-in user holds a permission. Only shapes the UI: the
 * server checks every request on its own.
 *
 * `profit:view` is also the person's own choice (owner, 2026-10-02; profit only since 2026-10-17):
 * profit stays hidden on every screen and printout until someone allowed to see it turns it on from
 * the account menu (so it doesn't show while selling in front of a customer). Supply prices
 * (`costs:view`) are a permission of their own, shown whenever it is held.
 */
export function useCan(): (permission: Permission) => boolean {
  const permissions = useAuth((s) => s.user?.permissions ?? NONE);
  const prefs = usePreferences();
  const showCosts = prefs.data?.[SHOW_COSTS_KEY] === '1';
  return (permission) =>
    permissions.includes(permission) && (permission !== 'profit:view' || showCosts);
}

/** Whether the person may see profit at all (whatever they chose to show). */
export function useMaySeeProfit(): boolean {
  return useAuth((s) => s.user?.permissions ?? NONE).includes('profit:view');
}

/**
 * Whoever may go past the company's rules after a warning (rules:override, owner 2026-10-22: the
 * owner, and anyone it is given to); the server decides too.
 */
export function useMayOverride(): boolean {
  return useAuth((s) => s.user?.permissions ?? NONE).includes('rules:override');
}
