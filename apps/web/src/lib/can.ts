import type { Permission } from '@skb/shared';
import { useAuth } from '../stores/auth';

const NONE: Permission[] = [];

/**
 * `can('prices:edit')` — whether the signed-in user holds a permission. Only shapes the UI: the
 * server checks every request on its own.
 */
export function useCan(): (permission: Permission) => boolean {
  const permissions = useAuth((s) => s.user?.permissions ?? NONE);
  return (permission) => permissions.includes(permission);
}
