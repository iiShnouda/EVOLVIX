import {
  allocate,
  applyCharges,
  formatMoney,
  formatNumber,
  lineAdjust,
  percentOf,
  toMajor,
  toMinor,
  type ChargeInput,
  type InvoiceAdjustInput,
  type LineAdjustInput,
  type SalesDocument,
  type TranslationKey,
} from '@skb/shared';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { ItemLink } from './ItemLink';

/**
 * The accountant sees the discounts an invoice has and changes them (owner, 2026-11-20): each item's
 * discount as a percent, an amount and an amount a piece, and the invoice's as a percent and an
 * amount — filled in with what is there. There is no second discount: what he types replaces it.
 * Increases show too; they change only for whoever holds their permissions. Each box is its own
 * permission (a piece's is an amount); the server checks them, and the person's limit, again.
 */

type Line = SalesDocument['lines'][number];

/** One line's boxes as typed (major units, percents as typed; empty = none). */
export interface LineBoxes {
  dPct: string;
  dAmt: string;
  dPc: string;
  iPct: string;
  iAmt: string;
  iPc: string;
}
/** The invoice's own boxes. */
export interface InvoiceBoxes {
  dPct: string;
  dAmt: string;
  iPct: string;
  iAmt: string;
}
export interface AdjustBoxes {
  lines: Record<string, LineBoxes>;
  invoice: InvoiceBoxes;
}

const pctText = (v: number | null | undefined) => (v ? String(v) : '');
const amtText = (v: number | null | undefined) => (v ? String(toMajor(v)) : '');
const pctOf = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100) / 100 || 0);
const amtOf = (v: string) => (v.trim() === '' ? 0 : Math.max(0, toMinor(Number(v) || 0)));
const some = (v: number) => (v > 0 ? v : undefined);

/** The lines that take a discount (free goods have no price). */
export const pricedLines = (doc: SalesDocument) => doc.lines.filter((l) => !l.isBonus);

/** What `doc` has now, as boxes: a discount given as one sum reads as an amount. */
export function boxesOf(doc: SalesDocument): AdjustBoxes {
  const lines: Record<string, LineBoxes> = {};
  for (const l of pricedLines(doc)) {
    const dTyped = l.discountRate != null || l.discountFixed != null || l.discountPiece != null;
    const iTyped = l.increaseRate != null || l.increaseFixed != null || l.increasePiece != null;
    lines[l.id] = {
      dPct: pctText(l.discountRate),
      dAmt: amtText(dTyped ? l.discountFixed : l.discount),
      dPc: amtText(l.discountPiece),
      iPct: pctText(l.increaseRate),
      iAmt: amtText(iTyped ? l.increaseFixed : l.increase),
      iPc: amtText(l.increasePiece),
    };
  }
  const first = (kind: 'DISCOUNT' | 'INCREASE', rate: boolean) =>
    doc.charges.find((c) => c.kind === kind && (c.rate != null && c.rate > 0) === rate);
  return {
    lines,
    invoice: {
      dPct: pctText(first('DISCOUNT', true)?.rate),
      dAmt: amtText(first('DISCOUNT', false)?.fixedAmount),
      iPct: pctText(first('INCREASE', true)?.rate),
      iAmt: amtText(first('INCREASE', false)?.fixedAmount),
    },
  };
}

/** Which boxes this person may change (each its own permission; owner, 2026-11-19). */
export function useAdjustRights() {
  const can = useCan();
  return {
    line: {
      dPct: can('sales:discount_line_pct'),
      dAmt: can('sales:discount_line_amount'),
      dPc: can('sales:discount_line_amount'),
      iPct: can('sales:increase_line_pct'),
      iAmt: can('sales:increase_line_amount'),
      iPc: can('sales:increase_line_amount'),
    },
    invoice: {
      dPct: can('sales:discount_pct'),
      dAmt: can('sales:discount_amount'),
      iPct: can('sales:increase_pct'),
      iAmt: can('sales:increase_amount'),
    },
  };
}
export type AdjustRights = ReturnType<typeof useAdjustRights>;

/** Whether this person may change any of the discounts (or increases). */
export const mayAdjust = (r: AdjustRights) =>
  Object.values(r.line).some(Boolean) || Object.values(r.invoice).some(Boolean);

/** A line's price × quantity, before its own increase and discount. */
const baseOf = (l: Line) => l.lineTotal - (l.docIncrease ?? 0) + l.discount - (l.increase ?? 0);

/**
 * What the boxes come to, the way the server works it out (`Adjust.Of`, `Charges.Apply`): each
 * line's increase and discount and what is left of it, the invoice's increase and discount, and the
 * new total. The invoice's taxes and additions stay as they are.
 */
export function adjustPreview(doc: SalesDocument, boxes: AdjustBoxes) {
  const lines = doc.lines.map((l) => {
    const b = boxes.lines[l.id];
    if (!b || l.isBonus)
      return { id: l.id, increase: 0, discount: 0, net: l.lineTotal - (l.docIncrease ?? 0) };
    const base = baseOf(l);
    const increase = lineAdjust(base, l.quantity, {
      percent: pctOf(b.iPct),
      amount: amtOf(b.iAmt),
      perPiece: amtOf(b.iPc),
    });
    const discount = lineAdjust(base, l.quantity, {
      percent: pctOf(b.dPct),
      amount: amtOf(b.dAmt),
      perPiece: amtOf(b.dPc),
    });
    return { id: l.id, increase, discount, net: base + increase - discount };
  });
  const inv = boxes.invoice;
  const charges: ChargeInput[] = [
    ...(pctOf(inv.iPct) > 0 ? [{ kind: 'INCREASE' as const, percent: pctOf(inv.iPct) }] : []),
    ...(amtOf(inv.iAmt) > 0 ? [{ kind: 'INCREASE' as const, amount: amtOf(inv.iAmt) }] : []),
    ...(pctOf(inv.dPct) > 0 ? [{ kind: 'DISCOUNT' as const, percent: pctOf(inv.dPct) }] : []),
    ...(amtOf(inv.dAmt) > 0 ? [{ kind: 'DISCOUNT' as const, amount: amtOf(inv.dAmt) }] : []),
    ...doc.charges
      .filter((c) => c.kind !== 'DISCOUNT' && c.kind !== 'INCREASE')
      .map((c) =>
        c.rate != null
          ? { kind: c.kind, percent: c.rate }
          : { kind: c.kind, amount: c.fixedAmount ?? c.amount },
      ),
  ];
  const outcome = applyCharges(
    lines.map((l) => l.net),
    doc.lines.map((l) => !l.isBonus),
    charges,
  );
  const items = lines.reduce((s, l) => s + l.net, 0);
  const tooBig = lines.some((l) => l.net < 0) || !!outcome.error;
  return {
    lines: Object.fromEntries(lines.map((l) => [l.id, l])),
    outcome,
    total: items + outcome.increase - outcome.discount + outcome.tax + outcome.addition,
    tooBig,
  };
}

/** The boxes as the server takes them (`adjust`, and the approval's `lines` / `invoice`). */
export function adjustPayload(
  doc: SalesDocument,
  boxes: AdjustBoxes,
): { lines: LineAdjustInput[]; invoice: InvoiceAdjustInput } {
  return {
    lines: pricedLines(doc).map((l) => {
      const b = boxes.lines[l.id]!;
      return {
        lineId: l.id,
        discountPercent: some(pctOf(b.dPct)),
        discountAmount: some(amtOf(b.dAmt)),
        discountPerPiece: some(amtOf(b.dPc)),
        increasePercent: some(pctOf(b.iPct)),
        increaseAmount: some(amtOf(b.iAmt)),
        increasePerPiece: some(amtOf(b.iPc)),
      };
    }),
    invoice: {
      discountPercent: some(pctOf(boxes.invoice.dPct)),
      discountAmount: some(amtOf(boxes.invoice.dAmt)),
      increasePercent: some(pctOf(boxes.invoice.iPct)),
      increaseAmount: some(amtOf(boxes.invoice.iAmt)),
    },
  };
}

/** Whether a percent box holds something outside 0–100. */
export function badPercent(boxes: AdjustBoxes) {
  const all = [
    ...Object.values(boxes.lines).flatMap((b) => [b.dPct, b.iPct]),
    boxes.invoice.dPct,
    boxes.invoice.iPct,
  ];
  return all.some((v) => v.trim() !== '' && !(Number(v) >= 0 && Number(v) <= 100));
}

/** Whether anything differs from what the invoice has. */
export function boxesChanged(doc: SalesDocument, boxes: AdjustBoxes) {
  return (
    JSON.stringify(adjustPayload(doc, boxes)) !== JSON.stringify(adjustPayload(doc, boxesOf(doc)))
  );
}

/** Combined discount over several invoices, shown per invoice before it is given (as the server shares it). */
export function combinedShares(
  docs: SalesDocument[],
  mode: 'percent' | 'amount',
  value: string,
): { id: string; percent?: number; amount: number }[] {
  if (mode === 'percent') {
    // A percent is each one's, of its items' total (before its own increase), as on the invoice.
    const p = pctOf(value);
    return docs.map((d) => ({
      id: d.id,
      percent: p,
      amount: percentOf(
        pricedLines(d).reduce((s, l) => s + l.lineTotal - (l.docIncrease ?? 0), 0),
        p,
      ),
    }));
  }
  const bases = docs.map((d) => pricedLines(d).reduce((s, l) => s + l.lineTotal, 0));
  const shares =
    allocate(
      amtOf(value),
      bases,
      bases.map(() => true),
    ) ?? bases.map(() => 0);
  return docs.map((d, i) => ({ id: d.id, amount: shares[i] ?? 0 }));
}

const box =
  'h-9 w-full min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum outline-none focus:border-brand disabled:border-transparent disabled:bg-surface-2 disabled:text-muted';

const LINE_D = [
  ['dPct', 'col.discountPct'],
  ['dAmt', 'col.discountAmount'],
  ['dPc', 'col.discountPiece'],
] as const;
const LINE_I = [
  ['iPct', 'col.increasePct'],
  ['iAmt', 'col.increaseAmount'],
  ['iPc', 'col.increasePiece'],
] as const;

/** One box: an input for whoever may change it, else the same box shown, not to be typed in. */
function Box({
  label,
  value,
  onChange,
  enabled,
  pct,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
  pct: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block truncate text-[11px] text-muted">{label}</span>
      <input
        type="number"
        min={0}
        max={pct ? 100 : undefined}
        step="0.01"
        inputMode="decimal"
        className={box}
        aria-label={label}
        placeholder={enabled ? '0' : '—'}
        disabled={!enabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * The boxes of one invoice: each item's discount (and increase), then the invoice's, with what each
 * line and the invoice come to.
 */
export function AdjustEditor({
  doc,
  value,
  onChange,
  rights,
}: {
  doc: SalesDocument;
  value: AdjustBoxes;
  onChange: (v: AdjustBoxes) => void;
  rights: AdjustRights;
}) {
  const { t, locale } = useT();
  const money = (v: number) => formatMoney(v, doc.currency, locale);
  const preview = adjustPreview(doc, value);
  const lines = pricedLines(doc);
  // Increases show where there are some, or for whoever may give them.
  const mayLineIncrease = rights.line.iPct || rights.line.iAmt;
  const lineIncreases = mayLineIncrease || lines.some((l) => (l.increase ?? 0) > 0);
  const invoiceIncrease =
    rights.invoice.iPct ||
    rights.invoice.iAmt ||
    value.invoice.iPct !== '' ||
    value.invoice.iAmt !== '';
  const setLine = (id: string, k: keyof LineBoxes, v: string) =>
    onChange({ ...value, lines: { ...value.lines, [id]: { ...value.lines[id]!, [k]: v } } });
  const setInvoice = (k: keyof InvoiceBoxes, v: string) =>
    onChange({ ...value, invoice: { ...value.invoice, [k]: v } });

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t('together.itemsDiscount')}</p>
        <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
          {lines.map((l) => {
            const b = value.lines[l.id]!;
            const p = preview.lines[l.id]!;
            return (
              <li key={l.id} className="space-y-2 p-2.5">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      <ItemLink id={l.productId} name={l.productName} truncate />
                    </span>
                    <span className="text-xs text-muted tnum">
                      {formatNumber(l.unitQuantity || l.quantity, locale)} {l.unitName} ×{' '}
                      {money(l.unitPrice)}
                    </span>
                  </span>
                  <span className="shrink-0 text-end tnum">
                    {p.discount > 0 && (
                      <span className="block text-xs text-warning">−{money(p.discount)}</span>
                    )}
                    {p.increase > 0 && (
                      <span className="block text-xs text-positive">+{money(p.increase)}</span>
                    )}
                    <span className="font-medium">{money(p.net)}</span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {LINE_D.map(([k, label]) => (
                    <Box
                      key={k}
                      label={t(label as TranslationKey)}
                      value={b[k]}
                      enabled={rights.line[k]}
                      pct={k === 'dPct'}
                      onChange={(v) => setLine(l.id, k, v)}
                    />
                  ))}
                </div>
                {lineIncreases && (
                  <div className="grid grid-cols-3 gap-2">
                    {LINE_I.map(([k, label]) => (
                      <Box
                        key={k}
                        label={t(label as TranslationKey)}
                        value={b[k]}
                        enabled={rights.line[k]}
                        pct={k === 'iPct'}
                        onChange={(v) => setLine(l.id, k, v)}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {lineIncreases && !mayLineIncrease && (
          <p className="mt-1 text-xs text-faint">{t('together.increaseSeen')}</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 flex justify-between text-xs font-medium text-muted">
            <span>{t('together.invoiceDiscount')}</span>
            {preview.outcome.discount > 0 && (
              <span className="text-warning tnum">−{money(preview.outcome.discount)}</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Box
              label={t('col.discountPct')}
              value={value.invoice.dPct}
              enabled={rights.invoice.dPct}
              pct
              onChange={(v) => setInvoice('dPct', v)}
            />
            <Box
              label={t('col.discountAmount')}
              value={value.invoice.dAmt}
              enabled={rights.invoice.dAmt}
              pct={false}
              onChange={(v) => setInvoice('dAmt', v)}
            />
          </div>
        </div>
        {invoiceIncrease && (
          <div>
            <p className="mb-1 flex justify-between text-xs font-medium text-muted">
              <span>
                {t('together.invoiceIncrease')}
                {!(rights.invoice.iPct || rights.invoice.iAmt) &&
                  ` · ${t('together.increaseSeen')}`}
              </span>
              {preview.outcome.increase > 0 && (
                <span className="text-positive tnum">+{money(preview.outcome.increase)}</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Box
                label={t('col.increasePct')}
                value={value.invoice.iPct}
                enabled={rights.invoice.iPct}
                pct
                onChange={(v) => setInvoice('iPct', v)}
              />
              <Box
                label={t('col.increaseAmount')}
                value={value.invoice.iAmt}
                enabled={rights.invoice.iAmt}
                pct={false}
                onChange={(v) => setInvoice('iAmt', v)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
