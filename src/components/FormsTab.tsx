import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck, Clock, Download, FileText, Hourglass, ListChecks, MessageCircle, Search, Users, X } from 'lucide-react';
import { exportFormsSample, exportForemanSummary, ForemanFormCount } from '../utils/formsExport';
import { runExport } from '../utils/exportProgress';
import { exportTopsheet } from '../utils/topsheetExport';
import { exportTopsheetPdf } from '../utils/topsheetPdf';
import { TopsheetByUpazila } from './TopsheetByUpazila';
import { LogEntry, MarkAction, Foreman } from '../types';
import {
  awaitingByForeman, daysAwaiting, expectsForm, formMonthCounts, formMonthOf, formStats, getOverdueDays,
  formMarkedAt, formDateText, hasForm, latestActivity, setOverdueDays,
} from '../utils/forms';
import { saveSettings } from '../utils/cloud';
import { PendingIndex, pendingFor } from '../utils/approvals';
import { matchForeman } from '../utils/foremen';
import { chaseMessage, waLink, waNeedsCopy } from '../utils/whatsapp';
import { monthKey, monthLabel } from '../utils/months';
import { MonthSelect } from './MonthSelect';
import { NameLang, nameFor } from '../utils/names';
import { exportFormsPdf } from '../utils/exportPdf';
import { BulkMarkModal } from './BulkMarkModal';
import { usePersistedState, useScrollMemory } from '../utils/persist';

type Tab = 'awaiting' | 'received' | 'all';

interface Props {
  logs: LogEntry[];
  foremen: Foreman[];
  pending: PendingIndex;
  onToggleForm: (log: LogEntry, month?: string) => void;
  onMarkMany: (logs: LogEntry[], action: MarkAction, month?: string) => void;
  onChangeMonth: (items: { log: LogEntry; from: string }[]) => void;
  onOpenLog: (id: string) => void;
  initialTab?: Tab;
  nameLang?: NameLang;
  onNameLangChange?: (lang: NameLang) => void;
}

interface ExportItem { key: string; label: string; hint: string; icon: React.ElementType; tone: string; disabled?: boolean; onClick: () => void }

// One "Export" button that opens a small menu of the list downloads.
const ExportMenu: React.FC<{ items: ExportItem[]; groupBox: string; cell: string }> = ({ items, groupBox, cell }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  return (
    <div ref={box} className="relative inline-block">
      <div className={groupBox}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Download this list"
          className={`${cell} px-2.5 gap-1.5 text-emerald-700 hover:bg-white`}>
          <Download className="w-3.5 h-3.5" /><span>Export</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div role="menu" aria-label="Export"
          className="absolute right-0 top-full mt-2 z-50 w-64 p-1.5 bg-white rounded-2xl border border-slate-100 shadow-[0_24px_48px_-16px_rgba(30,50,110,0.35)]">
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-xl hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <it.icon className={`w-4 h-4 mt-0.5 shrink-0 ${it.tone}`} />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[#1b2a4e]">{it.label}</span>
                <span className="block text-[11px] text-slate-400 leading-snug">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const foremanOf = (l: LogEntry) => l.foremanName?.trim() || 'Unassigned';

export const FormsTab: React.FC<Props> = ({ logs, foremen, pending, onToggleForm, onMarkMany, onChangeMonth, onOpenLog, initialTab = 'received', nameLang = 'bn', onNameLangChange }) => {
  const [tab, setTab] = usePersistedState<Tab>(`forms.tab.${initialTab}`, initialTab);
  const [search, setSearch] = usePersistedState('forms.search', '');
  const [foreman, setForeman] = usePersistedState('forms.foreman', '');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selNote, setSelNote] = useState(''); // why a selection-based mark did nothing
  const [showBulk, setShowBulk] = useState(false);
  const [showByUpazila, setShowByUpazila] = useState(false);
  const [showDates, setShowDates] = usePersistedState('forms.showDates', true);
  const [limit, setLimit] = usePersistedState('forms.limit', getOverdueDays());
  const [settingsSaveError, setSettingsSaveError] = useState('');
  const settingsSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const scroll = useScrollMemory(`forms:${tab}`);

  // Only logs that expect a signed form (New User ID / EDC book) belong in this list.
  const expecting = useMemo(() => logs.filter(expectsForm), [logs]);
  const stats = useMemo(() => formStats(logs), [logs]);
  const waiting = useMemo(() => awaitingByForeman(logs), [logs]);
  const overdueCount = useMemo(
    () => expecting.filter((l) => !hasForm(l) && daysAwaiting(l) >= limit).length,
    [expecting, limit],
  );

  // Forms are marked received for a month, like bills.
  const monthCounts = useMemo(() => formMonthCounts(logs), [logs]);
  const [pickedMonth, setPickedMonth] = usePersistedState<string | null>('forms.month', null);
  const month = pickedMonth ?? ([...monthCounts.keys()].sort().pop() || monthKey());
  // An empty month means "All months": every received form, whatever month it was marked for.
  const allMonths = month === '';
  const monthText = allMonths ? 'All months' : monthLabel(month);
  const fileMonth = allMonths ? 'all-months' : month;
  const inMonth = (l: LogEntry) => hasForm(l) && (allMonths || formMonthOf(l) === month);
  const receivedInMonth = useMemo(() => expecting.filter(inMonth).length, [expecting, month]);
  const pct = stats.sent ? Math.round((receivedInMonth / stats.sent) * 100) : 0;

  // Per foreman: the pane follows the list tab. Received = forms given in the chosen month, Pending = forms still not received, All = every expected form.
  const byForeman = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of expecting) {
      if (tab === 'received' ? !inMonth(l) : tab === 'awaiting' ? hasForm(l) : false) continue;
      const k = foremanOf(l);
      m.set(k, (m.get(k) || 0) + 1);
    }
    // Keep the selected foreman visible even if they have nothing in this list.
    if (foreman && !m.has(foreman)) m.set(foreman, 0);
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [expecting, month, foreman, tab]);
  const paneTotal = byForeman.reduce((n, r) => n + r.count, 0);
  const topCount = byForeman.reduce((mx, r) => Math.max(mx, r.count), 0);

  // The tab counts follow the chosen foreman.
  const scope = useMemo(() => (foreman ? expecting.filter((l) => foremanOf(l) === foreman) : expecting), [expecting, foreman]);
  const scopedReceived = scope.filter(inMonth).length;
  const scopedAwaiting = scope.filter((l) => !hasForm(l)).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scope.filter((l) => {
      if (tab === 'received' && !inMonth(l)) return false;
      if (tab === 'awaiting' && hasForm(l)) return false;
      if (!q) return true;
      return [l.logNo, l.customerName, l.nameBn, l.nameEn, l.nmsId, l.edcNo, l.foremanName, l.upazila]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    }).sort((a, b) => (tab === 'received' ? formMarkedAt(b) - formMarkedAt(a) : latestActivity(b) - latestActivity(a)) || Number(b.logNo) - Number(a.logNo));
  }, [scope, tab, search, month]);

  const picks = rows.filter((l) => picked.has(l.id));
  const toggle = (id: string) => { setSelNote(''); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const allPicked = rows.length > 0 && rows.every((l) => picked.has(l.id));
  const pickAll = () => { setSelNote(''); setPicked(allPicked ? new Set() : new Set(rows.map((l) => l.id))); };
  const pickForeman = (name: string) => { setForeman(name); setPicked(new Set()); };

  const markPicked = (action: MarkAction) => {
    const target = picks.filter((l) => hasForm(l) !== (action === 'received'));
    if (!target.length) { setSelNote('Nothing to change in the selection.'); return; }
    setSelNote('');
    onMarkMany(target, action, month || undefined);
    setPicked(new Set());
  };

  // Move the selected, already-received forms to another month.
  const receivedPicks = picks.filter(hasForm);
  const changePickedMonth = () => {
    if (!receivedPicks.length) { setSelNote('Select forms that are already received to change their month.'); return; }
    setSelNote('');
    onChangeMonth(receivedPicks.map((l) => ({ log: l, from: formMonthOf(l) })));
    setPicked(new Set());
  };

  // Excel: same layout as the "EDC Bill" sample sheet (see utils/formsExport.ts).
  const exportList = () => {
    runExport('your Excel file', rows.length, () => exportFormsSample(rows, foremen, `Pace_IT_Forms_${fileMonth}_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`),
      (e) => alert('Could not create the Excel file: ' + (e?.message || e)));
  };

  // One sheet: which foreman has how many forms (received / pending). Covers every foreman, whatever tab, search or foreman is selected.
  const exportByForeman = () => {
    const m = new Map<string, ForemanFormCount>();
    for (const l of expecting) {
      const k = foremanOf(l);
      const r = m.get(k) || { name: k, receivedInMonth: 0, receivedAll: 0, pending: 0 };
      if (hasForm(l)) { r.receivedAll += 1; if (inMonth(l)) r.receivedInMonth += 1; } else r.pending += 1;
      m.set(k, r);
    }
    const list = [...m.values()].sort((a, b) => b.receivedInMonth - a.receivedInMonth || b.pending - a.pending || a.name.localeCompare(b.name));
    runExport('the foreman summary (Excel)', list.length, () => exportForemanSummary(list, monthText, allMonths, `Pace_IT_Forms_ByForeman_${fileMonth}_${new Date().toISOString().slice(0, 10)}.xlsx`),
      (e) => alert('Could not create the Excel file: ' + (e?.message || e)));
  };

  // Top Sheet: one sheet per upazila, up to 20 institutes per sheet (balanced split) (see utils/topsheetExport.ts).
  // Pass the ticked rows to export only the selection; with no argument the whole current list is exported.
  const topName = (ext: string, selectedOnly: boolean) => `Pace_IT_TopSheet_${fileMonth}_${tab}${selectedOnly ? '_selected' : ''}_${new Date().toISOString().slice(0, 10)}.${ext}`;
  const exportTop = (only?: LogEntry[]) => {
    const list = only ?? rows;
    runExport('the Top Sheet (Excel)', list.length, (report) => exportTopsheet(list, foremen, topName('xlsx', !!only), report, only ? { sizeLike: rows, fillRows: true } : {}),
      (e) => alert('Could not create the Top Sheet: ' + (e?.message || e)));
  };

  // Top Sheet as PDF: same layout as the Excel Top Sheet, A4 landscape, up to 20 institutes per page (balanced split).
  const exportTopPdf = (only?: LogEntry[]) => {
    const list = only ?? rows;
    runExport('the Top Sheet (PDF)', list.length, (report) => exportTopsheetPdf(list, foremen, topName('pdf', !!only), report, only ? { sizeLike: rows, fillRows: true } : {}),
      (e) => alert('Could not create the Top Sheet PDF: ' + (e?.message || e)));
  };

  // Top Sheet of ONE upazila (from the "By upazila" window). The column widths come from the whole list, so the sheet looks
  // exactly like that upazila's sheet in the full Top Sheet download.
  const upazilaFile = (upazila: string, ext: string) => `Pace_IT_TopSheet_${upazila.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Upazila'}_${fileMonth}_${tab}_${new Date().toISOString().slice(0, 10)}.${ext}`;
  const exportUpazila = (format: 'xlsx' | 'pdf', upazila: string, list: LogEntry[]) => {
    if (format === 'xlsx') {
      runExport(`the ${upazila} Top Sheet (Excel)`, list.length, (report) => exportTopsheet(list, foremen, upazilaFile(upazila, 'xlsx'), report, { sizeLike: rows }),
        (e) => alert('Could not create the Top Sheet: ' + (e?.message || e)));
    } else {
      runExport(`the ${upazila} Top Sheet (PDF)`, list.length, (report) => exportTopsheetPdf(list, foremen, upazilaFile(upazila, 'pdf'), report, { sizeLike: rows }),
        (e) => alert('Could not create the Top Sheet PDF: ' + (e?.message || e)));
    }
  };

  const exportPdf = () => runExport('your PDF file', rows.length, () => exportFormsPdf({
    logs: rows,
    monthText,
    listLabel: tab === 'received' ? 'Received' : tab === 'awaiting' ? 'Pending' : 'All',
    foremanName: foreman || undefined,
    hasForm,
    nameLang,
    fileName: `Pace_IT_Forms_${fileMonth}_${tab}_${new Date().toISOString().slice(0, 10)}.pdf`,
  }));

  const tabs: { key: Tab; label: string; n: number; active: string; dot: string }[] = [
    { key: 'received', label: 'Received', n: scopedReceived, active: 'bg-gradient-to-br from-teal-400 to-emerald-600 text-white shadow-emerald-600/30', dot: 'bg-emerald-500' },
    { key: 'awaiting', label: 'Pending', n: scopedAwaiting, active: 'bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-rose-500/30', dot: 'bg-rose-500' },
    { key: 'all', label: 'All', n: scope.length, active: 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand-600/30', dot: 'bg-brand-500' },
  ];
  const waitingForAdmin = expecting.filter((l) => pendingFor(pending, l.id, 'form')).length;

  const surface = 'bg-white rounded-3xl border border-slate-100 shadow-[0_12px_32px_-18px_rgba(30,50,110,0.25)]';
  const ghost = 'inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  // Same size system as the Connection Records toolbar: every control is 32px tall.
  const groupBox = 'inline-flex items-stretch h-8 shrink-0 p-[2px] bg-slate-100/80 rounded-xl border border-slate-200/70';
  const cell = 'inline-flex items-center justify-center rounded-[10px] text-[11px] font-semibold whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
  const segOn = 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm';
  const segOff = 'text-slate-600 hover:bg-white hover:text-brand-900';

  const Kpi: React.FC<{ icon: React.ElementType; label: string; value: number; sub: React.ReactNode; tone: 'sky' | 'rose' | 'amber'; bar?: number }> = ({ icon: Icon, label, value, sub, tone, bar }) => {
    const t = {
      sky: { halo: 'from-sky-50', icon: 'from-sky-400 to-sky-600', num: 'text-sky-700', bar: 'from-sky-400 to-teal-500' },
      rose: { halo: 'from-rose-50', icon: 'from-orange-400 to-rose-500', num: 'text-rose-600', bar: 'from-orange-400 to-rose-500' },
      amber: { halo: 'from-amber-50', icon: 'from-amber-300 to-orange-500', num: 'text-amber-600', bar: 'from-amber-300 to-orange-500' },
    }[tone];
    return (
      <div className={`relative overflow-hidden ${surface} p-5`}>
        <span className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${t.halo} to-transparent`} aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <span className={`grid place-items-center w-11 h-11 rounded-2xl bg-gradient-to-br ${t.icon} text-white shadow-lg`}><Icon className="w-5 h-5" /></span>
          <span className={`text-[34px] leading-none font-extrabold font-display tabular-nums ${t.num}`}>{value}</span>
        </div>
        <div className="relative mt-4 text-[15px] font-semibold text-[#1b2a4e]">{label}</div>
        <div className="relative mt-0.5 min-h-6 flex items-center text-[11.5px] text-slate-400">{sub}</div>
        <div className={`relative mt-3.5 h-1.5 rounded-full overflow-hidden ${bar === undefined ? 'bg-transparent' : 'bg-slate-100'}`}>
          {bar !== undefined && <div className={`h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${bar}%` }} />}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-5 pb-4">
      {/* Toolbar: same card language as the Connection Records toolbar */}
      <div className="no-print @container relative w-full bg-white rounded-2xl border border-slate-100 shadow-[0_12px_32px_-16px_rgba(30,50,110,0.22)] flex flex-col text-xs">
        <span className="absolute inset-x-0 top-0 h-24 rounded-t-2xl bg-gradient-to-b from-brand-50 to-transparent pointer-events-none" aria-hidden />

        {/* Row 1: identity on the left, month + every export on the right */}
        <div className="relative px-4 sm:px-5 pt-3 pb-2 flex flex-wrap @min-[900px]:flex-nowrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-600/30 shrink-0"><ClipboardCheck className="w-4 h-4" /></span>
            <div className="min-w-0">
              <h1 className="text-[15px] leading-tight font-extrabold tracking-tight whitespace-nowrap text-[#1b2a4e]">Forms</h1>
              <p className="text-[11px] text-slate-500 tabular-nums truncate">
                {rows.length === scope.length ? `${scope.length.toLocaleString()} institutes` : `${rows.length.toLocaleString()} of ${scope.length.toLocaleString()} institutes`} · {monthText}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap @min-[900px]:flex-nowrap items-center justify-end gap-1.5 shrink-0">
            <MonthSelect compact align="right" allowAll noun="forms" value={month} onChange={(m) => { setPickedMonth(m); setPicked(new Set()); }} counts={monthCounts}
              title="Forms are marked received for this month. Choose All months to see every form together." />

            {onNameLangChange && (
              <div className={groupBox} role="group" aria-label="Institute name language">
                {([['bn', 'বাংলা', 'Show institute names in Bangla'], ['en', 'EN', 'Show institute names in English']] as const).map(([k, label, tip]) => (
                  <button key={k} type="button" onClick={() => onNameLangChange(k)} aria-pressed={nameLang === k} title={tip}
                    className={`${cell} w-[46px] ${nameLang === k ? segOn : segOff}`}>{label}</button>
                ))}
              </div>
            )}

            <ExportMenu groupBox={groupBox} cell={cell} items={[
              { key: 'excel', label: 'Excel', hint: 'This list as an Excel sheet', icon: Download, tone: 'text-emerald-600', disabled: !rows.length, onClick: exportList },
              { key: 'pdf', label: 'PDF', hint: 'This list as a PDF', icon: FileText, tone: 'text-rose-600', disabled: !rows.length, onClick: exportPdf },
              { key: 'foreman', label: 'By foreman (Excel)', hint: 'One sheet: which foreman has how many forms, received and pending', icon: Users, tone: 'text-brand-700', disabled: !expecting.length, onClick: exportByForeman },
            ]} />

            <div className={groupBox} role="group" aria-label="Top Sheet">
              <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none" title="One sheet per upazila, up to 20 institutes per sheet (balanced split)">
                <ClipboardCheck className="w-3.5 h-3.5 text-brand-600" /><span className="hidden @min-[1100px]:inline">Top Sheet</span>
              </span>
              <button type="button" onClick={() => exportTop()} disabled={!rows.length} title="Download the Top Sheet as Excel: one sheet per upazila, up to 20 institutes per sheet (balanced split)" aria-label="Top Sheet Excel"
                className={`${cell} px-2.5 text-emerald-700 hover:bg-white disabled:opacity-30`}>Excel</button>
              <button type="button" onClick={() => exportTopPdf()} disabled={!rows.length} title="Download the Top Sheet as PDF: A4 landscape, up to 20 institutes per page (balanced split)" aria-label="Top Sheet PDF"
                className={`${cell} px-2.5 text-rose-600 hover:bg-white disabled:opacity-30`}>PDF</button>
              <button type="button" onClick={() => setShowByUpazila(true)} disabled={!rows.length} title="See every upazila's Top Sheet together and download just one upazila (for example only Sylhet Sadar)" aria-label="Top Sheets by upazila"
                className={`${cell} px-2.5 gap-1 text-brand-800 hover:bg-white disabled:opacity-30`}><span>By upazila</span></button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
        <Kpi icon={CheckCircle2} tone="sky" label={`Received · ${monthText}`} value={receivedInMonth} sub={`of ${stats.sent} institutes · ${pct}%`} bar={pct} />
        <Kpi icon={Clock} tone="rose" label="Pending" value={stats.awaiting} bar={stats.sent ? Math.round((stats.awaiting / stats.sent) * 100) : 0}
          sub={
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className={`font-semibold ${overdueCount ? 'text-rose-600' : 'text-emerald-600'}`}>{overdueCount} overdue</span>
              <span>after</span>
              <input type="number" min={1} max={90} value={limit} aria-label="Overdue after how many days"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (n > 0 && n < 365) {
                    setLimit(n);
                    setOverdueDays(n);
                    setSettingsSaveError('');
                    // Serialize shared-setting writes so rapid edits cannot arrive out of order.
                    settingsSaveQueue.current = settingsSaveQueue.current.catch(() => undefined).then(async () => {
                      await saveSettings({ formOverdueDays: n });
                    }).then(
                      () => setSettingsSaveError(''),
                      () => setSettingsSaveError('Could not save this shared setting. It is applied only in this session until saved.'),
                    );
                  }
                }}
                className="w-12 h-6 px-1 text-xs text-slate-700 border border-slate-200 rounded-md text-center bg-white" />
              <span>days</span>
              {settingsSaveError && <span role="status" aria-live="polite" className="basis-full text-rose-600">{settingsSaveError}</span>}
            </span>
          } />
        <Kpi icon={Hourglass} tone="amber" label="Waiting for admin" value={waitingForAdmin} sub="requests pending approval" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)] gap-4 sm:gap-5 lg:items-stretch lg:h-[max(28rem,min(44rem,calc(100vh_-_8rem)))]">
        {/* The one foreman filter */}
        <section className={`${surface} overflow-hidden flex flex-col lg:h-full min-h-0`}>
          <h2 className="shrink-0 px-4 pt-4 pb-3 flex items-center gap-2 text-[14px] font-bold text-[#1b2a4e] border-b border-slate-100">
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-brand-50 text-brand-700"><Users className="w-4 h-4" /></span>
            Foremen
            <span className="ml-auto text-[11px] font-semibold text-slate-400 tabular-nums">{byForeman.length}</span>
          </h2>
          <div className="shrink-0 px-4 py-1.5 text-[11.5px] text-slate-500 bg-slate-50/70 border-b border-slate-100">
            {tab === 'awaiting' ? <span className="font-semibold text-slate-700">Forms pending</span>
              : tab === 'all' ? <span className="font-semibold text-slate-700">All forms</span>
              : <>{allMonths ? 'Forms received · ' : 'Forms received in '}<span className="font-semibold text-slate-700">{monthText}</span></>}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 max-h-72 lg:max-h-none">
            <button type="button" onClick={() => pickForeman('')} aria-pressed={!foreman}
              className={`w-full text-left px-3 py-2.5 rounded-2xl flex items-center gap-2 text-[13px] transition-colors ${!foreman ? 'bg-brand-700 text-white font-semibold shadow-sm' : 'text-slate-700 hover:bg-slate-50 font-medium'}`}>
              <span className="flex-1">All foremen</span>
              <span className={`text-[11px] tabular-nums ${!foreman ? 'text-white/80' : 'text-slate-400'}`}>{paneTotal}</span>
            </button>
            {byForeman.map((r) => {
              const on = foreman === r.name;
              const rpct = topCount ? Math.round((r.count / topCount) * 100) : 0;
              const awaiting = waiting.get(r.name) || waiting.get(r.name === 'Unassigned' ? 'Unassigned Foreman' : r.name) || [];
              const rs = matchForeman({ foremanName: r.name }, foremen);
              const phone = rs?.phone || awaiting.find((l) => l.foremanPhone)?.foremanPhone || '';
              const msg = awaiting.length && phone ? chaseMessage(r.name, awaiting) : '';
              const tooLong = Boolean(msg) && waNeedsCopy(phone, msg);
              // A long list does not fit in a WhatsApp link: open the chat on its own and put the full message on the clipboard.
              const wa = msg ? waLink(phone, tooLong ? '' : msg) : null;
              return (
                <div key={r.name} className={`mt-0.5 flex items-stretch rounded-2xl transition-colors ${on ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : 'hover:bg-slate-50'}`}>
                  <button type="button" onClick={() => pickForeman(on ? '' : r.name)} aria-pressed={on} className="flex-1 min-w-0 text-left px-3 py-2">
                    <span className="flex items-center gap-2 text-[13px]">
                      <span className={`flex-1 truncate ${on ? 'font-bold text-brand-900' : 'font-medium text-slate-800'}`}>{r.name}</span>
                      <span className={`min-w-[1.5rem] text-right text-[13px] font-bold tabular-nums ${r.count ? (tab === 'awaiting' ? 'text-rose-600' : 'text-brand-700') : 'text-slate-300'}`}>{r.count}</span>
                    </span>
                    <span className="mt-1.5 block h-1 rounded-full bg-slate-100 overflow-hidden">
                      <span className={`block h-full rounded-full bg-gradient-to-r ${tab === 'awaiting' ? 'from-orange-400 to-rose-500' : 'from-emerald-400 to-teal-500'}`} style={{ width: `${rpct}%` }} />
                    </span>
                  </button>
                  {wa ? (
                    <a href={wa} target="_blank" rel="noopener noreferrer"
                      onClick={tooLong ? () => { navigator.clipboard?.writeText(msg).then(() => alert('The full list is too long for a WhatsApp link, so the message was copied. Paste it into the chat that just opened.'), () => alert(msg)); } : undefined}
                      title={`WhatsApp ${r.name} about ${awaiting.length} awaiting form${awaiting.length === 1 ? '' : 's'}`}
                      className="shrink-0 grid place-items-center w-9 text-emerald-600 hover:bg-emerald-50 rounded-r-2xl"><MessageCircle className="w-4 h-4" /></a>
                  ) : (
                    <span title={awaiting.length === 0 ? 'Nothing outstanding to chase' : 'No phone number saved for this foreman (add it in Foremen)'}
                      className="shrink-0 grid place-items-center w-9 text-slate-300 cursor-default"><MessageCircle className="w-4 h-4" /></span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* The list */}
        <section className={`${surface} overflow-hidden min-w-0 flex flex-col lg:h-full min-h-0`}>
          {/* List tabs, search, bulk action (under the cards, like the Bills tab) */}
          <div className="no-print shrink-0 p-4 flex flex-wrap items-center gap-2.5 border-b border-slate-100 text-xs">
            <div className="inline-flex items-stretch h-8 shrink-0 p-[2px] bg-slate-100/80 rounded-xl border border-slate-200/70" role="tablist" aria-label="Form status">
              {tabs.map((t) => {
                const active = tab === t.key;
                return (
                  <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => { setTab(t.key); setPicked(new Set()); }}
                    className={`inline-flex items-center justify-center gap-1.5 px-3 rounded-[10px] text-[11px] whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      active ? `${t.active} font-semibold shadow-md` : 'text-slate-600 hover:bg-white hover:text-slate-900 font-medium'}`}>
                    {!active && t.key !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />}
                    <span>{t.label}</span>
                    <span className={`font-mono tabular-nums text-[10px] px-1.5 rounded-full ${active ? 'bg-white/25 text-white' : 'bg-slate-200/70 text-slate-500'}`}>{t.n}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative min-w-[110px] flex-1 basis-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search institute, NMS ID, foreman..."
                className="w-full h-8 pl-9 pr-8 text-xs text-[#1b2a4e] bg-slate-50 border border-slate-200 rounded-xl hover:bg-white focus:outline-none focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition-colors placeholder:text-slate-400" />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="w-3 h-3" /></button>
              )}
            </div>

            {foreman && (
              <span className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 max-w-[14rem] shrink-0 rounded-xl border border-brand-300 bg-brand-50 text-brand-900 font-semibold">
                <Users className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                <span className="truncate">{foreman}</span>
                <button type="button" onClick={() => pickForeman('')} aria-label="Show all foremen" className="grid place-items-center w-5 h-5 rounded-full hover:bg-brand-100"><X className="w-3 h-3" /></button>
              </span>
            )}

            <button type="button" onClick={() => setShowBulk(true)}
              className="inline-flex items-center justify-center gap-1.5 h-8 shrink-0 px-3 whitespace-nowrap text-[11px] font-semibold rounded-xl border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 text-brand-900 bg-brand-50 hover:bg-brand-100 border-brand-200">
              <ListChecks className="w-3.5 h-3.5 text-brand-700" />Bulk mark by ID
            </button>
          </div>

          <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2.5 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer">
              <input type="checkbox" checked={allPicked} onChange={pickAll} className="w-4 h-4 rounded accent-brand-700" />Select all {rows.length}
            </label>
            {picks.length > 0 && (
              <>
                <span className="text-slate-500 tabular-nums">{picks.length} selected</span>
                <button type="button" onClick={() => markPicked('received')} className="h-7 px-3 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">Mark received</button>
                <button type="button" onClick={() => markPicked('not_received')} className="h-7 px-3 font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">Mark not received</button>
                <span className="inline-flex items-center gap-0.5 h-7 pl-2.5 pr-0.5 rounded-lg border border-slate-200 bg-white" role="group" aria-label="Top Sheet of the selected institutes">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">Top Sheet</span>
                  <button type="button" onClick={() => exportTop(picks)} title={`Download the Top Sheet (Excel) for only the ${picks.length} selected`} aria-label="Top Sheet Excel, selected only"
                    className="h-6 px-2 rounded-md text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors">Excel</button>
                  <button type="button" onClick={() => exportTopPdf(picks)} title={`Download the Top Sheet (PDF) for only the ${picks.length} selected`} aria-label="Top Sheet PDF, selected only"
                    className="h-6 px-2 rounded-md text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors">PDF</button>
                </span>
                {receivedPicks.length > 0 && (
                  <button type="button" onClick={changePickedMonth} title="Move the selected received forms to another month"
                    className="inline-flex items-center gap-1.5 h-7 px-3 font-semibold text-brand-800 bg-brand-50 border border-brand-100 hover:bg-brand-100 rounded-lg transition-colors">
                    <CalendarDays className="w-3.5 h-3.5" />Change month
                  </button>
                )}
              </>
            )}
            {selNote && <span className="text-slate-600">{selNote}</span>}
            <label className="ml-auto inline-flex items-center gap-2 text-slate-600 cursor-pointer select-none" title="Show the date each form was collected">
              <input type="checkbox" checked={showDates} onChange={(e) => setShowDates(e.target.checked)} className="w-4 h-4 rounded accent-brand-700" />
              <CalendarDays className="w-3.5 h-3.5 text-brand-600" />Collection date
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="flex-1 grid place-content-center px-4 py-16 text-center">
              <p className="text-sm font-semibold text-[#1b2a4e]">No institutes in this list</p>
              <p className="text-xs text-slate-400 mt-1">Try another tab, foreman or search.</p>
            </div>
          ) : (
            <div {...scroll} className="flex-1 min-h-0 max-h-[34rem] lg:max-h-none overflow-y-auto divide-y divide-slate-100">
              {rows.slice(0, 400).map((l, idx) => {
                const pend = pendingFor(pending, l.id, 'form');
                const got = hasForm(l);
                const days = daysAwaiting(l);
                const late = !got && days >= limit;
                const gotMonth = formMonthOf(l);
                const gotDate = formDateText(l);
                return (
                  <div key={l.id} className="group px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 hover:bg-brand-50/50 transition-colors">
                    <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select row ${idx + 1}`} className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                    <span className="grid place-items-center h-7 min-w-8 px-1.5 rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 tabular-nums shrink-0" title={`Connection #${l.logNo}`}>{idx + 1}</span>
                    <button type="button" onClick={() => onOpenLog(l.id)} className="flex-1 min-w-[11rem] text-left">
                      <span className="block text-[13.5px] font-semibold leading-relaxed text-[#1b2a4e] truncate">{nameFor(l, nameLang).text || 'Untitled'}</span>
                      <span className="block text-[11.5px] text-slate-400 truncate">{[l.foremanName, l.nmsId, l.upazila].filter(Boolean).join(' · ')}</span>
                    </button>
                    {showDates && (
                      <span className={`shrink-0 inline-flex items-center gap-1 text-[11.5px] tabular-nums ${gotDate ? 'text-slate-600' : 'text-slate-300'}`}
                        title={gotDate ? `Form collected on ${gotDate}` : 'Not collected yet'}>
                        <CalendarDays className="w-3.5 h-3.5" />{gotDate || '—'}
                      </span>
                    )}
                    {pend ? (
                      <button type="button" onClick={() => onToggleForm(l, month || undefined)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors" title="Waiting for admin - click to withdraw">
                        <Hourglass className="w-3 h-3" />{pend.action === 'received' ? 'received' : 'not received'} · waiting
                      </button>
                    ) : (
                      <button type="button" onClick={() => onToggleForm(l, month || undefined)}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors ${got ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : late ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}>
                        {got
                          ? <><CheckCircle2 className="w-3.5 h-3.5" />Received{gotMonth ? ` · ${monthLabel(gotMonth, true)}` : ''}</>
                          : `Awaited${days > 0 ? ` · ${days}d` : ''}${late ? ' · overdue' : ''}`}
                      </button>
                    )}
                  </div>
                );
              })}
              {rows.length > 400 && <p className="px-4 py-3 text-[11px] text-slate-400 text-center">Showing the first 400 of {rows.length}. Use search or pick a foreman to narrow the list.</p>}
            </div>
          )}
        </section>
      </div>

      <TopsheetByUpazila isOpen={showByUpazila} onClose={() => setShowByUpazila(false)} rows={rows} foremen={foremen} nameLang={nameLang}
        scopeText={`${tab === 'received' ? 'Received' : tab === 'awaiting' ? 'Pending' : 'All'} · ${monthText}${foreman ? ` · ${foreman}` : ''}${search.trim() ? ' · search applied' : ''}`}
        onExport={exportUpazila} />

      <BulkMarkModal isOpen={showBulk} onClose={() => setShowBulk(false)} kind="form" logs={logs} monthText={monthText}
        isDone={(l, a) => hasForm(l) === (a === 'received')}
        stateText={(l) => (hasForm(l) ? 'Received' : 'Not received')}
        ineligible={(l) => (expectsForm(l) ? undefined : 'No signed form is expected for this connection')}
        onMark={(target, a) => onMarkMany(target, a, month || undefined)} />
    </div>
  );
};
