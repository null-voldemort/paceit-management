// Excel export of the Forms tab, laid out exactly like the "EDC Bill" sample sheet:
// column A empty, headers on row 2 (B..L), data from row 3, Fustat / Kalpurush, centred, thin borders, sheet named after the row count.
import type { Worksheet } from 'exceljs';
import type { LogEntry, Foreman } from '../types';
import { logUpazila, upazilaKey } from './upazilas';
import { fontNameFor } from './fonts';
import { matchForeman } from './foremen';

const HEADERS = ['SL', 'NAME', 'EDC SL No', 'Internet ID', 'EMIS CODE', 'HEAD Teacher Number', 'Division', 'upazila', 'MAC address', 'Vendor', 'Verified'];
const WIDTHS = [3.9, 9.8, 38.2, 10.4, 10.7, 14.4, 19, 10, 11.8, 19.6, 11.5, 15];

const numOrText = (v?: string | number | null): string | number => {
  const t = String(v ?? '').trim();
  return /^\d{1,15}$/.test(t) ? Number(t) : t;
};

const upazilaText = (l: LogEntry, foremen: Foreman[]): string => {
  const key = logUpazila(l, foremen) || upazilaKey(l.upazila);
  return key || (l.upazila || '').trim(); // the app's own spelling, same as the Forms tab
};

// Vendor column = the foreman who handled the connection (current profile name, else the name saved on the record).
const vendorText = (l: LogEntry, foremen: Foreman[]): string =>
  (matchForeman({ foremanId: l.foremanId, foremanName: l.foremanName }, foremen)?.name || l.foremanName || '').trim();

export async function exportFormsSample(rows: LogEntry[], foremen: Foreman[], filename: string): Promise<void> {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;

  // Group by upazila (in order of first appearance) like the sample; keep the list order inside each group.
  const withUp = rows.map((l) => ({ l, up: upazilaText(l, foremen) }));
  const order: string[] = [];
  for (const x of withUp) if (!order.includes(x.up)) order.push(x.up);
  const sorted = [...withUp].sort((a, b) => order.indexOf(a.up) - order.indexOf(b.up));

  const wb = new ExcelJS.Workbook();
  const ws: Worksheet = wb.addWorksheet(String(rows.length), { views: [{ state: 'frozen', ySplit: 2 }] });
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const edge = { style: 'thin' as const };
  const border = { top: edge, bottom: edge, left: edge, right: edge };
  const center = { horizontal: 'center' as const, vertical: 'middle' as const };

  HEADERS.forEach((h, i) => {
    const c = ws.getCell(2, i + 2);
    c.value = h; c.font = { name: fontNameFor(h), size: 10, bold: true }; c.alignment = center; c.border = border;
  });
  ws.getRow(2).height = 15.75;

  sorted.forEach(({ l, up }, i) => {
    const r = i + 3;
    const vals: (string | number)[] = [
      i + 1,
      l.nameEn || l.customerName || l.nameBn || '',
      numOrText(l.edcNo),
      numOrText(l.nmsId),
      numOrText(l.emisEiinDghs),
      String(l.headTeacherPhone ?? '').trim(),
      'Sylhet',
      up,
      String(l.mac ?? '').trim(),
      vendorText(l, foremen),
      '', // Verified: left blank for a manual check
    ];
    vals.forEach((v, j) => {
      const c = ws.getCell(r, j + 2);
      c.value = v; c.font = { name: fontNameFor(v), size: 11 }; c.alignment = center; c.border = border;
      if (j === 5) c.numFmt = '@'; // phone numbers stay text, keep the leading 0
    });
    ws.getRow(r).height = 15.75;
  });

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export interface ForemanFormCount {
  name: string;
  receivedInMonth: number; // forms received in the chosen month (or any month when "All months")
  receivedAll: number; // forms received in any month
  pending: number; // forms not received yet
}

// One sheet: which foreman has how many forms (received / pending). Last row is the total.
export async function exportForemanSummary(rows: ForemanFormCount[], monthText: string, allMonths: boolean, filename: string): Promise<void> {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;

  const wb = new ExcelJS.Workbook();
  const ws: Worksheet = wb.addWorksheet('Foremen', { views: [{ state: 'frozen', ySplit: 1 }] });

  const heads = allMonths
    ? ['SL', 'Foreman', 'Received', 'Pending', 'Total']
    : ['SL', 'Foreman', `Received · ${monthText}`, 'Received · all months', 'Pending', 'Total'];
  const widths = allMonths ? [5, 28, 13, 13, 13] : [5, 28, 22, 22, 13, 13];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const edge = { style: 'thin' as const };
  const border = { top: edge, bottom: edge, left: edge, right: edge };
  const center = { horizontal: 'center' as const, vertical: 'middle' as const };
  const put = (r: number, vals: (string | number)[], bold: boolean) => {
    vals.forEach((v, j) => {
      const c = ws.getCell(r, j + 1);
      c.value = v; c.font = { name: fontNameFor(v), size: 11, bold }; c.border = border;
      c.alignment = j === 1 ? { horizontal: 'left' as const, vertical: 'middle' as const } : center;
    });
    ws.getRow(r).height = 17;
  };

  put(1, heads, true);
  const line = (x: ForemanFormCount) => allMonths
    ? [x.receivedAll, x.pending, x.receivedAll + x.pending]
    : [x.receivedInMonth, x.receivedAll, x.pending, x.receivedAll + x.pending];
  rows.forEach((x, i) => put(i + 2, [i + 1, x.name, ...line(x)], false));

  const sum = (f: (x: ForemanFormCount) => number) => rows.reduce((n, x) => n + f(x), 0);
  const totals = allMonths
    ? [sum((x) => x.receivedAll), sum((x) => x.pending), sum((x) => x.receivedAll + x.pending)]
    : [sum((x) => x.receivedInMonth), sum((x) => x.receivedAll), sum((x) => x.pending), sum((x) => x.receivedAll + x.pending)];
  put(rows.length + 2, ['', 'Total', ...totals], true);

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
