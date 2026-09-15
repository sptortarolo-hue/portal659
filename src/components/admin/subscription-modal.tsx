"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type SuscripcionRow = {
  vendor_id: string;
  store_name: string;
  slug: string | null;
  vertical: string;
  plan_id: string | null;
  plan_status: string;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  plan_slug: string;
  plan_name: string;
  subscription_id: string | null;
  sub_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_method: string | null;
  amount: number | null;
  paid_at: string | null;
  note: string | null;
  effective_status: string;
  active: boolean;
  expired: boolean;
  trialActive: boolean;
  paid: boolean;
  expires_in_days: number | null;
};

type PlanOption = { id: string; slug: string; name: string; price_monthly: number };

export type SuscripcionMode = "set_plan" | "extend" | "pay";

interface Props {
  open: boolean;
  onClose: () => void;
  mode: SuscripcionMode;
  row: SuscripcionRow | null;
  plans: PlanOption[];
  onSubmit: (mode: SuscripcionMode, payload: Record<string, unknown>) => Promise<void>;
}

export default function SubscriptionModal({ open, onClose, mode, row, plans, onSubmit }: Props) {
  const [planSlug, setPlanSlug] = useState("pedidos");
  const [days, setDays] = useState("30");
  const [paymentMethod, setPaymentMethod] = useState("transferencia");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setLoading(false);
    setPlanSlug(row?.plan_slug && row.plan_slug !== "gratuito" ? row.plan_slug : "pedidos");
    setDays("30");
    setPaymentMethod(row?.payment_method || "transferencia");
    setAmount(row?.amount != null ? String(row.amount) : "");
    setPaid(true);
    setNote("");
  }, [open, row]);

  if (!open || !row) return null;

  const selectedPlan = plans.find((p) => p.slug === planSlug);
  const isPay = mode === "pay";

  const title =
    mode === "set_plan" ? "Cambiar / activar plan" :
    mode === "extend" ? "Renovar plan" : "Registrar pago";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      vendorId: row!.vendor_id,
      paymentMethod,
      amount: amount ? Number(amount) : null,
    };

    if (mode === "pay") {
      payload.action = "mark_paid";
      if (row!.subscription_id) payload.subscriptionId = row!.subscription_id;
    } else if (mode === "extend") {
      payload.action = "extend";
      payload.days = Number(days) || 30;
      payload.paid = paid;
      payload.note = note || null;
    } else {
      payload.action = "set_plan";
      payload.planSlug = planSlug;
      payload.days = Number(days) || 30;
      payload.paid = paid;
      payload.note = note || null;
    }

    try {
      await onSubmit(mode, payload);
      setLoading(false);
      onClose();
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{row.store_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "set_plan" && (
            <div>
              <Label>Plan</Label>
              <select
                className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={planSlug}
                onChange={(e) => setPlanSlug(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.slug}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {mode !== "pay" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Días</Label>
                <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
              {selectedPlan && mode === "set_plan" && (
                <div className="flex items-end pb-1">
                  <p className="text-xs text-muted-foreground">
                    {selectedPlan.price_monthly > 0 ? `$${selectedPlan.price_monthly}/mes` : "Gratis"}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Método de pago</Label>
              <select
                className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="mercadopago">Mercado Pago</option>
              </select>
            </div>
            <div>
              <Label>Monto ($)</Label>
              <Input type="number" min={0} placeholder="Opcional" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          {mode !== "pay" && (
            <div className="flex items-center gap-2">
              <Switch checked={paid} onCheckedChange={setPaid} />
              <Label className="text-sm">Marcar como pagado</Label>
            </div>
          )}

          {mode !== "pay" && (
            <div>
              <Label>Nota (opcional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: pagó en efectivo" />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}