import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
 */
export function TableColumns({
  id,
  children,
  className,
  toolbar,
  onMove,
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
}) {
  const box = useRef<HTMLDivElement>(null);
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [headers, setHeaders] = useState<string[]>([]);
  const [spans, setSpans] = useState(false);
  const [hidden, setHidden] = useHiddenColumns(id);
  const [savedOrder, setOrder] = useHiddenColumns(`order:${id}`);

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
  const css = positions
    .map((n) => `[data-cols="${scope}"] tr:not([data-span]) > :nth-child(${n}){display:none}`)
    .join('\n');
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
  const s = `[data-cols="${scope}"][data-reorder]`;
  const orderCss = reorder
    ? [
        `@layer base{${s} table{display:grid;grid-template-columns:repeat(${visible},auto)}`,
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
  const hiddenKey = positions.join(',');
  useLayoutEffect(() => {
    const apply = () => {
      const off = new Set(positions);
      box.current?.querySelectorAll('tr[data-span]').forEach((row) => {
        let col = 1;
        for (const cell of [...row.children] as HTMLTableCellElement[]) {
          const span = cell.colSpan || 1;
          cell.style.display = span === 1 && off.has(col) ? 'none' : '';
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

  return (
    <div className={className}>
      {(choices.length > 1 || toolbar) && (
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          {choices.length > 1 ? (
            <ColumnMenu
              choices={choices}
              hidden={hidden}
              onToggle={toggle}
              onReset={() => setHidden([])}
              onMove={onMove ?? (spans ? undefined : move)}
              ordered={!onMove && known.length > 0}
              onResetOrder={() => setOrder([])}
            />
          ) : (
            <span />
          )}
          <span className="min-w-0 text-xs text-muted">{toolbar}</span>
        </div>
      )}
      {(css || orderCss) && <style>{[css, orderCss].filter(Boolean).join('\n')}</style>}
      <div ref={box} data-cols={scope} data-reorder={reorder ? '' : undefined}>
        {children}
      </div>
    </div>
  );
}

function ColumnMenu({
  choices,
  hidden,
  onToggle,
  onReset,
  onMove,
  ordered,
  onResetOrder,
}: {
  choices: string[];
  hidden: string[];
  onToggle: (label: string) => void;
  onReset: () => void;
  onMove?: (label: string, step: -1 | 1) => void;
  /** The person has put the columns in their own order (offer to undo it). */
  ordered?: boolean;
  onResetOrder?: () => void;
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
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="absolute start-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]">
          {choices.map((c, i) => (
            <div key={c} className="flex items-center gap-1 rounded-md hover:bg-surface-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
                <input type="checkbox" checked={!hidden.includes(c)} onChange={() => onToggle(c)} />
                <span className="truncate">{c}</span>
              </label>
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
          {count > 0 && (
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
        </div>
      )}
    </div>
  );
}
