import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { displayCategory } from '../utils/category';
import { ChevronRight, FileText, Download, Check, Minus } from 'lucide-react';
import { LogEntry, Foreman } from '../types';
import { LogSheetView } from './LogSheetView';
import type { ViewMode } from './LogsToolbar';
import { followState, followLabel } from '../utils/followUps';
import { logUpazila } from '../utils/upazilas';
import { cleanCategoryLabel } from '../utils/csvImporter';
import { hasBill, latestBillMonth } from '../utils/bills';
import { monthKey, monthLabel } from '../utils/months';
import { PendingIndex, pendingFor } from '../utils/approvals';
import { canMakeUpacForm, downloadUpacForm } from '../utils/upacForm';
import { NameLang, nameFor } from '../utils/names';
import { categoryStyle } from '../utils/categoryStyle';
import { ScrollLock } from './ScrollLock';
import { useFitZoom } from '../utils/useFitZoom';
import { BulkActionBar, BulkHandlers } from './BulkActionBar';

const statusStyle = (status = ''): { pill: string; dot: string; ring: string; bar: string; tile: string; halo: string } => {
  const t = status.toLowerCase();
  if (t.includes('resolved') || t.includes('closed')) return { pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', ring: 'ring-emerald-500/20', bar: 'bg-emerald-500', tile: 'from-teal-400 to-emerald-600 shadow-emerald-600/25', halo: 'from-emerald-50' };
  if (t.includes('progress')) return { pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', ring: 'ring-amber-500/20', bar: 'bg-amber-500', tile: 'from-amber-300 to-orange-500 shadow-orange-500/25', halo: 'from-amber-50' };
  if (t.includes('pending') || t.includes('waiting')) return { pill: 'bg-rose-50 text-rose-700', dot: 'bg-red-500', ring: 'ring-red-500/20', bar: 'bg-rose-400', tile: 'from-orange-400 to-rose-500 shadow-rose-500/25', halo: 'from-rose-50' };
  return { pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', ring: 'ring-slate-400/20', bar: 'bg-slate-300', tile: 'from-slate-300 to-slate-500 shadow-slate-500/20', halo: 'from-slate-50' };
};

const Badge: React.FC<{ status?: string }> = ({ status }) => {
  const st = statusStyle(status);
  return (
    <span title={status || undefined} className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 text-[11px] font-semibold rounded-full ${st.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
      <span className="truncate">{status || '—'}</span>
    </span>
  );
};

const NameText: React.FC<{ log: LogEntry; lang: NameLang; className?: string }> = ({ log, lang, className = '' }) => {
  const n = nameFor(log, lang);
  return (
    <span className={`${className} ${n.missing ? 'text-slate-400 italic font-medium' : ''}`} title={n.missing ? 'No English name saved for this connection' : undefined}>
      {n.text || 'Untitled'}
    </span>
  );
};

// Category and term as one quiet line ("● Primary Education · Second Term") instead of two coloured pills.
const InstituteMeta: React.FC<{ log: LogEntry; className?: string }> = ({ log, className = '' }) => {
  const c = displayCategory(log);
  const label = c ? cleanCategoryLabel(c) : '';
  const term = (log.term || '').trim();
  if (!label && !term) return null;
  const cs = categoryStyle(label);
  return (
    <span className={`flex items-center gap-1.5 min-w-0 max-w-full text-[11px] font-medium leading-tight text-slate-500 ${className}`}>
      {label && (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cs.dot}`} />
          <span className="truncate">{label}</span>
        </span>
      )}
      {label && term && <span aria-hidden className="text-slate-300 shrink-0">/</span>}
      {term && <span title={`Marked ${term}`} className="shrink-0 whitespace-nowrap text-slate-400">{term}</span>}
    </span>
  );
};

// Status as a coloured dot only (the full text is in the tooltip) so the column stays narrow.
const StatusDot: React.FC<{ status?: string }> = ({ status }) => {
  const st = statusStyle(status);
  return (
    <span role="img" aria-label={status || 'No status'} title={status || 'No status'} className="inline-grid place-items-center w-5 h-5 cursor-default">
      <span className={`w-2.5 h-2.5 rounded-full ${st.dot} ring-4 ring-offset-0 ${st.ring}`} />
    </span>
  );
};

const UpacButton: React.FC<{ log: LogEntry; short?: boolean }> = ({ log, short }) =>
  canMakeUpacForm(log) ? (
    <button type="button" onClick={(e) => { e.stopPropagation(); downloadUpacForm(log).catch((err) => alert(err?.message || 'Could not make the UPAC form.')); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
      title="Download the UPAC form, filled in from this connection's details">
      <FileText className="w-3 h-3" />
      <span>{short ? 'UPAC' : 'UPAC Form'}</span>
      <Download className="w-3 h-3" />
    </button>
  ) : null;

const PendingChip: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <span role="button" tabIndex={0} title="Waiting for admin approval - click to withdraw the request"
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(); } }}
    className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full border cursor-pointer bg-amber-50 text-amber-800 border-amber-300">
    ⏳ {label}
  </span>
);

const BillChip: React.FC<{ log: LogEntry; onToggle: (l: LogEntry) => void; pending?: PendingIndex }> = ({ log, onToggle, pending }) => {
  const cur = monthKey();
  const pend = pendingFor(pending, log.id, 'bill', cur);
  if (pend) return <PendingChip label={`Bill ${pend.action === 'received' ? 'received' : 'not received'} · ${monthLabel(cur, true)} · waiting for admin`} onClick={() => onToggle(log)} />;
  const got = hasBill(log);
  const gotNow = hasBill(log, cur);
  const latest = latestBillMonth(log);
  return (
    <span role="button" tabIndex={0} title={gotNow ? `Bill for ${monthLabel(cur)} received - click to mark not received` : `Click to mark the ${monthLabel(cur)} bill received`}
      onClick={(e) => { e.stopPropagation(); onToggle(log); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(log); } }}
      className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 text-[10.5px] font-semibold rounded-md cursor-pointer transition-colors ${
        got ? 'bg-sky-50 text-sky-700 hover:bg-sky-100' : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}>
      {got ? `✓ Bill · ${monthLabel(latest, true)}` : '○ Bill not received'}
    </span>
  );
};

const FollowChip: React.FC<{ log: LogEntry }> = ({ log }) => {
  const st = followState(log);
  if (!st) return null;
  const cls = st === 'overdue' ? 'bg-rose-50 text-rose-700'
    : st === 'today' ? 'bg-amber-50 text-amber-700'
    : 'bg-slate-100 text-slate-600';
  return <span className={`inline-block shrink-0 px-2 py-0.5 text-[10.5px] font-semibold rounded-md ${cls}`}>{followLabel(log)}</span>;
};

const rowProps = (onOpen: () => void) => ({
  role: 'button' as const, tabIndex: 0, onClick: onOpen,
  onKeyDown: (e: React.KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } },
});

interface ListProps { selectedId?: string; onSelect?: (id: string) => void; onEdit?: (log: LogEntry) => void; onDuplicate?: (log: LogEntry) => void; onDelete?: (id: string) => void; logs: LogEntry[]; resetKey?: string; mode: ViewMode; nameLang?: NameLang; foremen: Foreman[]; onOpen: (log: LogEntry) => void; onToggleForm: (log: LogEntry) => void; onToggleBill?: (log: LogEntry) => void; pending?: PendingIndex; bulk?: BulkHandlers; }

const PAGE = 100;

const useWide = (query = '(min-width: 1024px)') => {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return m;
};

export const LogList: React.FC<ListProps> = ({ selectedId, onSelect, onEdit, onDuplicate, onDelete, logs: allLogs, resetKey, mode, nameLang = 'bn', foremen, onOpen, onToggleForm, onToggleBill, pending, bulk }) => {
  // Thousands of rows are never drawn at once: show a page, load the next page on scroll.
  const [visible, setVisible] = useState(PAGE);
  // ---- multi-select (change the foreman of many connections at once) ----
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const canSelect = Boolean(bulk);
  const sentinel = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const detailBoxRef = useRef<HTMLDivElement>(null);
  const detailFitRef = useRef<HTMLDivElement>(null);
  // Split view needs room for two panes; on narrow screens it falls back to the plain list.
  const wide = useWide();
  const split = mode === 'split' && wide;
  const total = allLogs.length;
  const logs = total > visible ? allLogs.slice(0, visible) : allLogs;
  const selectedKey = split ? (logs.find((x) => x.id === selectedId) || logs[0])?.id : undefined;
  // Split view: fit the selected log's sheet into the right pane so it never scrolls.
  // Never smaller than normal size (1): text stays readable, and the pane scrolls a little if the sheet is taller than the window.
  // On a taller window / fullscreen it grows (up to 1.6x) to use the extra room.
  useFitZoom(detailFitRef, detailBoxRef, `${split}:${selectedKey}`, { min: 1, max: 1.6 });

  // a new filter / sort / search starts again from the first page
  useEffect(() => { setVisible(PAGE); setPicked(new Set()); setLastIdx(null); }, [resetKey]);
  // drop selected ids that no longer exist in the list (deleted / moved by someone else)
  useEffect(() => {
    setPicked((cur) => {
      if (!cur.size) return cur;
      const live = new Set(allLogs.map((l) => l.id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [allLogs]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || visible >= total) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + PAGE);
    }, { root: split ? paneRef.current : null, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, total, split]);

  const more = total > visible ? (
    <div ref={sentinel} className="no-print flex items-center justify-center gap-3 py-4 text-xs text-slate-500">
      <span>Showing {visible.toLocaleString()} of {total.toLocaleString()}</span>
      <button type="button" onClick={() => setVisible((v) => v + PAGE)}
        className="px-4 py-1.5 font-semibold text-brand-800 bg-white border border-slate-200 rounded-full hover:bg-brand-50 transition-colors">
        Show more
      </button>
    </div>
  ) : null;


  const toggleRow = (idx: number, shift: boolean) => {
    const id = allLogs[idx]?.id;
    if (!id) return;
    setPicked((cur) => {
      const next = new Set(cur);
      if (shift && lastIdx !== null) {
        const [a, b] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx];
        const on = !cur.has(id);
        for (let k = a; k <= b; k++) { const x = allLogs[k]?.id; if (x) (on ? next.add(x) : next.delete(x)); }
      } else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setLastIdx(idx);
  };
  const allPicked = total > 0 && picked.size === total;
  const somePicked = picked.size > 0 && !allPicked;
  const toggleAll = () => { setPicked(allPicked ? new Set() : new Set(allLogs.map((l) => l.id))); setLastIdx(null); };
  const pickedLogs = allLogs.filter((l) => picked.has(l.id));

  const surface = 'bg-white rounded-3xl border border-slate-100 shadow-[0_12px_32px_-16px_rgba(30,50,110,0.22)]';

  if (total === 0) {
    return (
      <div className={`no-print ${surface} px-6 py-16 text-center`}>
        <p className="text-sm font-semibold text-[#1b2a4e]">No connections match these filters</p>
        <p className="text-xs text-slate-400 mt-1">Try clearing a filter or changing the search.</p>
      </div>
    );
  }

  if (split) {
    // Master-detail: a slim list on the left, the full log sheet of the selected log on the right.
    const selected = logs.find((l) => l.id === selectedId) || logs[0];
    return (
      <div className="no-print grid grid-cols-[148px_minmax(0,1fr)] gap-3 h-[calc(100vh-10rem)] min-h-[460px]">
        <div ref={paneRef} className={`${surface} overflow-y-auto overscroll-contain`}>
          {logs.map((l, i) => {
            const st = statusStyle(l.status);
            const active = selected?.id === l.id;
            return (
              <div key={l.id} id={`item-${l.id}`} {...rowProps(() => (onSelect ? onSelect(l.id) : onOpen(l)))}
                aria-current={active ? 'true' : undefined}
                title={nameFor(l, nameLang).text || undefined}
                className={`group relative cursor-pointer flex items-center gap-2 pl-3 pr-2 py-3 border-b border-slate-100 last:border-b-0 transition-colors scroll-mt-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${
                  active ? 'bg-brand-50' : 'hover:bg-slate-50'
                }`}>
                <span aria-hidden className={`absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full ${active ? 'bg-brand-600' : `${st.bar} opacity-40 group-hover:opacity-100`} transition-opacity`} />
                <span className="grid place-items-center h-7 min-w-7 px-1.5 rounded-lg bg-brand-900 text-white text-[11px] font-bold tabular-nums shrink-0" title={`Connection no. ${l.logNo}`}>{i + 1}</span>
                {/* Just the NMS ID (EDC no. or connection no. when there is none): the full name shows on hover and in the detail panel. */}
                <span className={`min-w-0 flex-1 truncate font-mono text-[13px] tabular-nums ${active ? 'font-bold text-brand-900' : 'font-semibold text-[#1b2a4e]'}`}>
                  {l.nmsId || (l.edcNo ? `EDC ${l.edcNo}` : `#${l.logNo}`)}
                </span>
              </div>
            );
          })}
          {more}
        </div>

        <div ref={detailBoxRef} className={`${surface} overflow-y-auto overscroll-contain bg-[#eef8f1] p-2.5`}>
          {selected ? (
            <div ref={detailFitRef} className="@container">
              <LogSheetView key={selected.id} log={selected} nameLang={nameLang} foremen={foremen}
                onEdit={onEdit ?? onOpen} onDuplicate={onDuplicate ?? (() => {})} onDelete={onDelete}
                onToggleForm={onToggleForm} onToggleBill={onToggleBill} pending={pending}
                columnsClass="columns-3" compact />
            </div>
          ) : (
            <div className="h-full grid place-items-center text-sm text-slate-400">Select a connection to see its details</div>
          )}
        </div>
      </div>
    );
  }

  // Wide screens get the full table; narrower ones get stacked rows so nothing is squeezed.
  const cols = 'grid-cols-[2.25rem_minmax(0,1fr)_1rem] xl:grid-cols-[2.5rem_minmax(0,2.4fr)_minmax(0,1.2fr)_6.25rem_4rem_4.75rem_3.5rem_7.75rem_1rem]';
  const th = 'text-[11px] font-semibold text-white';
  return (
    <div className={`no-print ${surface} overflow-hidden`}>
      <div className="hidden xl:block px-3 pt-3 pb-1">
        <div className={`grid ${cols} gap-x-4 px-2 py-2.5 rounded-2xl bg-brand-900 text-center ${th}`}>
          {canSelect ? (
            <button type="button" role="checkbox" aria-checked={allPicked ? true : somePicked ? 'mixed' : false} onClick={toggleAll}
              title={allPicked ? 'Clear selection' : `Select all ${total.toLocaleString()} listed connections`}
              className="justify-self-center inline-flex items-center gap-1 h-5 px-1 rounded-md hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <span className={`grid place-items-center w-4 h-4 rounded border ${allPicked || somePicked ? 'bg-white border-white text-brand-900' : 'border-white/60'}`}>
                {allPicked ? <Check className="w-3 h-3" strokeWidth={3.5} /> : somePicked ? <Minus className="w-3 h-3" strokeWidth={3.5} /> : null}
              </span>
              <span>#</span>
            </button>
          ) : <span>#</span>}<span>Institute</span><span>Foreman</span><span>Date</span><span>EDC no.</span><span>NMS ID</span><span>Status</span><span>Head teacher</span><span />
        </div>
      </div>
      {logs.map((l, i) => (
        <div key={l.id} id={`item-${l.id}`} {...rowProps(() => onOpen(l))}
          className={`group relative cursor-pointer w-full text-center grid ${cols} gap-x-4 items-center px-4 xl:px-5 py-3.5 border-b border-slate-100 last:border-b-0 ${picked.has(l.id) ? 'bg-brand-50' : 'hover:bg-gradient-to-r hover:from-brand-50/70 hover:to-transparent'} transition-colors scroll-mt-40 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500`}>
          <span aria-hidden className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${statusStyle(l.status).bar} opacity-40 group-hover:opacity-100 transition-opacity`} />
          {canSelect ? (
            <button type="button" role="checkbox" aria-checked={picked.has(l.id)}
              onClick={(e) => { e.stopPropagation(); toggleRow(i, e.shiftKey); }}
              onKeyDown={(e) => e.stopPropagation()}
              title={picked.has(l.id) ? 'Deselect (Shift-click selects a range)' : `Select connection ${i + 1} (Shift-click selects a range)`}
              className={`justify-self-center relative grid place-items-center h-8 min-w-8 px-1.5 rounded-xl text-xs font-bold tabular-nums shadow-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${picked.has(l.id) ? 'bg-brand-600 text-white shadow-brand-600/30' : 'bg-brand-900 text-white shadow-brand-900/30'}`}>
              <span className={picked.has(l.id) || picked.size > 0 ? 'hidden' : 'group-hover:hidden'}>{i + 1}</span>
              <span className={`${picked.has(l.id) || picked.size > 0 ? 'grid' : 'hidden group-hover:grid'} place-items-center w-4 h-4 rounded border ${picked.has(l.id) ? 'bg-white border-white text-brand-700' : 'border-white/70'}`}>
                {picked.has(l.id) && <Check className="w-3 h-3" strokeWidth={3.5} />}
              </span>
            </button>
          ) : (
            <span className={`justify-self-center grid place-items-center h-8 min-w-8 px-1.5 rounded-xl bg-brand-900 shadow-brand-900/30 text-white shadow-md text-xs font-bold tabular-nums`} title={`Connection no. ${l.logNo}`}>{i + 1}</span>
          )}

          {/* Stacked layout below xl */}
          <span className="xl:hidden min-w-0 space-y-1.5 text-left">
            <span className="block font-semibold text-[#1b2a4e] leading-relaxed break-words line-clamp-2"><NameText log={l} lang={nameLang} /></span>
            <InstituteMeta log={l} />
            <span className="block text-xs text-slate-500 break-words">{[l.foremanName, logUpazila(l, foremen) || l.upazila, l.date].filter(Boolean).join(' · ')}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge status={l.status} />
              <FollowChip log={l} />
              <UpacButton log={l} short />
            </span>
            {(l.nmsId || l.edcNo || l.headTeacherPhone) && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {l.nmsId && <span className="font-mono">NMS {l.nmsId}</span>}
                {l.edcNo && <span className="font-mono">EDC {l.edcNo}</span>}
                {l.headTeacherPhone && (
                  <a href={`tel:${l.headTeacherPhone.replace(/[^0-9+]/g, '')}`} onClick={(e) => e.stopPropagation()} className="font-mono text-brand-700 underline underline-offset-2">{l.headTeacherPhone}</a>
                )}
              </span>
            )}
          </span>

          {/* Table cells, xl and up */}
          <span className="hidden xl:flex flex-col items-start text-left gap-1 min-w-0">
            <span className="font-semibold text-[#1b2a4e] leading-relaxed break-words line-clamp-2"><NameText log={l} lang={nameLang} /></span>
            <InstituteMeta log={l} />
            {(followState(l) || canMakeUpacForm(l)) && (
              <span className="flex flex-wrap items-center justify-start gap-1.5 min-w-0">
                <FollowChip log={l} />
                <UpacButton log={l} short />
              </span>
            )}
          </span>
          <span className="hidden xl:flex items-center justify-center gap-2 min-w-0">
            <span className="min-w-0 text-center leading-tight">
              <span className="block truncate text-[13px] font-medium text-slate-700">{l.foremanName || '—'}</span>
            </span>
          </span>
          <span className="hidden xl:block text-xs text-slate-500 tabular-nums">{l.date}</span>
          <span className="hidden xl:block truncate font-mono text-xs text-slate-600 tabular-nums">{l.edcNo || '—'}</span>
          <span className="hidden xl:block truncate font-mono text-xs text-slate-600 tabular-nums">{l.nmsId || '—'}</span>
          <span className="hidden xl:flex justify-center min-w-0"><StatusDot status={l.status} /></span>
          <span className="hidden xl:block truncate font-mono text-xs text-slate-600 tabular-nums">{l.headTeacherPhone || '—'}</span>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-600 group-hover:translate-x-0.5 transition" />
        </div>
      ))}
      {more}

      {bulk && picked.size > 0 && (
        <BulkActionBar selected={pickedLogs} all={allLogs} foremen={foremen} nameLang={nameLang} handlers={bulk}
          onSelectAll={toggleAll} onClear={() => { setPicked(new Set()); setLastIdx(null); }} />
      )}
    </div>
  );
};

interface ModalProps {
  log: LogEntry | null;
  onClose: () => void;
  onEdit: (log: LogEntry) => void;
  onDuplicate: (log: LogEntry) => void;
  onDelete?: (id: string) => void;
  onToggleForm: (log: LogEntry) => void;
  onToggleBill?: (log: LogEntry) => void;
  pending?: PendingIndex;
  foremen?: Foreman[];
  nameLang?: NameLang;
}

export const LogDetailModal: React.FC<ModalProps> = ({ nameLang, log, onClose, onEdit, onDuplicate, onDelete, onToggleForm, onToggleBill, pending, foremen = [] }) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Keep the last log mounted while the closing animation plays.
  const [held, setHeld] = useState<LogEntry | null>(log);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (log) {
      setHeld(log);
      setClosing(false);
      return;
    }
    if (!held) return;
    setClosing(true);
    const t = window.setTimeout(() => { setHeld(null); setClosing(false); }, 220);
    return () => window.clearTimeout(t);
  }, [log]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = log ?? held;

  // Scale the whole sheet to the largest size that still fits the visible window.
  useFitZoom(fitRef, overlayRef, shown, { min: 0.8, max: 1.6 });

  if (!shown) return null;
  return (
    <div
      ref={overlayRef}
      className={`log-modal-overlay ${closing ? 'is-closing' : ''} fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-sm flex items-center justify-center sm:p-3`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !closing) onClose(); }}
    >
      <ScrollLock />
      <div className="log-modal-panel w-full max-w-[120rem] max-h-full bg-[#eef8f1] sm:rounded-2xl shadow-2xl overflow-y-auto">
        <div ref={fitRef} className="log-modal-fit p-2 sm:p-2.5">
          <LogSheetView log={shown} nameLang={nameLang} foremen={foremen} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onToggleForm={onToggleForm} onToggleBill={onToggleBill} pending={pending} onClose={onClose} />
        </div>
      </div>
    </div>
  );
};
