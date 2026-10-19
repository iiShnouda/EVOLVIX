/**
 * The one choice when there is exactly one, else '' (owner, 2026-10-19: an account with one
 * branch, warehouse or department shouldn't have to pick it on every screen).
 */
export function onlyChoice(list: readonly { id: string }[]): string {
  return list.length === 1 ? (list[0]?.id ?? '') : '';
}
