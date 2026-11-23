// Shared "processing" state for big exports (PDF / Excel). A big export takes several seconds before the download
// starts, and people click again because nothing seems to happen. runExport() shows a full-screen progress notice
// for big jobs and ignores clicks while one is already running. Small jobs run silently, as before.
//
// Exports that can count their own work (Top Sheet PDF / Excel) call report(fraction, stage) and the bar shows a real
// percentage. The others cannot report from inside the PDF table library, so they show a moving bar instead.
import { useSyncExternalStore } from 'react';

export const BIG_EXPORT_MIN = 30; // records; below this no notice is shown
const MAX_NOTICE_MS = 3 * 60 * 1000; // safety: the notice can never stay longer than this

export interface ExportJob { label: string; since: number; count: number; pct: number | null; stage: string }
export type Report = (fraction: number, stage?: string) => Promise<void>;

let job: ExportJob | null = null;
let busy = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const getJob = () => job;
const noJob = () => null;

export function useExportJob(): ExportJob | null {
  return useSyncExternalStore(subscribe, getJob, noJob);
}

export function dismissExportNotice() { job = null; emit(); }

// Give the browser a moment to paint the notice (setTimeout, not requestAnimationFrame: rAF never fires in a hidden tab).
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runExport(label: string, count: number, fn: (report: Report) => unknown, onError?: (e: any) => void): Promise<void> {
  if (busy) return; // a second click while the first export is still working
  busy = true;
  const big = count >= BIG_EXPORT_MIN;
  const mine: ExportJob | null = big ? { label, since: Date.now(), count, pct: null, stage: '' } : null;
  const report: Report = async (fraction, stage) => {
    if (!mine || !job || job.since !== mine.since) return;
    job = { ...job, pct: Math.max(0, Math.min(1, fraction)), stage: stage ?? job.stage }; // new object so the screen updates
    emit();
    await pause(20); // let the bar repaint before the next heavy step
  };
  try {
    if (mine) { job = mine; emit(); await pause(80); }
    await fn(report);
  } catch (e: any) {
    console.error(e);
    (onError || ((x) => alert('Export failed: ' + (x?.message || x))))(e);
  } finally {
    busy = false;
    if (mine) {
      const left = 500 - (Date.now() - mine.since);
      if (left > 0) await pause(left);
      if (job && job.since === mine.since) { job = null; emit(); }
    }
  }
}

// Watchdog: if anything ever leaves the notice up, remove it after MAX_NOTICE_MS.
setInterval(() => { if (job && Date.now() - job.since > MAX_NOTICE_MS) { job = null; busy = false; emit(); } }, 5000);
