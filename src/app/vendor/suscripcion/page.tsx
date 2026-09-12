"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice, daysLeft, activePromo } from "@/lib/plans";
import type { Plan, VendorSubscription } from "@/types/database";

type MeResponse = {
  vendorId?: string;
  vertical?: string;
  plans: Plan[];
  effective: {
    slug: string;
    status: string;
    trialActive: boolean;
    active: boolean;
    expired: boolean;
    eligibleForPaid: boolean;
    name: string | null;
    badge: string | null;
    priceMonthly: number;
    analyticsDays: number;
  };
  trial: { endsAt: string | null; daysLeft: number; hasTrial: boolean };
  usage: {
    products: number;
    maxProducts: number | null;
    overLimit: boolean;
    percent: number;
    ordersThisMonth: number;
    maxOrdersMonth: number | null;
    ordersOverLimit: boolean;
  };
  history: VendorSubscription[];
};

const PLAN_COPY: Record<string, { title: string; desc: string }> = {
  pedidos: {
    title: "Pedidos",
    desc: "Pedidos por la app sin límite mensual, analytics y gestión de reseñas.",
  },
  gestion: {
    title: "Gestión integral",
    desc: "Todo lo de Pedidos, más pago online, comanda, mostrador y mesas.",
  },
};

export default function VendorSuscripcionPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [payInfo, setPayInfo] = useState<any>(null);

  useEffect(() => {
    fetch("/api/subscriptions/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "No autenticado") {
          router.push("/login");
          return;
        }
        setMe(d);
      })
      .catch(() => setError("Error al cargar tu suscripción"))
      .finally(() => setLoading(false));
  }, [router]);

  async function activate(slug: string) {
    setError("");
    setBusy(slug);
    const res = await fetch("/api/subscriptions/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug: slug }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.ok) {
      router.refresh();
      window.location.reload();
      return;
    }
    setError(data.error || "No se pudo activar el trial");
  }

  async function pay(slug: string) {
    setError("");
    setPayInfo(null);
    setBusy(`pay-${slug}`);
    const res = await fetch("/api/subscriptions/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug: slug }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.mode === "mercado_pago" && data.initPoint) {
      window.location.href = data.initPoint;
      return;
    }
    if (data.ok && data.mode === "transfer") {
      setPayInfo(data);
      return;
    }
    setError(data.error || "No se pudo generar el pago");
  }

  if (loading) {
    return <main className="container mx-auto px-4 py-8 max-w-2xl"><p className="text-muted-foreground">Cargando...</p></main>;
  }

  if (!me) {
    return <main className="container mx-auto px-4 py-8 max-w-2xl"><p className="text-red-500 text-sm">{error}</p></main>;
  }

  const eff = me.effective;
  const trialTimeLeft = me.trial.hasTrial ? me.trial.daysLeft : eff.status === "trial" ? daysLeft(me.trial.endsAt) : 0;

  const statusBadge =
    eff.status === "preview"
      ? { label: "Modo prueba", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" }
      : eff.status === "trial"
      ? { label: `En prueba · ${trialTimeLeft} días`, cls: "bg-sun text-ink" }
      : eff.status === "active"
        ? { label: "Activo", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" }
        : eff.status === "expired"
          ? { label: "Vencido", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
          : { label: "Gratuito", cls: "bg-muted text-muted-foreground" };

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-base font-semibold">Mi suscripción</h1>
            <p className="text-xs text-muted-foreground">Dale de comer tu negocio a Portal 659</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push("/vendor/dashboard")}>Volver al panel</Button>
        </div>
      </div>

      <div className="container mx-auto px-4 mt-6 max-w-2xl space-y-6">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {payInfo && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="font-display font-semibold">Pago por transferencia</h3>
            <p className="text-sm text-muted-foreground">
              Transferí <b className="text-foreground">${Number(payInfo.order.amount).toLocaleString("es-AR")}</b> por el
              plan {payInfo.order.plan.name} (cubre hasta {new Date(payInfo.order.periodEnd).toLocaleDateString("es-AR")}).
            </p>
            <div className="text-sm space-y-1 rounded-xl bg-muted p-4">
              {payInfo.transfer?.alias && <p>Alias: <b>{payInfo.transfer.alias}</b></p>}
              {payInfo.transfer?.cbu && <p>CBU: <b>{payInfo.transfer.cbu}</b></p>}
              {payInfo.transfer?.qrUrl && (
                <span className="block pt-1"><img src={payInfo.transfer.qrUrl} alt="QR" className="h-28 w-28 rounded-lg" /></span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Referencia: <code className="text-[10px]">{payInfo.order.externalReference}</code>
            </p>
            {payInfo.transfer?.whatsapp && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  const msg = encodeURIComponent(`Hola! Hice una transferencia para activar el plan ${payInfo.order.plan.name}. Referencia: ${payInfo.order.externalReference}`);
                  window.open(`https://wa.me/${payInfo.transfer.whatsapp.replace(/[^0-9]/g, "")}?text=${msg}`, "_blank");
                }}
              >
                Avisar que transferí
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">El administrador lo recibe y activa tu plan en minutos.</p>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Plan actual</p>
              <h2 className="font-display text-xl font-semibold">{eff.name ?? "Gratuito"}</h2>
            </div>
            <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
          </div>

          {me.trial.hasTrial && (
            <p className="text-xs text-muted-foreground mt-2">
              Termina de probar el {me.trial.daysLeft < 2 ? "mañana" : `en ${me.trial.daysLeft} días`} (
              {new Date(me.trial.endsAt!).toLocaleDateString("es-AR")}). Después podés seguir,
              renovar o volver al plan gratis.
            </p>
          )}

          {eff.status === "expired" && (
            <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-xs text-red-600 dark:text-red-300">
              Tu periodo venció y volviste al plan Gratuito. Tus datos siguen acá;
              renová para volver a vender online.
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Productos publicados</span>
              <span>
                {me.usage.products}
                {me.usage.maxProducts != null ? ` de ${me.usage.maxProducts}` : " ilimitados"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${me.usage.overLimit ? "bg-red-500" : "bg-primary"}`}
                style={{ width: `${Math.max(3, me.usage.percent)}%` }}
              />
            </div>
            {me.usage.overLimit && (
              <p className="text-[11px] text-red-500 mt-1">
                Pasaste el límite del plan. Algunos productos quedaron ocultos hasta que bajes el nivel o subas de plan.
              </p>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Pedidos este mes</span>
              <span>
                {me.usage.ordersThisMonth}
                {me.usage.maxOrdersMonth != null ? ` de ${me.usage.maxOrdersMonth}` : " ilimitados"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${me.usage.ordersOverLimit ? "bg-red-500" : "bg-primary"}`}
                style={{
                  width: `${me.usage.maxOrdersMonth != null
                    ? Math.min(100, Math.round((me.usage.ordersThisMonth / me.usage.maxOrdersMonth) * 100))
                    : 10}%`,
                }}
              />
            </div>
            {me.usage.ordersOverLimit && (
              <p className="text-[11px] text-red-500 mt-1">
                Llegaste al límite de pedidos de este mes. Subí de plan para seguir recibiendo pedidos.
              </p>
            )}
          </div>
        </div>

        <div>
          <h3 className="font-display font-semibold mb-2">Elegí tu plan</h3>
          {eff.status === "preview" ? (
            <div className="rounded-2xl border border-violet-300 bg-violet-50 dark:bg-violet-950/30 p-5 text-sm">
              <p className="font-semibold text-violet-700 dark:text-violet-300 mb-1">🧪 Estás en modo prueba</p>
              <p className="text-muted-foreground text-xs">
                Tenés todo habilitado sin límites y sin que corra ningún reloj.
                Cuando publiques tu comercio vas a poder activar una prueba gratis o un plan pago.
              </p>
            </div>
          ) : (
          <>
          {!eff.eligibleForPaid && (
            <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Los planes de pago están disponibles por ahora solo para <b>gastronomía</b>.
              Para tu rubro, el plan <b>Gratuito</b> incluye tu ficha y vidriera completa.
            </div>
          )}
          {eff.eligibleForPaid && (
            <div className="grid sm:grid-cols-2 gap-3">
              {me.plans
                .filter((p) => p.slug !== "gratuito")
                .map((plan) => {
                  const current = eff.slug === plan.slug && (eff.status === "trial" || eff.status === "active");
                  const active = eff.status === "trial" || eff.status === "active";
                  const gated = active && !current;
                  const promo = activePromo(plan);
                  return (
                    <div key={plan.id} className="rounded-2xl border border-border bg-card p-4 flex flex-col">
                      <div className="flex items-center justify-between">
                        <h4 className="font-display font-semibold">{plan.name}</h4>
                        {plan.popular && <Badge variant="secondary" className="text-[10px]">Popular</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">{PLAN_COPY[plan.slug]?.desc ?? plan.description}</p>
                      <div className="mb-3">
                        {promo ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display font-bold text-lg">{formatPrice(promo.price)}</span>
                            <span className="font-display text-base font-semibold text-muted-foreground line-through">
                              {formatPrice(promo.listPrice)}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px] font-bold px-1.5 py-0.5">
                              -{promo.offPct}%
                            </span>
                          </div>
                        ) : (
                          <span className="font-display font-bold text-lg">{formatPrice(plan.price_monthly)}</span>
                        )}
                        {promo ? (
                          <p className="text-[11px] text-muted-foreground">
                            {promo.months} {promo.months === 1 ? "mes" : "meses"} por adelantado
                            {promo.endsAt ? ` · hasta ${new Date(promo.endsAt).toLocaleDateString("es-AR")}` : ""}{" "}
                            para nuevos suscriptores
                          </p>
                        ) : (
                          <span className="text-xs text-muted-foreground"> · 30 días de prueba</span>
                        )}
                      </div>
                      <div className="mt-auto space-y-2">
                        {current ? (
                          <Button className="w-full" variant="outline" disabled>Plan actual</Button>
                        ) : active ? (
                          <Button className="w-full" variant="outline" onClick={() => pay(plan.slug)} disabled={busy === `pay-${plan.slug}`}>
                            {busy === `pay-${plan.slug}` ? "Generando pago..." : "Pagar y cambiar"}
                          </Button>
                        ) : (
                          <Button className="w-full" onClick={() => activate(plan.slug)} disabled={busy === plan.slug}>
                            {busy === plan.slug ? "Activando..." : "Activar prueba gratis"}
                          </Button>
                        )}
                        {gated && (
                          <p className="text-[10px] text-muted-foreground text-center">
                            Para cambiar de plan pagás la diferencia desde el próximo periodo.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          </>
          )}
        </div>

        {me.history.length > 0 && (
          <div>
            <h3 className="font-display font-semibold mb-2">Historial</h3>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              {me.history.map((h) => {
                const planName = me.plans.find((p) => p.id === h.plan_id)?.name ?? "Plan";
                return (
                  <div key={h.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{planName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(h.current_period_start).toLocaleDateString("es-AR")} →{" "}
                        {h.current_period_end ? new Date(h.current_period_end).toLocaleDateString("es-AR") : "—"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize">{h.status}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}