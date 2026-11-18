"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";

type MethodTotals = { count: number; total: number };

/** Cierre mínimo que necesita el modal (viene del historial). */
export type AdjustableClosing = {
  id: string;
  closed_at: string;
  net_total: number;
  by_method: Record<string, MethodTotals> | null;
  cash_declared: number | null;
  expected_cash?: number | null;
  adjustment_cash?: number;
  adjustment_total?: number;
};

type Kind = "venta_faltante" | "venta_duplicada" | "otro";

type ClosingSale = {
  id: string;
  order_number: number | null;
  total: number;
  payment_method: string | null;
  paid_at: string;
  status: string | null;
  method: string | null;
  is_direct: boolean;
  items_summary: string;
  items_count: number;
};

const METHOD_ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** ¿El medio obliga a devolver la plata a mano (no hay refund automático)? */
function needsManualRefund(method: string | null | undefined): boolean {
  return method === "tarjeta" || method === "transferencia" || method === "mercadopago" || method === "stripe";
}

/**
 * Ajuste post-cierre: corrige un Z ya cerrado sin reescribirlo ni mover
 * dinero. Tres caminos:
 *  - Faltaba una venta  → se carga en el Mostrador con el cierre como contexto
 *    (la venta existe de verdad: stock, ticket, analytics y ajuste).
 *  - Venta de más       → se anula la venta real (stock devuelto, giftcards
 *    anuladas, CRM descontado) y se registra el ajuste negativo.
 *  - Otro               → solo corrige números (medio equivocado, redondeos).
 */
export function CashAdjustmentModal({
  closing,
  onClose,
  onSaved,
}: {
  closing: AdjustableClosing;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<Kind>("venta_faltante");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [direction, setDirection] = useState<"suma" | "resta">("suma");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Venta duplicada: ventas cobradas del período.
  const [sales, setSales] = useState<ClosingSale[] | null>(null);
  const [salesError, setSalesError] = useState("");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "venta_duplicada" || sales !== null) return;
    let cancelled = false;
    setSalesError("");
    fetch(`/api/vendor/cash-closing/sales?closingId=${encodeURIComponent(closing.id)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        if (r.ok && Array.isArray(d?.sales)) setSales(d.sales as ClosingSale[]);
        else setSalesError(d?.error || "No se pudieron cargar las ventas del cierre.");
      })
      .catch(() => {
        if (!cancelled) setSalesError("No se pudieron cargar las ventas del cierre.");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, closing.id, sales]);

  const magnitude = Math.abs(Number(amount) || 0);
  const sign = kind === "venta_faltante" ? 1 : kind === "venta_duplicada" ? -1 : direction === "resta" ? -1 : 1;
  const signed = Math.round(magnitude * sign * 100) / 100;

  const cashFrozen = Number(closing.by_method?.efectivo?.total) || 0;
  const frozenExpected = closing.expected_cash != null ? Number(closing.expected_cash) : cashFrozen;
  const existingCashAdj = Number(closing.adjustment_cash) || 0;
  const existingTotalAdj = Number(closing.adjustment_total) || 0;
  const cashEffect = method === "efectivo" ? signed : 0;
  const expectedAdj = frozenExpected + existingCashAdj + cashEffect;
  const netAdj = Number(closing.net_total) + existingTotalAdj + signed;
  const declared = closing.cash_declared != null ? Number(closing.cash_declared) : null;
  const diffAdj = declared == null ? null : Math.round((declared - expectedAdj) * 100) / 100;

  const methodOptions = [
    ...METHOD_ORDER.filter((m) => m in CASH_METHOD_LABELS),
    ...Object.keys(closing.by_method || {}).filter(
      (m) => !(m in CASH_METHOD_LABELS) && !METHOD_ORDER.includes(m) && m !== "fiado"
    ),
  ];

  const selectedSale = selectedSaleId ? (sales || []).find((s) => s.id === selectedSaleId) || null : null;

  /** Faltaba una venta: se carga en el Mostrador con el cierre como contexto. */
  function handleGoMostrador() {
    if (reason.trim().length < 3) {
      setError("Escribí el motivo: qué venta faltaba y por qué quedó sin cargar.");
      return;
    }
    window.dispatchEvent(
      new CustomEvent("portal:adjust-sale", {
        detail: {
          closingId: closing.id,
          closedAt: closing.closed_at,
          reason: reason.trim(),
        },
      })
    );
    onClose();
  }

  /** Venta de más: anula la venta real (stock, giftcards, CRM) + ajuste. */
  async function handleCancelSale() {
    if (!selectedSaleId || !selectedSale) {
      setError("Elegí la venta que se registró de más.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Escribí el motivo de la anulación.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/vendor/cash-closing/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingId: closing.id,
          orderId: selectedSaleId,
          reason: reason.trim(),
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        const label = selectedSale.order_number ? `Venta N°${selectedSale.order_number}` : "Venta";
        onSaved(
          `${label} anulada: ${money(selectedSale.total)} fuera del cierre, stock devuelto y ajuste registrado.`
        );
      } else {
        setError(d?.error || "No se pudo anular la venta.");
      }
    } catch {
      setError("No se pudo anular la venta. Revisá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNumbers() {
    if (!(magnitude > 0)) {
      setError("Indicá el monto del ajuste.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Escribí el motivo: qué pasó y por qué se ajusta.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/vendor/cash-closing/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingId: closing.id,
          amount: magnitude,
          kind,
          method,
          ...(kind === "otro" ? { direction } : {}),
          reason: reason.trim(),
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        onSaved(
          `Ajuste de ${signed >= 0 ? "+" : "−"}${money(Math.abs(signed))} registrado en el cierre del ${fmtDateTime(closing.closed_at)}.`
        );
      } else {
        setError(d?.error || "No se pudo registrar el ajuste.");
      }
    } catch {
      setError("No se pudo registrar el ajuste. Revisá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-lg space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-display text-lg font-semibold">Ajuste post-cierre</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cierre del {fmtDateTime(closing.closed_at)} · neto {money(closing.net_total)}
            {declared != null ? ` · contado ${money(declared)}` : ""}
          </p>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">¿Qué pasó?</label>
          <div className="mt-1 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => setKind("venta_faltante")}
              className={`text-left rounded-lg border px-3 py-2 text-sm ${
                kind === "venta_faltante"
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              ➕ Faltaba registrar una venta
              <span className="block text-[11px] text-muted-foreground">
                La cargás en el Mostrador: queda la venta real, con stock, ticket y analytics.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("venta_duplicada")}
              className={`text-left rounded-lg border px-3 py-2 text-sm ${
                kind === "venta_duplicada"
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              ➖ Se registró una venta de más
              <span className="block text-[11px] text-muted-foreground">
                Se anula la venta: vuelve el stock y el ajuste baja el cierre.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("otro")}
              className={`text-left rounded-lg border px-3 py-2 text-sm ${
                kind === "otro" ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted/40"
              }`}
            >
              🔧 Solo ajustar números (sin venta ni stock)
              <span className="block text-[11px] text-muted-foreground">
                Para un medio de pago equivocado o un redondeo. No crea ni anula ventas.
              </span>
            </button>
          </div>
        </div>

        {/* ── Faltaba una venta ─────────────────────────────────────────── */}
        {kind === "venta_faltante" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Motivo (queda en el cierre)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: mesa 4 no se cargó / venta de mostrador sin registrar"
                maxLength={240}
                aria-label="Motivo del ajuste"
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              Al cobrar en el Mostrador la venta se crea con la fecha del cierre, se descuenta el stock
              ahora y queda registrada en el cierre con tu motivo. Si el stock no alcanza, queda en
              negativo para que revises el conteo.
            </div>
            <Button type="button" onClick={handleGoMostrador} className="w-full">
              🛒 Cargar la venta en el Mostrador
            </Button>
          </div>
        )}

        {/* ── Venta de más ──────────────────────────────────────────────── */}
        {kind === "venta_duplicada" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Ventas del cierre</label>
              {sales === null && !salesError && (
                <p className="text-xs text-muted-foreground mt-2">Cargando ventas…</p>
              )}
              {salesError && <p className="text-xs text-red-600 mt-2">{salesError}</p>}
              {sales && sales.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  No hay ventas cobradas en este período: usá «Solo ajustar números».
                </p>
              )}
              {sales && sales.length > 0 && (
                <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {sales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSaleId(s.id)}
                      className={`w-full text-left px-3 py-2 text-xs ${
                        selectedSaleId === s.id ? "bg-primary/10" : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {s.order_number ? `N°${s.order_number}` : s.id.slice(0, 8)} · {fmtTime(s.paid_at)}
                        </span>
                        <span className="tabular-nums font-semibold">{money(s.total)}</span>
                      </span>
                      <span className="block text-muted-foreground truncate">
                        {CASH_METHOD_LABELS[s.payment_method || ""] || s.payment_method || "—"}
                        {s.items_summary ? ` · ${s.items_summary}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSale && needsManualRefund(selectedSale.payment_method || selectedSale.method) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                ⚠️ Esta venta se cobró con <b>{CASH_METHOD_LABELS[selectedSale.payment_method || ""] || selectedSale.payment_method}</b>.
                El ajuste y el stock se revierten, pero <b>la plata no se devuelve automáticamente</b>:
                hacé el reintegro por fuera del sistema.
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground">Motivo de la anulación</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: pedido duplicado de la mesa 4"
                maxLength={240}
                aria-label="Motivo de la anulación"
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <Button
              type="button"
              variant="destructive"
              onClick={handleCancelSale}
              disabled={saving || !selectedSaleId || reason.trim().length < 3}
              className="w-full"
            >
              {saving ? "Anulando..." : selectedSale ? `Anular venta ${money(selectedSale.total)}` : "Elegí una venta"}
            </Button>
          </div>
        )}

        {/* ── Solo números ──────────────────────────────────────────────── */}
        {kind === "otro" && (
          <>
            <div>
              <label className="text-xs text-muted-foreground">Dirección</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection("suma")}
                  className={`h-10 rounded-md border text-sm ${
                    direction === "suma" ? "border-primary bg-primary/5 font-medium" : "border-border"
                  }`}
                >
                  ➕ Suma (faltaba)
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("resta")}
                  className={`h-10 rounded-md border text-sm ${
                    direction === "resta" ? "border-primary bg-primary/5 font-medium" : "border-border"
                  }`}
                >
                  ➖ Resta (sobraba registrado)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Monto</label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    aria-label="Monto del ajuste"
                    className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Medio de pago</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {methodOptions.map((m) => (
                    <option key={m} value={m}>
                      {CASH_METHOD_LABELS[m] || m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Motivo (queda en el cierre)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: se cobró con tarjeta y se cargó efectivo"
                maxLength={240}
                aria-label="Motivo del ajuste"
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            {magnitude > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ajuste</span>
                  <span className="tabular-nums font-medium">
                    {signed >= 0 ? "+" : "−"}
                    {money(Math.abs(signed))} · {CASH_METHOD_LABELS[method] || method}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Neto con ajustes</span>
                  <span className="tabular-nums">{money(netAdj)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Efectivo esperado con ajustes</span>
                  <span className="tabular-nums">{money(expectedAdj)}</span>
                </div>
                {diffAdj != null && (
                  <div className="flex justify-between font-bold border-t border-primary/20 pt-1">
                    <span>Diferencia con ajustes</span>
                    <span className={`tabular-nums ${diffAdj === 0 ? "text-green-600" : "text-red-600"}`}>
                      {diffAdj === 0
                        ? "Cuadra ✓"
                        : `${diffAdj > 0 ? "Sobra" : "Falta"} ${money(Math.abs(diffAdj))}`}
                    </span>
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              onClick={handleSaveNumbers}
              disabled={saving || !(magnitude > 0) || reason.trim().length < 3}
              className="w-full"
            >
              {saving ? "Guardando..." : "Guardar ajuste"}
            </Button>
          </>
        )}

        <p className="text-[11px] text-muted-foreground">
          El Z nunca se reescribe: cada corrección queda con motivo, autor y fecha, y el panel, el A4 y
          el ticket muestran el neto y la diferencia «con ajustes».
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="w-full">
          Cancelar
        </Button>
      </div>
    </div>
  );
}
