import React from 'react';
import { Loader2 } from 'lucide-react';
import { useExportJob, dismissExportNotice } from '../utils/exportProgress';

/** Full-screen "processing" notice shown while a big PDF / Excel export is being prepared. */
export const ExportProgress: React.FC = () => {
  const job = useExportJob();
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!job) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.since]);
  if (!job) return null;
  const stuck = now - job.since > 30000; // only if something is really slow: let the person close the notice
  const known = job.pct != null;
  const pct = known ? Math.round((job.pct as number) * 100) : 0;
  return (
    <div role="alertdialog" aria-modal="true" aria-live="polite" aria-label="Processing your request"
      className="no-print fixed inset-0 z-[900] flex items-center justify-center p-6 bg-slate-950/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-slate-100 p-7 text-center">
        <span className="mx-auto grid place-items-center w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 mb-3">
          <Loader2 className="w-6 h-6 animate-spin" />
        </span>
        <h2 className="text-base font-bold text-[#1b2a4e]">Processing your request…</h2>
        <p className="text-[13px] text-slate-600 mt-1.5">
          Preparing {job.label} ({job.count.toLocaleString()} records). The download will start by itself.
          Please wait and do not click again.
        </p>
        <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
          {known
            ? <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-200" style={{ width: `${pct}%` }} />
            : <div className="export-bar h-full w-2/5 rounded-full bg-gradient-to-r from-brand-400 to-brand-600" />}
        </div>
        <div className="mt-2 text-[11px] font-semibold text-slate-400 tabular-nums">
          {known ? `${pct}%${job.stage ? ` · ${job.stage}` : ''}` : (job.stage || 'Working…')}
        </div>
        {stuck && (
          <button type="button" onClick={dismissExportNotice}
            className="mt-3 text-[12px] font-semibold text-slate-500 hover:text-slate-700 underline">Close this notice</button>
        )}
      </div>
    </div>
  );
};
