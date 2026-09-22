"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { activePromo, formatPrice } from "@/lib/plans";
import type { Plan } from "@/types/database";
import { Save, Tag } from "lucide-react";

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PromoPreview({ plan }: { plan: Plan }) {
  const promo = activePromo(plan);
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        Previsualización (página pública)
      </p>
      {promo ? (
        <div className="flex items-end gap-2 flex-wrap">
          <span className="font-display text-2xl font-bold text-foreground">
            {formatPrice(promo.price)}
          </span>
          <span className="font-display text-lg font-semibold text-muted-foreground line-through">
            {formatPrice(promo.listPrice)}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[11px] font-bold px-2 py-0.5">
            -{promo.offPct}%
          </span>
        </div>
      ) : (
        <span className="font-display text-2xl font-bold text-foreground">
          {formatPrice(plan.price_monthly)}
        </span>
      )}
      {promo ? (
        <p className="text-xs text-muted-foreground mt-1">
          por mes · {promo.months} {promo.months === 1 ? "mes" : "meses"} por adelantado
          {promo.endsAt && (
            <> · válido hasta {new Date(promo.endsAt).toLocaleDateString("es-AR")}</>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">por mes</p>
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  onSaved,
}: {
  plan: Plan;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    name: plan.name,
    description: plan.description ?? "",
    price_monthly: String(plan.price_monthly),
    max_products: plan.max_products != null ? String(plan.max_products) : "",
    max_orders_month: plan.max_orders_month != null ? String(plan.max_orders_month) : "",
    max_quotes_month: (plan as Plan).max_quotes_month != null ? String((plan as Plan).max_quotes_month) : "",
    promo_price: plan.promo_price != null ? String(plan.promo_price) : "",
    promo_months: plan.promo_months != null ? String(plan.promo_months) : "",
    promo_ends_at: toDateTimeLocal(plan.promo_ends_at),
    promo_label: plan.promo_label ?? "",
    badge: plan.badge ?? "",
    popular: plan.popular,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const currentPlan: Plan = {
    ...plan,
    name: draft.name,
    description: draft.description || null,
    badge: draft.badge || null,
    popular: draft.popular,
    price_monthly: Number(draft.price_monthly) || 0,
    max_products: draft.max_products ? Number(draft.max_products) : null,
    max_orders_month: draft.max_orders_month ? Number(draft.max_orders_month) : null,
    max_quotes_month: draft.max_quotes_month ? Number(draft.max_quotes_month) : null,
    promo_price: draft.promo_price ? Number(draft.promo_price) : null,
    promo_months: draft.promo_months ? Number(draft.promo_months) : null,
    promo_ends_at: draft.promo_ends_at ? new Date(draft.promo_ends_at).toISOString() : null,
    promo_label: draft.promo_label || null,
  };

  async function save() {
    setError("");
    setOk("");
    setSaving(true);
    const res = await fetch("/api/admin/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: plan.id,
        data: {
          name: draft.name,
          description: draft.description || null,
          price_monthly: Number(draft.price_monthly) || 0,
          max_products: draft.max_products ? Number(draft.max_products) : null,
          max_orders_month: draft.max_orders_month ? Number(draft.max_orders_month) : null,
          max_quotes_month: draft.max_quotes_month ? Number(draft.max_quotes_month) : null,
          promo_price: draft.promo_price ? Number(draft.promo_price) : null,
          promo_months: draft.promo_months ? Number(draft.promo_months) : null,
          promo_ends_at: draft.promo_ends_at ? new Date(draft.promo_ends_at).toISOString() : null,
          promo_label: draft.promo_label || null,
          badge: draft.badge || null,
          popular: draft.popular,
        },
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok && data.ok) {
      setOk("Guardado");
      onSaved();
    } else {
      setError(data.error || "No se pudo guardar");
    }
  }

  return (
    <div className={plan.popular ? "border-2 border-primary" : "border border-border"}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-semibold">{plan.name}</span>
            {plan.popular && (
              <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5">
                POPULAR
              </span>
            )}
            <span className="rounded-full bg-muted text-muted-foreground text-[10px] px-2 py-0.5 capitalize">
              {plan.slug}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Popular</Label>
            <Switch
              checked={draft.popular}
              onCheckedChange={(v) => setDraft({ ...draft, popular: v })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Nombre</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Precio mensual (full)</Label>
            <Input
              type="number"
              min={0}
              value={draft.price_monthly}
              onChange={(e) => setDraft({ ...draft, price_monthly: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">Descripción (se muestra en la página pública)</Label>
          <Input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Ej: Carta completa con carrito y hasta 20 pedidos por mes."
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Límite de productos</Label>
            <Input
              type="number"
              min={0}
              placeholder="Vacío = ilimitado"
              value={draft.max_products}
              onChange={(e) => setDraft({ ...draft, max_products: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Límite de pedidos/mes</Label>
            <Input
              type="number"
              min={0}
              placeholder="Vacío = ilimitado"
              value={draft.max_orders_month}
              onChange={(e) => setDraft({ ...draft, max_orders_month: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Límite de solicitudes/mes (servicios)</Label>
            <Input
              type="number"
              min={0}
              placeholder="Vacío = ilimitado"
              value={draft.max_quotes_month ?? ""}
              onChange={(e) => setDraft({ ...draft, max_quotes_month: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Precio promocional ($/mes)</Label>
            <Input
              type="number"
              min={0}
              placeholder="Vacío = sin promo"
              value={draft.promo_price}
              onChange={(e) => setDraft({ ...draft, promo_price: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Meses de promo (por adelantado)</Label>
            <Input
              type="number"
              min={1}
              placeholder="Ej: 3"
              value={draft.promo_months}
              onChange={(e) => setDraft({ ...draft, promo_months: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Válido hasta (opcional)</Label>
            <Input
              type="datetime-local"
              value={draft.promo_ends_at}
              onChange={(e) => setDraft({ ...draft, promo_ends_at: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Etiqueta de la promo (opcional)</Label>
            <Input
              placeholder="Ej: Promo lanzamiento"
              value={draft.promo_label}
              onChange={(e) => setDraft({ ...draft, promo_label: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">Badge del plan</Label>
          <Input
            placeholder="Ej: Premium"
            value={draft.badge}
            onChange={(e) => setDraft({ ...draft, badge: e.target.value })}
            className="mt-1"
          />
        </div>

        <PromoPreview plan={currentPlan} />

        {error && <p className="text-xs text-red-500">{error}</p>}
        {ok && <p className="text-xs text-green-600">{ok}</p>}

        <Button className="w-full" onClick={save} disabled={saving || !draft.name}>
          {saving ? "Guardando..." : (
            <>
              <Save className="h-4 w-4 mr-1.5" /> Guardar plan
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default function AdminPlanesPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchPlans() {
    const res = await fetch("/api/admin/plans");
    const data = await res.json();
    if (!data.error) setPlans(data.plans);
  }

  useEffect(() => {
    fetchPlans().finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <Tag className="h-6 w-6 text-muted-foreground" /> Planes y promociones
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editá precios y promociones para nuevos suscriptores. La promoción se cobra{" "}
          <b>N meses por adelantado</b> al precio promocional; luego renueva al precio completo.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {plans
          .sort((a, b) => a.sort - b.sort)
          .map((plan) => (
            <div key={plan.id} className="rounded-2xl bg-card overflow-hidden">
              <PlanEditor plan={plan} onSaved={() => fetchPlans()} />
            </div>
          ))}
      </div>
    </div>
  );
}
