import type { Permission, Role } from './types';

/**
 * Default permission set per role. The server derives a user's permissions from their role
 * using this map and enforces them on every request. The client imports the same map to
 * shape the UI, but UI hiding is never a substitute for server enforcement.
 */

const ALL: Permission[] = [
  'dashboard:view',
  'sales:view',
  'sales:create',
  'sales:edit',
  'sales:override_floor',
  'sales:return',
  'purchases:view',
  'purchases:create',
  'purchases:return',
  'receipts:view',
  'receipts:create',
  'parties:view',
  'parties:edit',
  'inventory:view',
  'inventory:edit',
  'staff:view',
  'staff:manage',
  'branches:view',
  'branches:manage',
  'analytics:view',
  'settings:view',
  'settings:manage',
  'audit:view',
  'presence:view',
  'products:create',
  'products:edit',
  'prices:edit',
  'price_levels:manage',
  'categories:manage',
  'units:manage',
  'variant_options:manage',
  'sales:change_price',
  'sales:choose_price_level',
  'purchases:change_price',
  'purchases:choose_price_level',
  'parties:set_price_level',
];

/** Catalog permissions store staff get: add items, but not set selling prices. */
const ITEMS: Permission[] = [
  'products:create',
  'products:edit',
  'categories:manage',
  'units:manage',
  'variant_options:manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Founder/owner: everything, including the audit + presence (who's online) views.
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== 'audit:view'),
  ACCOUNTANT: [
    'dashboard:view',
    'sales:view',
    'sales:create',
    'sales:edit',
    'sales:override_floor',
    'sales:return',
    'purchases:view',
    'purchases:create',
    'purchases:return',
    'receipts:view',
    'receipts:create',
    'parties:view',
    'parties:edit',
    'inventory:view',
    'inventory:edit',
    'analytics:view',
    'settings:view',
    ...ITEMS,
    'prices:edit',
    'sales:change_price',
    'sales:choose_price_level',
    'purchases:change_price',
    'purchases:choose_price_level',
    'parties:set_price_level',
  ],
  // Returns move money back out, so a salesperson can't issue them by default. Sales staff sell at
  // the customer's price level; changing a price or the level needs a manager.
  SALES: [
    'dashboard:view',
    'sales:view',
    'sales:create',
    'sales:edit',
    'parties:view',
    'parties:edit',
    'inventory:view',
  ],
  INVENTORY: [
    'dashboard:view',
    'inventory:view',
    'inventory:edit',
    'purchases:view',
    'purchases:create',
    'purchases:return',
    ...ITEMS,
    'purchases:change_price',
    'purchases:choose_price_level',
  ],
  VIEWER: [
    'dashboard:view',
    'sales:view',
    'purchases:view',
    'receipts:view',
    'parties:view',
    'inventory:view',
    'analytics:view',
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function hasPermission(userPermissions: Permission[], permission: Permission): boolean {
  return userPermissions.includes(permission);
}
