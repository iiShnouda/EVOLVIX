import type { Permission } from './types';
import { ALL_PERMISSIONS } from './roles';

/** Every permission starting with one of these, and these. */
function of(prefixes: string[], more: Permission[] = []): Permission[] {
  return ALL_PERMISSIONS.filter((p) => prefixes.some((x) => p.startsWith(x)) || more.includes(p));
}

/**
 * Lists several pages read (owner, 2026-10-23: every permission works on its own). The server's
 * Lookups.cs opens each for anyone holding one of these; keep both in lockstep.
 */
export const LOOKUPS = {
  /** Customers, suppliers and shipping companies: pickers, filters and their files. */
  parties: of(
    [
      'parties:',
      'sales:',
      'purchases:',
      'delivery:',
      'shipments:',
      'settlements:',
      'notes:',
      'reports:',
    ],
    [
      'statement:customers',
      'statement:suppliers',
      'statement:carriers',
      'vouchers:view',
      'receipts:create',
      'payments:create',
      'expenses:create',
      'vouchers:discount',
      'price_lists:view',
      'price_lists:customers',
      'inventory:view',
      'products:create',
      'products:edit',
      'inventory:valuation_suppliers',
      'labels:print',
      'ai:scan_purchase',
      'ai:scan_cheques',
    ],
  ),
  /** Items: the item finder, pickers and filters. */
  products: of(
    [
      'inventory:',
      'products:',
      'transfers:',
      'price_lists:',
      'quantity_breaks:',
      'labels:',
      'sales:',
      'purchases:',
    ],
    [
      'prices:edit',
      'reports:items',
      'reports:profit',
      'statement:warehouses',
      'ai:scan_purchase',
      'ai:scan_stocktake',
    ],
  ),
  /** Cash boxes, banks and wallets: where money goes in or out. */
  moneyAccounts: of(
    ['money:', 'vouchers:', 'money_accounts:'],
    [
      'receipts:create',
      'payments:create',
      'expenses:create',
      'cash:transfer',
      'sales:approve',
      'delivery:settle',
      'notes:deposit',
      'notes:collect',
      'notes:pay',
      'notes:bounce',
      'payroll:pay',
      'payroll:advance',
      'statement:money',
      'staff:access',
    ],
  ),
  /** Price lists and quantity discounts. */
  priceLists: of(['price_lists:', 'quantity_breaks:'], ['parties:set_price_level']),
} satisfies Record<string, Permission[]>;
