import type { Locale } from './types';
import { formatNumber } from './money';

/** What quantity helpers need of a unit: its name and how many base units it holds. */
export interface UnitSize {
  name: string;
  factor: number;
}

/**
 * Split a quantity in base units into whole larger units, largest first:
 * 53 pieces with a carton of 24 → 2 Carton + 5 Piece. Units with no share are left out.
 * The sign is kept on the first part.
 */
export function splitQuantity(
  baseQty: number,
  units: UnitSize[],
): { quantity: number; name: string }[] {
  const sorted = [...units].sort((a, b) => b.factor - a.factor);
  if (sorted.length === 0) return [{ quantity: baseQty, name: '' }];
  let left = Math.abs(baseQty);
  const parts: { quantity: number; name: string }[] = [];
  for (const u of sorted) {
    const n = Math.floor(left / u.factor);
    if (n > 0) {
      parts.push({ quantity: n, name: u.name });
      left -= n * u.factor;
    }
  }
  if (parts.length === 0) parts.push({ quantity: 0, name: sorted[sorted.length - 1]!.name });
  if (baseQty < 0) parts[0]!.quantity = -parts[0]!.quantity;
  return parts;
}

/** A base quantity in words of its units: "2 Carton + 5 Piece" (just "5 Piece" for a one-unit item). */
export function formatQuantity(baseQty: number, units: UnitSize[], locale: Locale): string {
  return splitQuantity(baseQty, units)
    .map((p) => `${formatNumber(p.quantity, locale)} ${p.name}`.trim())
    .join(' + ');
}
