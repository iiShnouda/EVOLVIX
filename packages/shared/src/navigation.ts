import type { Permission } from './types';
import { groupPermissions } from './permissions';
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
  | 'assistant'
  | 'layers';

export interface NavItem {
  /** Stable route key, also used as the presence "currentView" identifier. */
  key: string;
  /** i18n label key. */
  labelKey: TranslationKey;
  icon: IconName;
  path: string;
  /**
   * Shown to whoever holds any one of these (owner, 2026-10-23: no page needs one permission to
   * open; it shows the parts the person may use). Unset = everyone.
   */
  anyOf?: Permission[];
  /** Show in the phone bottom tab bar (max 4 + a "More" tab). */
  primaryOnPhone?: boolean;
}

/** A part of the menu: a heading and its pages. */
export interface NavSection {
  key: string;
  /** Unset for the first part (the dashboard), which has no heading. */
  labelKey?: TranslationKey;
  items: NavItem[];
}

/** A group's permissions, but those that only change how something else is done. */
function opens(group: string, except: Permission[] = []): Permission[] {
  return groupPermissions(group).filter((p) => !except.includes(p));
}

/**
 * Single source of truth for the module hierarchy, in the order people work (owner, 2026-10-23:
 * the program laid out logically). Every device shell renders from this:
 *  - desktop/iPad: full sidebar, a heading per part
 *  - tablet: nav rail, a line between parts
 *  - phone: `primaryOnPhone` items in the bottom bar; the rest under "More", by part.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'home',
    items: [
      {
        key: 'dashboard',
        labelKey: 'nav.dashboard',
        icon: 'dashboard',
        path: '/dashboard',
        anyOf: groupPermissions('dashboard'),
        primaryOnPhone: true,
      },
    ],
  },
  {
    key: 'trade',
    labelKey: 'navSection.trade',
    items: [
      {
        key: 'sales',
        labelKey: 'nav.sales',
        icon: 'sales',
        path: '/sales',
        anyOf: opens('sales', [
          'sales:print',
          'sales:invoice_alerts',
          'sales:change_price',
          'sales:raise_price',
          'sales:choose_price_level',
          'sales:price_basis',
          'sales:override_floor',
          'sales:discount_line',
          'sales:bonus',
          'sales:change_tax',
          'sales:additions',
          'sales:change_shipping',
        ]),
        primaryOnPhone: true,
      },
      {
        key: 'purchases',
        labelKey: 'nav.purchases',
        icon: 'purchases',
        path: '/purchases',
        anyOf: opens('purchases', [
          'purchases:print',
          'purchases:photos',
          'purchases:change_price',
          'purchases:choose_price_level',
          'purchases:discount',
          'purchases:bonus',
          'purchases:change_tax',
          'purchases:additions',
        ]),
      },
      {
        key: 'deliveries',
        labelKey: 'nav.deliveries',
        icon: 'delivery',
        path: '/deliveries',
        anyOf: groupPermissions('delivery'),
      },
    ],
  },
  {
    key: 'stock',
    labelKey: 'navSection.stock',
    items: [
      {
        key: 'inventory',
        labelKey: 'nav.inventory',
        icon: 'inventory',
        path: '/inventory',
        anyOf: opens('inventory', ['inventory:print', 'inventory:export', 'transfers:print']),
        primaryOnPhone: true,
      },
      // The item setup (departments, sub-groups, units, sizes, colors, seasons) on its own page.
      {
        key: 'setup',
        labelKey: 'nav.setup',
        icon: 'layers',
        path: '/inventory/setup',
        anyOf: groupPermissions('setup'),
      },
    ],
  },
  {
    key: 'parties',
    labelKey: 'navSection.parties',
    items: [
      {
        key: 'parties',
        labelKey: 'nav.parties',
        icon: 'parties',
        path: '/parties',
        anyOf: opens('parties', ['parties:print']),
        primaryOnPhone: true,
      },
      {
        // The old program's كشف الحساب: any customer's or supplier's account, picked by code.
        key: 'statement',
        labelKey: 'nav.statement',
        icon: 'ledger',
        path: '/statement',
        anyOf: opens('statement', ['statement:print', 'statement:export']),
      },
    ],
  },
  {
    key: 'finance',
    labelKey: 'navSection.finance',
    items: [
      {
        key: 'receipts',
        labelKey: 'nav.receipts',
        icon: 'receipts',
        path: '/receipts',
        anyOf: opens('money', [
          'money:print',
          'money:export',
          'cash:handover_send',
          'cash:handover_receive',
        ]),
      },
      {
        key: 'handovers',
        labelKey: 'nav.handovers',
        icon: 'receipts',
        path: '/handovers',
        anyOf: ['cash:handover_send', 'cash:handover_receive'],
      },
      {
        key: 'notes',
        labelKey: 'nav.notes',
        icon: 'notes',
        path: '/notes',
        anyOf: groupPermissions('notes'),
      },
      {
        key: 'ledger',
        labelKey: 'nav.ledger',
        icon: 'ledger',
        path: '/ledger',
        anyOf: opens('ledger', ['ledger:print', 'ledger:export']),
      },
    ],
  },
  {
    key: 'reports',
    labelKey: 'navSection.reports',
    items: [
      {
        key: 'analytics',
        labelKey: 'nav.analytics',
        icon: 'analytics',
        path: '/analytics',
        anyOf: opens('reports', ['reports:print', 'reports:export']),
      },
      {
        key: 'audit',
        labelKey: 'nav.audit',
        icon: 'audit',
        path: '/audit',
        anyOf: ['audit:view'],
      },
    ],
  },
  {
    key: 'people',
    labelKey: 'navSection.people',
    items: [
      {
        key: 'payroll',
        labelKey: 'nav.payroll',
        icon: 'payroll',
        path: '/payroll',
        anyOf: opens('payroll', ['payroll:print']),
      },
      {
        key: 'staff',
        labelKey: 'nav.staff',
        icon: 'staff',
        path: '/staff',
        anyOf: groupPermissions('staff'),
      },
      {
        key: 'presence',
        labelKey: 'nav.presence',
        icon: 'presence',
        path: '/presence',
        anyOf: ['presence:view'],
      },
    ],
  },
  {
    key: 'talk',
    labelKey: 'navSection.talk',
    items: [
      {
        key: 'chat',
        labelKey: 'nav.chat',
        icon: 'chat',
        path: '/chat',
        anyOf: ['chat:use', 'chat:monitor', 'chat:groups', 'chat:mute'],
      },
      {
        key: 'assistant',
        labelKey: 'nav.assistant',
        icon: 'assistant',
        path: '/assistant',
        anyOf: ['ai:chat', 'ai:voice'],
      },
    ],
  },
  {
    key: 'system',
    labelKey: 'navSection.system',
    items: [
      {
        key: 'branches',
        labelKey: 'nav.branches',
        icon: 'branches',
        path: '/branches',
        anyOf: groupPermissions('branches'),
      },
      {
        key: 'settings',
        labelKey: 'nav.settings',
        icon: 'settings',
        path: '/settings',
        anyOf: groupPermissions('settings'),
      },
      // Each person's own look (owner, 2026-10-01): no permission, it changes nothing but their screen.
      {
        key: 'themes',
        labelKey: 'nav.themes',
        icon: 'themes',
        path: '/themes',
      },
      // The owner's server monitor (owner, 2026-10-10).
      {
        key: 'system',
        labelKey: 'nav.system',
        icon: 'server',
        path: '/system',
        anyOf: ['system:monitor'],
      },
      // The owner's updates: a new version, what it brings, updating (owner, 2026-10-11).
      {
        key: 'updates',
        labelKey: 'nav.updates',
        icon: 'update',
        path: '/updates',
        anyOf: ['system:update'],
      },
      // The owner's bulk import from an Excel file (owner, 2026-10-14).
      {
        key: 'import',
        labelKey: 'nav.import',
        icon: 'upload',
        path: '/import',
        anyOf: ['data:import'],
      },
      // The owner's licence: users bought, end date, entering a code (owner, 2026-10-15).
      {
        key: 'license',
        labelKey: 'nav.license',
        icon: 'key',
        path: '/license',
        anyOf: ['license:manage'],
      },
    ],
  },
];

/** Every page of the menu, in order. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Whether the person may open this page (holds any of its permissions, or it needs none). */
export function mayOpen(item: NavItem, permissions: Permission[]): boolean {
  return !item.anyOf || item.anyOf.some((p) => permissions.includes(p));
}
