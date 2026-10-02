"use client";

import { useEffect, useRef, useState } from "react";

export type LookupCustomer = {
  phone: string;
  name: string | null;
  address: string | null;
  total_orders: number;
};

type Props = {
  /** Texto actual del campo (teléfono o nombre). */
  query: string;
  onQueryChange: (v: string) => void;
  /** Al elegir un cliente: el padre rellena nombre/teléfono/dirección. */
  onSelect: (c: LookupCustomer) => void;
  /** Placeholder según modalidad (delivery exige teléfono). */
  placeholder?: string;
  /** Ref para enfocar desde atajos. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

/**
 * Buscador único de clientes para el mostrador: se escribe el teléfono o
 * las primeras letras del nombre y trae nombre + dirección. Sin elección
 * sigue "Consumidor final" (no bloquea la venta).
 */
export function CustomerPicker({ query, onQueryChange, onSelect, placeholder, inputRef }: Props) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LookupCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const reqId = useRef(0);

  // Cerrar al tocar fuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Lookup con debounce (250ms). Sin query: frecuentes (top recientes).
  useEffect(() => {
    const q = query.trim();
    if (q.length > 0 && q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      const id = ++reqId.current;
      setLoading(true);
      try {
        const url = q ? `/api/vendor/customers/lookup?q=${encodeURIComponent(q)}` : "/api/vendor/customers/lookup";
        const res = await fetch(url);
        const d = await res.json().catch(() => ({}));
        if (reqId.current !== id) return;
        const list = Array.isArray(d?.customers) ? (d.customers as LookupCustomer[]) : [];
        setResults(list);
        setHighlight(0);
        setOpen(list.length > 0);
      } catch {
        if (reqId.current === id) {
          setResults([]);
          setOpen(false);
        }
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function choose(c: LookupCustomer) {
    setOpen(false);
    onSelect(c);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        autoComplete="off"
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={(e) => {
          if (results.length > 0) setOpen(true);
          // En el sheet mobile el teclado tapa el campo: traerlo a la vista.
          window.setTimeout(() => {
            e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }, 300);
        }}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[highlight] || results[0]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder || "Buscar cliente… (teléfono o nombre)"}
        className="w-full h-11 px-3 text-base sm:h-9 sm:text-xs rounded-lg border border-input bg-background"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">…</span>
      )}
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-[40vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
          {query.trim() === "" && (
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Frecuentes
            </p>
          )}
          {results.map((c, i) => (
            <button
              key={c.phone}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${
                i === highlight ? "bg-primary/10" : ""
              }`}
            >
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{c.name || "Sin nombre"}</span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {c.phone}
                  {c.address ? ` · ${c.address}` : ""}
                </span>
              </span>
              {c.total_orders > 0 && (
                <span className="flex-shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  ×{c.total_orders}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
