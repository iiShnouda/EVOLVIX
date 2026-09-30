import type { Permission } from './types';
import type { TranslationKey } from './i18n';

/** Icon name understood by the web app's local icon set (no emoji as UI symbols). */
export type IconName =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'receipts'
  | 'parties'
  | 'inventory'
  | 'staff'
  | 'branches'
  | 'analytics'
  | 'settings'
  | 'more'
  | 'audit'
  | 'presence'
  | 'delivery'
  | 'ledger'
  | 'notes'
  | 'payroll';

export interface NavItem {
  /** Stable route key, also used as the presence "currentView" identifier. */
  key: string;
  /** i18n label key. */
  labelKey: TranslationKey;
  icon: IconName;
  path: string;
  /** Permission required to see the item, if any. */
  permission?: Permission;
  /** Show in the phone bottom tab bar (max 4 + a "More" tab). */
  primaryOnPhone?: boolean;
}

/**
 * Single source of truth for the module hierarchy. Every device shell renders from this:
 *  - desktop/iPad: full sidebar
 *  - tablet: nav rail
 *  - phone: `primaryOnPhone` items in the bottom bar; the rest under "More".
 */
export const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    labelKey: 'nav.dashboard',
    icon: 'dashboard',
    path: '/dashboard',
    permission: 'dashboard:view',
    primaryOnPhone: true,
  },
  {
    key: 'sales',
    labelKey: 'nav.sales',
    icon: 'sales',
    path: '/sales',
    permission: 'sales:view',
    primaryOnPhone: true,
  },
  {
    key: 'inventory',
    labelKey: 'nav.inventory',
    icon: 'inventory',
    path: '/inventory',
    permission: 'inventory:view',
    primaryOnPhone: true,
  },
  {
    key: 'parties',
    labelKey: 'nav.parties',
    icon: 'parties',
    path: '/parties',
    permission: 'parties:view',
    primaryOnPhone: true,
  },
  {
    key: 'deliveries',
    labelKey: 'nav.deliveries',
    icon: 'delivery',
    path: '/deliveries',
    permission: 'delivery:view',
  },
  {
    key: 'purchases',
    labelKey: 'nav.purchases',
    icon: 'purchases',
    path: '/purchases',
    permission: 'purchases:view',
  },
  {
    key: 'receipts',
    labelKey: 'nav.receipts',
    icon: 'receipts',
    path: '/receipts',
    permission: 'receipts:view',
  },
  {
    key: 'notes',
    labelKey: 'nav.notes',
    icon: 'notes',
    path: '/notes',
    permission: 'notes:view',
  },
  {
    key: 'ledger',
    labelKey: 'nav.ledger',
    icon: 'ledger',
    path: '/ledger',
    permission: 'ledger:view',
  },
  {
    key: 'payroll',
    labelKey: 'nav.payroll',
    icon: 'payroll',
    path: '/payroll',
    permission: 'payroll:view',
  },
  {
    key: 'analytics',
    labelKey: 'nav.analytics',
    icon: 'analytics',
    path: '/analytics',
    permission: 'analytics:view',
  },
  {
    key: 'staff',
    labelKey: 'nav.staff',
    icon: 'staff',
    path: '/staff',
    permission: 'staff:view',
  },
  {
    key: 'branches',
    labelKey: 'nav.branches',
    icon: 'branches',
    path: '/branches',
    permission: 'branches:view',
  },
  {
    key: 'presence',
    labelKey: 'nav.presence',
    icon: 'presence',
    path: '/presence',
    permission: 'presence:view',
  },
  {
    key: 'audit',
    labelKey: 'nav.audit',
    icon: 'audit',
    path: '/audit',
    permission: 'audit:view',
  },
  {
    key: 'settings',
    labelKey: 'nav.settings',
    icon: 'settings',
    path: '/settings',
    permission: 'settings:view',
  },
];
