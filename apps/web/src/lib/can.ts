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

/** `canAny('a', 'b')` — whether the signed-in user holds any one of these (only shapes the UI). */
export function useCanAny(): (...permissions: Permission[]) => boolean {
  const can = useCan();
  return (...permissions) => permissions.some(can);
}

/**
 * Whether a party's statement opens for this person: customers', suppliers' and shipping companies'
 * statements are a permission each (owner, 2026-10-23).
 */
export function mayOpenStatement(
  party: { types: string[] },
  can: (permission: Permission) => boolean,
): boolean {
  return (
    (party.types.includes('CUSTOMER') && can('statement:customers')) ||
    (party.types.includes('SUPPLIER') && can('statement:suppliers')) ||
    (party.types.includes('CARRIER') && can('statement:carriers'))
  );
}

/**
 * Who opens a customer's invoices together: whoever prints them, and whoever gives discounts, since
 * every kind of discount is given there (owner, 2026-10-24).
 */
export const TOGETHER_PERMISSIONS: Permission[] = [
  'sales:together',
  'sales:discount',
  'sales:discount_line',
  'sales:discount_combined',
];

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
