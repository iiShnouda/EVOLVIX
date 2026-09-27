import type { AuthUser } from '@skb/shared';

/** Roles that may see data across all branches. Everyone else is scoped to their branch. */
const CROSS_BRANCH_ROLES = new Set(['OWNER', 'ADMIN', 'ACCOUNTANT']);

export function canSeeAllBranches(user: AuthUser): boolean {
  return CROSS_BRANCH_ROLES.has(user.role);
}

/**
 * Returns a Prisma `where` fragment that limits rows to the user's branch unless their
 * role is allowed to see all branches. Applied server-side on every branch-scoped query.
 */
export function branchScope(user: AuthUser): { branchId?: string } {
  return canSeeAllBranches(user) ? {} : { branchId: user.branchId };
}
