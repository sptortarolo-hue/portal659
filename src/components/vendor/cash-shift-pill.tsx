"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useCashShift } from "@/lib/use-cash-shift";

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Estado de la caja en el header (al lado de la impresora).
 * Sin turno: botón Abrir (mini-modal con fondo inicial). Con turno:
 * disponible en vivo + popover (ir a caja / cerrar desde acá).
 */
export function CashShiftPill({
  visible,
  onNavigate,
  onRequestClose,
}: {
  visible: boolean;
  onNavigate: (tab: "caja") => void;
  onRequestClose: () => void;
}) {
  const { shift, disponible, loading, refresh } = useCashShift(visible);
  const [openOpen, setOpenOpen] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  if (!visible) return null;

  async function handleOpen() {
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setOpenError("Indicá el monto inicial en efectivo (0 o más).");
      return;
    }
    setOpening(true);
    setOpenError("");
    try {
      const res = await fetch("/api/vendor/cash-closing/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening_amount: amount }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setOpenOpen(false);
        setOpeningAmount("");
        await refresh();
      } else {
        if (d?.code === "shift_open") await refresh();
        setOpenError(d?.error || "No se pudo abrir la caja.");
      }
    } catch {
      setOpenError("No se pudo abrir la caja. Revisá tu conexión.");
    } finally {
      setOpening(false);
    }
  }

  if (loading) {
    return (
      <span className="inline-flex items-center rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground flex-shrink-0">
        Caja…
      </span>
    );
  }

  if (!shift) {
    return (
      <>
        <button
          type="button"
          onClick={() => { setOpenError(""); setOpenOpen(true); }}
          title="Abrir caja con fondo inicial"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
        >
          🔓 Abrir caja
        </button>
        {openOpen && createPortal(
          <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => !opening && setOpenOpen(false)}>
            <div className="bg-card rounded-2xl p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-base font-semibold">Abrir caja</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="Fondo inicial en efectivo"
                  aria-label="Fondo inicial en efectivo"
                  className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              {openError && <p className="text-xs text-red-600">{openError}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setOpenOpen(false)} disabled={opening}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleOpen} disabled={opening}>
                  {opening ? "Abriendo..." : "Abrir"}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={`Turno abierto desde ${fmtTime(shift.opened_at)} — tocá para gestionar`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-2.5 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        <span className="tabular-nums">{money(disponible)}</span>
      </button>
      {/* Mini-modal centrado vía portal (no popover absolute: la fila mobile
          del header tiene overflow-x-auto y lo recortaba). */}
      {menuOpen && createPortal(
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => setMenuOpen(false)}>
          <div className="bg-card rounded-2xl p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">Turno abierto</p>
            <p className="text-xs text-muted-foreground">
              Desde {fmtTime(shift.opened_at)}
              {shift.opened_by_name ? ` · ${shift.opened_by_name}` : ""} · fondo {money(shift.opening_amount)}
            </p>
            <p className="font-display text-2xl font-bold tabular-nums">{money(disponible)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setMenuOpen(false); onNavigate("caja"); }}>
                Ir a caja
              </Button>
              <Button type="button" size="sm" onClick={() => { setMenuOpen(false); onRequestClose(); }}>
                🔒 Cerrar
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
