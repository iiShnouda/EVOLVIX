import type { PaperSize } from '@skb/shared';
import { buildXlsx, type Sheet } from './xlsx';

/**
 * Printing and saving files. A printout ("Save as PDF" in the same dialog) is a copy of one part
 * of the screen put in #print-root: only that prints, always in the light theme (index.css,
 * @media print). Elements marked `data-noprint` (buttons, filters) are left out.
 *
 * The Android app's WebView can neither print nor save a file the page made, so its bridge
 * (`window.SKBApp`) does both there. Nothing here keeps any data after the file is handed over.
 */

interface AndroidBridge {
  print?: (title: string) => void;
  saveFile?: (name: string, mime: string, base64: string) => void;
}

function bridge(): AndroidBridge | undefined {
  return (window as unknown as { SKBApp?: AndroidBridge }).SKBApp;
}

/** The printout's letterhead and footer. */
export interface PrintFrame {
  company: string;
  /** The company logo's address (shown beside its name), if it has one. */
  logo?: string | null;
  /** Address, phone, tax number… */
  details: string[];
  title: string;
  subtitle?: string;
  footer: string;
}

/** The paper the person prints on (A4 or A5), from their preferences. */
let paper: PaperSize = 'A4';
export function setPrintPaper(size: PaperSize) {
  paper = size;
}

/** Tell the print dialog the paper size; A5 gets narrower margins and slightly smaller type. */
function pageRule() {
  let style = document.getElementById('print-page') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page';
    document.head.appendChild(style);
  }
  style.textContent =
    paper === 'A5'
      ? '@media print { @page { size: A5; margin: 7mm; } #print-root { font-size: 11px; } }'
      : '@media print { @page { size: A4; margin: 12mm; } }';
}

/** A printout waiting in the print editor: the copy to print and the PDF's name. */
export interface PrintJob {
  node: HTMLElement;
  fileTitle: string;
}

/** Opens the print editor (components/PrintEditor.tsx registers it); none = print at once. */
let openEditor: ((job: PrintJob) => void) | null = null;
export function setPrintEditor(open: ((job: PrintJob) => void) | null) {
  openEditor = open;
}

/**
 * A copy of a part of the screen as it prints, without its buttons and filters (`data-noprint`).
 * Tables whose columns the person hid or moved (TableColumns, done with style rules) are copied as
 * they look: hidden columns left out, the others in their places, so the copy stands on its own
 * and a column taken off in the print editor takes nothing else with it.
 */
export function printClone(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  const from = Array.from(el.querySelectorAll<HTMLElement>('[data-cols]'));
  const to = Array.from(copy.querySelectorAll<HTMLElement>('[data-cols]'));
  from.forEach((src, i) => {
    const dst = to[i];
    if (!dst) return;
    const srcTables = Array.from(src.querySelectorAll('table'));
    Array.from(dst.querySelectorAll('table')).forEach((table, j) => {
      const original = srcTables[j];
      if (original) settleColumns(original, table, dst.hasAttribute('data-reorder'));
    });
    dst.removeAttribute('data-cols');
    dst.removeAttribute('data-reorder');
  });
  copy.querySelectorAll('style, [data-noprint]').forEach((n) => n.remove());
  return copy;
}

/** Copy a table's look into its copy: drop the hidden columns, put moved ones in their places. */
function settleColumns(src: HTMLTableElement, dst: HTMLTableElement, reordered: boolean) {
  const head = src.tHead?.rows[0] ?? src.rows[0];
  if (!head) return;
  const hidden = new Set<number>();
  let col = 0;
  for (const cell of Array.from(head.cells)) {
    if (getComputedStyle(cell).display === 'none')
      for (let k = 0; k < cell.colSpan; k++) hidden.add(col + k);
    col += cell.colSpan;
  }
  const srcRows = Array.from(src.rows);
  Array.from(dst.rows).forEach((row, r) => {
    const cells = Array.from(row.cells);
    const order = new Map<HTMLTableCellElement, number>();
    if (reordered && cells.every((c) => c.colSpan === 1)) {
      const srcCells = srcRows[r] ? Array.from(srcRows[r]!.cells) : [];
      cells.forEach((c, k) => order.set(c, Number(getComputedStyle(srcCells[k] ?? c).order) || 0));
    }
    let at = 0;
    for (const cell of cells) {
      const span = cell.colSpan;
      let off = 0;
      for (let k = 0; k < span; k++) if (hidden.has(at + k)) off++;
      at += span;
      if (off >= span) cell.remove();
      else if (off) cell.colSpan = span - off;
      cell.style.removeProperty('display');
      cell.style.removeProperty('width');
    }
    if (order.size)
      Array.from(row.cells)
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
        .forEach((c) => row.appendChild(c));
  });
}

/** A copy of a part of the screen as it prints: the letterhead, the part and the footer. */
export function printCopy(el: HTMLElement, frame?: PrintFrame): HTMLElement {
  const box = document.createElement('div');
  if (frame) box.appendChild(letterhead(frame));
  box.appendChild(printClone(el));
  if (frame) box.appendChild(div('print-foot', frame.footer));
  return box;
}

/**
 * Every print button (owner, 2026-10-02: "show me what the paper carries, let me take things off
 * and change them, then print"): the copy opens in the print editor first; it prints from there.
 */
export function printElement(el: HTMLElement, fileTitle: string, frame?: PrintFrame) {
  const node = printCopy(el, frame);
  if (openEditor) openEditor({ node, fileTitle });
  else printNow(node, fileTitle);
}

/** Print (or save as PDF) this copy now, as it is. */
export function printNow(node: HTMLElement, fileTitle: string) {
  pageRule();
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.replaceChildren();
  root.dir = document.documentElement.dir || 'ltr';
  root.lang = document.documentElement.lang;
  root.appendChild(node.cloneNode(true));
  document.body.classList.add('printing');

  const android = bridge();
  if (android?.print) {
    android.print(fileTitle);
    return;
  }
  // The browser names the PDF after the page title.
  const before = document.title;
  document.title = fileTitle;
  const restore = () => {
    if (document.title === fileTitle) document.title = before;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  // Desktop browsers return from print() when the dialog closes; phones may not say so.
  setTimeout(restore, 5000);
}

function letterhead(f: PrintFrame): HTMLElement {
  const head = div('print-head');
  if (f.logo) {
    const img = document.createElement('img');
    img.className = 'print-logo';
    img.src = f.logo;
    img.alt = '';
    head.appendChild(img);
  }
  const who = div('print-who');
  who.appendChild(div('print-company', f.company));
  for (const d of f.details) who.appendChild(div('print-detail', d));
  const what = div('print-what');
  what.appendChild(div('print-title', f.title));
  if (f.subtitle) what.appendChild(div('print-detail', f.subtitle));
  head.append(who, what);
  return head;
}

function div(className: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  if (className) d.className = className;
  if (text) {
    // Latin text (an address, an email) keeps its own order inside an Arabic page.
    const b = document.createElement('bdi');
    b.textContent = text;
    d.appendChild(b);
  }
  return d;
}

/** Save a file the page made (download on the web, Windows and iPhone; "save as" on Android). */
export function saveFile(name: string, mime: string, bytes: Uint8Array) {
  const android = bridge();
  if (android?.saveFile) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    android.saveFile(name, mime, btoa(bin));
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function saveXlsx(fileName: string, sheet: Sheet) {
  saveFile(`${safeName(fileName)}.xlsx`, XLSX_MIME, buildXlsx(sheet));
}

/** A file name without characters Windows or phones refuse. */
export function safeName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Evolvix'
  );
}
