"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHIPMENT_PAYMENT_METHODS, type ShipmentPaymentMethod } from "@/lib/shipment-payments-types";

/**
 * Hoja "Colectar y cobrar" del panel de logística: al retirar el paquete
 * el local le paga a la logística. Monto precargado con la tarifa de la
 * zona (editable), método de pago, vuelto en efectivo, quién pagó y la
 * opción de dejarlo como deuda documentada (fiado).
 *
 * Patrón: booking-cobro-modal.tsx (mismo lenguaje visual del panel).
 */
export type PickupCobroResult = {
  amount: number;
  method: ShipmentPaymentMethod;
  payerName: string | null;
  note: string | null;
};

export function PickupCobroSheet({
  open,
  onClose,
  onConfirm,
  storeName,
  suggestedAmount,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (r: PickupCobroResult) => void | Promise<void>;
  storeName: string | null;
  /** Tarifa congelada del encargo (precarga el monto). */
  suggestedAmount: number | null;
  busy?: boolean;
}) {
  const [method, setMethod] = useState<ShipmentPaymentMethod>("efectivo");
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  const base = suggestedAmount != null && suggestedAmount > 0 ? suggestedAmount : null;

  useEffect(() => {
    if (!open) {
      setErr(null);
      return;
    }
    setMethod("efectivo");
    setAmount(base != null ? String(base) : "");
    setReceived("");
    setPayerName("");
    setNote("");
    if (firstInput.current) firstInput.current.focus();
  }, [open, base]);

  if (!open) return null;

  const amountNum = amount === "" ? (base ?? 0) : Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum >= 0;
  const vuelto = Number(received) - amountNum;

  async function submit() {
    setErr(null);
    if (!validAmount) {
      setErr("Revisá el monto a cobrar");
      return;
    }
    if (method === "efectivo" && received !== "" && Number(received) < amountNum) {
      setErr("El monto recibido no alcanza");
      return;
    }
    await onConfirm({
      amount: Math.round(amountNum * 100) / 100,
      method,
      payerName: payerName.trim() ? payerName.trim().slice(0, 80) : null,
      note: note.trim() ? note.trim().slice(0, 300) : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div className="relative w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold">📦 Colectar y cobrar</p>
            <p className="text-xs text-muted-foreground">
              {storeName ? `Retirá en ${storeName} y registrá el pago de la logística.` : "Retirá el paquete y registrá el pago de la logística."}
            </p>
          </div>
          <button onClick={busy ? undefined : onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none px-1">✕</button>
        </div>

        <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Método de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {SHIPMENT_PAYMENT_METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  method === m.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Monto a cobrar ($)</label>
            <Input
              ref={firstInput}
              className="h-9 text-sm mt-0.5"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={base != null ? String(base) : "0"}
            />
          </div>
          {method === "efectivo" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Recibido ($)</label>
              <Input
                className="h-9 text-sm mt-0.5"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </div>
          )}
        </div>

        {method === "efectivo" && received !== "" && (
          <p className={`text-xs font-semibold ${vuelto >= 0 ? "text-emerald-700" : "text-red-600"}`}>
            {vuelto >= 0 ? `Vuelto: $${vuelto.toLocaleString("es-AR")}` : "Falta: el recibido no alcanza"}
          </p>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Quién pagó (opcional)</label>
          <Input
            className="h-9 text-sm mt-0.5"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            maxLength={80}
            placeholder="Nombre de la persona del local"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
          <Input
            className="h-9 text-sm mt-0.5"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Ej: paga el lunes / faltó cambio"
          />
        </div>

        {method === "fiado" && (
          <p className="text-[11px] rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900">
            📓 Queda como <b>deuda documentada</b> del local: el paquete se colecta igual y el pendiente aparece en la liquidación.
          </p>
        )}

        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1 h-10" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button className="flex-1 h-10" onClick={submit} disabled={busy}>
            {busy ? "Guardando..." : method === "fiado" ? "Colectar con deuda" : "Colectar y cobrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
