import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { useHiddenColumns } from '../lib/queries';

/**
 * Wraps any table so the person can hide or show its columns (owner, 2026-10-01: every table, and
 * "saved for the next time I use the page"). The columns are read from the table's header, so a
 * table needs no change; the choice is kept per person on the server (see useHiddenColumns), so it
 * follows them to any device.
 *
 * Columns are known by their header text. A row that spans columns (a note under a line, a totals
 * label) carries `data-span` and is left as it is.
 *
 * The person may also put the columns in their own order, from the same menu (owner, 2026-10-01).
 * The table's markup stays as React made it: once a table has an order of its own it is laid out
 * as a grid whose cells take their place from CSS `order` (row by row), so no table needs a change.
 * A table with cells spanning several columns keeps its order.
 *
 * Each column can also be left off the printed page only (owner, 2026-10-22: "choose which column I
 * can print, on every page"), kept per person the same way.
 */
export function TableColumns({
  id,
  children,
  className,
  toolbar,
  onMove,
  onDrop,
  onSort,
  sorted,
}: {
  /** Which table this is, e.g. "sales.invoices"; the same table everywhere shares its choice. */
  id: string;
  children: ReactNode;
  className?: string;
  /** Shown after the columns button on the toolbar line (e.g. a count). */
  toolbar?: ReactNode;
  /**
   * Tables that render their columns in a chosen order (e.g. the invoice lines) let the person
   * move a column earlier (-1) or later (+1) from the menu.
   */
  onMove?: (label: string, step: -1 | 1) => void;
  /** Tables with their own order (see onMove) put a dragged column where it was dropped. */
  onDrop?: (label: string, target: string) => void;
  /**
   * A list sorted by the server (paged): a click on a title asks for that order instead of the
   * rows on the screen being sorted here; `sorted` says which title is in use.
   */
  onSort?: (label: string, dir: 1 | -1) => void;
  sorted?: { label: string; dir: 1 | -1 } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [headers, setHeaders] = useState<string[]>([]);
  const [spans, setSpans] = useState(false);
  const [hidden, setHidden] = useHiddenColumns(id);
  const [noPrint, setNoPrint] = useHiddenColumns(`print:${id}`);
  const [savedOrder, setOrder] = useHiddenColumns(`order:${id}`);
  const [savedWidths, setWidths] = useHiddenColumns(`width:${id}`);
  // While a column's edge is being dragged, its width before it is saved.
  const [live, setLive] = useState<{ key: string; px: number } | null>(null);
  // The column being dragged to a new place, and the one it is over.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  // Sorted by a column (owner, 2026-10-18: "click a column: biggest first, again: smallest first").
  const [ownSort, setOwnSort] = useState<{ label: string; dir: 1 | -1 } | null>(null);
  const sort = onSort ? (sorted ?? null) : ownSort;

  // Read the header after each render, and whenever the table changes underneath.
  const read = () => {
    const cells = box.current?.querySelectorAll('thead tr:first-child > th');
    const next = cells ? [...cells].map((c) => c.textContent?.trim() ?? '') : [];
    setHeaders((prev) => (prev.join('\u0001') === next.join('\u0001') ? prev : next));
    setSpans(
      !!box.current &&
        ([...box.current.querySelectorAll('td[colspan], th[colspan]')].some(
          (c) => (c as HTMLTableCellElement).colSpan > 1,
        ) ||
          !!box.current.querySelector('tr[data-span]')),
    );
  };
  useLayoutEffect(read);
  useEffect(() => {
    if (!box.current) return;
    const watch = new MutationObserver(read);
    watch.observe(box.current, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);

  const positions = headers
    .map((h, i) => (h && hidden.includes(h) ? i + 1 : 0))
    .filter((n) => n > 0);
  const printOff = headers
    .map((h, i) => (h && noPrint.includes(h) && !hidden.includes(h) ? i + 1 : 0))
    .filter((n) => n > 0);
  const css = [
    ...positions.map(
      (n) => `[data-cols="${scope}"] tr:not([data-span]) > :nth-child(${n}){display:none}`,
    ),
    ...(printOff.length
      ? [
          `@media print{${printOff
            .map((n) => `[data-cols="${scope}"] tr:not([data-span]) > :nth-child(${n})`)
            .join(',')},[data-cols="${scope}"] [data-print-off]{display:none!important}}`,
        ]
      : []),
  ].join('\n');
  // Columns with a unique, non-empty header can move; the others keep their place.
  const movable = headers.filter((h) => h && headers.indexOf(h) === headers.lastIndexOf(h));
  const known = savedOrder.filter((h) => movable.includes(h));
  const ordered = [...known, ...movable.filter((h) => !known.includes(h))];
  const slots = headers.map((h, i) => (movable.includes(h) ? i : -1)).filter((i) => i >= 0);
  // Where each column (by its place in the markup) is shown, 1-based.
  const place = headers.map((h, i) => (movable.includes(h) ? slots[ordered.indexOf(h)]! : i) + 1);
  const reorder = !onMove && !spans && place.some((p, i) => p !== i + 1);
  const choices =
    onMove || spans ? headers.filter((h, i) => h && headers.indexOf(h) === i) : ordered;
  const visible = headers.length - positions.length;

  // Column widths (owner, 2026-10-02: "wider or narrower, by the mouse"), kept per person like the
  // rest. A column is known by its header, or by its place when it has none (a check box column).
  const keyOf = (i: number) => (headers[i] ? headers[i]! : `#${i}`);
  const widths = new Map<string, number>();
  for (const w of savedWidths) {
    const [k, px] = w.split('\u0002');
    if (k && Number(px) > 0) widths.set(k, Math.round(Number(px)));
  }
  if (live) widths.set(live.key, live.px);
  const sized = widths.size > 0 && headers.length > 0 && !spans;
  const shown = headers.map((_, i) => i).filter((i) => !positions.includes(i + 1));
  const widthOf = (i: number) => widths.get(keyOf(i));
  const total = shown.reduce((sum, i) => sum + (widthOf(i) ?? 80), 0);
  const w = `[data-cols="${scope}"]`;
  const widthCss = sized
    ? [
        `${w} table{table-layout:fixed;width:max(100%,${total}px)}`,
        ...shown.map((i) => {
          const px = widthOf(i);
          return px
            ? `${w} tr:not([data-span]) > :nth-child(${i + 1}){width:${px}px;overflow:hidden;text-overflow:ellipsis}`
            : '';
        }),
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const dragCss = drag
    ? [
        `${w} tr > :nth-child(${drag.from + 1}){opacity:.55}`,
        drag.over !== drag.from
          ? `${w} tr > :nth-child(${drag.over + 1}){box-shadow:inset 0 0 0 2px var(--c-brand)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const s = `[data-cols="${scope}"][data-reorder]`;
  const orderCss = reorder
    ? [
        `@layer base{${s} table{display:grid;grid-template-columns:${
          sized
            ? shown
                .slice()
                .sort((a, b) => place[a]! - place[b]!)
                .map((i) => (widthOf(i) ? `${widthOf(i)}px` : 'auto'))
                .join(' ')
            : `repeat(${visible},auto)`
        }}`,
        `${s} :is(thead,tbody,tfoot,tr){display:contents;background-color:inherit}`,
        `${s} :is(colgroup,caption){display:none}`,
        `${s} :is(th,td){background-color:inherit;border-bottom:1px solid var(--c-line)}}`,
        ...place.map((p, i) => `${s} tr > :nth-child(${i + 1}){order:calc(var(--r,0)*256 + ${p})}`),
      ].join('\n')
    : '';

  // Each row's cells come one after the other: number the rows for the cells' `order`.
  useLayoutEffect(() => {
    if (!reorder || !box.current) return;
    const number = () =>
      box.current?.querySelectorAll('tr').forEach((row, i) => {
        if (row.style.getPropertyValue('--r') !== String(i))
          row.style.setProperty('--r', String(i));
      });
    number();
    const watch = new MutationObserver(number);
    watch.observe(box.current, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [reorder]);

  const sortAt = sort ? headers.indexOf(sort.label) : -1;
  // Every title shows it sorts (owner, 2026-10-21: the arrows on each column); the one in use
  // shows which way.
  const sortCss =
    `${w} thead tr:first-child > th:not(:empty):not(:has(input))::after{content:" \\21C5";font-size:9px;opacity:.35}` +
    (sortAt >= 0
      ? `${w} thead tr:first-child > th:nth-child(${sortAt + 1})::after{content:"${
          sort!.dir === -1 ? ' \\25BC' : ' \\25B2'
        }";font-size:9px;opacity:.8}`
      : '');

  // The rows on the screen in the chosen order, kept so as rows come and go.
  useLayoutEffect(() => {
    if (onSort || sortAt < 0 || !box.current) return;
    const dir = ownSort!.dir;
    let busy = false;
    const apply = () => {
      if (busy || !box.current) return;
      busy = true;
      box.current.querySelectorAll('tbody').forEach((body) => sortBody(body, sortAt, dir));
      busy = false;
    };
    apply();
    const watch = new MutationObserver(() => {
      if (!busy) apply();
    });
    box.current.querySelectorAll('tbody').forEach((b) => watch.observe(b, { childList: true }));
    return () => watch.disconnect();
  }, [onSort, sortAt, ownSort]);

  /** A click on a title: biggest first, then smallest first, and so on. */
  function sortBy(index: number) {
    const label = headers[index];
    if (!label) return;
    const dir: 1 | -1 = sort?.label === label && sort.dir === -1 ? 1 : -1;
    if (onSort) onSort(label, dir);
    else setOwnSort({ label, dir });
  }

  /** Put a column where another one is, and keep that order for next time. */
  function place_(label: string, target: string) {
    if (onDrop) return onDrop(label, target);
    const next = ordered.filter((h) => h !== label);
    const at = next.indexOf(target);
    if (at < 0) return;
    // Moving towards the end lands after the target, towards the start before it.
    next.splice(ordered.indexOf(label) < ordered.indexOf(target) ? at + 1 : at, 0, label);
    setOrder(next.join('\u0001') === movable.join('\u0001') ? [] : next);
  }

  // The header row, by the mouse: its edge resizes a column, its title moves it (touch screens
  // scroll as before; the menu still moves columns there).
  const canDrag = !!onDrop || (!onMove && !spans);
  const justDragged = useRef(false);
  const headerCell = (target: EventTarget | null) => {
    const th = (target as HTMLElement | null)?.closest?.('th');
    if (!th || !box.current?.contains(th)) return null;
    const row = box.current.querySelector('thead tr:first-child');
    if (!row || th.parentElement !== row) return null;
    return { th: th as HTMLTableCellElement, index: [...row.children].indexOf(th) };
  };
  const nearEdge = (th: HTMLElement, x: number) => {
    const r = th.getBoundingClientRect();
    const rtl = getComputedStyle(th).direction === 'rtl';
    return rtl ? x - r.left < 7 : r.right - x < 7;
  };
  function onPointerMove(e: ReactPointerEvent) {
    if (e.pointerType !== 'mouse' || e.buttons || !box.current) return;
    const cell = headerCell(e.target);
    box.current.style.cursor = cell && !spans && nearEdge(cell.th, e.clientX) ? 'col-resize' : '';
  }
  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const cell = headerCell(e.target);
    if (!cell) return;
    const { th, index } = cell;
    if (!spans && nearEdge(th, e.clientX)) {
      // Resize: every column's width is fixed from what is on the screen now.
      e.preventDefault();
      const rtl = getComputedStyle(th).direction === 'rtl';
      const startX = e.clientX;
      const start = th.getBoundingClientRect().width;
      const row = box.current!.querySelector('thead tr:first-child')!;
      const now = new Map<string, number>();
      [...row.children].forEach((c, i) => {
        const px = (c as HTMLElement).getBoundingClientRect().width;
        if (px > 0) now.set(keyOf(i), Math.round(px));
      });
      const key = keyOf(index);
      let px = Math.round(start);
      const move = (ev: PointerEvent) => {
        px = Math.max(36, Math.round(start + (rtl ? startX - ev.clientX : ev.clientX - startX)));
        setLive({ key, px });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        now.set(key, px);
        for (const [k, v] of widths) if (k !== key && !now.has(k)) now.set(k, v);
        setWidths([...now].map(([k, v]) => `${k}\u0002${v}`));
        setLive(null);
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const label = headers[index];
    if (!canDrag || !label || !movable.includes(label)) return;
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const startX = e.clientX;
    let moving = false;
    let over = index;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.abs(ev.clientX - startX) < 8) return;
      moving = true;
      const hit = headerCell(document.elementFromPoint(ev.clientX, ev.clientY));
      if (hit) over = hit.index;
      setDrag({ from: index, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moving) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      const target = headers[over];
      if (target && target !== label && movable.includes(target)) place_(label, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Move a column one place earlier or later, and keep that order for next time. */
  function move(label: string, step: -1 | 1) {
    const next = [...ordered];
    const at = next.indexOf(label);
    const to = at + step;
    if (at < 0 || to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to]!, next[at]!];
    setOrder(next.join('\u0001') === movable.join('\u0001') ? [] : next);
  }

  // Rows that span columns (a totals label over several): hide their one-column cells that sit
  // under a hidden column; a cell spanning several stays.
  const hiddenKey = `${positions.join(',')}|${printOff.join(',')}`;
  useLayoutEffect(() => {
    const apply = () => {
      const off = new Set(positions);
      const offPrint = new Set(printOff);
      // The title of a column left off paper says so: the printout's copy leaves it out (print.ts).
      box.current?.querySelectorAll('thead tr:first-child > th').forEach((th, i) => {
        if (offPrint.has(i + 1)) th.setAttribute('data-print-off', '');
        else th.removeAttribute('data-print-off');
      });
      box.current?.querySelectorAll('tr[data-span]').forEach((row) => {
        let col = 1;
        for (const cell of [...row.children] as HTMLTableCellElement[]) {
          const span = cell.colSpan || 1;
          cell.style.display = span === 1 && off.has(col) ? 'none' : '';
          if (span === 1 && offPrint.has(col)) cell.setAttribute('data-print-off', '');
          else cell.removeAttribute('data-print-off');
          col += span;
        }
      });
    };
    apply();
    if (!box.current) return;
    const watch = new MutationObserver(apply);
    watch.observe(box.current, { childList: true, subtree: true });
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey]);

  function toggle(label: string) {
    setHidden(hidden.includes(label) ? hidden.filter((h) => h !== label) : [...hidden, label]);
  }

  function togglePrint(label: string) {
    setNoPrint(noPrint.includes(label) ? noPrint.filter((h) => h !== label) : [...noPrint, label]);
  }

  return (
    <div className={className}>
      {(choices.length > 1 || toolbar) && (
        <div data-noprint className="flex items-center justify-between gap-2 px-1 pb-1">
          {choices.length > 1 ? (
            <ColumnMenu
              choices={choices}
              hidden={hidden}
              onToggle={toggle}
              noPrint={noPrint}
              onTogglePrint={togglePrint}
              onReset={() => {
                setHidden([]);
                setNoPrint([]);
              }}
              onMove={onMove ?? (spans ? undefined : move)}
              ordered={!onMove && known.length > 0}
              onResetOrder={() => setOrder([])}
              sized={widths.size > 0}
              onResetWidths={() => setWidths([])}
            />
          ) : (
            <span />
          )}
          <span className="min-w-0 text-xs text-muted">{toolbar}</span>
        </div>
      )}
      {(css || orderCss || widthCss || dragCss || sortCss) && (
        <style>{[css, orderCss, widthCss, dragCss, sortCss].filter(Boolean).join('\n')}</style>
      )}
      <div
        ref={box}
        data-cols={scope}
        data-reorder={reorder ? '' : undefined}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={() => box.current && (box.current.style.cursor = '')}
        onClickCapture={(e) => {
          // A drag that ends on a sortable title is not a click on it.
          if (justDragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onClick={(e) => {
          const cell = headerCell(e.target);
          if (!cell || justDragged.current) return;
          if ((e.target as HTMLElement).closest('input,select,textarea,button,a')) return;
          if (e.nativeEvent instanceof MouseEvent && !spans && nearEdge(cell.th, e.clientX)) return;
          sortBy(cell.index);
        }}
        className={drag ? 'select-none' : undefined}
      >
        {children}
      </div>
    </div>
  );
}

function ColumnMenu({
  choices,
  hidden,
  onToggle,
  noPrint,
  onTogglePrint,
  onReset,
  onMove,
  ordered,
  onResetOrder,
  sized,
  onResetWidths,
}: {
  choices: string[];
  hidden: string[];
  onToggle: (label: string) => void;
  /** Columns shown on the screen but left off the printed page. */
  noPrint: string[];
  onTogglePrint: (label: string) => void;
  onReset: () => void;
  onMove?: (label: string, step: -1 | 1) => void;
  /** The person has put the columns in their own order (offer to undo it). */
  ordered?: boolean;
  onResetOrder?: () => void;
  /** The person has set their own column widths (offer to undo it). */
  sized?: boolean;
  onResetWidths?: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const count = choices.filter((c) => hidden.includes(c)).length;
  const offPrint = choices.filter((c) => noPrint.includes(c) && !hidden.includes(c)).length;
  return (
    <div ref={menu} className="relative shrink-0">
      <button
        type="button"
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t('list.columns')}
        {count > 0 && <span className="tnum">({count})</span>}
        {offPrint > 0 && (
          <span className="inline-flex items-center gap-0.5 tnum">
            <Icon name="print" size={12} />
            {offPrint}
          </span>
        )}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="absolute start-0 z-30 mt-1 max-h-96 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-1 px-2 pb-1 text-[11px] text-muted">
            <span className="w-4 text-center" title={t('list.showColumn')}>
              <Icon name="eye" size={13} />
            </span>
            <span className="w-4 text-center" title={t('list.printColumn')}>
              <Icon name="print" size={13} />
            </span>
            <span className="ms-1">{t('list.showAndPrint')}</span>
          </div>
          {choices.map((c, i) => (
            <div key={c} className="flex items-center gap-1 rounded-md hover:bg-surface-2">
              <span className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-sm">
                <input
                  type="checkbox"
                  className="w-4 shrink-0"
                  aria-label={`${t('list.showColumn')} ${c}`}
                  checked={!hidden.includes(c)}
                  onChange={() => onToggle(c)}
                />
                <input
                  type="checkbox"
                  className="w-4 shrink-0"
                  aria-label={`${t('list.printColumn')} ${c}`}
                  disabled={hidden.includes(c)}
                  checked={!hidden.includes(c) && !noPrint.includes(c)}
                  onChange={() => onTogglePrint(c)}
                />
                <span className="ms-1 truncate">{c}</span>
              </span>
              {onMove && (
                <>
                  <button
                    type="button"
                    disabled={i === 0}
                    title={t('list.moveStart')}
                    aria-label={`${t('list.moveStart')} ${c}`}
                    onClick={() => onMove(c, -1)}
                    className="grid h-7 w-7 place-items-center rounded text-muted hover:text-fg disabled:opacity-30"
                  >
                    <Icon name="chevronRight" size={14} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    disabled={i === choices.length - 1}
                    title={t('list.moveEnd')}
                    aria-label={`${t('list.moveEnd')} ${c}`}
                    onClick={() => onMove(c, 1)}
                    className="grid h-7 w-7 place-items-center rounded text-muted hover:text-fg disabled:opacity-30"
                  >
                    <Icon name="chevronRight" size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
          {(count > 0 || offPrint > 0) && (
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-start text-xs text-brand hover:bg-surface-2"
              onClick={onReset}
            >
              {t('list.showAll')}
            </button>
          )}
          {ordered && (
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-start text-xs text-brand hover:bg-surface-2"
              onClick={onResetOrder}
            >
              {t('list.defaultOrder')}
            </button>
          )}
          {sized && (
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-start text-xs text-brand hover:bg-surface-2"
              onClick={onResetWidths}
            >
              {t('list.defaultWidths')}
            </button>
          )}
          <p className="mt-1 border-t border-line px-2 pt-1.5 text-[11px] text-muted">
            {t('list.dragHint')}
          </p>
        </div>
      )}
    </div>
  );
}

const collator = new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' });
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** A cell's value to sort by: a number when the cell is one (money, a count), else its text. */
function sortValue(cell: Element | undefined): number | string {
  const text = (cell?.textContent ?? '')
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .trim();
  const bare = text.replace(/ج\.م\.?|EGP|%|٪/g, '').replace(/[\s\u00a0]/g, '');
  if (/^[-−]?[\d,]*\.?\d+$/.test(bare)) return Number(bare.replace(/,/g, '').replace('−', '-'));
  return text;
}

/**
 * Put a table body's rows in order of one column. A row spanning columns (a note under a line)
 * stays with the row above it; such rows at the very end (totals) stay at the end.
 */
function sortBody(body: HTMLTableSectionElement, col: number, dir: 1 | -1) {
  const rows = [...body.children] as HTMLTableRowElement[];
  const isSpan = (r: HTMLTableRowElement) =>
    r.hasAttribute('data-span') || [...r.cells].some((c) => c.colSpan > 1);
  let end = rows.length;
  while (end > 0 && isSpan(rows[end - 1]!)) end--;
  const groups: HTMLTableRowElement[][] = [];
  for (const r of rows.slice(0, end)) {
    if (isSpan(r) && groups.length) groups[groups.length - 1]!.push(r);
    else groups.push([r]);
  }
  if (groups.length < 2) return;
  const keyed = groups.map((g, i) => ({ g, i, v: sortValue(g[0]!.cells[col]) }));
  keyed.sort((a, b) => {
    const x = a.v;
    const y = b.v;
    const c =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : typeof x === 'number'
          ? -1
          : typeof y === 'number'
            ? 1
            : collator.compare(x, y);
    return c * dir || a.i - b.i;
  });
  const wanted = keyed.flatMap((k) => k.g);
  if (wanted.every((r, i) => r === rows[i])) return;
  const tail = rows[end] ?? null;
  for (const r of wanted) body.insertBefore(r, tail);
}
