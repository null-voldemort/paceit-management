// Shared by the browser and the server: the Promised / Rejected tags that can be put on a target institute.
//
//   promised - a foreman confirmed that he will install the connection there.
//   rejected - the institute refused our proposal; we send an application and follow the official process until it is accepted.
//
// A tag never changes a connection record. It only says why an institute that is not connected yet is not simply
// "Left". Once a connection record with the institute's EDC number exists, the institute shows as Connected and the tag is ignored.

export type TagKind = 'promised' | 'rejected';
export type TargetStatus = 'connected' | 'promised' | 'rejected' | 'left';

/** Where a rejected institute stands in the official process. */
export const REJECT_STAGES = ['Rejected', 'Application sent', 'In process'] as const;

export interface TargetTag {
  edc: string;
  kind: TagKind;
  foremanId?: string;
  foremanName?: string;
  /** Day the promise was given / the rejection was reported (YYYY-MM-DD). */
  taggedOn: string;
  /** Promised only: the day the foreman said it will be done (YYYY-MM-DD). */
  expectedBy?: string;
  /** Rejected only: one of REJECT_STAGES. */
  stage?: string;
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** What the browser sends: the tag without its EDC number (that comes from the list of selected institutes). */
export type TagInput = Omit<TargetTag, 'edc' | 'updatedBy' | 'updatedAt'>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const clean = (v: unknown, max: number) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);

export const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Checks what the browser sent and returns a clean tag. Throws an Error with a sentence that can be shown to the person. */
export function normalizeTagInput(o: unknown, today: string = todayIso()): TagInput {
  if (!o || typeof o !== 'object') throw new Error('Choose what to mark these institutes as.');
  const r = o as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'promised' && kind !== 'rejected') throw new Error('Choose Promised or Rejected.');

  const foremanId = clean(r.foremanId, 80);
  const foremanName = clean(r.foremanName, 120);
  if (kind === 'promised' && !foremanId && !foremanName) throw new Error('Choose the foreman who promised to connect these institutes.');

  const taggedOn = clean(r.taggedOn, 10) || today;
  if (!validDay(taggedOn)) throw new Error('The date is not valid.');
  const note = clean(r.note, 500);

  const out: TagInput = { kind, taggedOn };
  if (foremanId) out.foremanId = foremanId;
  if (foremanName) out.foremanName = foremanName;
  if (note) out.note = note;

  if (kind === 'promised') {
    const expectedBy = clean(r.expectedBy, 10);
    if (expectedBy) {
      if (!validDay(expectedBy)) throw new Error('The expected date is not valid.');
      if (expectedBy < taggedOn) throw new Error('The expected date cannot be before the day it was promised.');
      out.expectedBy = expectedBy;
    }
  } else {
    const stage = clean(r.stage, 40) || REJECT_STAGES[0];
    if (!(REJECT_STAGES as readonly string[]).includes(stage)) throw new Error('Choose a valid stage for the rejection.');
    out.stage = stage;
  }
  return out;
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

/** A promise whose expected day has passed. */
export const isOverdue = (t: TargetTag, today: string = todayIso()) => t.kind === 'promised' && !!t.expectedBy && t.expectedBy < today;

/** 14 Mar 2026 */
export const fmtDay = (s?: string) => {
  if (!s || !validDay(s)) return '';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
