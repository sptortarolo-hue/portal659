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

export type HistoryItem = {
  id: string;
  vendor_id: string;
  plan_id: string;
  plan_slug: string | null;
  plan_name: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_method: string | null;
  amount: number | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
};

type PlanOption = { id: string; slug: string; name: string; price_monthly: number };

// Compat: el tablero viejo usaba estos modos. Se mantienen los tipos para no
// romper imports, pero el modal actual es edición manual total.
export type SuscripcionMode = "set_plan" | "extend" | "pay" | "edit" | "create";

export type ManualPayload = {
  vendorId: string;
  action: "save_manual";
  createNew: boolean;
  subscriptionId: string | null;
  syncVendor: boolean;
  vendor: {
    planSlug: string;
    planStatus: string;
    planExpiresAt: string | null;
    trialEndsAt: string | null;
  };
  subscription: {
    planSlug: string;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    paymentMethod: string | null;
    amount: number | null;
    paid: boolean;
    paidAt: string | null;
    note: string | null;
  } | null;
  noSubscription?: boolean;
};

interface Props {
  open: boolean;
  onClose: () => void;
  mode?: SuscripcionMode;
  row: SuscripcionRow | null;
  plans: PlanOption[];
  subscription?: HistoryItem | null;
  createNew?: boolean;
  isLatest?: boolean;
  onSubmit: (mode: SuscripcionMode, payload: Record<string, unknown>) => Promise<void>;
}

function toDateInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toDatetimeInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const selectCls = "mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function SubscriptionModal({ open, onClose, row, plans, subscription, createNew, isLatest, onSubmit }: Props) {
  const [vendorPlan, setVendorPlan] = useState("gratuito");
  const [vendorStatus, setVendorStatus] = useState("gratuito");
  const [vendorExpires, setVendorExpires] = useState("");
  const [vendorTrial, setVendorTrial] = useState("");
  const [editSub, setEditSub] = useState(true);
  const [subPlan, setSubPlan] = useState("pedidos");
  const [subStatus, setSubStatus] = useState("active");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [syncVendor, setSyncVendor] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !row) return;
    setError("");
    setLoading(false);
    setVendorPlan(row.plan_slug || "gratuito");
    setVendorStatus(row.plan_status || "gratuito");
    setVendorExpires(toDateInput(row.plan_expires_at));
    setVendorTrial(toDateInput(row.trial_ends_at));
    const s = subscription ?? null;
    const hasSub = createNew ? true : !!s || !!row.subscription_id;
    setEditSub(hasSub);
    setSubPlan(s?.plan_slug || row.plan_slug || "pedidos");
    setSubStatus(s?.status || row.sub_status || "active");
    setPeriodStart(toDatetimeInput(s?.current_period_start ?? row.current_period_start));
    setPeriodEnd(toDatetimeInput(s?.current_period_end ?? row.plan_expires_at));
    setPaymentMethod(s?.payment_method ?? row.payment_method ?? "");
    const initialAmount = s?.amount ?? row.amount;
    setAmount(initialAmount != null ? String(initialAmount) : "");
    const isPaid = createNew ? false : !!((s?.paid_at ?? row.paid_at));
    setPaid(isPaid);
    setPaidAt(toDatetimeInput(s?.paid_at ?? row.paid_at));
    setNote(s?.note ?? "");
    setSyncVendor(createNew ? true : (isLatest ?? true));
  }, [open, row, subscription, createNew, isLatest]);

  // Si se marca pagado sin fecha, prellenar con ahora para que sea visible.
  useEffect(() => {
    if (paid && !paidAt) setPaidAt(toDatetimeInput(new Date().toISOString()));
    if (!paid && paidAt) setPaidAt("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  if (!open || !row) return null;

  const title = createNew ? "Nuevo período manual" : "Editar suscripción";
  const selectedPlan = plans.find((p) => p.slug === vendorPlan);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload: ManualPayload = {
        vendorId: row!.vendor_id,
        action: "save_manual",
        createNew: !!createNew,
        subscriptionId: createNew ? null : (subscription?.id ?? row!.subscription_id),
        syncVendor,
        vendor: {
          planSlug: vendorPlan,
          planStatus: vendorStatus,
          planExpiresAt: fromInput(vendorExpires),
          trialEndsAt: fromInput(vendorTrial),
        },
        subscription: editSub
          ? {
              planSlug: subPlan,
              status: subStatus,
              periodStart: fromInput(periodStart),
              periodEnd: fromInput(periodEnd),
              paymentMethod: paymentMethod || null,
              amount: amount === "" ? null : Number(amount),
              paid,
              paidAt: paid ? fromInput(paidAt) : null,
              note: note || null,
            }
          : null,
      };
      if (!editSub) payload.noSubscription = true;
      if (editSub && createNew && !payload.subscription?.periodStart) {
        throw new Error("El inicio del período es requerido");
      }
      if (editSub && payload.subscription && payload.subscription.amount != null && !(payload.subscription.amount >= 0)) {
        throw new Error("Monto inválido");
      }
      await onSubmit(createNew ? "create" : "edit", payload as unknown as Record<string, unknown>);
      setLoading(false);
      onClose();
    } catch (err) {
      setError((err as Error).message || "No se pudo guardar");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{row.store_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Comercio (vigente)</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Plan vigente</Label>
                <select className={selectCls} value={vendorPlan} onChange={(e) => setVendorPlan(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.slug}>{p.name}</option>
                  ))}
                </select>
                {selectedPlan && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {selectedPlan.price_monthly > 0 ? `$${selectedPlan.price_monthly}/mes` : "Gratis"}
                  </p>
                )}
              </div>
              <div>
                <Label>Estado del plan</Label>
                <select className={selectCls} value={vendorStatus} onChange={(e) => setVendorStatus(e.target.value)}>
                  <option value="gratuito">Gratuito</option>
                  <option value="trial">Prueba</option>
                  <option value="active">Activo</option>
                  <option value="expired">Vencido</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Vencimiento</Label>
                <Input type="date" value={vendorExpires} onChange={(e) => setVendorExpires(e.target.value)} />
              </div>
              <div>
                <Label>Fin de prueba</Label>
                <Input type="date" value={vendorTrial} onChange={(e) => setVendorTrial(e.target.value)} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              {createNew ? "Período a crear" : "Período (fila del historial)"}
            </legend>
            {!createNew && (
              <div className="flex items-center gap-2">
                <Switch checked={editSub} onCheckedChange={setEditSub} />
                <Label className="text-sm">Editar también esta fila del historial</Label>
              </div>
            )}
            {editSub && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Plan del período</Label>
                    <select className={selectCls} value={subPlan} onChange={(e) => setSubPlan(e.target.value)}>
                      {plans.map((p) => (
                        <option key={p.id} value={p.slug}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Estado del período</Label>
                    <select className={selectCls} value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
                      <option value="trial">Prueba</option>
                      <option value="active">Activo</option>
                      <option value="expired">Vencido</option>
                      <option value="cancelled">Cancelado</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Inicio *</Label>
                    <Input type="datetime-local" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <Label>Fin</Label>
                    <Input type="datetime-local" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Método de pago</Label>
                    <select className={selectCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      <option value="">—</option>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div className="flex items-center gap-2">
                    <Switch checked={paid} onCheckedChange={setPaid} />
                    <Label className="text-sm">Pagado</Label>
                  </div>
                  <div>
                    <Label>Fecha de pago</Label>
                    <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} disabled={!paid} />
                  </div>
                </div>
                <div>
                  <Label>Nota</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: pagó en efectivo, ajuste manual" />
                </div>
              </>
            )}
          </fieldset>

          <div className="flex items-center gap-2">
            <Switch checked={syncVendor} onCheckedChange={setSyncVendor} />
            <Label className="text-sm">Sincronizar vencimiento/plan del comercio con este período</Label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
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
