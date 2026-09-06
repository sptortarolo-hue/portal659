"use client";

import { useEffect, useRef, useState } from "react";
import type { Vendor } from "@/types/database";

const PRESETS = [15, 20, 25, 30, 40, 50, 60];

/**
 * Control de demora (tiempo estimado) en el header del dashboard.
 * null vende desactivado; número = minutos ("Demora: X min" en el micrositio).
 * Presets 15/30/45/60/90 + "Sin demora".
 */
export function PrepTimeControl({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Default 30 min: el tiempo de preparación nunca queda sin valor.
  const prep = (vendor as any).prep_time_min ?? 30;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function save(value: number | null) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prep_time_min: value }),
      });
      const data = await res.json().catch(() => null);
      if (data?.vendor) {
        onSaved(data.vendor);
        setOpen(false);
      }
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={saving}
        title={prep ? `Tiempo de preparación: ${prep} min` : "Definí el tiempo de preparación"}
        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors border-green-500 text-green-700 dark:text-green-400`}
      >
        ⏱️ {prep}m
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-card shadow-lg p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tiempo de preparación</p>
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => save(m)}
              className={`w-full rounded-md px-3 py-1.5 text-sm text-left transition-colors ${
                prep === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {m} min
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
