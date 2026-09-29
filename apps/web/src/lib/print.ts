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
  /** Address, phone, tax number… */
  details: string[];
  title: string;
  subtitle?: string;
  footer: string;
}

export function printElement(el: HTMLElement, fileTitle: string, frame?: PrintFrame) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.replaceChildren();
  root.dir = document.documentElement.dir || 'ltr';
  root.lang = document.documentElement.lang;
  if (frame) root.appendChild(letterhead(frame));
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-noprint]').forEach((n) => n.remove());
  root.appendChild(copy);
  if (frame) root.appendChild(div('print-foot', frame.footer));
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
  const who = div('');
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
      .slice(0, 100) || 'SKB'
  );
}
