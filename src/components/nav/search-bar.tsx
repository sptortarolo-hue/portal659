"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const TRENDING = ["Pizza", "Empanadas", "Verdulería", "Farmacia", "Electricista", "Mascotas"];

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("portal659_search_history");
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* noop */ }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    saveHistory(q);
    setShowSuggestions(false);
    router.push(`/buscar?q=${encodeURIComponent(q)}`);
  }

  function handleSelect(q: string) {
    setQuery(q);
    saveHistory(q);
    setShowSuggestions(false);
    router.push(`/buscar?q=${encodeURIComponent(q)}`);
  }

  function saveHistory(q: string) {
    const next = [q, ...history.filter((h) => h !== q)].slice(0, 8);
    setHistory(next);
    try { localStorage.setItem("portal659_search_history", JSON.stringify(next)); } catch { /* noop */ }
  }

  function clearHistory() {
    setHistory([]);
    try { localStorage.removeItem("portal659_search_history"); } catch { /* noop */ }
  }

  const filtered = TRENDING.filter((t) =>
    query ? t.toLowerCase().includes(query.toLowerCase()) : true
  );

  const input = (
    <input
      type="text"
      value={query}
      onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
      onFocus={() => setShowSuggestions(true)}
      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
      placeholder="Buscar comercios, productos..."
      className="w-full h-9 rounded-full border border-border bg-muted/50 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
    />
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-6 relative">
        <form onSubmit={handleSubmit} className="relative w-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {input}
        </form>

        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-2 border border-border rounded-xl bg-card shadow-lg z-50 py-2 max-h-72 overflow-y-auto">
            {query && filtered.length > 0 && (
              <div className="px-3 pb-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Sugerencias</p>
                {filtered.map((t) => (
                  <button key={t} onMouseDown={() => handleSelect(t)} className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-muted flex items-center gap-2">
                    <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {t}
                  </button>
                ))}
              </div>
            )}

            {!query && history.length > 0 && (
              <div className="px-3 pb-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recientes</p>
                  <button onMouseDown={(e) => { e.preventDefault(); clearHistory(); }} className="text-[10px] text-primary hover:underline">Limpiar</button>
                </div>
                {history.map((h) => (
                  <button key={h} onMouseDown={() => handleSelect(h)} className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-muted flex items-center gap-2">
                    <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {h}
                  </button>
                ))}
              </div>
            )}

            {!query && (
              <div className="px-3 pt-1 border-t border-border">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tendencias</p>
                {TRENDING.slice(0, 5).map((t) => (
                  <button key={t} onMouseDown={() => handleSelect(t)} className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-muted flex items-center gap-2">
                    <span className="text-xs">🔥</span>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile */}
      <div className="md:hidden flex-1 min-w-0 relative">
        <form onSubmit={handleSubmit} className="relative w-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {input}
        </form>

        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-2 border border-border rounded-xl bg-card shadow-lg z-50 py-2 max-h-60 overflow-y-auto">
            {!query && history.length > 0 && (
              <div className="px-3 pb-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Recientes</p>
                {history.slice(0, 5).map((h) => (
                  <button key={h} onMouseDown={() => handleSelect(h)} className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-muted">
                    {h}
                  </button>
                ))}
              </div>
            )}
            <div className="px-3 pt-1 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tendencias</p>
              {TRENDING.slice(0, 4).map((t) => (
                <button key={t} onMouseDown={() => handleSelect(t)} className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-muted flex items-center gap-2">
                  <span className="text-xs">🔥</span>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
