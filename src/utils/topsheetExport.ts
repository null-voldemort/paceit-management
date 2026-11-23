// "Top Sheet" export (End user connectivity completion certificate summary), laid out like the
// "New_Top_Sheet_SADAR" sample: one sheet per upazila, at most 20 institutes per sheet. An upazila with more
// than 20 institutes is split into balanced sheets (see pageSizes), and the SL number keeps counting.
import type { Worksheet, Workbook, Alignment, Borders } from 'exceljs';
import type { LogEntry, Foreman } from '../types';
import { logUpazila, upazilaBn, UPAZILAS } from './upazilas';
import { displayCategory, CATEGORY_LABELS } from './category';
import { TOPSHEET_LOGO_BASE64 } from './topsheetLogo';
import { FONT_BN, ensureFontsLoaded } from './fonts';

export const TOPSHEET_PAGE_SIZE = 20;
export const PACKAGE_NO = 'SD-133';
export const DIVISION = 'SYLHET';
const DISTRICT = 'সিলেট';

const DEPARTMENT: Record<string, string> = {
  'Primary Education': 'প্রাথমিক শিক্ষা অধিদপ্তর',
  'Secondary and Higher Secondary Education': 'মাধ্যমিক ও উচ্চশিক্ষা অধিদপ্তর',
  'Health Service': 'স্বাস্থ্য ও পরিবার কল্যাণ মন্ত্রণালয়',
  'Technical Education': 'কারিগরি শিক্ষা',
  'Ministry of Law': 'আইন মন্ত্রণালয়',
  'Department of Social Services': 'সমাজসেবা অধিদপ্তর',
  'Diabetic Association of Bangladesh': 'বাংলাদেশ ডায়াবেটিক সমিতি',
  'National University': 'জাতীয় বিশ্ববিদ্যালয়',
  'Madrasa Education': 'মাদ্রাসা শিক্ষা অধিদপ্তর',
  'Land Reform Board': 'ভূমি সংস্কার বোর্ড',
  'Govt. Organization': 'সরকারি প্রতিষ্ঠান',
};

const BN = '০১২৩৪৫৬৭৮৯';
const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN[Number(d)]);
const numOrText = (v?: string | number | null): string | number => {
  const t = String(v ?? '').trim();
  return /^\d{1,15}$/.test(t) ? Number(t) : t;
};

export const HEAD = ['SL No.', 'EDC Book No.', 'Package No.', 'District', 'Upazila', 'Union', 'Name of Department/ Organization',
  'Institute/Organization Name', 'Contact Person Name', 'Contact Person Mobile No.', 'NMS ID', 'Length of Optical Fiber'];
// Standard column widths (from New_Top_Sheet_balagonj.xlsx); a sheet widens a column when its longest text needs it.
export const WIDTHS = [7.5, 14.47, 13.89, 10.61, 11.19, 12.51, 25.45, 30.11, 15.25, 13.29, 8.65, 13.89];

// Fonts (Top Sheet only): every Bangla run is Kalpurush, every English letter / number run is Times New Roman.
export const TOPSHEET_EN = 'Times New Roman';
const NIKOSH = FONT_BN;
const TNR = TOPSHEET_EN;
const BN_CHAR = /[ঀ-৿‌‍]/;
const LATIN_CHAR = /[A-Za-z0-9]/;
export function cleanText(t: string): string {
  return t.replace(/\s+/g, ' ').trim()
    .replace(/\u09AF\u09BC/g, '\u09DF').replace(/\u09A1\u09BC/g, '\u09DC').replace(/\u09A2\u09BC/g, '\u09DD');
}
export type Run = { text: string; bn: boolean };
export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  let pendingNeutral = '';
  for (const ch of text) {
    const bn = BN_CHAR.test(ch);
    const neutral = !bn && !LATIN_CHAR.test(ch); // spaces / punctuation join the run before them
    const last = runs[runs.length - 1];
    if (neutral) { if (last) last.text += ch; else pendingNeutral += ch; continue; }
    if (last && last.bn === bn) last.text += ch;
    else runs.push({ text: pendingNeutral + ch, bn }), pendingNeutral = '';
  }
  if (!runs.length) runs.push({ text: pendingNeutral, bn: false });
  return runs;
}
const edge = { style: 'thin' as const };
const box = { top: edge, bottom: edge, left: edge, right: edge };

// Rows (same as the sample, with room for 20 institutes): header 8, data 9-28, instruction 30, signatures 37-39.
const FIRST = 9;
const LAST = FIRST + TOPSHEET_PAGE_SIZE - 1; // 28
const NOTE_ROW = LAST + 2; // 30
const SIGN_ROW = NOTE_ROW + 7; // 37
const END_ROW = SIGN_ROW + 2; // 39

export interface Item { l: LogEntry; sl: number }

export function topsheetValues(l: LogEntry, sl: number, upazilaBnName: string): (string | number)[] {
  const cat = displayCategory(l);
  return [
    sl, numOrText(l.edcNo), PACKAGE_NO, DISTRICT, upazilaBnName, (l.unionName || '').trim(),
    DEPARTMENT[cat] || cat, l.nameBn || l.customerName || l.nameEn || '', (l.headTeacherName || '').trim(),
    bnDigits(String(l.headTeacherPhone ?? '').trim()), numOrText(l.nmsId), numOrText(l.fiberLength),
  ];
}

// Fixed texts (shared by the Excel and PDF exports).
export const TITLES = ['তথ্য ও যোগাযোগ প্রযুক্তি অধিদপ্তর', 'ডিজিটাল সংযোগ স্থাপন প্রকল্প',
  'End user connectivity সংক্রান্ত কার্জ সম্পাদন সনদপত্র এর সার-সংক্ষেপ (Top Sheet)'];
export const NOTE = 'নির্দেশিকা: ISP প্রতিষ্ঠান কর্তৃক পূরণকৃত প্রতিটি সার-সংক্ষেপ (Top Sheet) উপজেলা ও জেলা আইসিটি কর্মকর্তা যাচাই বাছাই করে প্রকল্প পরিচালক বরাবর প্রেরণ করা হলো।';
export const SIGN_LEFT = ['উপজেলা সহকারী প্রোগ্রামার/', 'সহকারী নেটওয়ার্ক ইঞ্জিনিয়ার /', 'দায়িত্বপ্রাপ্ত কর্মকর্তাঃ'];
export const SIGN_RIGHT = 'জেলা প্রোগ্রামার / দায়িত্বপ্রাপ্ত কর্মকর্তাঃ';
export const INFO_LINE = ['Package No.: ' + PACKAGE_NO, 'Name of ISP: PACE IT', 'Division: ' + DIVISION];
// Data rows: every text stays on one line at the same 11 pt size and every row has the same height; a column widens
// (per sheet) when its longest text needs more room than the standard width.
// Page margin in inches, for Excel and PDF alike. Printers cannot print right at the paper's edge (usually the outer 4-6 mm is
// skipped), so anything closer than this gets cut off on paper.
export const PAGE_MARGIN_IN = 0.3;
export const DATA_SIZE = 11;
export const DATA_ROW_H = 18;
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textPx(text: string, size: number, bold: boolean): number {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
  }
  return splitRuns(text).reduce((w, r) => {
    if (!measureCtx) return w + r.text.length * size * (96 / 72) * 0.6;
    measureCtx.font = `${bold ? 'bold ' : ''}${size * (96 / 72)}px "${r.bn ? FONT_BN : TOPSHEET_EN}", Times, serif`;
    return w + measureCtx.measureText(r.text).width;
  }, 0);
}
// One set of widths for the whole export, so every sheet / page has the same scale and margins.
export function planWidths(plan: { label: string; items: Item[] }[]): number[] {
  return sheetWidths(plan.flatMap((p) => p.items.map(({ l, sl }) => topsheetValues(l, sl, p.label))));
}
export function sheetWidths(rows: (string | number)[][]): number[] {
  return WIDTHS.map((w, j) => Math.round(rows.reduce(
    (m, vals) => Math.max(m, (textPx(cleanText(String(vals[j])), DATA_SIZE, false) * 1.04 + 3) / 7), w) * 100) / 100);
}
export const ROW_HEIGHTS: Record<number, number> = (() => {
  const h: Record<number, number> = { 1: 9.75, 2: 17.35, 3: 20.25, 4: 24, 5: 15, 6: 24, 7: 20.25, 8: 46.5, 29: 9.75, 30: 38.2,
    31: 18.55, 32: 18.55, 33: 18.55, 34: 18.55, 35: 14.25, 36: 14.25, 37: 19.5, 38: 19.5, 39: 19.5 };
  for (let r = 9; r <= 28; r++) h[r] = DATA_ROW_H;
  return h;
})();

// Layout options for a partial export (e.g. only the ticked institutes): take the column widths from the full list and
// draw all 20 row slots, so the table has exactly the size of the normal Top Sheet.
export interface TopsheetOpts { sizeLike?: LogEntry[]; fillRows?: boolean }

function buildSheet(wb: Workbook, name: string, upazilaBnName: string, items: Item[], logoId: number, widths: number[], fillRows = false) {
  const ws: Worksheet = wb.addWorksheet(name, {
    views: [{ showGridLines: true, zoomScale: 80 }],
    properties: { defaultRowHeight: 14.25 },
    pageSetup: {
      // A4 landscape, forced onto exactly one page (Excel picks the scale, ~81% like the sample), centred, no manual resize.
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, scale: 81,
      horizontalCentered: true, verticalCentered: false, showGridLines: false, blackAndWhite: false,
      margins: { left: PAGE_MARGIN_IN, right: PAGE_MARGIN_IN, top: PAGE_MARGIN_IN, bottom: PAGE_MARGIN_IN, header: 0.15, footer: 0.15 },
      printArea: `A1:L${END_ROW}`,
    },
  });
  const allVals = items.map(({ l, sl }) => topsheetValues(l, sl, upazilaBnName));
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const setH = (r: number, h: number) => { ws.getRow(r).height = h; };
  [[1, 9.75], [2, 17.35], [3, 20.25], [4, 24], [5, 15], [6, 24], [7, 20.25], [8, 46.5], [LAST + 1, 9.75], [NOTE_ROW, 38.2],
    [NOTE_ROW + 1, 18.55], [NOTE_ROW + 2, 18.55], [NOTE_ROW + 3, 18.55], [NOTE_ROW + 4, 18.55], [NOTE_ROW + 5, 14.25], [NOTE_ROW + 6, 14.25],
    [SIGN_ROW, 19.5], [SIGN_ROW + 1, 19.5], [SIGN_ROW + 2, 19.5]].forEach(([r, h]) => setH(r, h));

  const setBorder = (r: number, col: number, border: Partial<Borders>) => {
    const c = ws.getCell(r, col);
    c.style = { ...c.style, border: { ...border } };
  };

  const put = (r: number, col: number, text: string | number, size: number, bold: boolean,
    align: Partial<Alignment>) => {
    const c = ws.getCell(r, col);
    if (typeof text === 'string') text = cleanText(text);
    const str = String(text);
    const runs = typeof text === 'number' ? [{ text: str, bn: false }] : splitRuns(str);
    const f = (bn: boolean) => ({ name: bn ? NIKOSH : TNR, size, bold });
    if (runs.length === 1) { c.value = text; c.font = f(runs[0].bn); }
    else { c.value = { richText: runs.map((x) => ({ text: x.text, font: f(x.bn) })) }; c.font = f(runs[0].bn); }
    c.alignment = align;
    return c;
  };

  // Titles
  const title = (r: number, text: string, size: number) => {
    ws.mergeCells(r, 1, r, 12);
    put(r, 1, text, size, true, { horizontal: 'center', vertical: 'middle' });
  };
  title(2, 'তথ্য ও যোগাযোগ প্রযুক্তি অধিদপ্তর', 14);
  title(3, 'ডিজিটাল সংযোগ স্থাপন প্রকল্প', 14);
  title(4, 'End user connectivity সংক্রান্ত কার্জ সম্পাদন সনদপত্র এর সার-সংক্ষেপ (Top Sheet)', 14);
  // Logo: same anchor / size as the sample (1092240 x 704520 EMU, starting at column A / row 2).
  ws.addImage(logoId, {
    tl: { nativeCol: 0, nativeColOff: 190440, nativeRow: 1, nativeRowOff: 57240 } as any,
    ext: { width: 1092240 / 9525, height: 704520 / 9525 }, editAs: 'oneCell',
  } as any);

  // Package / ISP / Division line: three single cells (A:D, E:H, I:L), each centred. E:H sits on the page's centre line
  // and A:D / I:L are about the same width, so the line is symmetric about the table.
  [[1, 4, 'Package No.: ' + PACKAGE_NO], [5, 8, 'Name of ISP: PACE IT'], [9, 12, 'Division: ' + DIVISION]].forEach(([c1, c2, text]) => {
    ws.mergeCells(6, c1 as number, 6, c2 as number);
    put(6, c1 as number, text as string, 12, true, { horizontal: 'center', vertical: 'middle' });
  });

  // Column headings
  HEAD.forEach((h, i) => {
    const c = put(8, i + 1, h, 11, true, { horizontal: 'center', vertical: 'middle', wrapText: i !== 0 });
    c.border = box;
  });

  // Institutes
  items.forEach(({ l, sl }, i) => {
    const r = FIRST + i;
    allVals[i].forEach((v, j) => {
      const c = put(r, j + 1, v, DATA_SIZE, false, { horizontal: 'center', vertical: 'middle' });
      c.border = box;
    });
    setH(r, DATA_ROW_H);
  });
  for (let r = FIRST + items.length; r <= LAST; r++) {
    setH(r, DATA_ROW_H);
    if (fillRows) for (let c = 1; c <= 12; c++) ws.getCell(r, c).border = box;
  }

  // Instruction note (box around A30:L30)
  ws.mergeCells(NOTE_ROW, 1, NOTE_ROW, 12);
  put(NOTE_ROW, 1, 'নির্দেশিকা: ISP প্রতিষ্ঠান কর্তৃক পূরণকৃত প্রতিটি সার-সংক্ষেপ (Top Sheet) উপজেলা ও জেলা আইসিটি কর্মকর্তা যাচাই বাছাই করে প্রকল্প পরিচালক বরাবর প্রেরণ করা হলো।',
    15, true, { horizontal: 'center', vertical: 'middle', wrapText: true });
  for (let c = 1; c <= 12; c++) {
    setBorder(NOTE_ROW, c, { top: edge, bottom: edge, left: c === 1 ? edge : undefined, right: c === 12 ? edge : undefined });
  }

  // Signature boxes
  ws.mergeCells(SIGN_ROW, 1, SIGN_ROW, 4); ws.mergeCells(SIGN_ROW + 1, 1, SIGN_ROW + 1, 4); ws.mergeCells(SIGN_ROW + 2, 1, SIGN_ROW + 2, 4);
  ['উপজেলা সহকারী প্রোগ্রামার/', 'সহকারী নেটওয়ার্ক ইঞ্জিনিয়ার /', 'দায়িত্বপ্রাপ্ত কর্মকর্তাঃ'].forEach((t, i) =>
    put(SIGN_ROW + i, 1, t, 14, true, { horizontal: 'center', vertical: 'middle' }));
  ws.mergeCells(SIGN_ROW, 9, SIGN_ROW + 2, 12); // I:L mirrors A:D (about the same width)
  put(SIGN_ROW, 9, 'জেলা প্রোগ্রামার / দায়িত্বপ্রাপ্ত কর্মকর্তাঃ', 14, true, { horizontal: 'center', vertical: 'middle', wrapText: true });
  const outline = (c1: number, c2: number) => {
    for (let r = SIGN_ROW; r <= END_ROW; r++) for (let c = c1; c <= c2; c++) {
      setBorder(r, c, {
        top: r === SIGN_ROW ? edge : undefined, bottom: r === END_ROW ? edge : undefined,
        left: c === c1 ? edge : undefined, right: c === c2 ? edge : undefined,
      });
    }
  };
  outline(1, 4); outline(9, 12);
  return ws;
}

// How many institutes go on each page: 20 -> 20; 22 -> 11/11; 23 -> 12/11; 30 -> 15/15; 40 -> 20/20; 50 -> 20/20/10.
// Up to 40 the list is split evenly over the pages it needs. Beyond that full pages of 20 are filled first, but the
// last page never holds fewer than 10: if it would, the last two pages share their institutes evenly
// (61 -> 20/20/11/10, 45 -> 20/13/12).
const MIN_LAST_PAGE = 10;
export function pageSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n <= TOPSHEET_PAGE_SIZE) return [n];
  if (n <= TOPSHEET_PAGE_SIZE * 2) { const a = Math.ceil(n / 2); return [a, n - a]; }
  const out: number[] = [];
  for (let left = n; left > 0; left -= TOPSHEET_PAGE_SIZE) out.push(Math.min(TOPSHEET_PAGE_SIZE, left));
  if (out[out.length - 1] < MIN_LAST_PAGE) {
    const total = out.pop()! + out.pop()!;
    const a = Math.ceil(total / 2);
    out.push(a, total - a);
  }
  return out;
}

// Which upazila's Top Sheet an institute belongs to (the same rule the export uses to group them).
export const topsheetUpazila = (l: LogEntry, foremen: Foreman[]): string => logUpazila(l, foremen) || (l.upazila || '').trim() || 'No upazila';

export function planTopsheets(rows: LogEntry[], foremen: Foreman[]): { key: string; label: string; page: number; pages: number; items: Item[] }[] {
  const order = (k: string) => { const i = UPAZILAS.findIndex((u) => u.key === k); return i < 0 ? 999 : i; };
  // Top sheet order: Primary, then Secondary, then National University, then Health, then everything else
  // (keeping the usual category order inside "others").
  const TOP_ORDER = ['Primary Education', 'Secondary and Higher Secondary Education', 'National University', 'Health Service'];
  const catOrder = (l: LogEntry) => {
    const c = displayCategory(l);
    const t = TOP_ORDER.indexOf(c);
    if (t >= 0) return t;
    const i = (CATEGORY_LABELS as readonly string[]).indexOf(c);
    return TOP_ORDER.length + (i < 0 ? 99 : i);
  };
  const num = (l: LogEntry) => { const n = Number(l.logNo); return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER; };
  const groups = new Map<string, LogEntry[]>();
  for (const l of rows) {
    const k = topsheetUpazila(l, foremen);
    (groups.get(k) || groups.set(k, []).get(k)!).push(l);
  }
  const out: { key: string; label: string; page: number; pages: number; items: Item[] }[] = [];
  for (const k of [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const list = groups.get(k)!.sort((a, b) => catOrder(a) - catOrder(b) || num(a) - num(b));
    const sizes = pageSizes(list.length);
    let start = 0;
    sizes.forEach((size, p) => {
      out.push({
        key: k, label: upazilaBn(k) || k, page: p + 1, pages: sizes.length,
        items: list.slice(start, start + size).map((l, i) => ({ l, sl: start + i + 1 })),
      });
      start += size;
    });
  }
  return out;
}

export async function buildTopsheetBuffer(rows: LogEntry[], foremen: Foreman[], report?: (f: number, stage?: string) => Promise<void>, opts: TopsheetOpts = {}): Promise<ArrayBuffer> {
  await report?.(0.02, 'Loading');
  await ensureFontsLoaded();
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb: Workbook = new ExcelJS.Workbook();
  const logoId = wb.addImage({ base64: TOPSHEET_LOGO_BASE64, extension: 'jpeg' });
  const used = new Set<string>();
  const uniqueName = (raw: string) => {
    const base = raw.replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let n = base, i = 2;
    while (used.has(n.toLowerCase())) { const s = ` ${i++}`; n = base.slice(0, 31 - s.length) + s; }
    used.add(n.toLowerCase());
    return n;
  };
  const plan = planTopsheets(rows, foremen);
  const widths = planWidths(opts.sizeLike ? planTopsheets(opts.sizeLike, foremen) : plan);
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    await report?.(0.05 + 0.75 * (i / plan.length), `Sheet ${i + 1} of ${plan.length}`);
    const eng = p.key.replace(/\s+/g, ' ');
    buildSheet(wb, uniqueName(p.pages > 1 ? `${eng} ${p.page}` : eng), p.label, p.items, logoId, widths, !!opts.fillRows);
  }
  await report?.(0.85, 'Writing file');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function exportTopsheet(rows: LogEntry[], foremen: Foreman[], filename: string, report?: (f: number, stage?: string) => Promise<void>, opts: TopsheetOpts = {}): Promise<void> {
  const buf = await buildTopsheetBuffer(rows, foremen, report, opts);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  await report?.(1, 'Done');
}
