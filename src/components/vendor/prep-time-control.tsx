"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Vendor } from "@/types/database";

const PRESETS = [15, 20, 25, 30, 40, 50, 60];

/**
 * Tiempo de preparación en el header del dashboard.
 * Desktop: dropdown anclado al botón (lista vertical).
 * Mobile: banda full-width (portal bajo el header) grilla 2 filas de presets.
 * Default 30 min — nunca queda sin valor.
 */
export function PrepTimeControl({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prep = (vendor as any).prep_time_min ?? 30;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggleOpen() {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      setPanelTop(r ? r.bottom + 4 : 0);
    }
    setOpen(!open);
  }

  async function save(value: number) {
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

  const listHeader = (
    <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Tiempo de preparación
    </p>
  );

  const buttons = PRESETS.map((m) => (
    <button
      key={m}
      type="button"
      onClick={() => save(m)}
      disabled={saving}
      className={`rounded-md px-3 py-1.5 text-sm text-left transition-colors ${
        prep === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      }`}
    >
      {m} min
    </button>
  ));

  const gridButtons = PRESETS.map((m) => (
    <button
      key={m}
      type="button"
      onClick={() => save(m)}
      disabled={saving}
      className={`rounded-md px-3 py-2 text-sm font-medium text-center transition-colors ${
        prep === m ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
      }`}
    >
      {m}
    </button>
  ));

  return (
    <>
      {/* Desktop: dropdown anclado al botón */}
      <div className="relative flex-shrink-0" ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleOpen}
          disabled={saving}
          title={`Tiempo de preparación: ${prep} min`}
          className="rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors border-green-500 text-green-700 dark:text-green-400"
        >
          ⏱️ {prep}m
        </button>

        {open && (
          <div className="hidden sm:block absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-card shadow-lg p-1.5">
            {listHeader}
            {buttons}
          </div>
        )}
      </div>

      {/* Mobile: banda full-width borde a borde */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="sm:hidden fixed inset-x-0 border-y border-border bg-card shadow-lg z-[60] px-3 py-2"
            style={{ top: panelTop }}
          >
            {listHeader}
            <div className="grid grid-cols-4 gap-2">{gridButtons}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
