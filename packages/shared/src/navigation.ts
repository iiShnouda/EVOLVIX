import type { Permission } from './types';
import type { TranslationKey } from './i18n';

/** Icon name understood by the web app's local icon set (no emoji as UI symbols). */
export type IconName =
  | 'dashboard'
  | 'server'
  | 'update'
  | 'upload'
  | 'key'
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
  | 'payroll'
  | 'themes'
  | 'chat'
  | 'assistant';

export interface NavItem {
  /** Stable route key, also used as the presence "currentView" identifier. */
  key: string;
  /** i18n label key. */
  labelKey: TranslationKey;
  icon: IconName;
  path: string;
  /** Permission required to see the item, if any. */
  permission?: Permission;
  /** …or any one of these instead. */
  anyOf?: Permission[];
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
    // The old program's كشف الحساب: any customer's or supplier's account, picked by code.
    key: 'statement',
    labelKey: 'nav.statement',
    icon: 'ledger',
    path: '/statement',
    permission: 'ledger:view',
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
    key: 'handovers',
    labelKey: 'nav.handovers',
    icon: 'receipts',
    path: '/handovers',
    permission: 'cash:handover_send',
    anyOf: ['cash:handover_receive'],
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
    key: 'chat',
    labelKey: 'nav.chat',
    icon: 'chat',
    path: '/chat',
    anyOf: ['chat:use', 'chat:monitor'],
  },
  {
    key: 'assistant',
    labelKey: 'nav.assistant',
    icon: 'assistant',
    path: '/assistant',
    permission: 'ai:chat',
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
  // The owner's server monitor (owner, 2026-10-10).
  {
    key: 'system',
    labelKey: 'nav.system',
    icon: 'server',
    path: '/system',
    permission: 'system:monitor',
  },
  // The owner's updates: a new version, what it brings, updating (owner, 2026-10-11).
  {
    key: 'updates',
    labelKey: 'nav.updates',
    icon: 'update',
    path: '/updates',
    permission: 'system:update',
  },
  // The owner's bulk import from an Excel file (owner, 2026-10-14).
  {
    key: 'import',
    labelKey: 'nav.import',
    icon: 'upload',
    path: '/import',
    permission: 'data:import',
  },
  // The owner's licence: users bought, end date, entering a code (owner, 2026-10-15).
  {
    key: 'license',
    labelKey: 'nav.license',
    icon: 'key',
    path: '/license',
    permission: 'license:manage',
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
  // Each person's own look (owner, 2026-10-01): no permission, it changes nothing but their screen.
  {
    key: 'themes',
    labelKey: 'nav.themes',
    icon: 'themes',
    path: '/themes',
  },
];
