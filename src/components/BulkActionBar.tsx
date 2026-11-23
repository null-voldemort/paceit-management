import React, { useEffect, useRef, useState } from 'react';
import {
  X, UserCog, Layers, CircleDot, CalendarClock, ClipboardCheck, Download, MoreHorizontal, FileSpreadsheet, FileText,
  Copy, MapPin, Trash2, Check, ChevronUp, Loader2, Wifi,
} from 'lucide-react';
import { Foreman, LogEntry } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { upazilaKey } from '../utils/upazilas';
import { TERM_PRESETS } from '../utils/terms';
import { INITIAL_SUGGESTIONS } from '../utils/storage';
import { addDaysIso } from '../utils/followUps';
import { displayName, NameLang } from '../utils/names';
import { exportBatchLogsExcel } from '../utils/exportExcel';
import { exportBatchLogsPdf } from '../utils/exportPdf';
import { runExport } from '../utils/exportProgress';
import { ROUTER_MODELS } from '../utils/formChoices';

// The bar that appears at the bottom of the Connection Records list once rows are ticked.
// One compact row of grouped menus (Foreman, Term, Status, Follow-up, Router, Forms & bills, Export, More); each menu opens
// upward, a pick that changes data asks for one confirmation, and nothing is saved before that.

export interface BulkHandlers {
  foreman: (ids: string[], foremanId: string) => Promise<void>;
  term: (ids: string[], term: string) => Promise<void>;
  status: (ids: string[], status: string) => Promise<void>;
  followUp: (ids: string[], date: string) => Promise<void>;
  /** Sets the router model printed on the UPAC form; an empty value clears it (the form then uses the standard router). */
  routerModel: (ids: string[], model: string) => Promise<void>;
  /** Opens the usual form / bill confirmation (month, admin approval) for the chosen connections. */
  mark: (logs: LogEntry[], kind: 'form' | 'bill', action: 'received' | 'not_received') => void;
  fixUpazila: (ids: string[]) => Promise<void>;
  /** Admin only; left out for everyone else. */
  remove?: (ids: string[]) => Promise<void>;
  notify: (message: string) => void;
}

type MenuKey = 'foreman' | 'term' | 'status' | 'follow' | 'router' | 'mark' | 'export' | 'more';

interface Ask { title: string; message: string; confirmLabel: string; destructive?: boolean; run: () => Promise<void> }

interface Props {
  /** The ticked connections, in list order. */
  selected: LogEntry[];
  /** Every connection in the current list (used for "Select all" and the terms / statuses seen in the data). */
  all: LogEntry[];
  foremen: Foreman[];
  nameLang: NameLang;
  handlers: BulkHandlers;
  onSelectAll: () => void;
  onClear: () => void;
}

const pill = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const panel = 'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-60 max-w-[calc(100vw-1.5rem)] max-h-72 overflow-y-auto overscroll-contain rounded-xl bg-white text-[#1b2a4e] shadow-[0_18px_40px_-10px_rgba(10,20,50,0.45)] border border-slate-200 py-1 text-xs';

const Item: React.FC<{ icon?: React.ElementType; label: string; sub?: string; onClick: () => void; danger?: boolean; disabled?: boolean }> = ({ icon: Icon, label, sub, onClick, danger, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${danger ? 'text-rose-700 hover:bg-rose-50' : 'hover:bg-brand-50'}`}>
    {Icon && <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />}
    <span className="min-w-0 flex-1">
      <span className="block font-semibold truncate">{label}</span>
      {sub && <span className="block text-[10.5px] text-slate-400 truncate">{sub}</span>}
    </span>
  </button>
);

const Head: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{children}</p>
);

const Rule = () => <div className="my-1 border-t border-slate-100" />;

export const BulkActionBar: React.FC<Props> = ({ selected, all, foremen, nameLang, handlers, onSelectAll, onClear }) => {
  const [open, setOpen] = useState<MenuKey | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customDate, setCustomDate] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const n = selected.length;
  const ids = () => selected.map((l) => l.id);
  const count = (k: number) => `${k.toLocaleString()} connection${k === 1 ? '' : 's'}`;

  // close the open menu on an outside click / Escape
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const foremanChoices = foremen.filter((r) => r.active && !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const terms = [...new Set([...TERM_PRESETS, ...all.map((l) => (l.term || '').trim()).filter(Boolean)])];
  const statuses = [...new Set([...INITIAL_SUGGESTIONS.status, ...all.map((l) => (l.status || '').trim()).filter(Boolean)])];

  const choose = (a: Ask) => { setOpen(null); setError(''); setAsk(a); };
  const confirm = async () => {
    if (!ask) return;
    setBusy(true); setError('');
    try { await ask.run(); setAsk(null); onClear(); }
    catch (e: any) { setError(e?.message || 'Could not finish that action.'); setAsk(null); }
    finally { setBusy(false); }
  };

  const copyList = async (what: string, pick: (l: LogEntry) => string) => {
    setOpen(null);
    const lines = selected.map(pick).filter(Boolean);
    if (!lines.length) { handlers.notify(`None of the selected connections has ${what}.`); return; }
    try { await navigator.clipboard.writeText(lines.join('\n')); handlers.notify(`Copied ${lines.length.toLocaleString()} ${what}${lines.length === 1 ? '' : (what.endsWith('s') ? '' : 's')}`); }
    catch { handlers.notify('Copy was blocked by the browser.'); }
  };

  const runExportNow = async (kind: 'excel' | 'pdf') => {
    setOpen(null);
    try {
      if (kind === 'excel') await runExport('your Excel file', n, () => exportBatchLogsExcel(selected));
      else await runExport('your PDF file', n, () => exportBatchLogsPdf(selected, nameLang));
    } catch (e: any) { handlers.notify(e?.message || 'Export failed.'); }
  };

  const toggle = (k: MenuKey) => setOpen((cur) => (cur === k ? null : k));
  const trigger = (k: MenuKey, Icon: React.ElementType, label: string, title: string) => (
    <button type="button" disabled={busy} onClick={() => toggle(k)} aria-haspopup="menu" aria-expanded={open === k} title={title}
      className={`${pill} ${open === k ? 'bg-white text-brand-900' : 'bg-white/10 hover:bg-white/20'}`}>
      <Icon className="w-3.5 h-3.5" /><span className="hidden md:inline">{label}</span><ChevronUp className={`w-3 h-3 opacity-60 transition-transform ${open === k ? '' : 'rotate-180'}`} />
    </button>
  );

  const setFollow = (date: string, label: string) => choose({
    title: date ? 'Set follow-up date?' : 'Clear follow-up date?',
    message: date ? `Follow up ${label} on ${count(n)}. They will be marked "follow-up needed".` : `Remove the follow-up date from ${count(n)}?`,
    confirmLabel: date ? 'Set date' : 'Clear date',
    run: () => handlers.followUp(ids(), date),
  });

  return (
    <>
    <div ref={ref} className="no-print fixed bottom-5 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1.5rem)] flex flex-wrap items-center justify-center gap-1.5 px-2.5 py-2 rounded-2xl bg-brand-900 text-white shadow-[0_18px_40px_-10px_rgba(10,20,50,0.55)] text-xs animate-in fade-in slide-in-from-bottom-2 duration-150">
      <span className="font-bold tabular-nums pl-1 whitespace-nowrap">{n.toLocaleString()} selected</span>
      {n < all.length && (
        <button type="button" onClick={onSelectAll} className="underline underline-offset-2 text-white/80 hover:text-white whitespace-nowrap">Select all {all.length.toLocaleString()}</button>
      )}
      <span className="hidden sm:block w-px h-5 bg-white/20 mx-0.5" />

      {/* Foreman */}
      <div className="relative">
        {trigger('foreman', UserCog, 'Foreman', 'Change foreman')}
        {open === 'foreman' && (
          <div className={panel} role="menu">
            <Head>Move to foreman</Head>
            {foremanChoices.length === 0 && <p className="px-3 py-2 text-slate-400">No active foremen.</p>}
            {foremanChoices.map((r) => {
              const area = upazilaKey(r.area);
              return (
                <Item key={r.id} label={r.name} sub={area || undefined} onClick={() => choose({
                  title: 'Change foreman?',
                  message: `Move ${count(n)} to ${r.name}${area ? ` (${area})` : ''}? Each connection's foreman, upazila and foreman phone will follow the new foreman.`,
                  confirmLabel: 'Change foreman',
                  run: () => handlers.foreman(ids(), r.id),
                })} />
              );
            })}
          </div>
        )}
      </div>

      {/* Term */}
      <div className="relative">
        {trigger('term', Layers, 'Term', 'Mark term')}
        {open === 'term' && (
          <div className={panel} role="menu">
            <Head>Mark as</Head>
            {terms.map((t) => (
              <Item key={t} label={t} onClick={() => choose({
                title: `Mark as ${t}?`, message: `Mark ${count(n)} as ${t}.`, confirmLabel: 'Mark', run: () => handlers.term(ids(), t),
              })} />
            ))}
            <Rule />
            <Item label="Clear term" sub="Back to not marked" onClick={() => choose({
              title: 'Clear term?', message: `Remove the term from ${count(n)}.`, confirmLabel: 'Clear term', run: () => handlers.term(ids(), ''),
            })} />
          </div>
        )}
      </div>

      {/* Status */}
      <div className="relative">
        {trigger('status', CircleDot, 'Status', 'Change status')}
        {open === 'status' && (
          <div className={panel} role="menu">
            <Head>Set status to</Head>
            {statuses.map((s) => {
              const done = /resolved|closed/i.test(s);
              return (
                <Item key={s} label={s} sub={done ? 'Also clears the follow-up' : undefined} onClick={() => choose({
                  title: 'Change status?',
                  message: `Set the status of ${count(n)} to "${s}".${done ? ' Their follow-up will be switched off.' : ''}`,
                  confirmLabel: 'Change status',
                  run: () => handlers.status(ids(), s),
                })} />
              );
            })}
          </div>
        )}
      </div>

      {/* Follow-up */}
      <div className="relative">
        {trigger('follow', CalendarClock, 'Follow-up', 'Set a follow-up date')}
        {open === 'follow' && (
          <div className={panel} role="menu">
            <Head>Follow up</Head>
            <Item label="Today" onClick={() => setFollow(addDaysIso(0), 'today')} />
            <Item label="Tomorrow" onClick={() => setFollow(addDaysIso(1), 'tomorrow')} />
            <Item label="In 3 days" onClick={() => setFollow(addDaysIso(3), 'in 3 days')} />
            <Item label="In a week" onClick={() => setFollow(addDaysIso(7), 'in a week')} />
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} aria-label="Pick a date"
                className="h-7 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-xs focus:outline-none focus:border-brand-500" />
              <button type="button" disabled={!customDate} onClick={() => setFollow(customDate, `on ${customDate}`)}
                className="grid place-items-center h-7 w-7 rounded-lg bg-brand-800 text-white disabled:opacity-40" title="Use this date" aria-label="Use this date"><Check className="w-3.5 h-3.5" /></button>
            </div>
            <Rule />
            <Item label="Clear follow-up date" onClick={() => setFollow('', '')} />
          </div>
        )}
      </div>

      {/* Router model: the router printed on each connection's UPAC form */}
      <div className="relative">
        {trigger('router', Wifi, 'Router', 'Set the router model')}
        {open === 'router' && (
          <div className={panel} role="menu">
            <Head>Router model</Head>
            {ROUTER_MODELS.map((m) => (
              <Item key={m} label={m} onClick={() => choose({
                title: 'Set router model?',
                message: `Set the router model of ${count(n)} to ${m}. The UPAC form of each one will print this router.`,
                confirmLabel: 'Set router model',
                run: () => handlers.routerModel(ids(), m),
              })} />
            ))}
            <Rule />
            <Item label="Clear router model" sub={`The form uses ${ROUTER_MODELS[0]}`} onClick={() => choose({
              title: 'Clear router model?',
              message: `Remove the router model from ${count(n)}. Their UPAC form will print ${ROUTER_MODELS[0]} again.`,
              confirmLabel: 'Clear',
              run: () => handlers.routerModel(ids(), ''),
            })} />
          </div>
        )}
      </div>

      {/* Forms & bills: the usual month + admin-approval dialog takes over */}
      <div className="relative">
        {trigger('mark', ClipboardCheck, 'Forms & bills', 'Mark forms or bills')}
        {open === 'mark' && (
          <div className={panel} role="menu">
            <Head>Form</Head>
            <Item label="Form received" onClick={() => { setOpen(null); handlers.mark(selected, 'form', 'received'); }} />
            <Item label="Form not received" onClick={() => { setOpen(null); handlers.mark(selected, 'form', 'not_received'); }} />
            <Rule />
            <Head>Bill</Head>
            <Item label="Bill received" onClick={() => { setOpen(null); handlers.mark(selected, 'bill', 'received'); }} />
            <Item label="Bill not received" onClick={() => { setOpen(null); handlers.mark(selected, 'bill', 'not_received'); }} />
          </div>
        )}
      </div>

      {/* Export & copy */}
      <div className="relative">
        {trigger('export', Download, 'Export', 'Export or copy')}
        {open === 'export' && (
          <div className={panel} role="menu">
            <Head>Download</Head>
            <Item icon={FileSpreadsheet} label="Excel" sub={`${count(n)}, all details`} onClick={() => runExportNow('excel')} />
            <Item icon={FileText} label="PDF" sub={`${count(n)}`} onClick={() => runExportNow('pdf')} />
            <Rule />
            <Head>Copy to clipboard</Head>
            <Item icon={Copy} label="NMS IDs" onClick={() => copyList('NMS ID', (l) => l.nmsId)} />
            <Item icon={Copy} label="EDC numbers" onClick={() => copyList('EDC number', (l) => l.edcNo || '')} />
            <Item icon={Copy} label="Institute names" onClick={() => copyList('institute name', (l) => displayName(l))} />
            <Item icon={Copy} label="Head teacher phones" onClick={() => copyList('phone number', (l) => l.headTeacherPhone || '')} />
          </div>
        )}
      </div>

      {/* More */}
      <div className="relative">
        {trigger('more', MoreHorizontal, 'More', 'More actions')}
        {open === 'more' && (
          <div className={panel} role="menu">
            <Item icon={MapPin} label="Fix upazila from targets" sub="Uses the target workbook's EDC match" onClick={() => choose({
              title: 'Fix upazila?', message: `Set the upazila of ${count(n)} to the one the target list gives their EDC number. Connections without a match stay as they are.`,
              confirmLabel: 'Fix upazila', run: () => handlers.fixUpazila(ids()),
            })} />
            {handlers.remove && (
              <>
                <Rule />
                <Item icon={Trash2} danger label="Move to bin" sub="Admin only, can be restored" onClick={() => choose({
                  title: `Move ${count(n)} to the bin?`, message: 'They disappear from the list but stay in the admin bin, where they can be restored.',
                  confirmLabel: 'Move to bin', destructive: true, run: () => handlers.remove!(ids()),
                })} />
              </>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={onClear} title="Clear selection" aria-label="Clear selection" disabled={busy}
        className="grid place-items-center w-8 h-8 rounded-xl hover:bg-white/15 transition-colors disabled:opacity-40">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
      </button>
      {error && <span className="basis-full text-center text-rose-300 font-medium">{error}</span>}
    </div>

    <ConfirmDialog
        isOpen={Boolean(ask)}
        title={ask?.title || ''}
        message={ask?.message || ''}
        confirmLabel={busy ? 'Working…' : ask?.confirmLabel}
        isDestructive={Boolean(ask?.destructive)}
        onCancel={() => { if (!busy) setAsk(null); }}
        onConfirm={confirm}
      />
    </>
  );
};
