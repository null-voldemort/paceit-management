import React, { useSyncExternalStore } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { subscribePdfJob, getPdfJob, cancelPdfJob, type StageId } from '../utils/pdfStream';

const noJob = () => null;

const LABELS: Record<StageId, string> = {
  queue: 'Waiting for another form to finish',
  fill: 'Filling in the form',
  engine: 'LibreOffice is opening and laying out the form',
  write: 'Writing the PDF file',
  check: 'Checking the PDF',
  save: 'Saving to your computer',
};
const ORDER: StageId[] = ['fill', 'queue', 'engine', 'write', 'check', 'save']; // the order the server really goes through them

const secs = (ms: number) => (ms < 950 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Window shown while a UPAC form is being turned into a PDF. Every line is a real stage reported by the server. */
export const PdfProgress: React.FC = () => {
  const job = useSyncExternalStore(subscribePdfJob, getPdfJob, noJob);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!job) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [job?.since]);
  if (!job) return null;

  // Show the stages that have happened plus the ones still to come. "Waiting" appears only if it really happened.
  const shown = ORDER.filter((id) => id !== 'queue' || job.seen.includes('queue'));
  const cur = shown.indexOf(job.stage);
  const total = now - job.since;
  const inStage = now - job.stageSince;
  const finished = job.stage === 'save';
  const slow = total > 45000;

  const detail = (id: StageId): string | null => {
    if (id !== job.stage) return null;
    if (id === 'queue') return job.ahead === 1 ? '1 form is being made before yours' : `${job.ahead} forms are being made before yours`;
    if (id === 'engine') {
      if (job.retry) return 'The first try failed, starting LibreOffice again from a clean state';
      if (job.firstRun) return 'First form since the server started: LibreOffice is preparing its settings and fonts. This is slower, once.';
      if (job.typicalMs) return `Usually takes about ${secs(job.typicalMs)}`;
    }
    return null;
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-live="polite" aria-label="Making the PDF"
      className="no-print fixed inset-0 z-[900] flex items-center justify-center p-6 bg-slate-950/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-slate-100 p-6">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 shrink-0">
            {finished ? <Check className="w-6 h-6" /> : <Loader2 className="w-6 h-6 animate-spin" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1b2a4e]">{finished ? 'PDF ready' : 'Making the PDF…'}</h2>
            <p className="text-[12px] text-slate-500 truncate">{job.label}</p>
          </div>
          <div className="text-[12px] font-semibold text-slate-400 tabular-nums" title="Time so far">{clock(total)}</div>
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-300"
            style={{ width: `${Math.round(((finished ? shown.length : Math.max(cur, 0)) / shown.length) * 100)}%` }} />
        </div>
        <div className="mt-1 text-[11px] font-semibold text-slate-400">Step {Math.min(Math.max(cur, 0) + 1, shown.length)} of {shown.length}</div>

        <ol className="mt-3 space-y-1.5">
          {shown.map((id, i) => {
            const state = i < cur || finished ? 'done' : i === cur ? 'now' : 'todo';
            const note = detail(id);
            return (
              <li key={id} className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0 ${state === 'done' ? 'bg-emerald-100 text-emerald-600' : state === 'now' ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-300'}`}>
                  {state === 'done' ? <Check className="w-3 h-3" /> : state === 'now' ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] ${state === 'now' ? 'font-bold text-[#1b2a4e]' : state === 'done' ? 'text-slate-600' : 'text-slate-400'}`}>{LABELS[id]}</div>
                  {note && <div className="text-[11.5px] text-slate-500 leading-snug">{note}</div>}
                </div>
                <div className="text-[11px] tabular-nums text-slate-400 mt-0.5">
                  {state === 'done' && job.times[id] != null ? secs(job.times[id] as number) : state === 'now' && !finished ? secs(inStage) : ''}
                </div>
              </li>
            );
          })}
        </ol>

        {slow && !finished && <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">This is taking longer than usual. You can keep waiting or cancel and try again.</p>}
        {!finished && (
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={cancelPdfJob}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
