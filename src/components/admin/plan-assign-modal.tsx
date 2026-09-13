"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PaymentMethod = "efectivo" | "transferencia" | "mercadopago";

interface PlanAssignModalProps {
  open: boolean;
  vendorName: string;
  planName: string;
  defaultAmount?: number | null;
  onClose: () => void;
  onConfirm: (data: { days: number; paymentMethod: PaymentMethod | null; amount: number | null }) => void;
  loading?: boolean;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: "💵 Efectivo",
  transferencia: "🏦 Transferencia",
  mercadopago: "💳 Mercado Pago",
};

export default function PlanAssignModal({
  open,
  vendorName,
  planName,
  defaultAmount,
  onClose,
  onConfirm,
  loading,
}: PlanAssignModalProps) {
  const [days, setDays] = useState(30);
  const [charge, setCharge] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : "");

  if (!open) return null;

  function confirm() {
    onConfirm({
      days: days > 0 ? days : 30,
      paymentMethod: charge ? method : null,
      amount: charge && amount !== "" && Number(amount) >= 0 ? Number(amount) : null,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="font-display text-lg font-semibold">Asignar plan</h2>
          <p className="text-sm text-muted-foreground">
            {vendorName} → <span className="font-medium text-foreground">{planName}</span>
          </p>
        </div>

        <div>
          <Label htmlFor="plan-days">Duración (días)</Label>
          <Input
            id="plan-days"
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={charge}
            onChange={(e) => setCharge(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Registrar cobro ahora
        </label>

        {charge && (
          <div className="space-y-3 rounded-xl border border-border p-3 bg-muted/40">
            <div>
              <Label>Método de pago</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-xl border-2 py-2 px-1 text-xs font-medium transition-all ${
                      method === m
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="plan-amount">Monto cobrado ($)</Label>
              <Input
                id="plan-amount"
                type="number"
                min={0}
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={confirm} disabled={loading}>
            {loading ? "Guardando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
