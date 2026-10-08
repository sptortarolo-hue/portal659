"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useCashShift } from "@/lib/use-cash-shift";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";

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
  const { shift, disponible, loading, refresh, recordMovement } = useCashShift(visible);
  const [openOpen, setOpenOpen] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Sub-vista de movimiento dentro del modal (null = menú del turno).
  const [movKind, setMovKind] = useState<"ingreso" | "retiro" | null>(null);
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("");
  const [movCategory, setMovCategory] = useState("");
  const [movSaving, setMovSaving] = useState(false);
  const [movError, setMovError] = useState("");

  function openMenu() {
    setMovKind(null);
    setMovAmount("");
    setMovReason("");
    setMovCategory("");
    setMovError("");
    setMenuOpen(true);
  }

  async function handleMovement() {
    if (!movKind) return;
    const amount = Number(movAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMovError("Indicá un monto mayor a 0.");
      return;
    }
    if (!movReason.trim()) {
      setMovError("Indicá el motivo del movimiento.");
      return;
    }
    setMovSaving(true);
    setMovError("");
    const r = await recordMovement(movKind, amount, movReason.trim(), movCategory || undefined);
    setMovSaving(false);
    if (r.ok) {
      setMovKind(null);
      setMovAmount("");
      setMovReason("");
      setMovCategory("");
      await refresh();
    } else {
      setMovError(r.error || "No se pudo registrar el movimiento.");
    }
  }

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
        onClick={openMenu}
        title={`Turno abierto desde ${fmtTime(shift.opened_at)} — tocá para gestionar`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-2.5 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        <span className="tabular-nums">{money(disponible)}</span>
      </button>
      {/* Mini-modal centrado vía portal (no popover absolute: la fila mobile
          del header tiene overflow-x-auto y lo recortaba). */}
      {menuOpen && createPortal(
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => !movSaving && setMenuOpen(false)}>
          <div className="bg-card rounded-2xl p-5 w-full max-w-xs space-y-3" onClick={(e) => e.stopPropagation()}>
            {movKind ? (
              <>
                <p className="text-sm font-semibold">
                  {movKind === "ingreso" ? "+ Ingresar efectivo" : "− Retirar efectivo"}
                </p>
                {movKind === "retiro" && (
                  <p className="text-xs text-muted-foreground">Disponible: {money(disponible)}</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={movAmount}
                    onChange={(e) => setMovAmount(e.target.value)}
                    placeholder="Monto"
                    aria-label="Monto del movimiento"
                    className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <input
                  type="text"
                  value={movReason}
                  onChange={(e) => setMovReason(e.target.value)}
                  placeholder={movKind === "ingreso" ? "Motivo (ej: cambio)" : "Motivo (ej: pago proveedor)"}
                  aria-label="Motivo del movimiento"
                  maxLength={140}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                />
                {movKind === "retiro" && (
                  <select
                    value={movCategory}
                    onChange={(e) => setMovCategory(e.target.value)}
                    aria-label="Categoría de gasto"
                    className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Sin categoría — no es gasto</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                {movError && <p className="text-xs text-red-600">{movError}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setMovKind(null)} disabled={movSaving}>
                    Volver
                  </Button>
                  <Button type="button" size="sm" onClick={handleMovement} disabled={movSaving}>
                    {movSaving ? "Guardando..." : "Confirmar"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold">Turno abierto</p>
                <p className="text-xs text-muted-foreground">
                  Desde {fmtTime(shift.opened_at)}
                  {shift.opened_by_name ? ` · ${shift.opened_by_name}` : ""} · fondo {money(shift.opening_amount)}
                </p>
                <p className="font-display text-2xl font-bold tabular-nums">{money(disponible)}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setMovKind("ingreso")}>
                    + Ingresar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setMovKind("retiro")}>
                    − Retirar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setMenuOpen(false); onNavigate("caja"); }}>
                    Ir a caja
                  </Button>
                  <Button type="button" size="sm" onClick={() => { setMenuOpen(false); onRequestClose(); }}>
                    🔒 Cerrar
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
