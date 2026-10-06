"use client";

import { useEffect, useRef, useState } from "react";

export type LookupCustomer = {
  phone: string;
  name: string | null;
  address: string | null;
  total_orders: number;
};

type Props = {
  /** Texto actual del campo (teléfono o nombre). Vacío = consumidor final. */
  query: string;
  onQueryChange: (v: string) => void;
  /** Al elegir un cliente: el padre rellena nombre/teléfono/dirección. */
  onSelect: (c: LookupCustomer) => void;
  /** Enter sin elección (tipeo directo): el padre lo toma y colapsa. */
  onEnterKey?: () => void;
  /** Placeholder según modalidad (delivery exige teléfono). */
  placeholder?: string;
};

/**
 * Campo de buscar cliente directo en el bloque Cliente (por default es
 * consumidor final: campo vacío + sin cliente = venta anónima).
 *
 * La lista va EN FLUJO (empuja el contenido hacia abajo): nunca flota ni
 * tapa los botones del ticket.
 */
export function CustomerPicker({ query, onQueryChange, onSelect, onEnterKey, placeholder }: Props) {
  const [results, setResults] = useState<LookupCustomer[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  // Sin Mostrador en el plan (lookup 403): se muestra el motivo.
  const [denied, setDenied] = useState(false);
  const reqId = useRef(0);

  // Lookup con debounce (250ms). Sin query y con foco: frecuentes.
  useEffect(() => {
    const q = query.trim();
    if (!focused) return;
    if (q.length > 0 && q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const id = ++reqId.current;
      try {
        const url = q ? `/api/vendor/customers/lookup?q=${encodeURIComponent(q)}` : "/api/vendor/customers/lookup";
        const res = await fetch(url);
        if (res.status === 403) {
          if (reqId.current !== id) return;
          setDenied(true);
          setResults([]);
          return;
        }
        setDenied(false);
        const d = await res.json().catch(() => ({}));
        if (reqId.current !== id) return;
        const list = Array.isArray(d?.customers) ? (d.customers as LookupCustomer[]) : [];
        setResults(list);
        setHighlight(0);
      } catch {
        if (reqId.current === id) setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, focused]);

  const open = focused && (results.length > 0 || query.trim().length >= 2);

  function choose(c: LookupCustomer) {
    setFocused(false);
    onSelect(c);
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        autoComplete="off"
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Dar tiempo al clic en una fila antes de cerrar.
          window.setTimeout(() => setFocused(false), 150);
        }}
        onKeyDown={(e) => {
          if (open && results.length > 0) {
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
              setFocused(false);
            }
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            setFocused(false);
            onEnterKey?.();
          } else if (e.key === "Escape") {
            setFocused(false);
          }
        }}
        placeholder={placeholder || "🔍 Consumidor final — buscar cliente…"}
        className="w-full h-11 px-3 text-base sm:h-9 sm:text-xs rounded-lg border border-input bg-background"
      />
      {open && (
        <div className="mt-1.5 rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {denied && (
            <p className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50">
              La búsqueda de clientes requiere Mostrador (planes pagos).
            </p>
          )}
          {query.trim() === "" && (
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          {query.trim().length >= 2 && results.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              Enter para usarlo como cliente nuevo
            </p>
          )}
        </div>
      )}
    </div>
  );
}
