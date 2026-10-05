import { NAV_ITEMS, hasPermission, type Permission, type TranslationKey } from '@skb/shared';

/**
 * Everything the quick-action button can open (owner, 2026-10-05: "a quick button each person
 * fills freely with all the main buttons, and it grows with our features"). A new feature adds
 * its main actions here; every page of the menu is offered too. Each shows only to people who
 * hold its permission (the server checks again when the page is used).
 */
export interface QuickAction {
  id: string;
  label: TranslationKey;
  icon: string;
  path: string;
  /** Needed to see it; `anyOf` lets one of several do. */
  permission?: Permission;
  anyOf?: Permission[];
  group: 'actions' | 'pages';
}

const ACTIONS: QuickAction[] = [
  {
    id: 'sale',
    label: 'qa.saleInvoice',
    icon: 'sales',
    path: '/sales/new',
    permission: 'sales:create',
  },
  {
    id: 'saleReturn',
    label: 'qa.saleReturn',
    icon: 'returns',
    path: '/sales/returns/new',
    permission: 'sales:return',
  },
  {
    id: 'together',
    label: 'together.title',
    icon: 'sales',
    path: '/sales/together',
    permission: 'sales:view',
  },
  {
    id: 'purchase',
    label: 'qa.purchaseInvoice',
    icon: 'purchases',
    path: '/purchases/new',
    permission: 'purchases:create',
  },
  {
    id: 'purchaseReturn',
    label: 'qa.purchaseReturn',
    icon: 'returns',
    path: '/purchases/returns/new',
    permission: 'purchases:return',
  },
  {
    id: 'receipt',
    label: 'money.voucher.RECEIPT',
    icon: 'receipts',
    path: '/receipts?tab=vouchers&new=receipt',
    permission: 'receipts:create',
  },
  {
    id: 'payment',
    label: 'money.voucher.PAYMENT',
    icon: 'receipts',
    path: '/receipts?tab=vouchers&new=payment',
    permission: 'payments:create',
  },
  {
    id: 'expense',
    label: 'money.voucher.EXPENSE',
    icon: 'receipts',
    path: '/receipts?tab=vouchers&new=expense',
    permission: 'expenses:create',
  },
  {
    id: 'cashMove',
    label: 'move.title',
    icon: 'receipts',
    path: '/receipts/move',
    permission: 'cash:transfer',
  },
  {
    id: 'handover',
    label: 'hand.send',
    icon: 'receipts',
    path: '/handovers',
    permission: 'cash:handover_send',
  },
  {
    id: 'noteReceive',
    label: 'qa.noteReceive',
    icon: 'notes',
    path: '/notes/receive',
    permission: 'notes:receive',
  },
  {
    id: 'noteIssue',
    label: 'qa.noteIssue',
    icon: 'notes',
    path: '/notes/issue',
    permission: 'notes:issue',
  },
  {
    id: 'newParty',
    label: 'qa.newParty',
    icon: 'parties',
    path: '/parties?new=1',
    permission: 'parties:create',
  },
  {
    id: 'accountStatement',
    label: 'nav.statement',
    icon: 'ledger',
    path: '/statement',
    permission: 'ledger:view',
  },
  {
    id: 'addItems',
    label: 'additems.title',
    icon: 'inventory',
    path: '/inventory/products/new',
    permission: 'products:create',
  },
  {
    id: 'stocktake',
    label: 'stocktake.title',
    icon: 'inventory',
    path: '/inventory/stocktake',
    permission: 'inventory:stocktake',
  },
  {
    id: 'transfer',
    label: 'transfer.new',
    icon: 'delivery',
    path: '/inventory/transfers/new',
    permission: 'inventory:transfer',
  },
].map((a) => ({ ...a, group: 'actions' as const })) as QuickAction[];

const PAGES: QuickAction[] = NAV_ITEMS.map((item) => ({
  id: `page:${item.key}`,
  label: item.labelKey,
  icon: item.icon,
  path: item.path,
  permission: item.permission,
  anyOf: item.anyOf,
  group: 'pages' as const,
}));

export const QUICK_ACTIONS: QuickAction[] = [...ACTIONS, ...PAGES];

/** What a person sees before choosing their own (the first of these they may use). */
export const DEFAULT_QUICK = [
  'sale',
  'receipt',
  'payment',
  'newParty',
  'accountStatement',
  'purchase',
];
/** Stored when a person removes them all (an empty choice means "not chosen yet"). */
export const NONE = '-';
export const MAX_QUICK = 12;

export function mayUse(a: QuickAction, permissions: Permission[]): boolean {
  return (
    !a.permission ||
    hasPermission(permissions, a.permission) ||
    (a.anyOf ?? []).some((p) => hasPermission(permissions, p))
  );
}
