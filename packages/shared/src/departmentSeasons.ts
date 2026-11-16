/**
 * A department's season, read from its name (owner, 2026-11-16: «رجالي صيفي», «رجالي شتوي», and
 * «داخلي» with no season word, which goes with both). Mirrors the server's `DepartmentSeasons`
 * (apps/api/src/SKB.Api/Services/DepartmentSeasons.cs); keep the two in step.
 *
 * The words, whole words of the folded name, with or without «ال» or «و» before them: صيف, صيفي,
 * صيفى, صيفية, الصيفي, summer; شتا, شتاء, شتوي, شتوى, شتوية, الشتوي, winter. A name with neither
 * (or both) is every season's.
 */
import { fold } from './textKey';

export type DepartmentSeason = 'SUMMER' | 'WINTER';

export const DEPARTMENT_SEASONS: readonly DepartmentSeason[] = ['SUMMER', 'WINTER'];

const SUMMER_WORDS = new Set(['صيف', 'صيفي', 'صيفيه', 'summer']);
const WINTER_WORDS = new Set(['شتا', 'شتاء', 'شتوي', 'شتويه', 'winter']);

/** The word itself, and without a leading «و» and/or «ال». */
function forms(w: string): string[] {
  const out = [w];
  const x = w.startsWith('و') && w.length > 3 ? w.slice(1) : w;
  if (x !== w) out.push(x);
  if (x.startsWith('ال') && x.length > 4) out.push(x.slice(2));
  return out;
}

/** SUMMER, WINTER, or null for a name with no season word (or with both). */
export function seasonOfDepartment(name: string | null | undefined): DepartmentSeason | null {
  let summer = false;
  let winter = false;
  for (const raw of fold(name).split(/[\s_-]+/)) {
    if (!raw) continue;
    for (const w of forms(raw)) {
      if (SUMMER_WORDS.has(w)) summer = true;
      if (WINTER_WORDS.has(w)) winter = true;
    }
  }
  return summer === winter ? null : summer ? 'SUMMER' : 'WINTER';
}

/** SUMMER or WINTER from the address (any case); anything else is no season. */
export function parseDepartmentSeason(
  value: string | null | undefined,
): DepartmentSeason | undefined {
  const v = value?.trim().toUpperCase();
  return v === 'SUMMER' || v === 'WINTER' ? v : undefined;
}

/** Whether a department of this name is offered for the season (none = every season). */
export function departmentFitsSeason(
  name: string | null | undefined,
  season: DepartmentSeason | null | undefined,
): boolean {
  if (!season) return true;
  const own = seasonOfDepartment(name);
  return own === null || own === season;
}
