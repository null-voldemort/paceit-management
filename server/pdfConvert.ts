import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// Turns a filled Word form into a PDF with LibreOffice (the same engine as File > Export as PDF), so the PDF looks
// exactly like the one made by hand. Works on Windows, Ubuntu, Linux Mint and macOS. The Word file only ever exists
// in a temporary folder for a moment and is deleted straight after; nobody downloads it.
//
// Needs LibreOffice (Writer) on the server computer:
//   Windows: install LibreOffice from libreoffice.org (found automatically)
//   Ubuntu / Linux Mint: sudo apt install libreoffice-writer
// If LibreOffice is somewhere unusual, set PACE_SOFFICE to the full path of its "soffice" program.
// The fonts the form uses (Kalpurush, Nikosh, Times New Roman) must be installed on this computer too.

/** A problem the user can act on (LibreOffice missing, conversion failed). The message never contains file paths. */
export class PdfEngineError extends Error {}

/** The person closed the progress window (or left the page) before the PDF was finished. Not an error to report. */
export class PdfCancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'PdfCancelled'; }
}

/** Real stages of a conversion, reported as they happen so the screen can show exactly where things are. */
export type PdfStage =
  | { id: 'queue'; ahead: number }                                                   // other forms are being made first
  | { id: 'engine'; firstRun: boolean; typicalMs: number | null; retry: boolean }    // LibreOffice started, loading and laying out the form
  | { id: 'write' }                                                                  // LibreOffice is writing the PDF file
  | { id: 'check' };                                                                 // LibreOffice finished, the PDF is being checked

export interface ConvertOptions {
  signal?: AbortSignal;
  onStage?: (stage: PdfStage) => void;
  /** false for the warm-up run, so the slow first start does not distort the "usually about N s" figure */
  record?: boolean;
}

const IS_WIN = process.platform === 'win32';
const TIMEOUT_MS = Math.max(10_000, Number(process.env.PACE_PDF_TIMEOUT_MS) || 90_000);

const MISSING_MSG =
  'The PDF maker (LibreOffice) was not found on the server computer. Install LibreOffice (on Ubuntu / Linux Mint: sudo apt install libreoffice-writer), then try again.';

function exists(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function candidates(): string[] {
  const list: string[] = [];
  if (process.env.PACE_SOFFICE) list.push(process.env.PACE_SOFFICE);
  if (IS_WIN) {
    const bases = [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
    for (const b of bases) if (b) list.push(path.join(b, 'LibreOffice', 'program', 'soffice.exe'));
  } else if (process.platform === 'darwin') {
    list.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    list.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/snap/bin/libreoffice');
    try {
      for (const d of fs.readdirSync('/opt')) if (/^libreoffice/i.test(d)) list.push(path.join('/opt', d, 'program', 'soffice'));
    } catch { /* no /opt */ }
  }
  // Anything on PATH
  const exts = IS_WIN ? ['.exe', '.com'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of ['soffice', 'libreoffice']) for (const e of exts) list.push(path.join(dir, name + e));
  }
  return list;
}

let cachedExe: string | null = null;
function findSoffice(): string | null {
  if (cachedExe && exists(cachedExe)) return cachedExe;
  cachedExe = candidates().find(exists) || null; // not cached when missing, so installing LibreOffice later needs no restart
  return cachedExe;
}

export function isPdfEngineAvailable(): boolean {
  return findSoffice() !== null;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL'); // the whole process group (soffice starts a second process)
  } catch { /* already gone */ }
}

function runSoffice(exe: string, args: string[], work: string, opts: ConvertOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new PdfCancelled());
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let wrote = false;
    const child = spawn(exe, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      detached: !IS_WIN,
      env: { ...process.env, HOME: process.env.HOME || os.homedir() },
    });
    child.stderr?.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, TIMEOUT_MS);
    // LibreOffice creates its output file (and a lock / temp file next to it) only when it starts writing the PDF.
    const watcher = setInterval(() => {
      if (wrote) return;
      try {
        if (fs.readdirSync(work).some((n) => n === 'form.pdf' || n.startsWith('.~lock.form.pdf') || n.endsWith('.tmp'))) {
          wrote = true;
          opts.onStage?.({ id: 'write' });
        }
      } catch { /* folder not readable for a moment */ }
    }, 50);
    const onAbort = () => { cancelled = true; killTree(child.pid); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => { clearTimeout(timer); clearInterval(watcher); opts.signal?.removeEventListener('abort', onAbort); };
    child.on('error', (err: any) => {
      done();
      reject(err?.code === 'ENOENT' ? new PdfEngineError(MISSING_MSG) : err);
    });
    child.on('close', (code) => {
      done();
      if (cancelled) return reject(new PdfCancelled());
      if (timedOut) return reject(new PdfEngineError('The PDF maker took too long and was stopped. Try again.'));
      if (code !== 0) {
        console.error('[Pace IT] LibreOffice exited with code', code, stderr.trim());
        return reject(new Error(`soffice exit ${code}`));
      }
      if (!wrote) opts.onStage?.({ id: 'write' }); // finished faster than the watcher could look
      resolve();
    });
  });
}

// How long recent conversions really took, so the screen can say "usually about N s" from facts, not a guess.
const recent: number[] = [];
function typicalMs(): number | null {
  if (recent.length < 2) return null;
  const sorted = [...recent].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

async function convertOnce(exe: string, docx: Buffer, root: string, profile: string, opts: ConvertOptions, retry: boolean): Promise<Buffer> {
  const work = fs.mkdtempSync(path.join(root, 'job-'));
  try {
    const input = path.join(work, 'form.docx');
    fs.writeFileSync(input, docx);
    const firstRun = !fs.existsSync(profile);
    opts.onStage?.({ id: 'engine', firstRun, typicalMs: typicalMs(), retry });
    const t0 = Date.now();
    await runSoffice(exe, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`, // own profile: never collides with a LibreOffice window someone has open
      '--headless', '--invisible', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', work, input,
    ], work, opts);
    opts.onStage?.({ id: 'check' });
    const out = path.join(work, 'form.pdf');
    if (!exists(out)) throw new Error('LibreOffice produced no PDF');
    const pdf = fs.readFileSync(out);
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('LibreOffice output is not a PDF');
    if (opts.record !== false && !firstRun) { recent.push(Date.now() - t0); if (recent.length > 7) recent.shift(); }
    return pdf;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp folder, harmless */ }
  }
}

async function convert(docx: Buffer, opts: ConvertOptions): Promise<Buffer> {
  const exe = findSoffice();
  if (!exe) throw new PdfEngineError(MISSING_MSG);
  const root = path.join(process.env.PACE_PDF_TMP || os.tmpdir(), 'pace-it-pdf');
  fs.mkdirSync(root, { recursive: true });
  const profile = path.join(root, 'lo-profile');
  try {
    return await convertOnce(exe, docx, root, profile, opts, false);
  } catch (first) {
    if (first instanceof PdfEngineError || first instanceof PdfCancelled) throw first;
    // A crashed earlier run can leave a damaged profile behind: start again with a fresh one, once.
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      return await convertOnce(exe, docx, root, profile, opts, true);
    } catch (second) {
      if (second instanceof PdfEngineError || second instanceof PdfCancelled) throw second;
      console.error('[Pace IT] PDF conversion failed:', second);
      throw new PdfEngineError('The PDF could not be made. Check that LibreOffice and the form fonts are installed on the server computer.');
    }
  }
}

// One conversion at a time: LibreOffice cannot share one profile between parallel runs. Waiting jobs are told how many
// forms are ahead of them, and a job that is cancelled while waiting simply leaves the line.
interface Job {
  docx: Buffer;
  opts: ConvertOptions;
  resolve: (pdf: Buffer) => void;
  reject: (err: unknown) => void;
}
const waiting: Job[] = [];
let running: Job | null = null;

function tellPosition(job: Job): void {
  job.opts.onStage?.({ id: 'queue', ahead: (running ? 1 : 0) + waiting.indexOf(job) });
}

function pump(): void {
  if (running) return;
  const job = waiting.shift();
  if (!job) return;
  waiting.forEach(tellPosition);
  running = job;
  // Free the slot before answering, so a request made right after this one finishes is not told someone is ahead of it.
  convert(job.docx, job.opts).then(
    (pdf) => { running = null; job.resolve(pdf); pump(); },
    (err) => { running = null; job.reject(err); pump(); },
  );
}

export function docxToPdf(docx: Buffer, opts: ConvertOptions = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new PdfCancelled());
    const job: Job = { docx, opts, resolve, reject };
    opts.signal?.addEventListener('abort', () => {
      const i = waiting.indexOf(job);
      if (i < 0) return; // already running: runSoffice stops it
      waiting.splice(i, 1);
      waiting.forEach(tellPosition);
      reject(new PdfCancelled());
    }, { once: true });
    const busy = running !== null || waiting.length > 0;
    waiting.push(job);
    if (busy) tellPosition(job);
    pump();
  });
}
