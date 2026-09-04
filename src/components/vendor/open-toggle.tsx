"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isStoreOpen } from "@/lib/open-hours";
import type { Vendor } from "@/types/database";

/**
 * Toggle de apertura del comercio (header del dashboard).
 * BINARIO + estado "según horarios":
 *  - open_override === null  → sigue los horarios; se muestra el estado resuelto
 *    como subtexto y el botón permite forzar abierto/cerrado.
 *  - open_override === true  → "🟢 Abierto" (forzado)
 *  - open_override === false → "🔴 Cerrado" (forzado)
 * Tocar alterna forzado; un botón chico permite volver a "según horarios".
 */
export function OpenToggle({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  const override = (vendor as any).open_override ?? null; // null | true | false
  const resolved = isStoreOpen({ hours: vendor.hours, open_override: override });
  const isOpenResolved = resolved === true;
  const isManual = override === true || override === false;

  async function save(next: boolean | null) {
    if (saving) return;
    setSaving(true);
    setErr(false);
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_override: next }),
      });
      const data = await res.json().catch(() => null);
      if (data?.vendor) {
        onSaved(data.vendor);
      } else {
        setErr(true);
      }
    } catch {
      setErr(true);
    } finally {
      setSaving(false);
    }
  }

  // Tocar el botón principal: si está "según horarios", fuerza lo contrario al
  // estado resuelto; si ya está forzado, invierte (abierto↔cerrado).
  function toggleForced() {
    const want = !isOpenResolved;
    save(want);
  }

  const baseClass =
    "flex-shrink-0 gap-1.5 ";
  const stateClass = isManual
    ? override === true
      ? "border-green-500 text-green-700 dark:text-green-400"
      : "border-red-300 text-red-700 dark:text-red-400"
    : "border-border text-muted-foreground";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        variant="outline"
        size="sm"
        onClick={toggleForced}
        disabled={saving}
        className={`${baseClass}${stateClass}`}
        title={
          isManual
            ? override === true
              ? "Forzado abierto. Tocá para cerrar."
              : "Forzado cerrado. Tocá para abrir."
            : "Según horarios. Tocá para forzar."
        }
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isOpenResolved ? "bg-green-500" : "bg-red-500"
          }`}
        />
        {saving
          ? "Guardando..."
          : isManual
            ? override === true
              ? "Abierto"
              : "Cerrado"
            : isOpenResolved
              ? "Abierto" // resolvió abierto según horarios
              : "Cerrado"}
      </Button>
      {/* El subtexto solo en desktop: en mobile el header no tiene lugar y
          quedaba en 2 líneas (nav alargado). */}
      <div className="hidden sm:block">
        {isManual ? (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
            onClick={() => save(null)}
          >
            Seguir horarios
          </button>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            Según horarios — tocá para forzar
          </span>
        )}
        {err && (
          <span className="text-[10px] text-red-500">
            No se pudo guardar. ¿Aplicaste la migración open_override en la base?
          </span>
        )}
      </div>
    </div>
  );
}