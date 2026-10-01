import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { usePreferences } from './queries';
import { useAuth } from '../stores/auth';
import { useWorkBranchStore } from '../stores/workBranch';

/** Where a person works now: branch, warehouse and sales department ("" = not picked). */
export interface WorkPlace {
  branchId: string;
  warehouseId: string;
  departmentId: string;
}

const KEY = 'work:place';
const EMPTY: WorkPlace = { branchId: '', warehouseId: '', departmentId: '' };

/**
 * The branch, warehouse and department a person last picked (owner, 2026-10-02): every screen
 * that asks for them — invoices, returns, lists and their filters, the item search — starts at
 * them, and picking another on any screen changes it everywhere until it is changed again. Kept on
 * the server per account (like hidden columns), so it follows the person to every device. Picking
 * a branch also makes it the working branch.
 */
export function useWorkPlace(): [WorkPlace, (patch: Partial<WorkPlace>) => void] {
  const qc = useQueryClient();
  const prefs = usePreferences();
  const user = useAuth((s) => s.user);
  const pickBranch = useWorkBranchStore((s) => s.pick);
  let place = EMPTY;
  try {
    const saved = prefs.data?.[KEY];
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      const text = (v: unknown) => (typeof v === 'string' ? v : '');
      place = {
        branchId: text(p.branchId),
        warehouseId: text(p.warehouseId),
        departmentId: text(p.departmentId),
      };
    }
  } catch {
    /* a bad value starts empty */
  }
  // Only a branch the person may still use.
  if (place.branchId && user && !(user.branches ?? []).some((b) => b.id === place.branchId))
    place = EMPTY;

  const set = (patch: Partial<WorkPlace>) => {
    const current =
      qc.getQueryData<Record<string, string>>(['preferences'])?.[KEY] ?? JSON.stringify(place);
    let base = place;
    try {
      base = { ...EMPTY, ...(JSON.parse(current) as Partial<WorkPlace>) };
    } catch {
      /* start from what shows */
    }
    const next = { ...base, ...patch };
    if (
      next.branchId === base.branchId &&
      next.warehouseId === base.warehouseId &&
      next.departmentId === base.departmentId
    )
      return;
    const value = JSON.stringify(next);
    qc.setQueryData<Record<string, string>>(['preferences'], (old) => ({
      ...(old ?? {}),
      [KEY]: value,
    }));
    void api.put('/preferences', { key: KEY, value }).catch(() => undefined);
    if (patch.branchId && user && (user.branches ?? []).some((b) => b.id === patch.branchId))
      pickBranch(user.id, patch.branchId);
  };
  return [place, set];
}
