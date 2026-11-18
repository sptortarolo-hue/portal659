"use client";

import { useState } from "react";
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

/**
 * Ajuste post-cierre: corrige un Z ya cerrado sin reescribirlo ni mover
 * dinero. Sirve cuando una venta quedó sin registrar, se registró dos veces o
 * se cargó con el medio de pago equivocado (el caso "la caja sobraba o
 * faltaba"). El panel recalcula en vivo el neto y la diferencia con ajustes
 * antes de confirmar.
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

  async function handleSave() {
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
                La plata estaba en el cajón (o se cobró por otro medio) pero no quedó el registro.
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
                Venta duplicada o que nunca existió: el sistema esperaba más plata de la real.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("otro")}
              className={`text-left rounded-lg border px-3 py-2 text-sm ${
                kind === "otro" ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted/40"
              }`}
            >
              🔧 Otro ajuste manual
              <span className="block text-[11px] text-muted-foreground">
                Ej. una venta cobrada con otro medio de pago: cargá resta en un medio y suma en el otro.
              </span>
            </button>
          </div>
        </div>

        {kind === "otro" && (
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
        )}

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
            placeholder="Ej: venta 123 sin cargar / pedido duplicado de la mesa 4"
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

        <p className="text-[11px] text-muted-foreground">
          El ajuste no mueve dinero ni reescribe el Z: queda registrado con motivo, autor y fecha, y el
          panel, el A4 y el ticket muestran el neto y la diferencia «con ajustes». Si te equivocaste,
          cargá un ajuste contrario. Si necesitás la venta completa (stock, cliente, factura), cargala
          desde el Mostrador: esto solo corrige el cierre.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !(magnitude > 0) || reason.trim().length < 3}>
            {saving ? "Guardando..." : "Guardar ajuste"}
          </Button>
        </div>
      </div>
    </div>
  );
}
