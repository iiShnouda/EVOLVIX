import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { TranslationKey } from '@skb/shared';
import { Button } from './ui';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { usePrintPaper } from '../lib/queries';
import { printClone, printNow, setPrintEditor, type PrintJob } from '../lib/print';

type Mode = 'text' | 'part' | 'column';
const MODES: { mode: Mode; icon: string; label: TranslationKey }[] = [
  { mode: 'text', icon: 'edit', label: 'print.modeText' },
  { mode: 'part', icon: 'close', label: 'print.modePart' },
  { mode: 'column', icon: 'close', label: 'print.modeColumn' },
];
/** Type sizes of the whole printout, as a scale of the normal one. */
const ZOOMS = { S: 0.9, M: 1, L: 1.15, XL: 1.3 } as const;
type Zoom = keyof typeof ZOOMS;

/** Where every print button's copy opens (mounted once, in the app). */
export function PrintEditorHost() {
  const [job, setJob] = useState<PrintJob | null>(null);
  useEffect(() => {
    setPrintEditor(setJob);
    return () => setPrintEditor(null);
  }, []);
  if (!job) return null;
  return <PrintEditor source={job.node} fileTitle={job.fileTitle} onClose={() => setJob(null)} />;
}

/** The cells of a table's column, whatever row they are in (a wide cell counts for each column it covers). */
function columnOf(cell: HTMLTableCellElement): HTMLTableCellElement[] {
  const table = cell.closest('table');
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || !row) return [cell];
  let start = 0;
  for (const c of Array.from(row.cells)) {
    if (c === cell) break;
    start += c.colSpan;
  }
  const out: HTMLTableCellElement[] = [];
  for (const r of Array.from(table.rows)) {
    let x = 0;
    for (const c of Array.from(r.cells)) {
      if (start >= x && start < x + c.colSpan) {
        out.push(c);
        break;
      }
      x += c.colSpan;
    }
  }
  return out;
}

/**
 * Before anything prints (owner, 2026-10-02: "every print button anywhere: show what the paper
 * carries, let me take things off and change them, then print at my ease"): the printout as it
 * will come out, where any word can be changed, any part or row taken off, any table column taken
 * off; a step back, back to how it was, the paper and type size; then print. The changes are only
 * on this printout: nothing is saved, on the device or the server.
 */
export function PrintEditor({
  source,
  fileTitle,
  onClose,
  onPrinted,
  side,
  live = false,
  zoomable = true,
}: {
  /** What prints (copied; the original is never touched). */
  source: HTMLElement | null;
  fileTitle: string;
  onClose: () => void;
  onPrinted?: () => void;
  /** More choices beside the page (a document's own print options). */
  side?: ReactNode;
  /** The source changes on screen (options); follow it until the person changes the copy. */
  live?: boolean;
  /** Offer a type size here (a document has its own, kept per person, in `side`). */
  zoomable?: boolean;
}) {
  const { t } = useT();
  const [paper, setPaper] = usePrintPaper();
  const content = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [zoom, setZoom] = useState<Zoom>('M');
  // The copy before each change (a step back restores the last one).
  const history = useRef<string[]>([]);
  const last = useRef('');
  const typing = useRef<number | undefined>(undefined);
  const [steps, setSteps] = useState(0);
  const [picked, setPicked] = useState<HTMLElement[]>([]);
  const [stale, setStale] = useState(false);

  const unpick = () => {
    content.current?.querySelectorAll('[data-pick]').forEach((n) => n.removeAttribute('data-pick'));
    setPicked([]);
  };
  const load = () => {
    const box = content.current;
    if (!box || !source) return;
    box.replaceChildren(printClone(source));
    window.clearTimeout(typing.current);
    typing.current = undefined;
    history.current = [];
    last.current = box.innerHTML;
    setSteps(0);
    setPicked([]);
    setStale(false);
  };
  useEffect(load, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  // A live source (a document whose options change behind): follow it while nothing is changed.
  useEffect(() => {
    if (!live || !source) return;
    let timer: number | undefined;
    const watch = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (history.current.length ? setStale(true) : load()), 120);
    });
    watch.observe(source, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    return () => {
      watch.disconnect();
      window.clearTimeout(timer);
    };
  }, [source, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = (before: string) => {
    history.current.push(before);
    setSteps(history.current.length);
  };
  /** Words typed since the last step become a step of their own. */
  const commitTyping = () => {
    if (typing.current === undefined || !content.current) return;
    window.clearTimeout(typing.current);
    typing.current = undefined;
    remember(last.current);
    last.current = content.current.innerHTML;
  };
  const onInput = () => {
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(commitTyping, 700);
  };

  const onPick = (e: MouseEvent<HTMLDivElement>) => {
    if (mode === 'text') return;
    e.preventDefault();
    const box = content.current;
    let el = e.target as HTMLElement;
    if (!box || el === box || !box.contains(el)) return;
    if (mode === 'column') {
      const cell = el.closest('td, th') as HTMLTableCellElement | null;
      if (cell && box.contains(cell)) pick(columnOf(cell));
      return;
    }
    const row = el.closest('tr');
    if (row && box.contains(row)) return pick([row]);
    while (
      el.parentElement &&
      el.parentElement !== box &&
      getComputedStyle(el).display.startsWith('inline')
    )
      el = el.parentElement;
    pick([el]);
  };
  const pick = (els: HTMLElement[]) => {
    content.current?.querySelectorAll('[data-pick]').forEach((n) => n.removeAttribute('data-pick'));
    els.forEach((el) => el.setAttribute('data-pick', ''));
    setPicked(els);
  };
  /** The part around what is picked (a whole table, a whole box). */
  const bigger = () => {
    const box = content.current;
    let up = picked.length === 1 ? picked[0]!.parentElement : null;
    while (up && /^(TBODY|THEAD|TFOOT)$/.test(up.tagName)) up = up.parentElement;
    if (box && up && up !== box && box.contains(up)) pick([up]);
  };
  const remove = () => {
    const box = content.current;
    if (!box || picked.length === 0) return;
    commitTyping();
    const els = picked;
    unpick();
    remember(box.innerHTML);
    for (const el of els) {
      if (el instanceof HTMLTableCellElement && el.colSpan > 1) el.colSpan -= 1;
      else el.remove();
    }
    last.current = box.innerHTML;
  };
  const undo = () => {
    const box = content.current;
    if (!box) return;
    commitTyping();
    const before = history.current.pop();
    if (before === undefined) return;
    box.innerHTML = before;
    last.current = before;
    setSteps(history.current.length);
    setPicked([]);
  };
  const print = () => {
    const box = content.current;
    if (!box) return;
    commitTyping();
    unpick();
    const node = document.createElement('div');
    node.style.zoom = String(ZOOMS[zoom]);
    node.append(...Array.from((box.cloneNode(true) as HTMLElement).childNodes));
    printNow(node, fileTitle);
    onPrinted?.();
    onClose();
  };

  useEffect(() => {
    if (picked.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const choice = (on: boolean) =>
    `px-2.5 py-1 text-xs font-semibold ${on ? 'bg-brand text-brand-fg' : 'hover:bg-surface-2'}`;

  return (
    <Sheet title={t('print.setup')} onClose={onClose} closeLabel={t('common.close')} wide="full">
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="space-y-1 rounded-[var(--radius-app)] border border-line p-1">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
              <span>{t('print.paper')}</span>
              <div className="flex overflow-hidden rounded-md border border-line">
                {(['A4', 'A5'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPaper(s)}
                    aria-pressed={paper === s}
                    className={choice(paper === s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {zoomable && (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span>{t('print.textSize')}</span>
                <div className="flex overflow-hidden rounded-md border border-line">
                  {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setZoom(z)}
                      aria-pressed={zoom === z}
                      className={choice(zoom === z)}
                    >
                      {z}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {side && <div className="border-t border-line pt-1">{side}</div>}
          </div>
          <div className="flex gap-2">
            <Button icon="print" className="flex-1" onClick={print}>
              {t('print.now')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label={t('print.edit')}
              className="flex flex-wrap gap-0.5 rounded-[var(--radius-app)] border border-line bg-surface p-0.5"
            >
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.mode}
                  onClick={() => {
                    commitTyping();
                    unpick();
                    setMode(m.mode);
                  }}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${
                    mode === m.mode ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg'
                  }`}
                >
                  <Icon name={m.icon} size={14} />
                  {t(m.label)}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" disabled={steps === 0} onClick={undo}>
              {t('print.undo')}
            </Button>
            <Button size="sm" variant="ghost" disabled={steps === 0} onClick={load}>
              {t('print.restore')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t(`print.hint.${mode}`)}</p>
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-app)] bg-destructive-soft px-2 py-1.5">
              <Button size="sm" variant="danger" icon="close" onClick={remove}>
                {t(mode === 'column' ? 'print.removeColumn' : 'print.remove')}
              </Button>
              {mode === 'part' && (
                <Button size="sm" variant="secondary" onClick={bigger}>
                  {t('print.bigger')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={unpick}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
          {stale && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-app)] bg-warning-soft px-2 py-1.5 text-xs">
              <span className="flex-1">{t('print.optionsChanged')}</span>
              <Button size="sm" variant="secondary" onClick={load}>
                {t('print.apply')}
              </Button>
            </div>
          )}
          <div className="max-h-[70vh] overflow-auto rounded-[var(--radius-app)] bg-surface-2 p-2 sm:p-4">
            <div
              className={`print-sheet mx-auto border border-line p-3 ${paper === 'A5' ? 'sm:p-[7mm]' : 'sm:p-[12mm]'}`}
              style={{
                maxWidth: paper === 'A5' ? '148mm' : '210mm',
                fontSize: paper === 'A5' ? 11 : 12,
              }}
              data-mode={mode}
            >
              <div
                ref={content}
                contentEditable={mode === 'text'}
                suppressContentEditableWarning
                spellCheck={false}
                style={{ zoom: ZOOMS[zoom] }}
                onClick={onPick}
                onInput={onInput}
                dir={document.documentElement.dir || undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
