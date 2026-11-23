import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import type { LogEntry } from '../src/types';
import { upazilaKey } from '../src/utils/upazilas';
import { CATEGORY_LABELS, displayCategory } from '../src/utils/category';
import { logDay, toInputDate } from '../src/utils/dates';

// "Simple list" export of the Connection Records page: the End User Connections List Format (Combined-Old & New Data).
// The file is NOT drawn from scratch. It is filled into template/End User Connections List.xlsx, so the title, header
// row, fonts, fills, borders, column widths, row heights and page setup are exactly the template's. To change the layout,
// edit that Excel file; to change what goes in a column, edit the mapping below.

const TEMPLATE_PATH = path.resolve(process.cwd(), 'template', 'End User Connections List.xlsx');
const FIRST_DATA_ROW = 4; // rows 1-3 are the title and the header
const COLUMNS = 24;       // A..X

// The template wants numeric IDs. Change these if your upload system uses different codes.
const ISP_ID = '';        // Pace IT's ISP ID in the upload system (blank until you set it)
const DIVISION_ID = '60'; // Sylhet division (BBS geo-code)
const DISTRICT_ID = '91'; // Sylhet district (BBS geo-code)
const UPAZILA_IDS: Record<string, string> = {
  'Balaganj': '09', 'Beanibazar': '18', 'Bishwanath': '27', 'Companiganj': '36', 'Fenchuganj': '45',
  'Golapganj': '54', 'Gowainghat': '63', 'Jaintiapur': '72', 'Kanaighat': '81', 'Sylhet Sadar': '87',
  'Zakiganj': '90', 'Dakshin Surma': '92', 'Osmani Nagar': '94',
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toEn = (v: unknown) => String(v ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).trim();
const intOrText = (v: unknown): string | number => {
  const t = toEn(v);
  return /^\d+$/.test(t) ? Number(t) : t;
};
const qty = (v: unknown): number => { const n = parseInt(toEn(v), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const macOf = (v: unknown): string => {
  const raw = toEn(v);
  const hex = raw.replace(/[\s:.\-]/g, '');
  return /^[0-9A-Fa-f]{12}$/.test(hex) ? hex.toUpperCase().match(/.{2}/g)!.join(':') : raw;
};
const ispStatus = (s: string): string => {
  const t = (s || '').toLowerCase();
  if (/inactive|cancel|disconnect/.test(t)) return 'Inactive';
  if (/resolv|done|complete|active/.test(t)) return 'Active';
  return 'Pending';
};

/** One connection record as the template's 24 columns (A..X), in the template's order. */
export function connectionRow(l: LogEntry): (string | number)[] {
  const catIdx = (CATEGORY_LABELS as readonly string[]).indexOf(displayCategory(l));
  const hasRouter = !!(toEn(l.routerSerial) || toEn(l.routerModel) || toEn(l.mac));
  const patch = Math.min(5, qty(l.patchCord));
  return [
    toEn(l.emisEiinDghs),                                  // A EMIS Code
    l.nameEn || l.customerName || '',                      // B School Name English
    l.nameBn || '',                                        // C School Name Bengali
    DIVISION_ID,                                           // D Division ID
    DISTRICT_ID,                                           // E District ID
    UPAZILA_IDS[upazilaKey(l.upazila)] || '',              // F Upazila ID
    l.unionName || '',                                     // G Union Name
    catIdx >= 0 ? catIdx + 1 : '',                         // H Institute Type ID
    ISP_ID,                                                // I ISP ID
    intOrText(l.edcNo),                                    // J EDC Book Serial No
    intOrText(l.nmsId),                                    // K NMS ID
    l.headTeacherName || '',                               // L Head Teacher Name
    toEn(l.headTeacherPhone),                              // M Head Teacher Mobile
    ispStatus(l.status),                                   // N ISP Status
    toInputDate(logDay(l)),                                // O Activation Date (YYYY-MM-DD)
    hasRouter ? 1 : 0,                                     // P Wi-Fi Router
    intOrText(l.fiberLength),                              // Q Fiber Cable Length
    qty(l.onu) > 0 ? 1 : 0,                                // R ONU Media Converter
    patch || '',                                           // S Patch Cord Qty
    qty(l.terminationBox) > 0 ? 1 : 0,                     // T TJ Box
    toEn(l.lat),                                           // U Latitude
    toEn(l.long),                                          // V Longitude
    macOf(l.mac),                                          // W Router MAC Address
    '',                                                    // X ONU MAC Address (not stored on a connection record)
  ];
}

export async function renderConnectionsXlsx(logs: LogEntry[]): Promise<Buffer> {
  if (!fs.existsSync(TEMPLATE_PATH)) throw new Error(`Connections template not found at ${TEMPLATE_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.worksheets[0];

  // Row 4 of the template is the sample data row: every record copies its look (borders, alignment) and height.
  const proto = Array.from({ length: COLUMNS }, (_, i) => structuredClone(ws.getCell(FIRST_DATA_ROW, i + 1).style));
  const height = ws.getRow(FIRST_DATA_ROW).height;

  logs.forEach((log, n) => {
    const row = ws.getRow(FIRST_DATA_ROW + n);
    if (height) row.height = height;
    connectionRow(log).forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v === '' ? null : v;
      cell.style = structuredClone(proto[c]);
    });
    row.commit();
  });
  // Template's second sample row (row 5) is left empty and bordered if there is only one record: it is part of the template.

  return Buffer.from(await wb.xlsx.writeBuffer());
}
