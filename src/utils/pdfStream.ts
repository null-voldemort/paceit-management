// Asks the server for a UPAC form as a PDF and follows its real progress. The server reports each stage as it happens
// (waiting for another form, filling the template, LibreOffice laying out the form, writing the PDF, checking it), and
// this file keeps that in a small shared store that the progress window (components/PdfProgress.tsx) shows.
// Closing the window cancels the request, and the server then stops the work.

export type StageId = 'queue' | 'fill' | 'engine' | 'write' | 'check' | 'save';

export interface PdfJob {
  label: string;
  since: number;                       // when the request started
  stage: StageId;                      // the stage the server is in now
  stageSince: number;                  // when that stage began
  times: Partial<Record<StageId, number>>; // how long each finished stage took (ms)
  seen: StageId[];                     // stages that have happened, in order
  ahead: number;                       // forms being made before this one (only while stage is 'queue')
  firstRun: boolean;                   // first conversion since the server started (slower once)
  retry: boolean;                      // the first attempt failed and LibreOffice is being started again
  typicalMs: number | null;            // how long recent conversions really took
}

export class PdfCancelledError extends Error {
  constructor() { super('Cancelled'); this.name = 'PdfCancelledError'; }
}

let job: PdfJob | null = null;
let controller: AbortController | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribePdfJob = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getPdfJob = () => job;

/** The window's Cancel button. */
export function cancelPdfJob(): void { controller?.abort(); }

function enter(id: StageId, extra: Partial<PdfJob> = {}): void {
  if (!job) return;
  const now = Date.now();
  const times = { ...job.times };
  if (job.stage !== id) times[job.stage] = now - job.stageSince;
  const seen = job.seen.includes(id) ? job.seen : [...job.seen, id];
  job = { ...job, ...extra, stage: id, stageSince: job.stage === id ? job.stageSince : now, times, seen };
  emit();
}

function applyEvent(ev: any): { filename: string; mac: string; blob: Blob } | null {
  if (ev?.t === 'stage') {
    if (ev.id === 'queue') enter('queue', { ahead: Number(ev.ahead) || 0 });
    else if (ev.id === 'engine') enter('engine', { firstRun: !!ev.firstRun, retry: !!ev.retry, typicalMs: typeof ev.typicalMs === 'number' ? ev.typicalMs : null });
    else if (ev.id === 'fill' || ev.id === 'write' || ev.id === 'check') enter(ev.id);
    return null;
  }
  if (ev?.t === 'error') throw new Error(ev.message || 'The PDF could not be made.');
  if (ev?.t === 'done') {
    const bin = atob(String(ev.pdf || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { filename: String(ev.filename || 'UPAC_Form.pdf'), mac: String(ev.mac || ''), blob: new Blob([bytes], { type: 'application/pdf' }) };
  }
  return null;
}

const MAX_WAIT_MS = 3 * 60 * 1000; // safety: never wait longer than this

/** Requests a PDF from a streaming endpoint and resolves with the file. Rejects with PdfCancelledError when cancelled. */
export async function requestPdf(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ blob: Blob; filename: string; mac: string }> {
  if (job) throw new Error('A form is already being made. Please wait for it to finish.');
  const now = Date.now();
  job = { label, since: now, stage: 'fill', stageSince: now, times: {}, seen: [], ahead: 0, firstRun: false, retry: false, typicalMs: null };
  controller = new AbortController();
  const ctl = controller;
  const watchdog = setTimeout(() => ctl.abort(), MAX_WAIT_MS);
  emit();
  let result: { filename: string; mac: string; blob: Blob } | null = null;
  try {
    const res = await fetch(url, { ...init, credentials: 'include', signal: ctl.signal });
    if (!res.ok) {
      if (res.status === 401) {
        try { const { signOut } = await import('./auth'); await signOut(); } catch { /* ignore */ }
      }
      let msg = `Could not make the form (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    const handle = (line: string) => { if (line.trim()) result = applyEvent(JSON.parse(line)) || result; };
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      buf += dec.decode();
      handle(buf);
    } else {
      (await res.text()).split('\n').forEach(handle); // very old browsers: no live stages, same result
    }
    if (!result) throw new Error('The server stopped before the PDF was ready. Please try again.');
    enter('save');
    return result;
  } catch (e: any) {
    if (e?.name === 'AbortError' || e instanceof PdfCancelledError) throw new PdfCancelledError();
    throw e;
  } finally {
    clearTimeout(watchdog);
    controller = null;
    // Leave the last step on screen for a moment so a fast job does not just flash.
    const mine = job;
    const keep = result ? Math.max(0, 700 - (Date.now() - (mine?.stageSince || Date.now()))) : 0;
    setTimeout(() => { if (job === mine) { job = null; emit(); } }, keep);
    if (!result) { job = null; emit(); }
  }
}

/** Saves a finished PDF to the computer. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
