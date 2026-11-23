import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { LogEntry } from '../types';
import { NameLang, nameFor } from '../utils/names';
import { ScrollLock } from './ScrollLock';

interface Props {
  logs: LogEntry[];
  nameLang: NameLang;
  onOpen: (id: string) => void;
}

const MAX_RESULTS = 8;
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

// Ctrl+K (or Cmd+K) opens this from any screen, even in the middle of editing a form.
// It only opens the connection's detail on top of the current screen, so nothing being edited is lost.
export const QuickSearch: React.FC<Props> = ({ logs, nameLang, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // One global shortcut. e.code covers a Bangla keyboard layout, where e.key is not "k".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return;
      if (e.key.toLowerCase() !== 'k' && e.code !== 'KeyK') return;
      e.preventDefault(); // stop the browser from jumping to its own search bar
      e.stopPropagation();
      setOpen((o) => {
        if (!o) {
          returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setQuery('');
          setActive(0);
        }
        return !o;
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // The search text of every connection is built only while the box is open.
  const index = useMemo(() => {
    if (!open) return [];
    return logs.map((l) => ({
      l,
      ids: [l.logNo, l.nmsId, l.edcNo].map(lc).filter(Boolean),
      name: lc([l.nameBn, l.nameEn, l.customerName].join(' ')),
      hay: lc([
        l.logNo, l.customerName, l.nameBn, l.nameEn, l.nmsId, l.edcNo, l.emisEiinDghs, l.foremanName, l.upazila, l.unionName,
        l.headTeacherName, l.headTeacherPhone, l.foremanPhone, l.mac, l.routerSerial,
      ].join(' ')),
    }));
  }, [open, logs]);

  const { results, total } = useMemo(() => {
    if (!open) return { results: [] as LogEntry[], total: 0 };
    const tokens = query.split(/\s+/).map((t) => lc(t).replace(/^#/, '')).filter(Boolean);
    if (!tokens.length) {
      // Nothing typed yet: the most recently changed connections.
      const recent = [...logs].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { results: recent.slice(0, MAX_RESULTS), total: recent.length };
    }
    const scored: { l: LogEntry; score: number }[] = [];
    for (const x of index) {
      if (!tokens.every((t) => x.hay.includes(t))) continue;
      let score = 0;
      for (const t of tokens) {
        if (x.ids.includes(t)) score += 100;
        else if (x.ids.some((id) => id.startsWith(t))) score += 60;
        else if (x.name.startsWith(t)) score += 40;
        else score += 10;
      }
      scored.push({ l: x.l, score });
    }
    scored.sort((a, b) => b.score - a.score || String(b.l.date || '').localeCompare(String(a.l.date || '')));
    return { results: scored.slice(0, MAX_RESULTS).map((s) => s.l), total: scored.length };
  }, [open, query, index, logs]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => returnTo.current?.focus?.(), 0);
  };
  const pick = (l: LogEntry) => { close(false); onOpen(l.id); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive((a) => (a + 1) % results.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive((a) => (a - 1 + results.length) % results.length); return; }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const l = results[active];
      if (l) pick(l);
    }
  };

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh] bg-slate-950/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(true); }}>
      <ScrollLock />
      <div role="dialog" aria-modal="true" aria-label="Quick search" onKeyDown={onKeyDown}
        className="w-full max-w-xl bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100">
          <Search className="w-4.5 h-4.5 text-brand-600 shrink-0" />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder="Search institute, NMS ID, EDC no, foreman, phone, MAC..."
            aria-label="Search connections"
            className="flex-1 min-w-0 h-full bg-transparent text-sm text-[#1b2a4e] placeholder:text-slate-400 focus:outline-none" />
          <kbd className="hidden sm:inline-flex items-center h-6 px-1.5 text-[10px] font-semibold text-slate-400 border border-slate-200 rounded-md">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[22rem] overflow-y-auto p-1.5">
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {query.trim() ? (total ? `${total} match${total === 1 ? '' : 'es'}` : '') : 'Recently changed'}
          </div>
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-400">No connection matches “{query.trim()}”.</p>
          ) : results.map((l, i) => {
            const on = i === active;
            const sub = [l.foremanName, l.nmsId && `NMS ${l.nmsId}`, l.edcNo && `EDC ${l.edcNo}`, l.upazila].filter(Boolean).join(' · ');
            return (
              <button key={l.id} type="button" data-active={on} onClick={() => pick(l)} onMouseMove={() => setActive(i)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-2xl transition-colors ${on ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : 'hover:bg-slate-50'}`}>
                <span className="grid place-items-center h-7 min-w-9 px-1.5 rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700 tabular-nums shrink-0">#{l.logNo}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-relaxed text-[#1b2a4e] truncate">{nameFor(l, nameLang).text || 'Untitled'}</span>
                  <span className="block text-[11.5px] text-slate-400 truncate">{sub || '—'}</span>
                </span>
              </button>
            );
          })}
          {total > results.length && (
            <p className="px-3 py-2 text-[11px] text-slate-400 text-center">Showing the first {results.length} of {total}. Type more to narrow it down.</p>
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-9 border-t border-slate-100 bg-slate-50/70 text-[11px] text-slate-400">
          <span><b className="font-semibold text-slate-500">↑ ↓</b> move</span>
          <span><b className="font-semibold text-slate-500">Enter</b> open</span>
          <span className="ml-auto"><b className="font-semibold text-slate-500">Ctrl K</b> anywhere</span>
        </div>
      </div>
    </div>
  );
};
