import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ClipboardCheck, Download, FileText, X } from 'lucide-react';
import type { Foreman, LogEntry } from '../types';
import { planTopsheets } from '../utils/topsheetExport';
import { upazilaBn } from '../utils/upazilas';
import { displayCategory } from '../utils/category';
import { NameLang, nameFor } from '../utils/names';
import { ScrollLock } from './ScrollLock';

// "Top Sheets by upazila": every upazila's Top Sheet listed together, so one upazila (e.g. only Sylhet Sadar) can be
// previewed and downloaded on its own, as Excel or PDF. It works on the list currently shown on the Forms page
// (tab, month, foreman and search), exactly like the main Top Sheet buttons.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rows: LogEntry[];
  foremen: Foreman[];
  /** Describes the list the sheets are made from, e.g. "Received · November 2026". */
  scopeText: string;
  nameLang: NameLang;
  /** `upazila` is the stored upazila key; `list` holds only that upazila's institutes. */
  onExport: (format: 'xlsx' | 'pdf', upazila: string, list: LogEntry[]) => void;
}

interface Group { key: string; bn: string; items: LogEntry[]; sheets: number }

export const TopsheetByUpazila: React.FC<Props> = ({ isOpen, onClose, rows, foremen, scopeText, nameLang, onExport }) => {
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  // Same grouping and order as the Top Sheet itself (planTopsheets), so what is listed here is what gets exported.
  const groups = useMemo<Group[]>(() => {
    if (!isOpen) return [];
    const byKey = new Map<string, Group>();
    for (const p of planTopsheets(rows, foremen)) {
      const g = byKey.get(p.key) || { key: p.key, bn: p.label, items: [], sheets: 0 };
      g.items.push(...p.items.map((i) => i.l));
      g.sheets += 1;
      byKey.set(p.key, g);
    }
    return [...byKey.values()];
  }, [isOpen, rows, foremen]);

  if (!isOpen) return null;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const btn = 'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-xl border transition-colors';

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <ScrollLock />
      <div role="dialog" aria-modal="true" aria-label="Top Sheets by upazila" className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-brand-50">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 shrink-0" /><span className="truncate">Top Sheets by upazila</span></h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {scopeText} · {total.toLocaleString()} institutes in {groups.length} upazila{groups.length === 1 ? '' : 's'}. Download one upazila's Top Sheet on its own.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900 rounded hover:bg-white" title="Close" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {groups.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-semibold text-[#1b2a4e]">No institutes in this list</p>
            <p className="text-xs text-slate-400 mt-1">Change the tab, month, foreman or search on the Forms page first.</p>
          </div>
        ) : (
          <div className="overflow-y-auto min-h-0 divide-y divide-slate-100">
            {groups.map((g) => {
              const isOpenRow = open === g.key;
              return (
                <div key={g.key}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-brand-50/40 transition-colors">
                    <button type="button" onClick={() => setOpen(isOpenRow ? null : g.key)} aria-expanded={isOpenRow}
                      className="flex-1 min-w-[12rem] flex items-center gap-3 text-left">
                      <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpenRow ? 'rotate-180' : '-rotate-90'}`} />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-[#1b2a4e] truncate">{g.key}{upazilaBn(g.key) ? <span className="ml-2 font-medium text-slate-400">{upazilaBn(g.key)}</span> : null}</span>
                        <span className="block text-[11.5px] text-slate-500 tabular-nums">{g.items.length} institute{g.items.length === 1 ? '' : 's'} · {g.sheets} sheet{g.sheets === 1 ? '' : 's'}</span>
                      </span>
                    </button>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => onExport('xlsx', g.key, g.items)} title={`Download only the ${g.key} Top Sheet as Excel`} aria-label={`${g.key} Top Sheet Excel`}
                        className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}><Download className="w-3.5 h-3.5" />Excel</button>
                      <button type="button" onClick={() => onExport('pdf', g.key, g.items)} title={`Download only the ${g.key} Top Sheet as PDF`} aria-label={`${g.key} Top Sheet PDF`}
                        className={`${btn} border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`}><FileText className="w-3.5 h-3.5" />PDF</button>
                    </div>
                  </div>

                  {isOpenRow && (
                    <ol className="px-4 pb-3 pl-11 space-y-0.5 text-[12.5px]">
                      {g.items.map((l, i) => (
                        <li key={l.id} className="flex items-baseline gap-2 py-1 border-t border-slate-50 first:border-t-0">
                          <span className="w-7 shrink-0 text-right tabular-nums text-slate-400">{i + 1}</span>
                          <span className="flex-1 min-w-0 truncate text-slate-800">{nameFor(l, nameLang).text || 'Untitled'}</span>
                          <span className="shrink-0 hidden sm:inline text-slate-400 truncate max-w-[10rem]">{[(l.unionName || '').trim(), l.nmsId].filter(Boolean).join(' · ')}</span>
                          <span className="shrink-0 hidden md:inline text-[11px] text-slate-400 truncate max-w-[9rem]">{displayCategory(l)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
