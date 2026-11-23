import { LogEntry, Foreman } from '../types';
import { loadXlsx } from './xlsxLoader';
import { downloadRowsXlsx } from './xlsxWrite';
import { monthKey } from './months';

export type FormFilter = 'all' | 'awaiting' | 'received';

export interface FormForemanRow {
  key: string;
  name: string;
  sent: number;
  received: number;
}

export interface FormStatsResult {
  sent: number;
  received: number;
  awaiting: number;
  overdue: number;
  rows: FormForemanRow[];
}

export interface ImportPlan {
  toMark: { log: LogEntry; at: string }[];
  already: number;
  notFound: string[];
}

let cachedOverdueDays = 3;

// The number lives in the database (settings); the app loads it once at start-up and keeps this copy for the screens.
export function getOverdueDays(): number {
  return cachedOverdueDays;
}

export function setOverdueDays(n: number): void {
  if (Number.isInteger(n) && n > 0 && n < 365) cachedOverdueDays = n;
}

export function expectsForm(log: LogEntry): boolean {
  const req = (log.requestType || '').toLowerCase();
  return req.includes('new user') || req.includes('form') || Boolean(log.edcNo);
}

export function hasForm(log: LogEntry): boolean {
  return Boolean(log.formReceivedAt && log.formReceivedAt.trim());
}

// When the form was marked received in the app (the received date itself can be backdated to another month).
export function formMarkedAt(log: LogEntry): number {
  for (let i = (log.history?.length || 0) - 1; i >= 0; i--) {
    const h = log.history![i];
    if (h.changes?.some((c) => c.field === 'formReceivedAt' && c.to)) { const t = new Date(h.at).getTime(); if (!isNaN(t)) return t; }
  }
  const t = new Date(log.formReceivedAt || '').getTime();
  return isNaN(t) ? 0 : t;
}

// Newest first: a form just received, or a connection just added, comes first whatever its dates say.
export function latestActivity(log: LogEntry): number {
  const added = new Date(log.createdAt).getTime();
  return Math.max(isNaN(added) ? 0 : added, hasForm(log) ? formMarkedAt(log) : 0);
}

export function formMonthOf(log: LogEntry): string {
  const at = (log.formReceivedAt || '').trim();
  if (!at) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at.slice(0, 7); // a plain date is already in local time
  const d = new Date(at);
  return isNaN(d.getTime()) ? '' : monthKey(d);
}

// The day the form was collected, e.g. "12 Nov 2026" ('' while not received).
// Marking a form for a past month saves the 1st of that month as its received date, so the real day is taken
// from the history entry written when it was marked; the saved date is only the fallback for records without one.
export function formDateText(log: LogEntry): string {
  const at = (log.formReceivedAt || '').trim();
  if (!at) return '';
  let d: Date | null = null;
  for (let i = (log.history?.length || 0) - 1; i >= 0 && !d; i--) {
    const h = log.history![i];
    if (h.changes?.some((c) => c.field === 'formReceivedAt' && c.to)) { const t = new Date(h.at); if (!isNaN(t.getTime())) d = t; }
  }
  if (!d) {
    const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at); // a plain date is already local: no timezone shift
    d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(at);
  }
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formMonthCounts(logs: LogEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) {
    if (!expectsForm(l)) continue;
    const k = formMonthOf(l);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function monthToReceivedOn(month: string): string {
  const now = new Date();
  if (!month || month === monthKey(now)) return now.toLocaleDateString('sv-SE');
  return `${month}-01`;
}

export function daysAwaiting(log: LogEntry): number {
  if (hasForm(log)) return 0;
  const created = new Date(log.createdAt || log.date);
  if (isNaN(created.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - created.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function isFormOverdue(log: LogEntry, customLimit?: number): boolean {
  const limit = typeof customLimit === 'number' ? customLimit : getOverdueDays();
  return expectsForm(log) && !hasForm(log) && daysAwaiting(log) >= limit;
}

export function formStats(logs: LogEntry[]): FormStatsResult {
  const expecting = logs.filter(expectsForm);
  const received = expecting.filter(hasForm).length;
  const awaiting = expecting.length - received;
  const overdue = expecting.filter((l) => isFormOverdue(l)).length;

  const foremanMap = new Map<string, { sent: number; received: number }>();
  for (const log of expecting) {
    const rName = log.foremanName?.trim() || 'Unassigned';
    const curr = foremanMap.get(rName) || { sent: 0, received: 0 };
    curr.sent += 1;
    if (hasForm(log)) curr.received += 1;
    foremanMap.set(rName, curr);
  }

  const rows: FormForemanRow[] = Array.from(foremanMap.entries()).map(([name, data]) => ({
    key: name,
    name,
    sent: data.sent,
    received: data.received,
  }));

  return { sent: expecting.length, received, awaiting, overdue, rows };
}

export function awaitingByForeman(logs: LogEntry[]): Map<string, LogEntry[]> {
  const map = new Map<string, LogEntry[]>();
  for (const log of logs) {
    if (expectsForm(log) && !hasForm(log)) {
      const key = log.foremanName || 'Unassigned Foreman';
      const arr = map.get(key) || [];
      arr.push(log);
      map.set(key, arr);
    }
  }
  return map;
}

export async function planFormImport(file: File, logs: LogEntry[]): Promise<ImportPlan> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const toMark: { log: LogEntry; at: string }[] = [];
  const notFound: string[] = [];
  let already = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (!cell) continue;
      const str = String(cell).trim();
      if (!str || str.length < 3) continue;

      const matched = logs.find((l) => {
        if (l.edcNo && String(l.edcNo).trim() === str) return true;
        if (l.nmsId && String(l.nmsId).trim() === str) return true;
        if (String(l.logNo) === str) return true;
        return false;
      });

      if (matched) {
        if (hasForm(matched)) {
          already++;
        } else if (!toMark.some((x) => x.log.id === matched.id)) {
          toMark.push({ log: matched, at: now });
        }
      }
    }
  }

  return { toMark, already, notFound };
}

export async function exportFormTracker(logs: LogEntry[], onlyAwaitingOrForemen?: boolean | Foreman[]): Promise<void> {
  const onlyAwaiting = typeof onlyAwaitingOrForemen === 'boolean' ? onlyAwaitingOrForemen : false;
  let expecting = logs.filter(expectsForm);
  if (onlyAwaiting) {
    expecting = expecting.filter((l) => !hasForm(l));
  }

  const data = expecting.map((l, i) => ({
    'SL': i + 1,
    'Date': l.date,
    'Foreman': l.foremanName,
    'Foreman Phone': l.foremanPhone || '',
    'Institute Name': l.customerName,
    'Head Teacher / In-Charge': l.headTeacherName || '',
    'Head Teacher Phone': l.headTeacherPhone || '',
    'Upazila': l.upazila || '',
    'Union': l.unionName || '',
    'Coordinates': [l.lat, l.long].filter(Boolean).join(', '),
    'NMS ID': l.nmsId,
    'EDC Book No': l.edcNo || '',
    'Emis / EIIN / DGHS': l.emisEiinDghs || '',
    'MAC': l.mac || '',
    'Router Serial': l.routerSerial || '',
    'Fiber Length (m)': l.fiberLength || '',
    'Status': hasForm(l) ? 'Received' : 'Awaiting',
    'Days Awaiting': daysAwaiting(l),
    'Received month': formMonthOf(l),
    'Received At': l.formReceivedAt || '',
  }));

  await downloadRowsXlsx(
    `Pace_IT_Form_Tracker_${onlyAwaiting ? 'Awaiting_' : 'All_'}${new Date().toISOString().slice(0, 10)}.xlsx`,
    'Form Tracker',
    data
  );
}
