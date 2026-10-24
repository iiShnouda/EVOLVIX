import { matchPath } from 'react-router-dom';
import { NAV_ITEMS, type Permission } from '@skb/shared';
import { TOGETHER_PERMISSIONS } from './can';

const menu = (key: string): readonly Permission[] | undefined =>
  NAV_ITEMS.find((i) => i.key === key)?.anyOf;

/**
 * Who may open each address (owner, 2026-10-24): its menu page's permissions, or the action the
 * page is for. A page opened without them shows one clear "not allowed" page instead of a spinner
 * or an empty form; the server refuses its data all the same. Addresses not listed need none.
 */
const NEEDS: [string, () => readonly Permission[] | undefined][] = [
  ['/dashboard', () => menu('dashboard')],
  ['/sales', () => menu('sales')],
  ['/sales/new', () => ['sales:create', 'sales:order']],
  ['/sales/invoices/:id', () => menu('sales')],
  // Its maker may change it for half an hour with the right to sell alone.
  ['/sales/invoices/:id/edit', () => ['sales:edit', 'sales:create']],
  ['/sales/invoices/:id/return', () => ['sales:return']],
  ['/sales/returns/new', () => ['sales:return', 'sales:return_free']],
  ['/sales/together', () => TOGETHER_PERMISSIONS],
  ['/sales/together/:partyId', () => TOGETHER_PERMISSIONS],
  ['/parties', () => menu('parties')],
  ['/parties/:id/account', () => ['sales:together', 'statement:customers']],
  ['/statement', () => menu('statement')],
  ['/deliveries', () => menu('deliveries')],
  ['/inventory', () => menu('inventory')],
  [
    '/inventory/items/:id',
    () => [
      'inventory:card',
      'products:card_purchases',
      'products:card_sales',
      'products:card_returns',
      'products:card_prices',
    ],
  ],
  ['/inventory/transfers/new', () => ['inventory:transfer']],
  ['/inventory/transfers/:id', () => menu('inventory')],
  ['/inventory/transfers/:id/edit', () => ['inventory:transfer_edit']],
  ['/inventory/setup', () => menu('setup')],
  ['/inventory/products/new', () => ['products:create', 'purchases:create']],
  ['/inventory/products/:id/edit', () => ['products:edit', 'prices:edit']],
  ['/inventory/models', () => menu('inventory')],
  ['/inventory/models/new', () => ['products:create']],
  ['/inventory/models/:id', () => ['products:create', 'products:edit']],
  ['/purchases', () => menu('purchases')],
  ['/purchases/new', () => ['purchases:create']],
  ['/purchases/invoices/:id/return', () => ['purchases:return']],
  ['/purchases/returns/new', () => ['purchases:return', 'purchases:return_free']],
  ['/receipts', () => menu('receipts')],
  [
    '/receipts/move',
    () => [
      'receipts:create',
      'payments:create',
      'expenses:create',
      'cash:transfer',
      'vouchers:discount',
    ],
  ],
  ['/handovers', () => menu('handovers')],
  ['/ledger', () => menu('ledger')],
  ['/notes', () => menu('notes')],
  ['/notes/receive', () => ['notes:receive']],
  ['/notes/issue', () => ['notes:issue']],
  ['/analytics', () => menu('analytics')],
  ['/audit', () => menu('audit')],
  ['/presence', () => menu('presence')],
  ['/system', () => menu('system')],
  ['/updates', () => menu('updates')],
  ['/import', () => menu('import')],
  ['/license', () => menu('license')],
  ['/payroll', () => menu('payroll')],
  ['/staff', () => menu('staff')],
  ['/branches', () => menu('branches')],
  ['/settings', () => menu('settings')],
  ['/chat', () => menu('chat')],
  ['/assistant', () => menu('assistant')],
];

/** Whether the person may open this address (its path, without the query). */
export function mayOpenPath(pathname: string, permissions: readonly string[]): boolean {
  for (const [pattern, needs] of NEEDS) {
    if (!matchPath({ path: pattern, end: true }, pathname)) continue;
    const anyOf = needs();
    return !anyOf || anyOf.some((p) => permissions.includes(p));
  }
  return true;
}
