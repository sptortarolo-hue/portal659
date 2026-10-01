"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { isStoreOpen } from "@/lib/open-hours";
import type { Vendor } from "@/types/database";

/**
 * Toggle de apertura del comercio (header del dashboard).
 * Patrón modal (como CashShiftPill): botón compacto con el estado actual
 * que abre un modal centrado con las opciones de gestión.
 *
 * Estados:
 *  - open_override === null  → sigue los horarios
 *  - open_override === true  → forzado abierto
 *  - open_override === false → forzado cerrado
 */
export function OpenToggle({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const override = vendor.open_override ?? null; // null | true | false
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
        setModalOpen(false);
      } else {
        setErr(true);
      }
    } catch {
      setErr(true);
    } finally {
      setSaving(false);
    }
  }

  const stateLabel = isManual
    ? override === true
      ? "Abierto"
      : "Cerrado"
    : isOpenResolved
      ? "Abierto"
      : "Cerrado";

  const stateClass = isManual
    ? override === true
      ? "border-green-500 text-green-700 dark:text-green-400"
      : "border-red-300 text-red-700 dark:text-red-400"
    : "border-border text-muted-foreground";

  return (
    <>
      <button
        type="button"
        onClick={() => { setErr(false); setModalOpen(true); }}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors flex-shrink-0 ${stateClass}`}
        title={isManual ? `Forzado ${stateLabel.toLowerCase()}. Tocá para gestionar.` : "Según horarios. Tocá para forzar."}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isOpenResolved ? "bg-green-500" : "bg-red-500"
          }`}
        />
        {saving ? "Guardando..." : stateLabel}
      </button>

      {modalOpen && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="bg-card rounded-2xl p-5 w-full max-w-xs space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-semibold">Estado del comercio</h3>

            <div className="text-sm text-muted-foreground">
              {isManual ? (
                override === true ? (
                  <p>Forzado <span className="font-semibold text-green-700 dark:text-green-400">Abierto</span></p>
                ) : (
                  <p>Forzado <span className="font-semibold text-red-700 dark:text-red-400">Cerrado</span></p>
                )
              ) : (
                <p>
                  Según horarios — ahora{" "}
                  <span className={`font-semibold ${isOpenResolved ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {stateLabel}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => save(false)}
                disabled={saving}
              >
                🔴 Forzar cerrado
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => save(true)}
                disabled={saving}
              >
                🟢 Forzar abierto
              </Button>
              {isManual && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => save(null)}
                  disabled={saving}
                >
                  ↩️ Volver a según horarios
                </Button>
              )}
            </div>

            {err && (
              <p className="text-xs text-red-500">
                No se pudo guardar. ¿Aplicaste la migración open_override en la base?
              </p>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cerrar
            </Button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
