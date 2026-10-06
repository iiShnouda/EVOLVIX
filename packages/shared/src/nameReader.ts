import { fold, sameWord, words } from './textKey';

/**
 * Reads an item's name as it is typed (owner, 2026-10-06: "آدم فنيله ريجالي نص كم M" → underwear /
 * men's / vests / half sleeve, size M). Each group of a department's tree is found by its name or one
 * of its keywords anywhere in the name, allowing a long vowel or a slipped letter; the deepest group
 * found wins (it implies the groups above it: vests are men's even when "men's" isn't written).
 * Sizes and colors are picked from the company's lists the same way. Nothing here is saved: it only
 * fills the form, and the person can change any of it.
 */

export interface ReaderGroup {
  id: string;
  name: string;
  departmentId: string;
  parentId?: string | null;
  keywords?: string[];
  isActive?: boolean;
}

export interface ReaderNamed {
  id: string;
  name: string;
  isActive?: boolean;
}

export interface NameReading {
  departmentId?: string;
  groupId?: string;
  sizeId?: string;
  colorId?: string;
}

/** Where a phrase (one or more words) appears in the name's words; -1 when it doesn't. */
function find(nameWords: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > nameWords.length) return -1;
  for (let i = 0; i + phrase.length <= nameWords.length; i++)
    if (phrase.every((w, j) => sameWord(nameWords[i + j]!, w))) return i;
  return -1;
}

/** How strongly a name says this group: the longest of its name and keywords found (0 = not found). */
function strength(nameWords: string[], labels: string[]): number {
  let best = 0;
  for (const label of labels) {
    const phrase = words(label);
    if (find(nameWords, phrase) >= 0) best = Math.max(best, fold(label).length);
  }
  return best;
}

export function readItemName(
  name: string,
  lists: {
    departments: ReaderNamed[];
    groups: ReaderGroup[];
    sizes?: ReaderNamed[];
    colors?: ReaderNamed[];
  },
): NameReading {
  const nameWords = words(name);
  if (nameWords.length === 0) return {};
  const groups = lists.groups.filter((g) => g.isActive !== false);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const depth = (g: ReaderGroup) => {
    let d = 0;
    for (let at: ReaderGroup | undefined = g; at?.parentId; at = byId.get(at.parentId)) d++;
    return d;
  };
  const found = new Map<string, number>();
  for (const g of groups) {
    const s = strength(nameWords, [g.name, ...(g.keywords ?? [])]);
    if (s > 0) found.set(g.id, s);
  }

  const out: NameReading = {};
  if (found.size > 0) {
    // The deepest group found; then the one whose chain says more; then the longest word.
    const score = (g: ReaderGroup) => {
      let chain = 0;
      for (
        let at: ReaderGroup | undefined = g;
        at;
        at = at.parentId ? byId.get(at.parentId) : undefined
      )
        if (found.has(at.id)) chain++;
      return [depth(g), chain, found.get(g.id)!] as const;
    };
    const best = groups
      .filter((g) => found.has(g.id))
      .sort((a, b) => {
        const [da, ca, sa] = score(a);
        const [db, cb, sb] = score(b);
        return db - da || cb - ca || sb - sa;
      })[0]!;
    out.groupId = best.id;
    out.departmentId = best.departmentId;
  } else {
    const dept = lists.departments
      .filter((d) => d.isActive !== false)
      .map((d) => ({ d, s: strength(nameWords, [d.name]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0];
    if (dept) out.departmentId = dept.d.id;
  }

  // A size or color: the last one named (they usually come at the end).
  const pick = (options: ReaderNamed[] | undefined) => {
    let hit: { id: string; at: number } | undefined;
    for (const o of (options ?? []).filter((x) => x.isActive !== false)) {
      const at = find(nameWords, words(o.name));
      if (at >= 0 && (!hit || at > hit.at)) hit = { id: o.id, at };
    }
    return hit?.id;
  };
  out.sizeId = pick(lists.sizes);
  out.colorId = pick(lists.colors);
  return out;
}

/** A group's path from its department down, e.g. ["رجالي", "فانلة", "نصف كم"]. */
export function groupPath<T extends { id: string; parentId?: string | null }>(
  groups: T[],
  id: string | null | undefined,
): T[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path: T[] = [];
  const seen = new Set<string>();
  for (
    let at = id ? byId.get(id) : undefined;
    at && !seen.has(at.id);
    at = at.parentId ? byId.get(at.parentId) : undefined
  ) {
    seen.add(at.id);
    path.unshift(at);
  }
  return path;
}
