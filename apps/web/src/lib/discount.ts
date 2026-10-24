import { toMinor } from '@skb/shared';

/** How a line's discount is typed: a percent of it, so much a piece, or an amount for the line. */
export type LineDiscountMode = 'percent' | 'piece' | 'amount';

/**
 * A line discount in minor units, never more than the line (`gross`) is worth. "A piece" is the
 * item's smallest unit («على الحتة»): `pieces` is how many of them the line holds.
 */
export function lineDiscount(
  mode: LineDiscountMode,
  value: string,
  gross: number,
  pieces: number,
): number {
  const v = Number(value);
  if (!value.trim() || !Number.isFinite(v) || v <= 0 || gross <= 0) return 0;
  const d =
    mode === 'percent'
      ? Math.round((gross * Math.min(v, 100)) / 100)
      : mode === 'piece'
        ? toMinor(v) * pieces
        : toMinor(v);
  return Math.min(gross, Math.max(0, d));
}
