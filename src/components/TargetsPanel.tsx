import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Ban, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, FileSpreadsheet, Loader2, Pencil, Phone, Search, Target, Trash2, Upload, UserCheck, X,
} from 'lucide-react';
import type { Foreman, LogEntry } from '../types';
import {
  buildTargetRows, computeStats, exportTargets, findSharedEdc, parseTargetFile, planImport, pct, reconcile, shortCategory,
  ExportMode, ExtraRecord, SharedEdc, ParsedTargets, TargetInstitute, TargetRow, Tally,
} from '../utils/targets';
import { categoryStyle } from '../utils/categoryStyle';
import {
  clearTargetList, fixUpazilas, importTargetRows, loadTargets, loadTargetTags, removeTargetTags, saveTargetTags, TARGETS_CHANGED_EVENT,
} from '../utils/cloud';
import { REJECT_STAGES, daysBetween, fmtDay, isOverdue, todayIso, type TagInput, type TagKind, type TargetTag } from '../utils/targetTags';
import { UPAZILAS, foremanServes, upazilaKey } from '../utils/upazilas';
import { usePersistedState, useScrollMemory } from '../utils/persist';
import { ConfirmDialog } from './ConfirmDialog';
import { ScrollLock } from './ScrollLock';
import { runExport } from '../utils/exportProgress';

type Tab = 'left' | 'promised' | 'rejected' | 'connected' | 'shared' | 'extra' | 'upazila' | 'all';
type GroupBy = 'none' | 'category' | 'upazila';

interface Props {
  logs: LogEntry[];
  /** The foreman directory: who can be named on a promise. */
  foremen?: Foreman[];
  onOpenLog: (id: string) => void;
  isAdmin?: boolean;
  onRefresh?: () => Promise<unknown> | void;
  /** Shown inside the Field Hub: the hub supplies the page title. */
  embedded?: boolean;
  /** Reports the live connected / left totals so the hub can show them on its tab. */
  onSummary?: (s: Tally) => void;
  /** The list the Field Hub already loaded, so this section opens filled instead of empty (it still refreshes in the background). */
  seed?: { rows: TargetInstitute[]; tags: TargetTag[] } | null;
}

// Only this many institutes are drawn at first; the rest come with "Show more". Thousands of rows at once made the page slow.
const ROW_PAGE = 100;

const surface = 'bg-white rounded-3xl border border-slate-100 shadow-[0_12px_32px_-18px_rgba(30,50,110,0.25)]';
const ghost = 'inline-flex items-center gap-1.5 h-10 px-3.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors';
const selectCls = 'h-10 px-3 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:bg-white focus:border-slate-200';

const Bar: React.FC<{ value: number; className?: string }> = ({ value, className = 'from-emerald-400 to-teal-500' }) => (
  <span className="block h-1.5 rounded-full bg-slate-100 overflow-hidden">
    <span className={`block h-full rounded-full bg-gradient-to-r ${className}`} style={{ width: `${value}%` }} />
  </span>
);

export const TargetsPanel: React.FC<Props> = ({ logs, foremen = [], onOpenLog, isAdmin = false, onRefresh, embedded = false, onSummary, seed = null }) => {
  // ───────────── data + import ─────────────
  const [targets, setTargets] = useState<TargetInstitute[] | null>(seed?.rows ?? null);
  const [loadError, setLoadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ fileName: string; data: ParsedTargets } | null>(null);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  // Promised / Rejected tags. They live apart from the list, so importing the workbook again never removes them.
  const [tags, setTags] = useState<TargetTag[]>(seed?.tags ?? []);
  const reloadTags = useCallback(async () => {
    try { setTags(await loadTargetTags()); } catch { /* keep what is on screen; the next change reloads */ }
  }, []);

  const reload = useCallback(async () => {
    try { setTargets(await loadTargets()); setLoadError(''); }
    catch (e: any) { setLoadError(e?.message || 'Could not load the target list.'); setTargets((t) => t ?? []); }
    await reloadTags();
  }, [reloadTags]);
  useEffect(() => { reload(); }, [reload]);
  // Someone else (or another tab) tagged an institute: show it here without a refresh.
  useEffect(() => {
    const h = () => { void reloadTags(); };
    window.addEventListener(TARGETS_CHANGED_EVENT, h);
    return () => window.removeEventListener(TARGETS_CHANGED_EVENT, h);
  }, [reloadTags]);

  const pickFile = async (file?: File | null) => {
    if (!file) return;
    setImportError(''); setNotice('');
    try {
      const data = await parseTargetFile(file);
      if (!data.rows.length) {
        setImportError(data.sheets.length
          ? 'No institutes with an EDC number were found in that file.'
          : 'Could not find the columns. Each sheet needs a header row with the serial number (ক্রমিক নং.), upazila and institute name columns - or the older format: EDC, Upazila, Catagory and Institute Name.');
        return;
      }
      setReplace(false);
      setParsed({ fileName: file.name, data });
    } catch {
      setImportError('That file could not be read. Please use an .xlsx, .xls or .csv file.');
    }
  };

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true); setImportError('');
    try {
      const r = await importTargetRows(parsed.data.rows, replace);
      setNotice(`Imported ${parsed.fileName}: ${r.added} added, ${r.updated} updated, ${r.unchanged} already on the list${r.removed ? `, ${r.removed} removed` : ''}. ${r.total} target institutes in total.`);
      setParsed(null);
      await reload();
    } catch (e: any) {
      setImportError(e?.message || 'Import failed.');
    }
    setImporting(false);
  };

  const runClear = async () => {
    setConfirmClear(false);
    try { await clearTargetList(); setNotice('The target list was cleared. Connection Records were not touched.'); await reload(); }
    catch (e: any) { setNotice(e?.message || 'Could not clear the list.'); }
  };

  const plan = useMemo(() => (parsed ? planImport(targets || [], parsed.data.rows) : null), [parsed, targets]);
  const importCats = useMemo(() => {
    if (!parsed) return [];
    const m = new Map<string, number>();
    for (const r of parsed.data.rows) m.set(r.category, (m.get(r.category) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  // ───────────── filters ─────────────
  const [tab, setTab] = usePersistedState<Tab>('targets.tab', 'left');
  const [search, setSearch] = usePersistedState('targets.search', '');
  const dSearch = useDeferredValue(search); // typing stays instant; the list catches up a moment later
  const [upazila, setUpazila] = usePersistedState('targets.upazila', ''); // upazilaId, '' = all
  const [category, setCategory] = usePersistedState('targets.category', '');
  const [groupBy, setGroupBy] = usePersistedState<GroupBy>('targets.groupBy', 'none');
  const [openMap, setOpenMap] = usePersistedState<Record<string, boolean>>('targets.openMap', {});
  const [exportOpen, setExportOpen] = useState(false);
  // Left lists leave out promised / rejected institutes, unless this is ticked in the Export menu.
  const [includeTagged, setIncludeTagged] = usePersistedState('targets.includeTagged', false);
  const [foremanFilter, setForemanFilter] = usePersistedState('targets.promisedBy', ''); // Promised tab: one foreman
  const [overdueOnly, setOverdueOnly] = usePersistedState('targets.overdueOnly', false);

  // Recomputed from the live connection records, so a new connection (or a deleted one) updates this page at once.
  const all = useMemo(() => buildTargetRows(targets || [], logs, tags), [targets, logs, tags]);
  const stats = useMemo(() => computeStats(all), [all]);
  const rec = useMemo(() => reconcile(targets || [], logs), [targets, logs]);
  const sharedAll = useMemo(() => findSharedEdc(all), [all]);
  const total = stats.overall.total;
  useEffect(() => { if (targets !== null) onSummary?.(stats.overall); }, [targets, stats.overall, onSummary]);

  // Rows inside the chosen upazila: the category dropdown counts these.
  const inUpazila = useMemo(() => (upazila ? all.filter((r) => r.upazilaId === upazila) : all), [all, upazila]);
  const catStats = useMemo(() => computeStats(inUpazila).categories, [inUpazila]);
  const upazilaMeta = stats.upazilas.find((u) => u.id === upazila);

  const q = dSearch.trim().toLowerCase();
  const tokens = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);
  // One lower-case text per institute, built once. It covers the workbook fields, the Promised / Rejected mark (who, note, stage),
  // its status and the connection records, so searching "promised", a foreman's name or an NMS ID finds the institute in any list.
  const haystack = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) {
      m.set(r.edc, [
        r.edc, r.name, r.displayName, r.category, r.upazila, r.union, r.contact, r.mobile, r.emis, r.status,
        r.tag?.foremanName, r.tag?.note, r.tag?.stage,
        ...r.logs.flatMap((l) => [l.logNo, l.nmsId, l.foremanName]),
      ].filter(Boolean).join(' ').normalize('NFC').toLowerCase());
    }
    return m;
  }, [all]);
  // Counts follow upazila / category / search; the tab only picks which of them to list.
  const scoped = useMemo(() => inUpazila.filter((r) => {
    if (category && r.category !== category) return false;
    if (!tokens.length) return true;
    const h = haystack.get(r.edc) || '';
    return tokens.every((t) => h.includes(t));
  }), [inUpazila, category, tokens, haystack]);

  const extras = useMemo(() => rec.extras.filter((e) => {
    if (upazila && e.upazilaId !== upazila) return false;
    if (category && e.category !== category) return false;
    if (!q) return true;
    return [e.edc, e.name, e.log.logNo, e.log.foremanName, e.log.nmsId, e.log.upazila].join(' ').toLowerCase().includes(q);
  }), [rec, upazila, category, q]);

  const shared = useMemo(() => sharedAll.filter((g) => {
    if (upazila && g.upazilaId !== upazila) return false;
    if (category && g.category !== category) return false;
    if (!q) return true;
    return [g.edc, g.target.name, ...g.records.flatMap((r) => [r.name, r.log.logNo, r.log.nmsId, r.log.foremanName])].join(' ').toLowerCase().includes(q);
  }), [sharedAll, upazila, category, q]);

  // Records whose own upazila differs from their target's upazila: the Connection Records page files them under the wrong upazila.
  const mismatchAll = useMemo(() => {
    const out: { log: LogEntry; target: TargetRow; has: string; want: string }[] = [];
    for (const r of all) for (const l of r.logs) {
      const has = upazilaKey(l.upazila) || (l.upazila || '').trim();
      if (has !== r.upazilaId) out.push({ log: l, target: r, has: has || '(none)', want: r.upazilaId });
    }
    return out.sort((a, b) => a.want.localeCompare(b.want) || Number(a.log.logNo) - Number(b.log.logNo));
  }, [all]);
  const mismatch = useMemo(() => mismatchAll.filter((m) => {
    if (upazila && m.want !== upazila && m.has !== upazila) return false;
    if (category && m.target.category !== category) return false;
    if (!q) return true;
    return [m.target.edc, m.target.name, m.log.logNo, m.log.nmsId, m.log.foremanName, m.has, m.want].join(' ').toLowerCase().includes(q);
  }), [mismatchAll, upazila, category, q]);
  const scroll = useScrollMemory(`targets:${tab}:${groupBy}`);
  const [fixing, setFixing] = useState(false);
  const fixUp = async (items: typeof mismatchAll) => {
    if (!items.length) return;
    setFixing(true);
    try {
      const r = await fixUpazilas(items.map((m) => m.log.id));
      await onRefresh?.();
      setNotice(`Moved ${r.updated} record${r.updated === 1 ? '' : 's'} to their target's upazila.`);
    } catch (e: any) { setNotice(e?.message || 'Could not update the records.'); }
    setFixing(false);
  };
  const upLabel = (id: string) => { const u = UPAZILAS.find((x) => x.key === id); return u ? `${u.key} (${u.bn})` : id; };

  const counts = useMemo(() => {
    const c = { left: 0, promised: 0, rejected: 0, connected: 0, shared: shared.length, extra: extras.length, upazila: mismatch.length, all: scoped.length };
    for (const r of scoped) c[r.status] += 1;
    return c;
  }, [scoped, extras, shared, mismatch]);

  // Promised tab: the foremen who hold a promise (with how many), for the "promised by" filter.
  const promisedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of scoped) if (r.status === 'promised') { const n = r.tag?.foremanName || '(no foreman)'; m.set(n, (m.get(n) || 0) + 1); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scoped]);
  const today = todayIso();
  const overdueCount = useMemo(() => scoped.filter((r) => r.status === 'promised' && r.tag && isOverdue(r.tag, today)).length, [scoped, today]);
  // Does this institute belong in the list the current tab shows?
  const inTab = useCallback((r: TargetRow) => {
    if (tab !== 'all' && r.status !== tab) return false;
    if (tab === 'promised') {
      if (foremanFilter && (r.tag?.foremanName || '(no foreman)') !== foremanFilter) return false;
      if (overdueOnly && !(r.tag && isOverdue(r.tag, today))) return false;
    }
    return true;
  }, [tab, foremanFilter, overdueOnly, today]);

  const rows = useMemo(() => (tab === 'extra' || tab === 'shared' || tab === 'upazila' ? [] : scoped.filter(inTab)), [scoped, tab, inTab]);
  const filtered = Boolean(category || upazila || q || (tab === 'promised' && (foremanFilter || overdueOnly)));
  const sc = counts.connected, sl = counts.left;

  // Sections: header numbers use every status, the list follows the tab.
  const groups = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; sub?: string; tally: Tally; rows: TargetRow[] }>();
    const upMeta = new Map(stats.upazilas.map((u) => [u.id, u] as const));
    const key = (r: TargetRow) => (groupBy === 'none' ? 'all' : groupBy === 'category' ? r.category : r.upazilaId);
    for (const r of scoped) {
      const id = key(r);
      let g = byId.get(id);
      if (!g) {
        g = { id, label: groupBy === 'upazila' ? upMeta.get(id)?.label || id : id, sub: groupBy === 'upazila' ? upMeta.get(id)?.sub : undefined, tally: { total: 0, connected: 0, promised: 0, rejected: 0, left: 0 }, rows: [] };
        byId.set(id, g);
      }
      g.tally.total++; g.tally[r.status]++;
      if (inTab(r)) g.rows.push(r);
    }
    const order = groupBy === 'category' ? stats.categories.map((c) => c.id) : stats.upazilas.map((u) => u.id);
    const pos = (id: string) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
    return [...byId.values()].filter((g) => g.rows.length > 0).sort((a, b) => pos(a.id) - pos(b.id));
  }, [scoped, groupBy, inTab, stats]);

  const isOpen = (id: string) => openMap[`${groupBy}:${id}`] ?? (groups.length <= 1 || Boolean(q));

  // Only the first ROW_PAGE institutes (across the open sections) are drawn; "Show more" adds the next page.
  // The count starts again from one page whenever the list, a filter or the search changes (no extra pass needed).
  const sig = [tab, groupBy, upazila, category, q, foremanFilter, overdueOnly].join('|');
  const [pager, setPager] = useState({ sig, n: ROW_PAGE });
  const shown = pager.sig === sig ? pager.n : ROW_PAGE;
  const setShown = (f: (n: number) => number) => setPager({ sig, n: f(shown) });
  const { sections, hiddenRows } = (() => {
    let budget = shown, hidden = 0;
    const out = groups.map((g) => {
      const open = groupBy === 'none' || isOpen(g.id);
      let take: TargetRow[] = [];
      if (open) { take = g.rows.slice(0, Math.max(0, budget)); budget -= take.length; hidden += g.rows.length - take.length; }
      return { g, open, take };
    });
    return { sections: out, hiddenRows: hidden };
  })();
  const setAllOpen = (open: boolean) => setOpenMap(Object.fromEntries(groups.map((g) => [`${groupBy}:${g.id}`, open])));

  const exportAs = (mode: ExportMode) => {
    setExportOpen(false);
    const parts = [upazilaMeta?.sub, category && shortCategory(category).replace(/\s+/g, '_'), tab !== 'all' && tab].filter(Boolean) as string[];
    runExport('your Excel file', rows.length, () => exportTargets(mode, all, rows, parts.join('_') || 'all', rec.extras, tab === 'extra' ? extras : null, sharedAll, tab === 'shared' ? shared : null, includeTagged),
      (e) => alert('Could not create the Excel file: ' + (e?.message || e)));
  };

  // ───────────── Promised / Rejected marks ─────────────
  const foremenById = useMemo(() => new Map(foremen.map((f) => [f.id, f] as const)), [foremen]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  useEffect(() => { setSelected(new Set()); }, [tab]);
  useEffect(() => { if (foremanFilter && !promisedBy.some(([n]) => n === foremanFilter)) setForemanFilter(''); }, [promisedBy, foremanFilter, setForemanFilter]);
  useEffect(() => { if (overdueOnly && overdueCount === 0) setOverdueOnly(false); }, [overdueCount, overdueOnly, setOverdueOnly]);

  const canSelect = tab === 'left' || tab === 'promised' || tab === 'rejected';
  // Only what is visible counts, so a filter can never leave an invisible institute in a bulk action.
  const selectedRows = useMemo(() => rows.filter((r) => !r.connected && selected.has(r.edc)), [rows, selected]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const toggle = useCallback((edc: string) => setSelected((p) => { const n = new Set(p); if (n.has(edc)) n.delete(edc); else n.add(edc); return n; }), []);
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.filter((r) => !r.connected).map((r) => r.edc)));

  const [tagDlg, setTagDlg] = useState<{ rows: TargetRow[]; kind: TagKind } | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState('');
  const openTag = useCallback((rs: TargetRow[], kind: TagKind) => { setTagError(''); setTagDlg({ rows: rs, kind }); }, []);
  const markRow = useCallback((r: TargetRow) => openTag([r], r.tag?.kind ?? 'promised'), [openTag]);

  const saveTag = async (input: TagInput) => {
    if (!tagDlg) return;
    setTagBusy(true); setTagError('');
    try {
      const res = await saveTargetTags(tagDlg.rows.map((x) => x.edc), input);
      await reloadTags();
      const n = res.saved;
      const what = input.kind === 'promised' ? `promised${input.foremanName ? ` by ${input.foremanName}` : ''}` : `rejected${input.stage && input.stage !== 'Rejected' ? ` (${input.stage})` : ''}`;
      setNotice(`${n === 1 ? tagDlg.rows[0].displayName : `${n} institutes`} marked as ${what}.`);
      setTagDlg(null); setSelected(new Set());
    } catch (e: any) { setTagError(e?.message || 'Could not save the mark.'); }
    setTagBusy(false);
  };

  const removeMarks = async (rs: TargetRow[]) => {
    const edcs = rs.filter((r) => r.tag).map((r) => r.edc);
    if (!edcs.length) return;
    setTagBusy(true); setTagError('');
    try {
      const res = await removeTargetTags(edcs);
      await reloadTags();
      setNotice(`Mark removed from ${res.removed === 1 ? rs.find((r) => r.tag)!.displayName : `${res.removed} institutes`}. ${res.removed === 1 ? 'It is' : 'They are'} back in Left.`);
      setTagDlg(null); setSelected(new Set());
    } catch (e: any) { setTagError(e?.message || 'Could not remove the mark.'); setNotice(e?.message || 'Could not remove the mark.'); }
    setTagBusy(false);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'left', label: 'Left' },
    { key: 'promised', label: 'Promised' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'connected', label: 'Connected' },
    { key: 'shared', label: 'Shared EDC' },
    { key: 'extra', label: 'Not matched' },
    { key: 'upazila', label: 'Wrong upazila' },
    { key: 'all', label: 'All targets' },
  ];

  const exportItems: { mode: ExportMode; title: string; desc: string }[] = [
    { mode: 'view', title: 'This list (Excel)', desc: `${(tab === 'extra' ? extras.length : tab === 'shared' ? shared.length : rows.length).toLocaleString()} shown now${tab === 'extra' || tab === 'shared' ? '' : ', with Overview, per-upazila / per-category counts, Connected, Left, Promised and Rejected sheets'}` },
    { mode: 'by-upazila', title: 'Everything, a sheet per upazila', desc: 'Overview + counts + Connected / Left sheets + a sheet for every upazila' },
    { mode: 'by-category', title: 'Everything, a sheet per category', desc: 'Overview + counts + Connected / Left sheets + a sheet for every category' },
    { mode: 'left-by-upazila', title: 'Left only, a sheet per upazila', desc: includeTagged ? 'Every institute not connected yet, promised and rejected ones too (marked in a Status column): one sheet per upazila' : 'Only institutes left for connection, without the promised and rejected ones: one sheet per upazila, Primary first' },
    { mode: 'csv', title: 'This list (CSV)', desc: 'Plain text file that opens in Excel' },
  ];

  const R = rec.byReason;
  const extraTotal = rec.extras.length;

  // ───────────── render ─────────────
  return (
    <div className="w-full space-y-4 pb-4">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          {embedded ? null : <span className="grid place-items-center w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-600/25"><Target className="w-5 h-5" /></span>}
          <div>
            {embedded ? null : <h1 className="text-2xl font-extrabold tracking-tight text-[#1b2a4e]">Targets</h1>}
            <p className="text-[13px] text-slate-500">Target institutes from the workbook, matched to Connection Records by EDC number.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} className={`${ghost} text-brand-800 border-brand-200 bg-brand-50 hover:bg-brand-100`} title="Import the whole workbook (every upazila sheet)">
                <Upload className="w-4 h-4" />Import workbook
              </button>
              {total > 0 && (
                <button type="button" onClick={() => setConfirmClear(true)} className={ghost} title="Remove every institute from the target list">
                  <Trash2 className="w-4 h-4" />Clear list
                </button>
              )}
            </>
          )}
          <div className="relative">
            <button type="button" onClick={() => setExportOpen((v) => !v)} disabled={!total} aria-expanded={exportOpen} className={`${ghost} disabled:opacity-40`}>
              <Download className="w-4 h-4" />Export<ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} aria-hidden />
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] z-40 bg-white rounded-2xl border border-slate-100 shadow-2xl p-1.5">
                  {exportItems.map((it) => (
                    <button key={it.mode} type="button" onClick={() => exportAs(it.mode)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-50">
                      <span className="block text-[13px] font-semibold text-[#1b2a4e]">{it.title}</span>
                      <span className="block text-[11.5px] text-slate-400">{it.desc}</span>
                    </button>
                  ))}
                  {(stats.overall.promised > 0 || stats.overall.rejected > 0) && (
                    <label className="mt-1 flex items-start gap-2.5 px-3 py-2.5 rounded-xl border-t border-slate-100 text-[12px] cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={includeTagged} onChange={(e) => setIncludeTagged(e.target.checked)} className="mt-0.5" />
                      <span>
                        <b className="text-[#1b2a4e]">Include promised and rejected in the Left lists</b>
                        <span className="block text-slate-400">Off: the Left lists show only institutes nobody has promised or rejected. Promised and Rejected always get their own sheets.</span>
                      </span>
                    </label>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {(notice || (importError && !parsed) || loadError) && (
        <div className={`flex items-start gap-2 px-4 py-2.5 rounded-2xl text-[13px] ${importError || loadError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`} role="status">
          <span className="flex-1">{importError || loadError || notice}</span>
          <button type="button" onClick={() => { setNotice(''); setImportError(''); setLoadError(''); }} aria-label="Dismiss" className="shrink-0 mt-0.5"><X className="w-4 h-4" /></button>
        </div>
      )}

      {targets === null ? (
        <div className={`${surface} p-12 grid place-items-center`}><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>
      ) : total === 0 ? (
        <div className={`${surface} p-10 text-center`}>
          <span className="mx-auto grid place-items-center w-12 h-12 rounded-2xl bg-brand-50 text-brand-700"><FileSpreadsheet className="w-6 h-6" /></span>
          <h2 className="mt-3 text-lg font-bold text-[#1b2a4e]">No target institutes yet</h2>
          <p className="mt-1 text-sm text-slate-500 max-w-lg mx-auto">
            Import the whole workbook. Every upazila sheet is read at once, and each institute is filed under its <b>upazila</b> and <b>category</b>.
          </p>
          {isAdmin ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-4 inline-flex items-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-xl transition-colors">
              <Upload className="w-4 h-4" />Import workbook
            </button>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Ask an admin to import the list.</p>
          )}
        </div>
      ) : (<>

      {/* One slim summary: progress + how the record count adds up */}
      <section className={`${surface} px-5 py-4`}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">Connected targets</div>
            <div className="flex items-baseline gap-2">
              <span className="text-[32px] leading-none font-extrabold font-display tabular-nums text-emerald-600">{stats.overall.connected.toLocaleString()}</span>
              <span className="text-[15px] text-slate-400 tabular-nums">of {total.toLocaleString()} · {pct(stats.overall.connected, total)}%</span>
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">Promised</div>
            <span className="text-[32px] leading-none font-extrabold font-display tabular-nums text-amber-600">{stats.overall.promised.toLocaleString()}</span>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">Rejected</div>
            <span className="text-[32px] leading-none font-extrabold font-display tabular-nums text-violet-600">{stats.overall.rejected.toLocaleString()}</span>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide" title="Not connected, not promised and not rejected">Left for connection</div>
            <span className="text-[32px] leading-none font-extrabold font-display tabular-nums text-rose-600">{stats.overall.left.toLocaleString()}</span>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wide">Connection records</div>
            <span className="text-[32px] leading-none font-extrabold font-display tabular-nums text-[#1b2a4e]">{rec.records.toLocaleString()}</span>
          </div>
        </div>
        <div className="mt-3"><Bar value={pct(stats.overall.connected, total)} /></div>

        {extraTotal === 0 && sharedAll.length === 0 && mismatchAll.length === 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-emerald-700"><CheckCircle2 className="w-4 h-4" />Every connection record matches its own target ({rec.records.toLocaleString()} records on {stats.overall.connected.toLocaleString()} institutes).</p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-[12.5px] text-slate-500">
              <b className="tabular-nums text-[#1b2a4e]">{rec.records.toLocaleString()}</b> records = <b className="tabular-nums text-[#1b2a4e]">{rec.connectedTargets.toLocaleString()}</b> connected institutes
              {rec.matchedRecords > rec.connectedTargets && <> + <b className="tabular-nums text-amber-700">{rec.matchedRecords - rec.connectedTargets}</b> extra records on an EDC number that another record already uses</>}
              {extraTotal > 0 && <> + <b className="tabular-nums text-amber-700">{extraTotal}</b> records with no matching EDC number</>}.
              An institute counts once, however many records it has.
            </p>
            {sharedAll.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12.5px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span><b className="tabular-nums">{sharedAll.length}</b> EDC numbers are written on 2 or more records. Either the same institute was connected twice, or one record has the wrong EDC number (so its real institute still shows as Left).</span>
                <button type="button" onClick={() => { setTab('shared'); setUpazila(''); setCategory(''); setSearch(''); }}
                  className="ml-auto h-7 px-3 rounded-lg bg-amber-100 hover:bg-amber-200 font-semibold">Review {sharedAll.length}</button>
              </div>
            )}
            {mismatchAll.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12.5px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span><b className="tabular-nums">{mismatchAll.length}</b> connection records are saved under a different upazila than their target (usually the foreman's), so they are missing from that upazila on the Connection Records page.</span>
                <button type="button" onClick={() => { setTab('upazila'); setUpazila(''); setCategory(''); setSearch(''); }}
                  className="ml-auto h-7 px-3 rounded-lg bg-amber-100 hover:bg-amber-200 font-semibold">Review {mismatchAll.length}</button>
              </div>
            )}
            {extraTotal > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-amber-50 text-amber-900 px-3.5 py-2.5 text-[12.5px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  <b className="tabular-nums">{extraTotal}</b> records do not match any target:
                  {R['no-edc'] > 0 && <> <b className="tabular-nums">{R['no-edc']}</b> without an EDC number</>}
                  {R['no-edc'] > 0 && R['not-in-workbook'] > 0 && ','}
                  {R['not-in-workbook'] > 0 && <> <b className="tabular-nums">{R['not-in-workbook']}</b> with an EDC number that is not in the workbook</>}.
                </span>
                <button type="button" onClick={() => { setTab('extra'); setUpazila(''); setCategory(''); setSearch(''); }}
                  className="ml-auto h-7 px-3 rounded-lg bg-amber-100 hover:bg-amber-200 font-semibold">Review {extraTotal}</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={`${surface} overflow-hidden min-w-0 flex flex-col h-[max(30rem,calc(100vh_-_14rem))]`}>
        <div className="shrink-0 p-4 space-y-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex flex-wrap p-0.5 rounded-xl bg-slate-100 text-xs font-semibold" role="tablist">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={`h-8 px-3.5 rounded-[10px] transition-colors ${tab === t.key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {t.label} <span className={`ml-1 tabular-nums ${tab === t.key ? (t.key === 'extra' || t.key === 'shared' || t.key === 'upazila' || t.key === 'promised' ? 'text-amber-600' : t.key === 'rejected' ? 'text-violet-600' : 'text-brand-600') : 'text-slate-400'}`}>{counts[t.key]}</span>
                </button>
              ))}
            </div>
            {filtered && (
              <button type="button" onClick={() => { setUpazila(''); setCategory(''); setSearch(''); setForemanFilter(''); setOverdueOnly(false); }} className="text-xs font-semibold text-brand-700 hover:underline">Clear filters</button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'extra' || tab === 'shared' ? 'Search record no., EDC, institute' : 'Search EDC no., institute, union, mobile'}
                className="w-full h-10 pl-9 pr-3 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:bg-white focus:border-slate-200 placeholder:text-slate-400" />
            </div>
            <select value={upazila} onChange={(e) => setUpazila(e.target.value)} className={`${selectCls} max-w-[13rem]`} aria-label="Upazila">
              <option value="">All upazilas · {stats.overall.connected}/{total}</option>
              {stats.upazilas.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.connected}/{u.total}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${selectCls} max-w-[15rem]`} aria-label="Category">
              <option value="">All categories</option>
              {catStats.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.connected}/{c.total}</option>)}
            </select>
            {tab === 'promised' && promisedBy.length > 0 && (
              <select value={foremanFilter} onChange={(e) => setForemanFilter(e.target.value)} className={`${selectCls} max-w-[13rem]`} aria-label="Promised by">
                <option value="">All foremen · {counts.promised}</option>
                {promisedBy.map(([n, c]) => <option key={n} value={n}>{n} · {c}</option>)}
              </select>
            )}
            {tab === 'promised' && overdueCount > 0 && (
              <button type="button" onClick={() => setOverdueOnly(!overdueOnly)} aria-pressed={overdueOnly}
                className={`inline-flex items-center gap-1.5 h-10 px-3.5 text-xs font-semibold rounded-xl border transition-colors ${overdueOnly ? 'bg-rose-600 border-rose-600 text-white' : 'bg-rose-50 border-rose-100 text-rose-700 hover:bg-rose-100'}`}>
                <CalendarClock className="w-4 h-4" />Overdue {overdueCount}
              </button>
            )}
            {tab !== 'extra' && tab !== 'shared' && tab !== 'upazila' && (
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={selectCls} aria-label="Group the list by">
                <option value="none">No grouping</option>
                <option value="category">Group by category</option>
                <option value="upazila">Group by upazila</option>
              </select>
            )}
          </div>

          {filtered && (tab === 'left' || tab === 'promised' || tab === 'rejected' || tab === 'connected') && (() => {
            const elsewhere = (['left', 'promised', 'rejected', 'connected'] as const).filter((k) => k !== tab && counts[k] > 0);
            if (!elsewhere.length) return null;
            return (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-[12px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Also matching, but listed under another tab:</span>
                {elsewhere.map((k) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-amber-100 hover:bg-amber-200 font-semibold capitalize">
                    {k} <span className="tabular-nums">{counts[k]}</span>
                  </button>
                ))}
                <button type="button" onClick={() => setTab('all')} className="ml-auto font-semibold underline hover:text-amber-950">Show all kinds</button>
              </div>
            );
          })()}

          {filtered && tab !== 'extra' && tab !== 'shared' && tab !== 'upazila' && (
            <p className="text-[12px] text-slate-500 tabular-nums">
              {[upazilaMeta?.label, category].filter(Boolean).join(' · ') || 'Search'}: <b className="text-emerald-600">{sc}</b> connected{counts.promised > 0 && <> · <b className="text-amber-600">{counts.promised}</b> promised</>}{counts.rejected > 0 && <> · <b className="text-violet-600">{counts.rejected}</b> rejected</>} · <b className="text-rose-600">{sl}</b> left · {pct(sc, sc + counts.promised + counts.rejected + sl)}%
            </p>
          )}
        </div>

        {canSelect && rows.length > 0 && (
          <div className="shrink-0 px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 bg-slate-50/60 text-[12px]">
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-600">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>{selectedRows.length > 0 ? <><b className="tabular-nums text-[#1b2a4e]">{selectedRows.length}</b> selected</> : <>Select all <span className="tabular-nums">{rows.length.toLocaleString()}</span></>}</span>
            </label>
            {selectedRows.length > 0 ? (
              <>
                <button type="button" onClick={() => openTag(selectedRows, 'promised')} disabled={tagBusy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold disabled:opacity-50"><UserCheck className="w-3.5 h-3.5" />Mark promised</button>
                <button type="button" onClick={() => openTag(selectedRows, 'rejected')} disabled={tagBusy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-900 font-semibold disabled:opacity-50"><Ban className="w-3.5 h-3.5" />Mark rejected</button>
                {selectedRows.some((r) => r.tag) && (
                  <button type="button" onClick={() => removeMarks(selectedRows)} disabled={tagBusy}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-50">Remove mark</button>
                )}
                <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-brand-700 hover:underline">Clear</button>
              </>
            ) : (
              <span className="text-slate-400">Tick institutes to mark them as promised by a foreman, or rejected by the institute.</span>
            )}
          </div>
        )}

        {tab === 'shared' ? (
          shared.length === 0 ? (
            <div className="flex-1 grid place-content-center px-4 py-16 text-center">
              <p className="text-sm font-semibold text-[#1b2a4e]">{filtered ? 'No shared EDC numbers here' : 'No EDC number is used twice'}</p>
              <p className="text-xs text-slate-400 mt-1">{filtered ? 'Try clearing the filters.' : 'Nothing to review.'}</p>
            </div>
          ) : (
            <div {...scroll} className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              <p className="px-4 py-2.5 text-[12px] text-slate-500 bg-slate-50/60">
                Each box is one EDC number written on more than one record. The institute counts as connected once. If a record's name is not the institute of that EDC number, fix its EDC number in Connection Records.
              </p>
              {shared.map((g) => <SharedCard key={g.edc} g={g} onOpenLog={onOpenLog} />)}
            </div>
          )
        ) : tab === 'upazila' ? (
          mismatch.length === 0 ? (
            <div className="flex-1 grid place-content-center px-4 py-16 text-center">
              <p className="text-sm font-semibold text-[#1b2a4e]">{filtered ? 'No mismatched records here' : 'Every record is under its target\'s upazila'}</p>
              <p className="text-xs text-slate-400 mt-1">{filtered ? 'Try clearing the filters.' : 'Nothing to review.'}</p>
            </div>
          ) : (
            <div {...scroll} className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-50">
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-[12px] text-slate-500 bg-slate-50/60">
                <span>Each record below is filed under a different upazila than its target. Open it to edit, or move it to the target's upazila with one click. Its foreman does not change.</span>
                <button type="button" disabled={fixing} onClick={() => fixUp(mismatch)}
                  className="ml-auto h-8 px-3.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  {fixing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Move all {mismatch.length} to the target's upazila
                </button>
              </div>
              {mismatch.map((m) => (
                <div key={m.log.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex items-center h-7 px-2 rounded-lg bg-slate-100 text-[11.5px] font-bold tabular-nums text-slate-600">EDC {m.target.edc}</span>
                  <div className="flex-1 min-w-[14rem]">
                    <div className="text-[13px] font-semibold text-[#1b2a4e]">{m.target.displayName}</div>
                    <div className="text-[11.5px] text-slate-500">Record #{m.log.logNo} · NMS {m.log.nmsId || '-'} · Foreman {m.log.foremanName || '-'}</div>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-rose-600 font-semibold">Saved as {m.has}</span>
                    <span className="mx-1.5 text-slate-300">→</span>
                    <span className="text-emerald-700 font-semibold">Target: {upLabel(m.want)}</span>
                  </div>
                  <button type="button" onClick={() => onOpenLog(m.log.id)} className="h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50">Open record</button>
                  <button type="button" disabled={fixing} onClick={() => fixUp([m])} className="h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Move to {m.want}</button>
                </div>
              ))}
            </div>
          )
        ) : tab === 'extra' ? (
          extras.length === 0 ? (
            <div className="flex-1 grid place-content-center px-4 py-16 text-center">
              <p className="text-sm font-semibold text-[#1b2a4e]">{filtered ? 'No unmatched records here' : 'Every connection record matches a target'}</p>
              <p className="text-xs text-slate-400 mt-1">{filtered ? 'Try clearing the filters.' : 'Nothing to review.'}</p>
            </div>
          ) : (
            <div {...scroll} className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-50">
              {extras.map((e) => <ExtraRow key={e.log.id} e={e} onOpenLog={onOpenLog} />)}
            </div>
          )
        ) : groups.length === 0 ? (
          <div className="flex-1 grid place-content-center px-4 py-16 text-center">
            <p className="text-sm font-semibold text-[#1b2a4e]">
              {tab === 'left' && !filtered ? (counts.promised + counts.rejected > 0 ? 'Nothing is left without a promise or a rejection' : 'Every target institute is connected')
                : tab === 'promised' && !filtered ? 'No promised institutes'
                : tab === 'rejected' && !filtered ? 'No rejected institutes'
                : 'No institutes in this list'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {tab === 'left' && !filtered ? (counts.promised + counts.rejected > 0 ? 'Promised and rejected institutes have their own tabs.' : 'Nothing is left for connection.')
                : tab === 'promised' && !filtered ? 'When a foreman promises to connect an institute, mark it from the Left tab.'
                : tab === 'rejected' && !filtered ? 'When an institute rejects the proposal, mark it from the Left tab to follow its application.'
                : 'Try another tab, upazila, category or search.'}
            </p>
          </div>
        ) : (
          <div {...scroll} className="flex-1 min-h-0 overflow-y-auto">
            {groupBy !== 'none' && groups.length > 1 && (
              <div className="px-4 py-2 flex items-center gap-3 text-[11.5px] text-slate-400 border-b border-slate-100 bg-slate-50/60">
                <span className="tabular-nums">{rows.length.toLocaleString()} institutes in {groups.length} {groupBy === 'category' ? 'categories' : 'upazilas'}</span>
                <button type="button" onClick={() => setAllOpen(true)} className="ml-auto font-semibold text-brand-700 hover:underline">Expand all</button>
                <button type="button" onClick={() => setAllOpen(false)} className="font-semibold text-brand-700 hover:underline">Collapse all</button>
              </div>
            )}
            {sections.map(({ g, open, take }) => {
              return (
                <div key={g.id}>
                  {groupBy !== 'none' && (
                    <button type="button" onClick={() => setOpenMap((m) => ({ ...m, [`${groupBy}:${g.id}`]: !open }))} aria-expanded={open}
                      className="sticky top-0 z-[5] w-full px-4 py-2.5 flex items-center gap-2.5 text-left bg-slate-50 hover:bg-slate-100 border-b border-slate-100">
                      {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="flex-1 min-w-0 text-[13px] font-bold text-[#1b2a4e]">{g.label}{g.sub && <span className="ml-2 text-[11px] font-medium text-slate-400">{g.sub}</span>}</span>
                      <span className="shrink-0 text-[11.5px] text-slate-500 tabular-nums"><b className="text-[#1b2a4e]">{g.tally.connected}/{g.tally.total}</b>{g.tally.promised > 0 && <> · {g.tally.promised} promised</>}{g.tally.rejected > 0 && <> · {g.tally.rejected} rejected</>} · {g.tally.left} left</span>
                    </button>
                  )}
                  {open && (
                    <div className="divide-y divide-slate-50">
                      {take.map((r) => <Row key={r.edc} r={r} showCategory={groupBy !== 'category'} showUpazila={groupBy !== 'upazila'} onOpenLog={onOpenLog}
                        selectable={canSelect} selected={selected.has(r.edc)} onToggle={toggle} onMark={markRow} foremenById={foremenById} today={today} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenRows > 0 && (
              <div className="px-4 py-4 flex flex-wrap items-center gap-3 text-[12px] text-slate-500 border-t border-slate-100">
                <button type="button" onClick={() => setShown((n) => n + ROW_PAGE)}
                  className="h-8 px-3.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">Show {Math.min(ROW_PAGE, hiddenRows)} more</button>
                <button type="button" onClick={() => setShown((n) => n + hiddenRows)} className="font-semibold text-brand-700 hover:underline">Show all</button>
                <span className="tabular-nums">{hiddenRows.toLocaleString()} more not shown yet</span>
              </div>
            )}
          </div>
        )}
      </section>
      </>)}

      {parsed && plan && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <ScrollLock />
          <div role="dialog" aria-modal="true" aria-label="Import target institutes" className="bg-white w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-100 p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <span className="grid place-items-center w-10 h-10 rounded-2xl text-white shadow-lg shrink-0 bg-gradient-to-br from-brand-400 to-brand-700 shadow-brand-600/30"><FileSpreadsheet className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[#1b2a4e]">Import target institutes</h3>
                <p className="text-[13px] text-slate-500 mt-1 break-words">{parsed.fileName} · {parsed.data.rows.length.toLocaleString()} institutes in {parsed.data.sheets.length} sheets</p>
              </div>
            </div>

            <ul className="grid grid-cols-3 gap-2 text-center">
              {([['New', plan.added, 'text-emerald-600'], ['Updated', plan.updated, 'text-amber-600'], ['Already listed', plan.unchanged, 'text-slate-500']] as const).map(([label, n, tone]) => (
                <li key={label} className="rounded-2xl bg-slate-50 py-3">
                  <div className={`text-2xl font-extrabold tabular-nums ${tone}`}>{n}</div>
                  <div className="text-[11px] text-slate-500">{label}</div>
                </li>
              ))}
            </ul>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Upazila (sheet) → institutes</div>
              <div className="flex flex-wrap gap-1.5">
                {parsed.data.sheets.map((s) => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 h-6 pl-2.5 pr-2 rounded-full bg-slate-100 text-[12px] text-slate-700">
                    {s.name}<b className="tabular-nums text-[#1b2a4e]">{s.rows}</b>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Category</div>
              <div className="flex flex-wrap gap-1.5">
                {importCats.map(([c, n]) => (
                  <span key={c} className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold ${categoryStyle(c).pill}`}>
                    {shortCategory(c)}<span className="tabular-nums opacity-70">{n}</span>
                  </span>
                ))}
              </div>
            </div>

            <p className="text-[12px] text-slate-500">
              Institutes are matched by EDC number (the serial number in the sheet). New ones are added and ones already on the list are updated.
              This only changes the Targets list, never Connection Records.
            </p>

            <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12px] cursor-pointer ${replace ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
              <span>
                <b className="text-[#1b2a4e]">Replace the list with this workbook</b>
                <span className="block text-slate-500">
                  {plan.notInFile > 0
                    ? `${plan.notInFile} institutes on the list today are not in this file and would be removed.`
                    : 'Nothing on the list today is missing from this file, so nothing would be removed.'}
                </span>
              </span>
            </label>

            {(parsed.data.invalid > 0 || parsed.data.duplicates > 0 || parsed.data.unknownUpazila > 0 || parsed.data.unnamed > 0 || parsed.data.ignoredSheets.length > 0) && (
              <ul className="text-[12px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2 space-y-0.5">
                {parsed.data.invalid > 0 && <li>{parsed.data.invalid} rows skipped: no valid EDC number.</li>}
                {parsed.data.duplicates > 0 && <li>{parsed.data.duplicates} repeated EDC numbers in the file: the last row is used.</li>}
                {parsed.data.unknownUpazila > 0 && <li>{parsed.data.unknownUpazila} rows have an upazila outside the 13 known ones; they are kept as their own group.</li>}
                {parsed.data.unnamed > 0 && <li>{parsed.data.unnamed} institutes have an EDC number but no name in the Excel; they are kept with a placeholder name.</li>}
                {parsed.data.ignoredSheets.length > 0 && <li>Sheets skipped: {parsed.data.ignoredSheets.join(', ')}.</li>}
              </ul>
            )}
            {importError && <p className="text-[12px] text-rose-600">{importError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setParsed(null); setImportError(''); }} disabled={importing}
                className="h-10 px-5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
              <button type="button" onClick={runImport} disabled={importing || plan.added + plan.updated + (replace ? plan.notInFile : 0) === 0}
                className="inline-flex items-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-xl transition-colors disabled:opacity-40">
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}Import {plan.added + plan.updated}{replace && plan.notInFile > 0 ? ` · remove ${plan.notInFile}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {tagDlg && (
        <TagDialog rows={tagDlg.rows} kind={tagDlg.kind} foremen={foremen} busy={tagBusy} error={tagError}
          onSave={saveTag} onRemove={tagDlg.rows.some((r) => r.tag) ? () => removeMarks(tagDlg.rows) : undefined}
          onClose={() => { if (!tagBusy) setTagDlg(null); }} />
      )}

      <ConfirmDialog isOpen={confirmClear} title="Clear the target list?" confirmLabel="Clear list"
        message={`This removes all ${total} target institutes from this tab so you can start over. Connection Records are not touched.`}
        onConfirm={runClear} onCancel={() => setConfirmClear(false)} />
    </div>
  );
};

/** Under an institute's name: what the Promised / Rejected mark says (who, when, expected date, note). */
const TagLine: React.FC<{ tag: TargetTag; phone?: string; today: string }> = ({ tag, phone, today }) => {
  const late = isOverdue(tag, today);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-500">
      {tag.kind === 'promised' ? (
        <>
          <span>Promised {fmtDay(tag.taggedOn)}</span>
          {tag.expectedBy && (
            <span className={late ? 'font-semibold text-rose-600' : ''}>
              · expected by {fmtDay(tag.expectedBy)}{late && ` (${daysBetween(tag.expectedBy, today)} day${daysBetween(tag.expectedBy, today) === 1 ? '' : 's'} overdue)`}
            </span>
          )}
          {phone && <a href={`tel:${phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline tabular-nums"><Phone className="w-3 h-3" />{phone}</a>}
        </>
      ) : (
        <>
          <span>Since {fmtDay(tag.taggedOn)}</span>
          {tag.foremanName && <span>· reported by {tag.foremanName}</span>}
        </>
      )}
      {tag.note && <span className="italic text-slate-500">· {tag.note}</span>}
    </span>
  );
};

interface RowProps {
  r: TargetRow; showCategory: boolean; showUpazila: boolean; onOpenLog: (id: string) => void;
  selectable: boolean; selected: boolean; onToggle: (edc: string) => void; onMark: (r: TargetRow) => void;
  foremenById: Map<string, Foreman>; today: string;
}

const Row: React.FC<RowProps> = React.memo(({ r, showCategory, showUpazila, onOpenLog, selectable, selected, onToggle, onMark, foremenById, today }) => {
  const st = categoryStyle(r.category);
  const tag = r.tag;
  const late = !!tag && isOverdue(tag, today);
  const phone = tag?.foremanId ? foremenById.get(tag.foremanId)?.phone : undefined;
  return (
    <div className={`px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 transition-colors ${selected ? 'bg-brand-50/70' : 'hover:bg-brand-50/50'}`}>
      {selectable && !r.connected && (
        <input type="checkbox" checked={selected} onChange={() => onToggle(r.edc)} aria-label={`Select ${r.displayName}`} className="shrink-0" />
      )}
      <span className="grid place-items-center h-7 min-w-10 px-2 rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 tabular-nums shrink-0" title="EDC number">EDC {r.edc}</span>
      <div className="flex-1 min-w-[11rem]">
        <span className="block text-[13.5px] font-semibold leading-relaxed text-[#1b2a4e]" title={r.displayName !== r.name ? `Name in workbook: ${r.name}` : undefined}>{r.displayName}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-400">
          {showUpazila && <span>{r.upazila}</span>}
          {showCategory && <span className={`inline-flex items-center gap-1 px-1.5 rounded-full font-semibold ${st.pill}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{shortCategory(r.category)}</span>}
          {r.union && <span>· {r.union}</span>}
          {r.mobile && <span className="tabular-nums">· {r.mobile}</span>}
        </span>
        {tag && <TagLine tag={tag} phone={phone} today={today} />}
      </div>
      {r.connected ? (
        <span className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />Connected
          </span>
          {r.logs.map((l) => (
            <button key={l.id} type="button" onClick={() => onOpenLog(l.id)} title="Open this connection record"
              className="px-2 py-1 text-[11px] font-bold tabular-nums rounded-lg bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-800 transition-colors">
              #{l.logNo}
            </button>
          ))}
        </span>
      ) : (
        <span className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
          {tag?.kind === 'promised' ? (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full ${late ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
              <UserCheck className="w-3.5 h-3.5" />{late ? 'Overdue' : 'Promised'}{tag.foremanName ? ` · ${tag.foremanName}` : ''}
            </span>
          ) : tag?.kind === 'rejected' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-violet-50 text-violet-800">
              <Ban className="w-3.5 h-3.5" />{tag.stage || 'Rejected'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-white text-slate-500 ring-1 ring-inset ring-slate-200">
              <Clock className="w-3.5 h-3.5" />Left
            </span>
          )}
          <button type="button" onClick={() => onMark(r)} title={tag ? 'Change or remove this mark' : 'Mark as promised by a foreman, or rejected by the institute'}
            className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
            {tag ? <><Pencil className="w-3 h-3" />Edit</> : 'Mark'}
          </button>
        </span>
      )}
    </div>
  );
});

const ExtraRow: React.FC<{ e: ExtraRecord; onOpenLog: (id: string) => void }> = React.memo(({ e, onOpenLog }) => (
  <div className="px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 hover:bg-amber-50/40 transition-colors">
    <button type="button" onClick={() => onOpenLog(e.log.id)} title="Open this connection record"
      className="grid place-items-center h-7 min-w-10 px-2 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600 hover:bg-brand-100 hover:text-brand-800 tabular-nums shrink-0">#{e.log.logNo}</button>
    <div className="flex-1 min-w-[11rem]">
      <span className="block text-[13.5px] font-semibold leading-relaxed text-[#1b2a4e]">{e.name || '(no name)'}</span>
      <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-400">
        <span>{[e.log.upazila, e.log.foremanName].filter(Boolean).join(' · ') || '-'}</span>
        {e.edc && <span className="tabular-nums">· EDC {e.edc}</span>}
      </span>
    </div>
    <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-amber-50 text-amber-800">
      <AlertCircle className="w-3.5 h-3.5" />
      {e.reason === 'not-in-workbook' ? 'EDC not in workbook' : 'No EDC number'}
    </span>
  </div>
));

const SharedCard: React.FC<{ g: SharedEdc; onOpenLog: (id: string) => void }> = React.memo(({ g, onOpenLog }) => (
  <div className="px-4 py-3">
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span className="h-6 px-2 grid place-items-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 tabular-nums">EDC {g.edc}</span>
      <span className="text-[12.5px] text-slate-500">Workbook name: <b className="text-[#1b2a4e] font-semibold">{g.target.name}</b></span>
      <span className="text-[11.5px] text-slate-400">{g.target.upazila}</span>
    </div>
    <div className="mt-2 rounded-xl border border-slate-100 divide-y divide-slate-100">
      {g.records.map((r) => (
        <div key={r.log.id} className="px-3 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={() => onOpenLog(r.log.id)} title="Open this connection record"
            className="grid place-items-center h-7 min-w-10 px-2 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600 hover:bg-brand-100 hover:text-brand-800 tabular-nums shrink-0">#{r.log.logNo}</button>
          <div className="flex-1 min-w-[11rem]">
            <span className="block text-[13.5px] font-semibold leading-relaxed text-[#1b2a4e]">{r.name || '(no name)'}</span>
            <span className="block text-[11.5px] text-slate-400">{[r.log.upazila, r.log.unionName, r.log.foremanName, r.log.nmsId && `NMS ${r.log.nmsId}`].filter(Boolean).join(' · ')}</span>
            {r.hint && (
              <span className="block mt-0.5 text-[11.5px] text-amber-700">
                Looks like workbook EDC <b>{r.hint.edc}</b> ({r.hint.name}), which has no record yet.
              </span>
            )}
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full ${r.looksSame ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
            {r.looksSame ? 'Name fits this EDC' : 'Name differs from this EDC'}
          </span>
        </div>
      ))}
    </div>
  </div>
));

const fieldCls = 'w-full h-10 px-3 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:bg-white focus:border-slate-300';
const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1';

/** Mark one or more institutes as promised by a foreman, or rejected by the institute (and edit / remove an existing mark). */
const TagDialog: React.FC<{
  rows: TargetRow[]; kind: TagKind; foremen: Foreman[]; busy: boolean; error: string;
  onSave: (t: TagInput) => void; onRemove?: () => void; onClose: () => void;
}> = ({ rows, kind: kind0, foremen, busy, error, onSave, onRemove, onClose }) => {
  const initial = rows.length === 1 ? rows[0].tag : undefined;
  const [kind, setKind] = useState<TagKind>(initial?.kind ?? kind0);
  const [foremanId, setForemanId] = useState(initial?.foremanId || '');
  const [taggedOn, setTaggedOn] = useState(initial?.taggedOn || todayIso());
  const [expectedBy, setExpectedBy] = useState(initial?.expectedBy || '');
  const [stage, setStage] = useState<string>(initial?.stage || REJECT_STAGES[0]);
  const [note, setNote] = useState(initial?.note || '');
  const [local, setLocal] = useState('');

  // Foremen who cover the institutes' upazila come first (when they are all in one upazila).
  const { here, others } = useMemo(() => {
    const active = foremen.filter((f) => f.active && !f.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
    const ups = new Set(rows.map((r) => r.upazilaId));
    const only = ups.size === 1 ? [...ups][0] : '';
    const here = only ? active.filter((f) => foremanServes(f, only)) : [];
    return { here, others: active.filter((f) => !here.includes(f)) };
  }, [foremen, rows]);
  // A foreman named on an old mark who has since left the directory stays selectable, so editing does not lose him.
  const missing = initial?.foremanId && !foremen.some((f) => f.id === initial.foremanId) ? initial : null;
  const opt = (f: Foreman) => <option key={f.id} value={f.id}>{f.name}{f.area ? ` — ${f.area}` : ''}</option>;

  const replacing = rows.length > 1 && rows.some((r) => r.tag);
  const save = () => {
    setLocal('');
    const f = foremen.find((x) => x.id === foremanId);
    const name = f?.name || (missing && missing.foremanId === foremanId ? missing.foremanName : '') || '';
    if (kind === 'promised' && !foremanId) { setLocal('Choose the foreman who promised.'); return; }
    onSave({
      kind, taggedOn,
      ...(foremanId ? { foremanId, foremanName: name } : {}),
      ...(kind === 'promised' && expectedBy ? { expectedBy } : {}),
      ...(kind === 'rejected' ? { stage } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  const names = rows.slice(0, 3).map((r) => r.displayName);
  const title = rows.length === 1 ? rows[0].displayName : `${rows.length} institutes`;
  const shownError = local || error;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <ScrollLock />
      <div role="dialog" aria-modal="true" aria-label="Mark target institutes" className="bg-white w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-100 p-6 space-y-4">
        <div className="flex items-start gap-3.5">
          <span className={`grid place-items-center w-10 h-10 rounded-2xl text-white shadow-lg shrink-0 ${kind === 'promised' ? 'bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-600/30' : 'bg-gradient-to-br from-violet-400 to-violet-700 shadow-violet-600/30'}`}>
            {kind === 'promised' ? <UserCheck className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[#1b2a4e] break-words">{initial ? 'Edit mark' : 'Mark'}: {title}</h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5 break-words">
              {rows.length === 1 ? `EDC ${rows[0].edc} · ${rows[0].upazila}` : `${names.join(', ')}${rows.length > 3 ? ` and ${rows.length - 3} more` : ''}`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="inline-flex p-0.5 rounded-xl bg-slate-100 text-xs font-semibold w-full" role="tablist">
          <button type="button" role="tab" aria-selected={kind === 'promised'} onClick={() => setKind('promised')}
            className={`flex-1 h-9 rounded-[10px] transition-colors ${kind === 'promised' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Promised by a foreman</button>
          <button type="button" role="tab" aria-selected={kind === 'rejected'} onClick={() => setKind('rejected')}
            className={`flex-1 h-9 rounded-[10px] transition-colors ${kind === 'rejected' ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Rejected by institute</button>
        </div>

        <p className="text-[12px] text-slate-500">
          {kind === 'promised'
            ? 'A foreman confirmed he will install the connection. These institutes leave the Left list. When a connection record with the same EDC number is added, they turn Connected by themselves.'
            : 'The institute refused the proposal. These institutes leave the Left list while you send the application and follow the official process. When it is accepted, remove the mark and they go back to Left.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="tag-foreman">{kind === 'promised' ? 'Promised by (foreman)' : 'Reported by (foreman, optional)'}</label>
            <select id="tag-foreman" value={foremanId} onChange={(e) => setForemanId(e.target.value)} className={fieldCls}>
              <option value="">{kind === 'promised' ? 'Choose a foreman…' : 'Nobody in particular'}</option>
              {missing && <option value={missing.foremanId}>{missing.foremanName} (not in the directory)</option>}
              {here.length > 0 && <optgroup label="Covers this upazila">{here.map(opt)}</optgroup>}
              {others.length > 0 && <optgroup label={here.length ? 'Other foremen' : 'Foremen'}>{others.map(opt)}</optgroup>}
            </select>
          </div>
          {kind === 'rejected' && (
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="tag-stage">Where is it in the official process?</label>
              <select id="tag-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={fieldCls}>
                {REJECT_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="tag-on">{kind === 'promised' ? 'Promised on' : 'Rejected on'}</label>
            <input id="tag-on" type="date" value={taggedOn} onChange={(e) => setTaggedOn(e.target.value)} className={fieldCls} />
          </div>
          {kind === 'promised' && (
            <div>
              <label className={labelCls} htmlFor="tag-exp">Expected by (optional)</label>
              <input id="tag-exp" type="date" value={expectedBy} min={taggedOn || undefined} onChange={(e) => setExpectedBy(e.target.value)} className={fieldCls} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="tag-note">{kind === 'promised' ? 'Note (optional)' : 'Reason / note (optional)'}</label>
            <textarea id="tag-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'promised' ? 'e.g. will do it after Eid' : 'e.g. head teacher refused; application sent to the UNO office'}
              className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 resize-none" />
          </div>
        </div>

        {replacing && <p className="text-[12px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">Some of these already have a mark. Saving replaces it with this one.</p>}
        {shownError && <p className="text-[12px] text-rose-600" role="alert">{shownError}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {onRemove && (
            <button type="button" onClick={onRemove} disabled={busy}
              className="mr-auto h-10 px-4 text-xs font-semibold text-rose-700 bg-white border border-rose-200 rounded-xl hover:bg-rose-50 transition-colors disabled:opacity-50">Remove mark</button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="h-10 px-5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="button" onClick={save} disabled={busy}
            className="inline-flex items-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-xl transition-colors disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}{rows.length === 1 ? 'Save' : `Save for ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
};
