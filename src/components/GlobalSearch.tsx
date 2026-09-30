import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search, Loader2, Users, FileText, Receipt, Truck, Briefcase, BookOpen, ShoppingCart } from 'lucide-react';
import { searchApi } from '../lib/api';
import type { Module } from '../types';

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  link: Module;
}

const TYPE_META: Record<string, { label: string; icon: any }> = {
  employee: { label: 'Employee', icon: Users },
  invoice: { label: 'Invoice', icon: FileText },
  bill: { label: 'Bill', icon: Receipt },
  supplier: { label: 'Supplier', icon: Truck },
  purchase_order: { label: 'Purchase order', icon: ShoppingCart },
  project: { label: 'Project', icon: Briefcase },
  journal: { label: 'Journal', icon: BookOpen },
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export default function GlobalSearch({ onNavigate }: { onNavigate: (module: Module) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchApi.search(q);
        if (!cancelled) {
          setResults(res.data.results || []);
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const choose = (result: SearchResult) => {
    onNavigate(result.link);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        placeholder="Search projects, invoices, staff..."
        aria-label="Search"
        className="bg-[#F5F5F5] border-none rounded-full pl-10 pr-16 py-2 text-sm w-64 lg:w-80 focus:ring-2 focus:ring-[#141414] outline-none transition-all"
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#8E9299] bg-white border border-[#E4E3E0] rounded px-1.5 py-0.5 pointer-events-none">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>

      {showPanel && (
        <div className="absolute left-0 top-full mt-2 w-[28rem] max-w-[90vw] bg-white rounded-xl shadow-2xl border border-[#E4E3E0] z-50 overflow-hidden">
          {loading && results.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-[#8E9299]"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-[#8E9299]">No matches for “{query.trim()}”.</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((r, i) => {
                const meta = TYPE_META[r.type] || { label: r.type, icon: Search };
                const Icon = meta.icon;
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(r)}
                      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-[#F5F5F5]' : ''}`}
                    >
                      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-[#8E9299]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[#141414] truncate">{r.title}</span>
                        {r.subtitle && <span className="block text-xs text-[#8E9299] truncate">{r.subtitle}</span>}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-[#8E9299] shrink-0 mt-0.5">{meta.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
