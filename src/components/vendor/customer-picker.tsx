"use client";

import { useEffect, useRef, useState } from "react";

export type LookupCustomer = {
  phone: string;
  name: string | null;
  address: string | null;
  total_orders: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Al elegir o crear: el padre rellena nombre/teléfono/dirección. */
  onSelect: (c: LookupCustomer) => void;
  placeholder?: string;
};

/**
 * Modal dedicado para elegir cliente en el mostrador (patrón Odoo/popup):
 * un botón compacto abre esta búsqueda y al elegir se cierra y sigue la
 * venta. Nada flotante tapa los botones del ticket.
 */
export function CustomerModal({ open, onClose, onSelect, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LookupCustomer[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqId = useRef(0);

  // Al abrir: limpiar, enfocar y traer frecuentes.
  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setHighlight(0);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open ]);

  // Lookup con debounce (250ms). Sin query: frecuentes (top recientes).
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length > 0 && query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const id = ++reqId.current;
      try {
        const url = query
          ? `/api/vendor/customers/lookup?q=${encodeURIComponent(query)}`
          : "/api/vendor/customers/lookup";
        const res = await fetch(url);
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
  }, [q, open ]);

  if (!open) return null;

  const query = q.trim();
  const digits = query.replace(/[^\d]/g, "");
  const isPhoneLike = digits.length >= 7;
  const isNameLike = !isPhoneLike && query.length >= 2;
  const exactPhoneHit = isPhoneLike && results.some((c) => c.phone.replace(/[^\d]/g, "") === digits);

  function choose(c: LookupCustomer) {
    onSelect(c);
  }

  /** Fila manual: usar lo tipeado como cliente nuevo (teléfono o nombre). */
  function useManual() {
    if (isPhoneLike) {
      choose({ phone: query, name: null, address: null, total_orders: 0 });
    } else if (isNameLike) {
      choose({ phone: "", name: query, address: null, total_orders: 0 });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Elegir cliente"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="font-display text-base font-semibold">Elegir cliente</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="px-4 pb-2">
          <input
            ref={inputRef}
            type="text"
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (results.length > 0) choose(results[highlight] || results[0]);
                else useManual();
              } else if (e.key === "ArrowDown" && results.length > 0) {
                e.preventDefault();
                setHighlight((h) => (h + 1) % results.length);
              } else if (e.key === "ArrowUp" && results.length > 0) {
                e.preventDefault();
                setHighlight((h) => (h - 1 + results.length) % results.length);
              }
            }}
            placeholder={placeholder || "Teléfono o nombre…"}
            className="w-full h-11 px-3 text-base sm:text-sm rounded-xl border border-input bg-background"
          />
        </div>
        <div className="px-4 pb-4 overflow-y-auto">
          {query === "" && results.length > 0 && (
            <p className="py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Frecuentes
            </p>
          )}
          <div className="space-y-1">
            {results.map((c, i) => (
              <button
                key={c.phone}
                type="button"
                onClick={() => choose(c)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm ${
                  i === highlight ? "border-primary bg-primary/5" : ""
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
          {/* Alta al vuelo con lo tipeado */}
          {isPhoneLike && !exactPhoneHit && (
            <button
              type="button"
              onClick={useManual}
              className="mt-1.5 w-full rounded-xl border border-dashed border-primary/50 px-3 py-2.5 text-left text-sm text-primary"
            >
              ＋ Usar <strong>{query}</strong> como cliente nuevo
            </button>
          )}
          {isNameLike && results.length === 0 && (
            <button
              type="button"
              onClick={useManual}
              className="mt-1.5 w-full rounded-xl border border-dashed border-primary/50 px-3 py-2.5 text-left text-sm text-primary"
            >
              ＋ Crear <strong>«{query}»</strong> como cliente nuevo
            </button>
          )}
          {query !== "" && results.length === 0 && !isPhoneLike && !isNameLike && (
            <p className="py-4 text-center text-xs text-muted-foreground">Seguí escribiendo…</p>
          )}
        </div>
      </div>
    </div>
  );
}
