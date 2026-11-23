"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Package, Users, ShoppingBag, X } from "lucide-react";

type Result = {
  type: "product" | "customer" | "order";
  id: string;
  title: string;
  subtitle: string;
  image?: string | null;
  tab: string;
};

export function GlobalSearch({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  const iconFor = (type: string) => {
    if (type === "product") return <Package className="h-4 w-4 text-muted-foreground" />;
    if (type === "customer") return <Users className="h-4 w-4 text-muted-foreground" />;
    return <ShoppingBag className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar... (Ctrl+K)"
          className="w-full h-9 pl-8 pr-8 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setResults([]); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-[999] max-h-80 overflow-y-auto">
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-4">Buscando...</p>
          )}
          {!loading && results.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
          )}
          {!loading && results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onClick={() => {
                onNavigate(r.tab);
                setOpen(false);
                setQuery("");
                setResults([]);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-b border-border last:border-0"
            >
              {r.image ? (
                <img src={r.image} alt="" className="h-8 w-8 rounded-md object-cover flex-shrink-0" />
              ) : (
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                  {iconFor(r.type)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{r.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
