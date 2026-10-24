import { toMajor } from '@skb/shared';

/**
 * A small Excel (.xlsx) writer for report exports: one sheet, text and numbers, money with
 * thousands separators, a bold header and totals row, right-to-left in Arabic. A real .xlsx
 * (not CSV) opens the same in Excel, Google Sheets, LibreOffice and on phones whatever the
 * region's list separator, and Arabic text never turns into garbage. Nothing is a formula.
 */

/** A cell: text, a number, an amount of money (minor units), or empty. */
export type Cell = string | number | null | undefined | { money: number };

export interface Sheet {
  /** Tab name (cut to Excel's 31 characters). */
  name: string;
  /** Lines above the table: company, report, period… */
  title?: string[];
  header: string[];
  rows: Cell[][];
  /** Optional bold totals row. */
  total?: Cell[];
  rtl?: boolean;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Styles (cellXfs order): 0 plain · 1 bold · 2 money · 3 bold money.
const STYLES =
  `${HEAD}<styleSheet xmlns="${NS}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** A single-sheet workbook (reports). */
export function buildXlsx(sheet: Sheet): Uint8Array {
  return buildWorkbook([sheet]);
}

/** A workbook with one sheet per tab (used by the data-import template and sample files). */
export function buildWorkbook(sheets: Sheet[]): Uint8Array {
  const list: Sheet[] = sheets.length ? sheets : [{ name: 'Sheet1', header: [], rows: [] }];
  const bodies = list.map(worksheetXml);
  const names = dedupeNames(list.map((s) => cleanName(s.name)));
  const n = list.length;

  const contentTypes =
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    list
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const workbookXml =
    `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>` +
    names.map((nm, i) => `<sheet name="${xml(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const workbookRels =
    `${HEAD}<Relationships xmlns="${PKG}">` +
    list
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;

  return zip([
    ['[Content_Types].xml', contentTypes],
    [
      '_rels/.rels',
      `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', workbookRels],
    ...list.map((_, i) => [`xl/worksheets/sheet${i + 1}.xml`, bodies[i]!] as [string, string]),
    ['xl/styles.xml', STYLES],
  ]);
}

function cleanName(name: string): string {
  return (
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet1'
  );
}

/** Excel refuses two tabs with the same name; make them unique. */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    let name = raw;
    for (let i = 2; seen.has(name.toLowerCase()); i++) name = `${raw.slice(0, 28)} ${i}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

function worksheetXml(sheet: Sheet): string {
  const title = sheet.title?.filter(Boolean) ?? [];
  const lines: { cells: Cell[]; bold: boolean }[] = [
    ...title.map((t) => ({ cells: [t] as Cell[], bold: false })),
    ...(title.length ? [{ cells: [] as Cell[], bold: false }] : []),
    { cells: sheet.header, bold: true },
    ...sheet.rows.map((r) => ({ cells: r, bold: false })),
    ...(sheet.total ? [{ cells: sheet.total, bold: true }] : []),
  ];
  const headerRow = title.length ? title.length + 2 : 1;

  const widths: number[] = [];
  const rowsXml = lines
    .map(({ cells, bold }, i) => {
      const r = i + 1;
      const cellsXml = cells
        .map((c, j) => {
          const ref = `${column(j)}${r}`;
          if (c == null || c === '') return '';
          // A title line spans the sheet: don't let it widen the first column.
          if (r < headerRow)
            return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t>${xml(String(c))}</t></is></c>`;
          if (typeof c === 'object') {
            const v = toMajor(c.money);
            widths[j] = Math.max(widths[j] ?? 0, v.toFixed(2).length + 4);
            return `<c r="${ref}" s="${bold ? 3 : 2}"><v>${v}</v></c>`;
          }
          if (typeof c === 'number') {
            widths[j] = Math.max(widths[j] ?? 0, String(c).length + 2);
            return `<c r="${ref}"${bold ? ' s="1"' : ''}><v>${Number.isFinite(c) ? c : 0}</v></c>`;
          }
          widths[j] = Math.max(widths[j] ?? 0, c.length + 2);
          return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(c)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}">${cellsXml}</row>`;
    })
    .join('');

  const cols = widths
    .map((w, j) =>
      w
        ? `<col min="${j + 1}" max="${j + 1}" width="${Math.min(60, Math.max(8, w))}" customWidth="1"/>`
        : '',
    )
    .join('');
  return (
    `${HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"${sheet.rtl ? ' rightToLeft="1"' : ''}>` +
    `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

function column(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex -- only the characters XML allows are kept
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------- zip (stored)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of uncompressed entries — all an .xlsx needs. */
function zip(entries: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const files = entries.map(([name, text]) => {
    const data = enc.encode(text);
    return { name: enc.encode(name), data, crc: crc32(data) };
  });
  const size =
    files.reduce((n, f) => n + 30 + f.name.length + f.data.length + 46 + f.name.length, 0) + 22;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(p);
    u32(0x04034b50);
    u16(20);
    u16(0);
    u16(0);
    u16(0);
    u16(0x21); // 1980-01-01
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0);
    out.set(f.name, p);
    p += f.name.length;
    out.set(f.data, p);
    p += f.data.length;
  }
  const central = p;
  files.forEach((f, i) => {
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(0);
    u16(0);
    u16(0);
    u16(0x21);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(offsets[i]!);
    out.set(f.name, p);
    p += f.name.length;
  });
  const centralSize = p - central;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(central);
  u16(0);
  return out;
}
