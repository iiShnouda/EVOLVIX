/**
 * Invoice-level charges (DOMAIN.md §2.5) — the same rules the server applies (`Charges.cs`), so
 * the invoice screen shows exactly what will be posted:
 *  1. DISCOUNT, then EXTRA_DISCOUNT, each on what is left after the one before;
 *  2. TAX, OTHER_TAX and ADDITION on the discounted amount.
 * The total discount is shared over the lines in proportion to their nets (bonus lines take none),
 * with the shares adding up exactly. Money is integer minor units; rates are percents (2 decimals).
 */

export type ChargeKind = 'DISCOUNT' | 'EXTRA_DISCOUNT' | 'TAX' | 'OTHER_TAX' | 'ADDITION';

export const CHARGE_ORDER: ChargeKind[] = [
  'DISCOUNT',
  'EXTRA_DISCOUNT',
  'TAX',
  'OTHER_TAX',
  'ADDITION',
];

/** A charge as sent to the server: a percent or a fixed amount. */
export interface ChargeInput {
  kind: ChargeKind;
  percent?: number;
  amount?: number;
  label?: string;
}

/** A charge as the server stored it. */
export interface DocumentCharge {
  kind: ChargeKind;
  /** Percent (14 = 14%) when it is a rate. */
  rate?: number | null;
  fixedAmount?: number | null;
  /** What it came to, minor units. */
  amount: number;
  label?: string | null;
}

export interface ChargesOutcome {
  rows: { kind: ChargeKind; amount: number; label?: string }[];
  discount: number;
  tax: number;
  addition: number;
  /** Each line's share of the discount, in line order. */
  allocation: number[];
  /** Why the charges can't apply (e.g. a discount larger than the invoice). */
  error?: 'discount_too_big';
}

const isDiscount = (k: ChargeKind) => k === 'DISCOUNT' || k === 'EXTRA_DISCOUNT';

function amountOf(c: ChargeInput, on: number): number {
  if (c.percent !== undefined) return Math.round((on * Math.round(c.percent * 100)) / 10000);
  return Math.max(0, Math.round(c.amount ?? 0));
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

export function applyCharges(
  nets: number[],
  shares: boolean[],
  charges: ChargeInput[],
): ChargesOutcome {
  const ordered = charges
    .map((c, i) => ({ c, i }))
    .sort((a, b) => CHARGE_ORDER.indexOf(a.c.kind) - CHARGE_ORDER.indexOf(b.c.kind) || a.i - b.i)
    .map((x) => x.c);
  let running = nets.reduce((s, n) => s + n, 0);
  let discount = 0;
  let tax = 0;
  let addition = 0;
  let error: ChargesOutcome['error'];
  const rows: ChargesOutcome['rows'] = [];
  for (const c of ordered.filter((c) => isDiscount(c.kind))) {
    const amount = amountOf(c, running);
    if (amount > running) error = 'discount_too_big';
    const taken = Math.min(amount, running);
    running -= taken;
    discount += taken;
    rows.push({ kind: c.kind, amount: taken, label: c.label });
  }
  for (const c of ordered.filter((c) => !isDiscount(c.kind))) {
    const amount = amountOf(c, running);
    if (c.kind === 'ADDITION') addition += amount;
    else tax += amount;
    rows.push({ kind: c.kind, amount, label: c.label });
  }
  const allocation = allocate(discount, nets, shares);
  if (!allocation) error = 'discount_too_big';
  return { rows, discount, tax, addition, allocation: allocation ?? nets.map(() => 0), error };
}
