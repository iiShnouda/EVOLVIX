import type { Permission } from './types';

/** A part of a page and the permissions it has. */
export interface PermissionSection {
  key: string;
  permissions: Permission[];
}

/** A page (or a few pages that go together) and its parts. */
export interface PermissionGroup {
  key: string;
  sections: PermissionSection[];
}

/**
 * Every permission, grouped as the accounts page shows them: by page, then by part of the page
 * (owner, 2026-10-23: every action on every page is its own permission, and none needs another).
 * Labels: `permGroup.<group>`, `permSection.<group>.<section>`, `perm.<permission>`. The server's
 * Roles.cs has the same names; keep both in lockstep.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'dashboard',
    sections: [
      {
        key: 'cards',
        permissions: [
          'dashboard:kpi_sales',
          'dashboard:kpi_purchases',
          'dashboard:kpi_receivables',
          'dashboard:kpi_payables',
          'dashboard:kpi_cash',
          'dashboard:kpi_low_stock',
          'dashboard:trend',
          'dashboard:today',
          'dashboard:month',
          'dashboard:top_items',
          'dashboard:top_customers',
          'dashboard:branches',
          'dashboard:recent',
          'dashboard:accounts',
          'dashboard:notes_due',
          'dashboard:awaiting',
          'dashboard:over_limit',
          'dashboard:low_stock',
          'dashboard:stock_value',
          'dashboard:profit',
        ],
      },
    ],
  },
  {
    key: 'sales',
    sections: [
      {
        key: 'view',
        permissions: ['sales:view', 'sales:returns_view', 'sales:together', 'sales:print'],
      },
      {
        key: 'invoices',
        permissions: [
          'sales:create',
          'sales:order',
          'sales:edit',
          'sales:cancel',
          'sales:approve',
          'sales:reject',
          'sales:lock',
          'sales:invoice_alerts',
        ],
      },
      {
        key: 'returns',
        permissions: ['sales:return', 'sales:return_free', 'sales:return_cancel'],
      },
      {
        key: 'prices_and_discounts',
        permissions: [
          'sales:change_price',
          'sales:raise_price',
          'sales:choose_price_level',
          'sales:price_basis',
          'sales:override_floor',
          'sales:discount',
          'sales:discount_line',
          'sales:discount_combined',
          'sales:bonus',
          'sales:change_tax',
          'sales:additions',
          'sales:change_shipping',
        ],
      },
    ],
  },
  {
    key: 'delivery',
    sections: [
      {
        key: 'view',
        permissions: ['delivery:view', 'shipments:view', 'settlements:view'],
      },
      {
        key: 'actions',
        permissions: [
          'delivery:status',
          'shipments:create',
          'shipments:progress',
          'shipments:return',
          'shipments:cancel',
          'delivery:settle',
        ],
      },
    ],
  },
  {
    key: 'purchases',
    sections: [
      {
        key: 'view',
        permissions: [
          'purchases:view',
          'purchases:returns_view',
          'purchases:price_sheet',
          'purchases:print',
        ],
      },
      {
        key: 'invoices',
        permissions: [
          'purchases:create',
          'purchases:photos',
          'purchases:return',
          'purchases:return_free',
          'purchases:return_cancel',
        ],
      },
      {
        key: 'prices_and_discounts',
        permissions: [
          'purchases:change_price',
          'purchases:choose_price_level',
          'purchases:discount',
          'purchases:bonus',
          'purchases:change_tax',
          'purchases:additions',
        ],
      },
    ],
  },
  {
    key: 'inventory',
    sections: [
      {
        key: 'items',
        permissions: [
          'inventory:view',
          'inventory:print',
          'inventory:export',
          'products:create',
          'products:edit',
          'products:close',
          'products:barcodes',
          'products:images',
          'prices:edit',
        ],
      },
      {
        key: 'totals',
        permissions: [
          'inventory:total_items',
          'inventory:total_quantity',
          'inventory:total_sale_value',
          'inventory:total_supply_value',
          'inventory:total_sold',
        ],
      },
      {
        key: 'item_card',
        permissions: [
          'inventory:card',
          'products:card_purchases',
          'products:card_sales',
          'products:card_returns',
          'products:card_prices',
        ],
      },
      {
        key: 'stock_valuation',
        permissions: [
          'inventory:valuation',
          'inventory:valuation_departments',
          'inventory:valuation_warehouses',
          'inventory:valuation_items',
          'inventory:valuation_prices',
          'inventory:valuation_suppliers',
        ],
      },
      {
        key: 'stocktake',
        permissions: ['inventory:stocktake_view', 'inventory:stocktake'],
      },
      {
        key: 'transfers',
        permissions: [
          'transfers:view',
          'transfers:print',
          'inventory:transfer',
          'inventory:transfer_edit',
          'inventory:transfer_receive',
          'inventory:transfer_cancel',
        ],
      },
      {
        key: 'labels',
        permissions: ['labels:print'],
      },
      {
        key: 'price_lists_and_quantity_discounts',
        permissions: [
          'price_lists:view',
          'price_lists:create',
          'price_lists:edit',
          'price_lists:prices',
          'price_lists:customers',
          'price_lists:delete',
          'quantity_breaks:view',
          'quantity_breaks:edit',
        ],
      },
    ],
  },
  {
    key: 'setup',
    sections: [
      {
        key: 'departments',
        permissions: [
          'departments:create',
          'departments:edit',
          'departments:close',
          'departments:delete',
        ],
      },
      {
        key: 'sub_groups',
        permissions: ['groups:create', 'groups:edit', 'groups:close', 'groups:delete'],
      },
      {
        key: 'units',
        permissions: ['units:create', 'units:edit', 'units:close', 'units:delete'],
      },
      {
        key: 'sizes',
        permissions: ['sizes:create', 'sizes:edit', 'sizes:close', 'sizes:delete'],
      },
      {
        key: 'colors',
        permissions: ['colors:create', 'colors:edit', 'colors:close', 'colors:delete'],
      },
      {
        key: 'seasons',
        permissions: ['seasons:create', 'seasons:edit', 'seasons:delete'],
      },
    ],
  },
  {
    key: 'parties',
    sections: [
      {
        key: 'view',
        permissions: ['parties:view', 'parties:contact', 'parties:id_cards_view', 'parties:print'],
      },
      {
        key: 'adding_and_changing',
        permissions: [
          'parties:create_customer',
          'parties:create_supplier',
          'parties:create_carrier',
          'parties:edit',
          'parties:close',
          'parties:id_cards_edit',
        ],
      },
      {
        key: 'prices_and_credit',
        permissions: ['parties:set_price_level', 'parties:credit_limit'],
      },
    ],
  },
  {
    key: 'statement',
    sections: [
      {
        key: 'accounts',
        permissions: [
          'statement:customers',
          'statement:suppliers',
          'statement:carriers',
          'statement:money',
          'statement:expenses',
          'statement:warehouses',
          'statement:ledger',
        ],
      },
      {
        key: 'printing',
        permissions: ['statement:print', 'statement:export'],
      },
    ],
  },
  {
    key: 'money',
    sections: [
      {
        key: 'view',
        permissions: [
          'money:accounts',
          'vouchers:view',
          'expense_categories:view',
          'money:print',
          'money:export',
        ],
      },
      {
        key: 'vouchers',
        permissions: [
          'receipts:create',
          'payments:create',
          'expenses:create',
          'cash:transfer',
          'vouchers:cancel',
          'vouchers:discount',
        ],
      },
      {
        key: 'accounts',
        permissions: [
          'money_accounts:create',
          'money_accounts:edit',
          'money_accounts:delete',
          'money_accounts:main',
        ],
      },
      {
        key: 'expense_items',
        permissions: [
          'expense_categories:create',
          'expense_categories:edit',
          'expense_categories:close',
          'expense_categories:delete',
        ],
      },
      {
        key: 'cash_handovers',
        permissions: ['cash:handover_send', 'cash:handover_receive'],
      },
    ],
  },
  {
    key: 'notes',
    sections: [
      {
        key: 'view',
        permissions: [
          'notes:view_receivable',
          'notes:view_payable',
          'notes:portfolios',
          'notes:photos',
        ],
      },
      {
        key: 'actions',
        permissions: [
          'notes:receive',
          'notes:issue',
          'notes:deposit',
          'notes:collect',
          'notes:pay',
          'notes:bounce',
          'notes:endorse',
          'notes:cancel',
          'notes:lost',
        ],
      },
    ],
  },
  {
    key: 'ledger',
    sections: [
      {
        key: 'view',
        permissions: [
          'ledger:accounts',
          'ledger:journal',
          'ledger:trial_balance',
          'ledger:income_statement',
          'ledger:balance_sheet',
          'ledger:print',
          'ledger:export',
        ],
      },
      {
        key: 'actions',
        permissions: [
          'ledger:accounts_create',
          'ledger:accounts_edit',
          'ledger:post',
          'ledger:reverse',
          'ledger:lock',
          'ledger:close_year',
        ],
      },
    ],
  },
  {
    key: 'payroll',
    sections: [
      {
        key: 'view',
        permissions: [
          'payroll:runs',
          'payroll:attendance',
          'payroll:employees',
          'payroll:advances',
          'payroll:setup',
          'payroll:print',
        ],
      },
      {
        key: 'employees',
        permissions: [
          'employees:create',
          'employees:edit',
          'employees:delete',
          'shifts:create',
          'shifts:edit',
          'payroll:settings',
        ],
      },
      {
        key: 'attendance',
        permissions: ['attendance:edit', 'attendance:import'],
      },
      {
        key: 'bonuses_and_advances',
        permissions: [
          'payroll:adjust',
          'payroll:adjust_cancel',
          'payroll:advance',
          'payroll:advance_cancel',
        ],
      },
      {
        key: 'runs',
        permissions: ['payroll:run', 'payroll:post', 'payroll:run_cancel', 'payroll:pay'],
      },
    ],
  },
  {
    key: 'reports',
    sections: [
      {
        key: 'reports',
        permissions: [
          'reports:pl',
          'reports:profit',
          'reports:monthly',
          'reports:performance',
          'reports:parties',
          'reports:aging',
          'reports:items',
          'reports:changes',
        ],
      },
      {
        key: 'printing',
        permissions: ['reports:print', 'reports:export'],
      },
    ],
  },
  {
    key: 'activity',
    sections: [
      {
        key: 'log',
        permissions: ['audit:view', 'audit:export', 'presence:view'],
      },
    ],
  },
  {
    key: 'chat',
    sections: [
      {
        key: 'chat',
        permissions: ['chat:use', 'chat:monitor', 'chat:groups', 'chat:mute'],
      },
      {
        key: 'assistant',
        permissions: [
          'ai:chat',
          'ai:voice',
          'ai:scan_purchase',
          'ai:scan_stocktake',
          'ai:scan_cheques',
        ],
      },
    ],
  },
  {
    key: 'staff',
    sections: [
      {
        key: 'view',
        permissions: ['staff:view', 'roles:view'],
      },
      {
        key: 'accounts',
        permissions: [
          'staff:create',
          'staff:edit',
          'staff:role',
          'staff:password',
          'staff:password_note',
          'staff:close',
          'staff:delete',
          'staff:access',
          'staff:permissions',
        ],
      },
      {
        key: 'roles',
        permissions: ['roles:create', 'roles:edit', 'roles:delete'],
      },
    ],
  },
  {
    key: 'branches',
    sections: [
      {
        key: 'branches',
        permissions: ['branches:view', 'branches:create', 'branches:edit', 'branches:delete'],
      },
      {
        key: 'warehouses',
        permissions: ['warehouses:create', 'warehouses:edit', 'warehouses:delete'],
      },
    ],
  },
  {
    key: 'settings',
    sections: [
      {
        key: 'settings',
        permissions: [
          'settings:company',
          'settings:logo',
          'settings:pricing',
          'settings:rules',
          'settings:security',
          'settings:numbering',
          'settings:storefront',
          'backup:create',
        ],
      },
    ],
  },
  {
    key: 'general',
    sections: [
      {
        key: 'general',
        permissions: ['costs:view', 'profit:view', 'documents:backdate', 'rules:override'],
      },
    ],
  },
  {
    key: 'system',
    sections: [
      {
        key: 'owner_only',
        permissions: ['system:monitor', 'system:update', 'data:import', 'license:manage'],
      },
    ],
  },
];

/** Every permission of a group (empty for an unknown one). */
export function groupPermissions(key: string): Permission[] {
  return PERMISSION_GROUPS.find((g) => g.key === key)?.sections.flatMap((s) => s.permissions) ?? [];
}
