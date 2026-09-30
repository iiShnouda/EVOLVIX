import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@skb/shared';
import { useAuth } from './auth';

interface WorkBranchState {
  /** The branch each person last picked on this device (a UI preference, like the language). */
  byUser: Record<string, string>;
  pick: (userId: string, branchId: string) => void;
}

/**
 * The working branch: where new invoices, receipts and counts go, for people who work in more than
 * one branch (DOMAIN.md §2.1). Only the choice is kept on the device; the server checks on every
 * request that the person may use it (the X-Branch header), else it uses their own branch.
 */
export const useWorkBranchStore = create<WorkBranchState>()(
  persist(
    (set) => ({
      byUser: {},
      pick: (userId, branchId) => set((s) => ({ byUser: { ...s.byUser, [userId]: branchId } })),
    }),
    { name: 'skb.workBranch' },
  ),
);

/** The branch picked, if the person may still use it; else their own. */
export function workBranchOf(user: AuthUser | null, byUser: Record<string, string>): string {
  if (!user) return '';
  const picked = byUser[user.id];
  return picked && user.branches?.some((b) => b.id === picked) ? picked : user.branchId;
}

export function useWorkBranch(): string {
  const user = useAuth((s) => s.user);
  const byUser = useWorkBranchStore((s) => s.byUser);
  return workBranchOf(user, byUser);
}

/** For the api client, outside React. */
export const getWorkBranch = (): string =>
  workBranchOf(useAuth.getState().user, useWorkBranchStore.getState().byUser);
