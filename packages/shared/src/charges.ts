/**
 * Invoice-level charges (DOMAIN.md §2.5) — the same rules the server applies (`Charges.cs`), so
 * the invoice screen shows exactly what will be posted:
 *  1. a sale's INCREASE on the lines' total (it is sales; owner, 2026-11-19);
 *  2. DISCOUNT off it. Nothing compounds (owner, 2026-11-19): INCREASE's and DISCOUNT's percents
 *     are both of the lines' total, so they net out (+10% +2.00 −5% −1.00 on 200.00 = 211.00);
 *  3. EXTRA_DISCOUNT (a purchase's second discount; a sale has one discount, owner 2026-11-20) on
 *     what is left after them;
 *  4. TAX, OTHER_TAX and ADDITION on the discounted amount.
 * The increase, then the discount, is shared over the lines in proportion to their nets (bonus lines
 * take none), with the shares adding up exactly. A sale's increase or discount may be an amount a
 * piece (owner, 2026-11-20): it comes to that times the invoice's pieces (each item's smallest unit,
 * free goods aside), and each line takes exactly its own pieces times it. Money is integer minor
 * units; rates are percents (2 decimals).
 */

export type ChargeKind =
  'INCREASE' | 'DISCOUNT' | 'EXTRA_DISCOUNT' | 'TAX' | 'OTHER_TAX' | 'ADDITION';

export const CHARGE_ORDER: ChargeKind[] = [
  'INCREASE',
  'DISCOUNT',
  'EXTRA_DISCOUNT',
  'TAX',
  'OTHER_TAX',
  'ADDITION',
];

/** A charge as sent to the server: a percent, a fixed amount, or (a sale's increase or discount) an amount a piece. */
export interface ChargeInput {
  kind: ChargeKind;
  percent?: number;
  amount?: number;
  /** Minor units a piece, times the invoice's pieces. */
  perPiece?: number;
  label?: string;
}

/** A charge as the server stored it. */
export interface DocumentCharge {
  kind: ChargeKind;
  /** Percent (14 = 14%) when it is a rate. */
  rate?: number | null;
  fixedAmount?: number | null;
  /** An amount a piece, as typed (minor units); `amount` is it times the invoice's pieces. */
  perPiece?: number | null;
  /** What it came to, minor units. */
  amount: number;
  label?: string | null;
}

export interface ChargesOutcome {
  rows: { kind: ChargeKind; amount: number; perPiece?: number; label?: string }[];
  discount: number;
  tax: number;
  addition: number;
  /** Each line's share of the discount, in line order. */
  allocation: number[];
  /** The invoice's increase, and each line's share of it. */
  increase: number;
  increaseAllocation: number[];
  /** Why the charges can't apply (e.g. a discount larger than the invoice). */
  error?: 'discount_too_big';
}

const isDiscount = (k: ChargeKind) => k === 'DISCOUNT' || k === 'EXTRA_DISCOUNT';

function amountOf(c: ChargeInput, on: number, pieces: number): number {
  if (c.percent !== undefined) return percentOf(on, c.percent);
  if (c.perPiece !== undefined) return Math.max(0, Math.round(c.perPiece)) * pieces;
  return Math.max(0, Math.round(c.amount ?? 0));
}

/** A stored charge as typed again (a percent, an amount, or an amount a piece). */
export function chargeInputOf(c: DocumentCharge): ChargeInput {
  const label = c.label ?? undefined;
  if (c.rate != null) return { kind: c.kind, percent: c.rate, label };
  if (c.perPiece != null) return { kind: c.kind, perPiece: c.perPiece, label };
  return { kind: c.kind, amount: c.fixedAmount ?? c.amount, label };
}

/** Share `total` over lines in proportion to their nets (largest remainder); null if nothing can take it. */
export function allocate(total: number, nets: number[], shares: boolean[]): number[] | null {
  const result = nets.map(() => 0);
  if (total === 0) return result;
  const weights = nets.map((n, i) => (shares[i] && n > 0 ? n : 0));
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return null;
  const remainders = weights.map((w, i) => {
    const exact = (total * w) / sum;
    result[i] = Math.floor(exact);
    return exact - result[i]!;
  });
  let left = total - result.reduce((s, x) => s + x, 0);
  const order = weights
    .map((w, i) => i)
    .filter((i) => weights[i]! > 0)
    .sort((a, b) => remainders[b]! - remainders[a]! || a - b);
  for (const i of order) {
    if (left <= 0) break;
    result[i]!++;
    left--;
  }
  return result;
}

/**
 * @param pieces each line's pieces (its item's smallest unit), for an amount a piece.
 */
export function applyCharges(
  nets: number[],
  shares: boolean[],
  charges: ChargeInput[],
  pieces: number[] = [],
): ChargesOutcome {
  const ordered = charges
    .map((c, i) => ({ c, i }))
    .sort((a, b) => CHARGE_ORDER.indexOf(a.c.kind) - CHARGE_ORDER.indexOf(b.c.kind) || a.i - b.i)
    .map((x) => x.c);
  let running = nets.reduce((s, n) => s + n, 0);
  const base = running; // what an increase's and the first discount's percents are of
  // The pieces an amount a piece is times: those of the lines that take a share (not free goods).
  const each = nets.map((_, i) => (shares[i] ? Math.max(0, pieces[i] ?? 0) : 0));
  const allPieces = each.reduce((s, p) => s + p, 0);
  let increasePiece = 0;
  let discountPiece = 0;
  let discount = 0;
  let tax = 0;
  let addition = 0;
  let increase = 0;
  let error: ChargesOutcome['error'];
  const rows: ChargesOutcome['rows'] = [];
  for (const c of ordered.filter((c) => c.kind === 'INCREASE')) {
    const amount = amountOf(c, base, allPieces);
    running += amount;
    increase += amount;
    if (c.perPiece !== undefined) increasePiece += Math.max(0, Math.round(c.perPiece));
    rows.push({ kind: c.kind, amount, perPiece: c.perPiece, label: c.label });
  }
  // An amount a piece goes on each line exactly by its pieces; the rest by the nets.
  const increaseAllocation = allocate(increase - increasePiece * allPieces, nets, shares)?.map(
    (x, i) => x + increasePiece * each[i]!,
  );
  if (!increaseAllocation) error = 'discount_too_big';
  const raised = nets.map((n, i) => n + (increaseAllocation?.[i] ?? 0));
  for (const c of ordered.filter((c) => isDiscount(c.kind))) {
    const amount = amountOf(c, c.kind === 'DISCOUNT' ? base : running, allPieces);
    if (amount > running) error = 'discount_too_big';
    const taken = Math.min(amount, running);
    running -= taken;
    discount += taken;
    if (c.perPiece !== undefined && taken === amount)
      discountPiece += Math.max(0, Math.round(c.perPiece));
    rows.push({ kind: c.kind, amount: taken, perPiece: c.perPiece, label: c.label });
  }
  for (const c of ordered.filter((c) => !isDiscount(c.kind) && c.kind !== 'INCREASE')) {
    const amount = amountOf(c, running, allPieces);
    if (c.kind === 'ADDITION') addition += amount;
    else tax += amount;
    rows.push({ kind: c.kind, amount, label: c.label });
  }
  const allocation = allocate(discount - discountPiece * allPieces, raised, shares)?.map(
    (x, i) => x + discountPiece * each[i]!,
  );
  if (!allocation) error = 'discount_too_big';
  // A discount a piece can't take more off a line than it comes to.
  if (allocation?.some((x, i) => x > raised[i]!)) error = 'discount_too_big';
  return {
    rows,
    discount,
    tax,
    addition,
    allocation: allocation ?? nets.map(() => 0),
    increase,
    increaseAllocation: increaseAllocation ?? nets.map(() => 0),
    error,
  };
}

/** What a percent (2 decimals) of `on` comes to, rounded to the piastre half away from zero, as the server does. */
export function percentOf(on: number, percent: number): number {
  const bp = Math.round(percent * 100);
  const exact = (on * bp) / 10000;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

/** A sales line's own increase or discount as typed: a percent, an amount for the line, an amount a piece. */
export interface LineAdjustInput {
  percent?: number;
  amount?: number;
  perPiece?: number;
}

/**
 * A sales line's own increase or discount (owner, 2026-11-19), as the server works it out
 * (`Adjust.Of`): nothing compounds, the percent is of `gross` (quantity × price, before any increase
 * or discount) for both, so an increase and a discount net out; the amount is added as typed, and
 * the amount a piece times `pieces` (the line's pieces of the item's smallest unit).
 */
export function lineAdjust(gross: number, pieces: number, a: LineAdjustInput): number {
  return (
    (a.percent ? percentOf(gross, a.percent) : 0) +
    Math.max(0, a.amount ?? 0) +
    Math.max(0, a.perPiece ?? 0) * pieces
  );
}
