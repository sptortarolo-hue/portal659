"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isStoreOpen } from "@/lib/open-hours";
import type { Vendor } from "@/types/database";

/**
 * Toggle de apertura del comercio (header del dashboard).
 * Toca y guarda: false (cerrado forzado) ↔ null (seguir horarios) ↔ true (abierto forzado).
 * El label muestra el estado RESVIDO (override o horarios), porque eso es lo
 * que ven los clientes y valida /api/orders.
 */
export function OpenToggle({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [saving, setSaving] = useState(false);

  const resolved = isStoreOpen({ hours: vendor.hours, open_override: (vendor as any).open_override ?? null });
  const override = (vendor as any).open_override ?? null; // null | true | false
  const isOpen = resolved === true;

  async function toggle() {
    if (saving) return;
    // Al tocar queremos INVERTIR el estado resuelto: si está abierto, cerrar
    // (false); si está cerrado, abrir (true). Si el resultado coincide con lo
    // que dirían los horarios, volvemos a null (sin override: cero fricción).
    const want = !isOpen;
    const hoursSay = isStoreOpen({ hours: vendor.hours, open_override: null as any });
    const next: boolean | null = hoursSay === want ? null : want;

    setSaving(true);
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_override: next }),
      });
      const data = await res.json();
      if (data.vendor) onSaved(data.vendor);
    } catch { /* noop */ } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={saving}
      className={`flex-shrink-0 gap-1.5 ${isOpen ? "border-green-500 text-green-700 dark:text-green-400" : "border-red-300 text-red-700 dark:text-red-400"}`}
      title={
        override === null
          ? "Siguiendo el horario cargado. Tocá para forzar apertura/cierre."
          : override
          ? "Abierto manualmente."
          : "Cerrado manualmente."
      }
    >
      <span className={`inline-block h-2 w-2 rounded-full ${isOpen ? "bg-green-500" : "bg-red-500"}`} />
      {saving ? "Guardando..." : isOpen ? "Abierto" : "Cerrado"}
    </Button>
  );
}
