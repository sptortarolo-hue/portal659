"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  /** Enter sin elección (tipeo directo): el padre lo toma y colapsa. */
  onEnterKey?: () => void;
  /** Placeholder según modalidad (delivery exige teléfono). */
  placeholder?: string;
  /** Ref para enfocar desde atajos. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

type Coords = { top: number; left: number; width: number; maxH: number };

/**
 * Buscador único de clientes para el mostrador: se escribe el teléfono o
 * las primeras letras del nombre y trae nombre + dirección. Sin elección
 * sigue "Consumidor final" (no bloquea la venta).
 *
 * La lista va en portal (fixed sobre el body): ningún `overflow-hidden` o
 * scroll del panel/sheet la puede tapar.
 */
export function CustomerPicker({ query, onQueryChange, onSelect, onEnterKey, placeholder, inputRef }: Props) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LookupCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [coords, setCoords] = useState<Coords | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const innerInputRef = useRef<HTMLInputElement | null>(null);
  const reqId = useRef(0);
  const inputEl = inputRef ?? innerInputRef;

  function setInputRef(el: HTMLInputElement | null) {
    (innerInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  }

  // Posición fixed desde el input: abajo, o arriba si no entra.
  function position() {
    const el = inputEl.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxH = Math.min(window.innerHeight * 0.4, 320);
    const openUp = window.innerHeight - r.bottom < 160 && r.top > maxH;
    setCoords({
      top: openUp ? Math.max(8, r.top - maxH - 4) : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      width: Math.min(r.width, window.innerWidth - 16),
      maxH,
    });
  }

  // Cerrar al tocar fuera (input + lista del portal).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open ]);

  // Re-posicionar al scrollear (sheet/panel) o rotar/resize.
  useEffect(() => {
    if (!open) return;
    position();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results.length]);

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
    <div ref={boxRef}>
      <input
        ref={setInputRef}
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
              setOpen(false);
            }
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onEnterKey?.();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder || "Buscar cliente… (teléfono o nombre)"}
        className="w-full h-11 px-3 text-base sm:h-9 sm:text-xs rounded-lg border border-input bg-background"
      />
      {open && results.length > 0 && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropRef}
            className="fixed z-[90] overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
            style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxH }}
            role="listbox"
          >
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
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm sm:text-xs ${
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
          </div>,
          document.body
        )}
    </div>
  );
}
