import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatMoney, type TranslationKey } from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { LabelPicker, type LabelPick } from '../components/LabelPicker';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { barsFor } from '../lib/barcode';
import { printNow } from '../lib/print';
import { useBranding, useHiddenColumns } from '../lib/queries';

/** One item's label as the server gives it, with how many to print. */
interface LabelItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number;
  currency: string;
  sizeName: string | null;
  colorName: string | null;
  count: number;
  /** Its stock when picked from the list (for "as many labels as pieces"). */
  stock?: number;
}

/**
 * Label sizes (owner, 2026-10-06: "a label printer or the small sticker sheets"). A roll prints one
 * label per page at its own size; a sheet is A4 with labels in rows and columns.
 */
interface Layout {
  id: string;
  kind: 'roll' | 'sheet';
  w: number;
  h: number;
  cols?: number;
  rows?: number;
  top?: number;
  side?: number;
  gapX?: number;
  gapY?: number;
}
const LAYOUTS: Layout[] = [
  { id: 'roll-38x25', kind: 'roll', w: 38, h: 25 },
  { id: 'roll-40x30', kind: 'roll', w: 40, h: 30 },
  { id: 'roll-50x25', kind: 'roll', w: 50, h: 25 },
  { id: 'roll-50x30', kind: 'roll', w: 50, h: 30 },
  { id: 'roll-60x40', kind: 'roll', w: 60, h: 40 },
  {
    id: 'a4-3x7',
    kind: 'sheet',
    w: 63.5,
    h: 38.1,
    cols: 3,
    rows: 7,
    top: 15.15,
    side: 7.2,
    gapX: 2.5,
    gapY: 0,
  },
  {
    id: 'a4-3x8',
    kind: 'sheet',
    w: 70,
    h: 37,
    cols: 3,
    rows: 8,
    top: 0.5,
    side: 0,
    gapX: 0,
    gapY: 0,
  },
  {
    id: 'a4-4x10',
    kind: 'sheet',
    w: 48.5,
    h: 25.4,
    cols: 4,
    rows: 10,
    top: 21.5,
    side: 8,
    gapX: 0,
    gapY: 0,
  },
  {
    id: 'a4-5x13',
    kind: 'sheet',
    w: 38.1,
    h: 21.2,
    cols: 5,
    rows: 13,
    top: 10.7,
    side: 4.75,
    gapX: 2.5,
    gapY: 0,
  },
];

type Field = 'company' | 'name' | 'code' | 'price' | 'variant' | 'digits';
const FIELDS: { key: Field; label: TranslationKey }[] = [
  { key: 'company', label: 'labels.fCompany' },
  { key: 'name', label: 'labels.fName' },
  { key: 'variant', label: 'labels.fVariant' },
  { key: 'code', label: 'labels.fCode' },
  { key: 'price', label: 'labels.fPrice' },
  { key: 'digits', label: 'labels.fDigits' },
];
const DEFAULT_FIELDS: Field[] = ['company', 'name', 'variant', 'price', 'digits'];

/** The bars of a code as an SVG that fills its box. */
function BarcodeSvg({ code }: { code: string }) {
  const bars = barsFor(code);
  if (!bars) return null;
  const quiet = 6;
  const width = bars.bits.length + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${width} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    >
      {[...bars.bits].map((b, i) =>
        b === '1' ? <rect key={i} x={i + quiet} y={0} width={1} height={10} fill="#000" /> : null,
      )}
    </svg>
  );
}

/** One label, sized in millimetres. */
function Label({
  item,
  layout,
  fields,
  company,
  locale,
}: {
  item: LabelItem;
  layout: Layout;
  fields: Set<Field>;
  company: string;
  locale: 'ar' | 'en';
}) {
  const code = item.barcode || item.sku;
  const small = Math.max(1.9, layout.h / 11);
  const variant = [item.sizeName, item.colorName].filter(Boolean).join(' · ');
  return (
    <div
      className="label-cell"
      style={{
        width: `${layout.w}mm`,
        height: `${layout.h}mm`,
        padding: '1.2mm 1.6mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        background: '#fff',
        color: '#000',
        textAlign: 'center',
        lineHeight: 1.1,
        fontSize: `${small}mm`,
      }}
    >
      {fields.has('company') && company && (
        <div style={{ fontWeight: 700, fontSize: `${small * 0.95}mm`, whiteSpace: 'nowrap' }}>
          {company}
        </div>
      )}
      {fields.has('name') && (
        <div
          style={{
            fontWeight: 600,
            maxWidth: '100%',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.name}
        </div>
      )}
      {fields.has('variant') && variant && <div>{variant}</div>}
      <div
        style={{
          flex: '1 1 auto',
          width: '100%',
          minHeight: `${layout.h * 0.28}mm`,
          padding: '0.6mm 0',
        }}
      >
        <BarcodeSvg code={code} />
      </div>
      {fields.has('digits') && (
        <div dir="ltr" style={{ fontFamily: 'monospace', letterSpacing: '0.3mm' }}>
          {code}
        </div>
      )}
      {(fields.has('code') || fields.has('price')) && (
        <div
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: fields.has('code') && item.barcode ? 'space-between' : 'center',
            gap: '1mm',
          }}
        >
          {fields.has('code') && item.barcode && (
            <span dir="ltr" style={{ fontFamily: 'monospace' }}>
              {item.sku}
            </span>
          )}
          {fields.has('price') && (
            <span style={{ fontWeight: 800, fontSize: `${small * 1.25}mm` }}>
              {formatMoney(item.price, item.currency, locale)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The labels in print order, laid out as the paper carries them. */
function Sheet({
  items,
  layout,
  fields,
  company,
  locale,
  top,
  side,
}: {
  items: LabelItem[];
  layout: Layout;
  fields: Set<Field>;
  company: string;
  locale: 'ar' | 'en';
  top: number;
  side: number;
}) {
  const copies = items.flatMap((it) => Array.from({ length: it.count }, () => it));
  if (layout.kind === 'roll')
    return (
      <div>
        {copies.map((it, i) => (
          <div
            key={i}
            className="label-page"
            style={{ height: `${layout.h - 0.3}mm`, overflow: 'hidden', breakAfter: 'page' }}
          >
            <Label item={it} layout={layout} fields={fields} company={company} locale={locale} />
          </div>
        ))}
      </div>
    );
  const per = (layout.cols ?? 1) * (layout.rows ?? 1);
  const pages = Array.from({ length: Math.ceil(copies.length / per) }, (_, p) =>
    copies.slice(p * per, (p + 1) * per),
  );
  return (
    <div>
      {pages.map((page, p) => (
        <div
          key={p}
          className="label-page"
          style={{
            width: '210mm',
            height: '296.5mm',
            overflow: 'hidden',
            boxSizing: 'border-box',
            paddingTop: `${top}mm`,
            paddingInline: `${side}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${layout.cols}, ${layout.w}mm)`,
            gridAutoRows: `${layout.h}mm`,
            columnGap: `${layout.gapX ?? 0}mm`,
            rowGap: `${layout.gapY ?? 0}mm`,
            alignContent: 'start',
            background: '#fff',
            breakAfter: 'page',
          }}
          dir="ltr"
        >
          {page.map((it, i) => (
            <div key={i} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
              <Label item={it} layout={layout} fields={fields} company={company} locale={locale} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Barcode labels (owner, 2026-10-06): choose items — or open from a purchase invoice, one label per
 * piece — pick the label size (a label printer's roll or an A4 sticker sheet) and what each label
 * shows, then print. Items with no barcode get the company's own (EAN-13 from 20…) first.
 */
export function LabelsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const [params] = useSearchParams();
  const company = useBranding().data?.companyName ?? '';
  const [items, setItems] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One count for every item (owner, 2026-10-18), or as many labels as pieces in stock.
  const [each, setEach] = useState('1');
  const [byStock, setByStock] = useState(false);
  const countFor = (stock?: number) =>
    Math.max(0, Math.min(1000, byStock ? (stock ?? 1) : Math.floor(Number(each) || 0)));
  const [saved, save] = useHiddenColumns('labels.options');
  const opt = (k: string) => saved.find((x) => x.startsWith(`${k}:`))?.slice(k.length + 1);
  const layout = LAYOUTS.find((l) => l.id === opt('layout')) ?? LAYOUTS[2]!;
  const fieldsSaved = saved.filter((x) => x.startsWith('f:')).map((x) => x.slice(2) as Field);
  const fields = new Set<Field>(saved.length ? fieldsSaved : DEFAULT_FIELDS);
  const top = Number(opt('top') ?? layout.top ?? 0);
  const side = Number(opt('side') ?? layout.side ?? 0);
  const keep = (next: { layout?: string; fields?: Field[]; top?: number; side?: number }) => {
    const l = next.layout ?? layout.id;
    const f = next.fields ?? [...fields];
    const nl = LAYOUTS.find((x) => x.id === l)!;
    save([
      `layout:${l}`,
      ...f.map((x) => `f:${x}`),
      ...(next.layout ? [] : [`top:${next.top ?? top}`, `side:${next.side ?? side}`]),
      ...(next.layout ? [`top:${nl.top ?? 0}`, `side:${nl.side ?? 0}`] : []),
    ]);
  };

  const load = async (
    query: string,
    counts?: Map<string, number>,
    stocks?: Map<string, number>,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<LabelItem[]>(`/products/labels?${query}`);
      setItems((cur) => {
        const have = new Map(cur.map((x) => [x.id, x]));
        for (const r of rows) {
          const was = have.get(r.id);
          const n = counts?.get(r.id) ?? r.count;
          const stock = stocks?.get(r.id) ?? was?.stock;
          // Picked again from the list: the count is set, not added to.
          have.set(
            r.id,
            was ? { ...was, stock, count: counts ? n : was.count + n } : { ...r, stock, count: n },
          );
        }
        return [...have.values()];
      });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setLoading(false);
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const doc = params.get('doc');
    const ids = params.get('ids');
    if (doc) void load(`documentId=${encodeURIComponent(doc)}`);
    else if (ids) void load(`ids=${encodeURIComponent(ids)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = items.reduce((n, x) => n + x.count, 0);
  const noBarcode = items.filter((x) => !x.barcode);
  const preview = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  async function print() {
    setPrinting(true);
    setError(null);
    try {
      // Items without a barcode get the company's own before their labels print.
      if (noBarcode.length && can('products:edit')) {
        const given = await api.post<Record<string, string>>(
          '/products/barcodes',
          noBarcode.map((x) => x.id),
        );
        setItems((cur) => cur.map((x) => (given[x.id] ? { ...x, barcode: given[x.id]! } : x)));
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!preview.current) return;
      const pageCss =
        layout.kind === 'roll'
          ? `@page { size: ${layout.w}mm ${layout.h}mm; margin: 0; } #print-root { font-size: inherit; }`
          : '@page { size: A4; margin: 0; }';
      printNow(preview.current, t('labels.title'), pageCss);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setPrinting(false);
    }
  }

  const sheetPreview = useMemo(
    () => (
      <Sheet
        items={items}
        layout={layout}
        fields={fields}
        company={company}
        locale={locale}
        top={top}
        side={side}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, layout.id, [...fields].join(), company, locale, top, side],
  );

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title={t('labels.title')}
          action={
            <Button variant="ghost" size="sm" icon="close" onClick={() => navigate('/inventory')}>
              {t('itemCard.back')}
            </Button>
          }
        />
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('labels.size')}</span>
            <select
              className="h-9 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm"
              value={layout.id}
              onChange={(e) => keep({ layout: e.target.value })}
            >
              <optgroup label={t('labels.roll')}>
                {LAYOUTS.filter((l) => l.kind === 'roll').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.w} × {l.h} {t('labels.mm')}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('labels.sheet')}>
                {LAYOUTS.filter((l) => l.kind === 'sheet').map((l) => (
                  <option key={l.id} value={l.id}>
                    A4 · {l.cols! * l.rows!} ({l.w} × {l.h} {t('labels.mm')})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {layout.kind === 'sheet' && (
            <>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('labels.top')}</span>
                <input
                  type="number"
                  step="0.5"
                  className="h-9 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum"
                  value={top}
                  onChange={(e) => keep({ top: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('labels.side')}</span>
                <input
                  type="number"
                  step="0.5"
                  className="h-9 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum"
                  value={side}
                  onChange={(e) => keep({ side: Number(e.target.value) || 0 })}
                />
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {FIELDS.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={fields.has(f.key)}
                  onChange={() => {
                    const next = new Set(fields);
                    if (next.has(f.key)) next.delete(f.key);
                    else next.add(f.key);
                    keep({ fields: [...next] });
                  }}
                />
                {t(f.label)}
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <span className="text-sm font-semibold">{t('labels.choose')}</span>
        <LabelPicker
          onAdd={(picks: LabelPick[]) =>
            void load(
              `ids=${picks
                .slice(0, 500)
                .map((p) => p.id)
                .join(',')}`,
              new Map(picks.map((p) => [p.id, countFor(p.stock)])),
              new Map(picks.map((p) => [p.id, p.stock])),
            ).then(async () => {
              // More than the server takes at once: the rest in further batches.
              for (let i = 500; i < picks.length; i += 500) {
                const part = picks.slice(i, i + 500);
                await load(
                  `ids=${part.map((p) => p.id).join(',')}`,
                  new Map(part.map((p) => [p.id, countFor(p.stock)])),
                  new Map(part.map((p) => [p.id, p.stock])),
                );
              }
            })
          }
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {t('labels.items')} <span className="text-muted tnum">({total})</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              icon="print"
              loading={printing}
              disabled={total === 0 || printing}
              onClick={print}
            >
              {t('labels.print')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] bg-surface-2 p-2">
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('labels.countEach')}</span>
            <input
              type="number"
              min={0}
              max={1000}
              disabled={byStock}
              className="h-9 w-24 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum disabled:opacity-50"
              value={each}
              onChange={(e) => setEach(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input
              type="checkbox"
              checked={byStock}
              onChange={(e) => setByStock(e.target.checked)}
            />
            {t('labels.byStock')}
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={items.length === 0}
            onClick={() => setItems((cur) => cur.map((x) => ({ ...x, count: countFor(x.stock) })))}
          >
            {t('labels.applyAll')}
          </Button>
          {items.length > 0 && (
            <Button size="sm" variant="dangerGhost" onClick={() => setItems([])}>
              {t('labels.clear')}
            </Button>
          )}
        </div>
        {loading ? (
          <div className="grid place-items-center py-8 text-muted">
            <Spinner size={22} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t('labels.empty')} icon="scan" />
        ) : (
          <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
            {items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{x.name}</span>
                  <span className="block text-xs text-muted" dir="ltr">
                    {x.sku} · {x.barcode ?? t('labels.willAssign')}
                  </span>
                </span>
                <span className="tnum">{formatMoney(x.price, x.currency, locale)}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  {t('labels.count')}
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    className="h-8 w-20 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm tnum"
                    value={x.count}
                    onChange={(e) =>
                      setItems((cur) =>
                        cur.map((y) =>
                          y.id === x.id
                            ? {
                                ...y,
                                count: Math.max(
                                  0,
                                  Math.min(1000, Math.floor(Number(e.target.value) || 0)),
                                ),
                              }
                            : y,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={t('invoice.remove')}
                  title={t('invoice.remove')}
                  onClick={() => setItems((cur) => cur.filter((y) => y.id !== x.id))}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-destructive-soft hover:text-destructive"
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {noBarcode.length > 0 && !can('products:edit') && (
          <p className="text-xs text-warning">{t('labels.noBarcode')}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Card>

      {items.length > 0 && (
        <Card className="space-y-2">
          <span className="text-sm font-semibold">{t('labels.preview')}</span>
          <div className="max-h-[70vh] overflow-auto rounded-[var(--radius-app)] bg-surface-2 p-3">
            <div
              style={{ zoom: layout.kind === 'roll' ? 1.6 : 0.6 }}
              className="label-preview flex flex-wrap gap-2"
            >
              <div ref={preview}>{sheetPreview}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
