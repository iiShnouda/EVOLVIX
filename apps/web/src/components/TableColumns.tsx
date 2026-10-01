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
 */
export function TableColumns({
  id,
  children,
  className,
  toolbar,
}: {
  /** Which table this is, e.g. "sales.invoices"; the same table everywhere shares its choice. */
  id: string;
  children: ReactNode;
  className?: string;
  /** Shown at the start of the toolbar line (e.g. a count). */
  toolbar?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [headers, setHeaders] = useState<string[]>([]);
  const [hidden, setHidden] = useHiddenColumns(id);

  // Read the header after each render, and whenever the table changes underneath.
  const read = () => {
    const cells = box.current?.querySelectorAll('thead tr:first-child > th');
    const next = cells ? [...cells].map((c) => c.textContent?.trim() ?? '') : [];
    setHeaders((prev) => (prev.join('\u0001') === next.join('\u0001') ? prev : next));
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
  const choices = headers.filter((h, i) => h && headers.indexOf(h) === i);

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
          <span className="min-w-0 text-xs text-muted">{toolbar}</span>
          {choices.length > 1 && (
            <ColumnMenu
              choices={choices}
              hidden={hidden}
              onToggle={toggle}
              onReset={() => setHidden([])}
            />
          )}
        </div>
      )}
      {css && <style>{css}</style>}
      <div ref={box} data-cols={scope}>
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
}: {
  choices: string[];
  hidden: string[];
  onToggle: (label: string) => void;
  onReset: () => void;
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
        <div className="absolute end-0 z-30 mt-1 max-h-80 w-56 overflow-auto rounded-[var(--radius-app)] border border-line bg-surface p-1 shadow-[var(--shadow-card)]">
          {choices.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <input type="checkbox" checked={!hidden.includes(c)} onChange={() => onToggle(c)} />
              <span className="truncate">{c}</span>
            </label>
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
        </div>
      )}
    </div>
  );
}
