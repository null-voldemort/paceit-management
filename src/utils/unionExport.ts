import { fontNameFor } from './fonts';
import type { LogEntry } from '../types';
import type { CoverageReport } from './unionStats';

const logNo = (l: LogEntry) => { const n = Number(l.logNo); return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER; };

export interface SpellingRow {
  nmsId: string; union: string; looksLike: string; upazila: string; institute: string; edc: string; logNo: string; foreman: string; sameSpelling: number;
  group: string;
}

/** Every record that belongs to a union flagged "check spelling", grouped so look-alike spellings sit next to each other. */
export function spellingRows(report: CoverageReport, logs: LogEntry[], upazila = ''): SpellingRow[] {
  const byId = new Map(logs.map((l) => [l.id, l] as const));
  const rows: SpellingRow[] = [];
  for (const u of report.unions) {
    if (!u.similarTo.length || (upazila && u.upazila !== upazila)) continue;
    const group = [u.name, ...u.similarTo.map((s) => s.name)].sort((a, b) => a.localeCompare(b))[0];
    const looksLike = u.similarTo.map((s) => `${s.name} (${s.count})`).join(', ');
    for (const id of u.logIds) {
      const l = byId.get(id);
      if (!l) continue;
      rows.push({
        nmsId: String(l.nmsId || '').trim(), union: u.name, looksLike, upazila: u.upazila,
        institute: l.nameBn || l.customerName || l.nameEn || '', edc: String(l.edcNo || '').trim(), logNo: String(l.logNo ?? ''),
        foreman: l.foremanName || '', sameSpelling: u.count, group,
      });
    }
  }
  return rows.sort((a, b) =>
    a.upazila.localeCompare(b.upazila) || a.group.localeCompare(b.group) || a.union.localeCompare(b.union) || Number(a.logNo) - Number(b.logNo));
}

/**
 * Excel file of the unions that need a spelling check, with each record's institute and location.
 * The first two columns are NMS ID and "Correct union", so after filling the second column both can be copied
 * straight into Bulk fill (IDs in the first box, values in the second).
 */
export async function exportSpellingCheck(report: CoverageReport, logs: LogEntry[], upazila = ''): Promise<number> {
  const rows = spellingRows(report, logs, upazila);
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Spelling check', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });

  const cols: [string, number][] = [
    ['NMS ID', 14], ['Correct union (type here)', 28], ['Union as written', 26], ['Looks like (other spellings)', 36], ['Upazila', 16],
    ['Institute name', 44], ['EDC No', 10], ['SL', 6], ['Foreman', 18], ['Records with this spelling', 14],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  const thin = { style: 'thin', color: { argb: 'FFD5DDD8' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const header = ws.getRow(1);
  header.height = 32;
  header.eachCell((c: any, n: number) => {
    c.font = { name: fontNameFor(String(c.value)), size: 11, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: n === 2 ? 'FFFFF1B8' : 'FFE8F3EC' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = box;
  });

  let band = false, last = '';
  rows.forEach((r, idx) => {
    const key = `${r.upazila}|${r.group}`;
    if (key !== last) { band = !band; last = key; }
    const row = ws.addRow([r.nmsId, '', r.union, r.looksLike, r.upazila, r.institute, r.edc, idx + 1, r.foreman, r.sameSpelling]);
    row.eachCell({ includeEmpty: true }, (c: any, n: number) => {
      c.font = { name: fontNameFor(c.value), size: 11 };
      c.border = box;
      c.alignment = { vertical: 'middle' };
      c.fill = n === 2
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFAE0' } }
        : band ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F9F6' } } : undefined;
    });
    row.getCell(1).numFmt = '@';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const help = wb.addWorksheet('How to use');
  help.getColumn(1).width = 110;
  [
    'Spelling check: how to fix these unions and save them in bulk',
    '',
    '1. In the "Spelling check" sheet, type the correct union name in the yellow column (Correct union). Rows in the same colour band are look-alike spellings of one union, so they usually need the same name.',
    '2. Delete the rows you do not want to change, so every row left has a correct union filled in.',
    '3. Open Connection Records > Bulk fill, choose the field "Union / address".',
    '4. Copy column A (NMS ID) of the remaining rows into the IDs box, and column B (Correct union) into the values box. Both lists have one line per row, in the same order.',
    '5. Check the preview, then press the button to save.',
    '',
    'Tip: sort or filter by Upazila first. Do not sort one column on its own, or the names will no longer match their IDs.',
    'A record with no NMS ID has an EDC No instead; Bulk fill also accepts EDC numbers.',
  ].forEach((t, i) => {
    const c = help.addRow([t]).getCell(1);
    c.font = { name: fontNameFor(t), size: i === 0 ? 14 : 11, bold: i === 0 };
    c.alignment = { wrapText: true, vertical: 'top' };
  });

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `Pace_IT_Spelling_Check${upazila ? `_${upazila}` : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return rows.length;
}
