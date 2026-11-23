import { upazilaKey, upazilaBn } from '../src/utils/upazilas.ts';
import { ROUTER_MODELS, CABLE_BRANDS, matchChoice } from '../src/utils/formChoices.ts';

// The lists live in src/utils/formChoices.ts (the browser needs them too).
export { ROUTER_MODELS, CABLE_BRANDS };

// The UPAC / EDC form is never stored. It is built from the template (template/EDC Form.docx) each time someone asks
// for it, either from what is typed into the Form Maker or from a saved connection record. Both routes use the field
// list and the rules in this file, so the form comes out the same either way.
//
// This file has no heavy imports on purpose: it can be tested without the document library.

export interface FormField { key: string; label: string; default: string; options?: string[] }

export const FORM_FIELDS: FormField[] = [
  { key: 'name', label: 'প্রতিষ্ঠানের নাম (Institute Name)', default: '' },
  { key: 'mobile', label: 'মোবাইল নাম্বার (Mobile)', default: '' },
  { key: 'union', label: 'ইউনিয়নের নাম (Union)', default: '' },
  { key: 'upazila', label: 'উপজেলা/থানা (Upazila)', default: '' },
  { key: 'source_no', label: 'EDC Book No. / সুত্র নং', default: '' },
  { key: 'connection_nms', label: 'সংযোগ/NMS আইডি', default: '' },
  { key: 'institution_code', label: 'প্রতিষ্টানের কোড (EMIS/EIIN/OTHERS)', default: '' },
  { key: 'lat_long', label: 'Lat & Long', default: '' },
  { key: 'router_serial', label: 'রাউটার সিরিয়াল নাম্বার', default: '' },
  { key: 'router_mac', label: 'MAC address', default: '' },
  { key: 'router_model', label: 'Wi-Fi Router Brand & Model', default: ROUTER_MODELS[0], options: ROUTER_MODELS },
  { key: 'cable_brand', label: 'Optical Fiber Cable Brand', default: CABLE_BRANDS[0], options: CABLE_BRANDS },
  { key: 'cable_qty', label: 'Optical Fiber Cable Qty (meters)', default: '1500' },
];

export type FormFields = Record<string, string>;

/** Every field present, trimmed; a field with a fixed list only accepts a value that means one of that list ("nx30" is "H3C - NX30"); anything else takes the default. */
export function coerceFormFields(data: unknown): FormFields {
  const src = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const out: FormFields = {};
  for (const field of FORM_FIELDS) {
    const val = src[field.key] !== undefined && src[field.key] !== null ? String(src[field.key]).trim() : '';
    out[field.key] = field.options ? matchChoice(val, field.options) || field.default : val || field.default;
  }
  return out;
}

/** True when there is something to identify the form by (the same rule the Form Maker uses for its Download button). */
export function hasFormContent(fields: FormFields): boolean {
  return Boolean(fields.name || fields.source_no || fields.connection_nms);
}

/** The part of a connection record the form is built from. */
export interface UpacSourceLog {
  customerName?: string;
  headTeacherPhone?: string;
  unionName?: string;
  upazila?: string;
  edcNo?: string;
  nmsId?: string;
  emisEiinDghs?: string;
  lat?: string;
  long?: string;
  routerSerial?: string;
  mac?: string;
  routerModel?: string;
  cableBrand?: string;
  fiberLength?: string;
  date?: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const validYmd = (y: number, m: number, d: number): boolean => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * A connection's date as YYYY-MM-DD, or '' when it cannot be read. The app writes dates like "05 Oct 2026";
 * a plain 2026-10-05 (older imports) is accepted too.
 */
export function parseLogDate(text: string | undefined): string {
  const s = (text || '').trim();
  if (!s) return '';
  let y = 0, m = 0, d = 0;
  let hit = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3})[A-Za-z]*\.?,?[\s\-/]+(\d{4})$/);
  if (hit) {
    d = Number(hit[1]);
    m = Number(MONTHS[hit[2].toLowerCase()] || 0);
    y = Number(hit[3]);
  } else if ((hit = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/))) {
    y = Number(hit[1]); m = Number(hit[2]); d = Number(hit[3]);
  } else {
    return '';
  }
  return validYmd(y, m, d) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

/** Today as YYYY-MM-DD in the server's local time. */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The date printed on a regenerated form: the connection's own date, or today when that date is missing or unreadable. */
export function formDateOf(log: UpacSourceLog, now: Date = new Date()): string {
  return parseLogDate(log.date) || todayYmd(now);
}

/**
 * The Form Maker's fields, rebuilt from a saved connection. This is the reverse of what the Form Maker saves into the record
 * after a download. The record keeps the upazila by its English name; the workbook (and so the printed form) uses the Bangla one.
 */
export function logToFormFields(log: UpacSourceLog): FormFields {
  const rawUpazila = (log.upazila || '').trim();
  const lat = (log.lat || '').trim();
  const long = (log.long || '').trim();
  return coerceFormFields({
    name: log.customerName,
    mobile: log.headTeacherPhone,
    union: log.unionName,
    upazila: upazilaBn(upazilaKey(rawUpazila)) || rawUpazila,
    source_no: log.edcNo,
    connection_nms: log.nmsId,
    institution_code: log.emisEiinDghs,
    lat_long: lat && long ? `${lat}, ${long}` : lat || long,
    router_serial: log.routerSerial,
    router_mac: log.mac,
    router_model: log.routerModel,
    cable_brand: log.cableBrand,
    cable_qty: log.fiberLength,
  });
}
