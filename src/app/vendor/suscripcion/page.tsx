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
    /** Gracia: hay un pago en revisión, el plan no cortó. */
    grace: boolean;
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
    quotesThisMonth: number;
    maxQuotesMonth: number | null;
    quotesOverLimit: boolean;
  };
  history: VendorSubscription[];
  planExpiresAt: string | null;
  /** Reclamo de pago por transferencia (pending) o null. */
  pending: {
    id: string;
    amount: number;
    period_start: string;
    period_end: string;
    reference: string;
    status: string;
    comprobante_url: string | null;
    comprobante_name: string | null;
    comprobante_at: string | null;
    plan_slug: string | null;
    plan_name: string | null;
    created_at: string;
    review_note: string | null;
  } | null;
  payments: {
    id: string;
    amount: number;
    period_end: string;
    reference: string;
    status: string;
    comprobante_url: string | null;
    comprobante_name: string | null;
    comprobante_at: string | null;
    plan_slug: string | null;
    plan_name: string | null;
    created_at: string;
    review_note: string | null;
  }[];
  receipts: {
    id: string;
    amount: number;
    plan_name: string;
    seq: number;
    year: number;
    method: string;
    issued_at: string;
    period_end: string | null;
  }[];
  bank: { alias: string | null; cbu: string | null; titular: string | null; qr_url: string | null } | null;
};

const PLAN_COPY: Record<string, { title: string; desc: string }> = {
  pedidos: {
    title: "Pedidos",
    desc: "Pedidos por la app sin límite mensual, analytics y gestión de reseñas.",
  },
  gestion: {
    title: "Gestión integral",
    desc: "Todo lo de Pedidos, más cobro online, mostrador, caja, clientes e impresión (gastro suma comanda y mesas).",
  },
  oficios: {
    title: "Oficios",
    desc: "Solicitudes ilimitadas, cotización con precio, seña por Mercado Pago, urgencia con recargo y reseñas.",
  },
  oficios_estetica: {
    title: "Oficios",
    desc: "Solicitudes ilimitadas, cotización con precio, seña online y reseñas.",
  },
  pedidos_estetica: {
    title: "Turnera",
    desc: "Turnera libre: consultas y turnos ilimitados + pedidos online ilimitados, reseñas, cotización con precio y seña por Mercado Pago.",
  },
};

/** Copy por vertical: `pedidos` se llama "Turnera" en estética. */
function planCopyFor(slug: string, vertical: string | null | undefined): { title: string; desc: string } | undefined {
  if (vertical === "estetica") {
    const esteticaCopy = PLAN_COPY[`${slug}_estetica`];
    if (esteticaCopy) return esteticaCopy;
  }
  return PLAN_COPY[slug];
}

export default function VendorSuscripcionPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renewMsg, setRenewMsg] = useState("");

  async function load() {
    const res = await fetch("/api/subscriptions/me");
    const data = await res.json().catch(() => ({}));
    if (data && !data.error) setMe(data);
    else setError(data?.error || "No se pudo cargar tu suscripción");
    setLoading(false);
  }

  async function renew(slug?: string) {
    setBusy("renew");
    setRenewMsg("");
    try {
      const res = await fetch("/api/subscriptions/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: slug ?? me?.effective.slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setRenewMsg("");
        await load();
      } else {
        setRenewMsg(data.error || "No se pudo iniciar la renovación");
      }
    } catch {
      setRenewMsg("Error de conexión");
    }
    setBusy(null);
  }

  async function uploadComprobante(paymentId: string) {
    if (!file) return;
    setUploading(true);
    setRenewMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/vendor/suscripcion/pagos/${paymentId}/comprobante`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setFile(null);
        await load();
      } else {
        setRenewMsg(data.error || "No se pudo subir el comprobante");
      }
    } catch {
      setRenewMsg("Error de conexión");
    }
    setUploading(false);
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/subscriptions/me");
      const d = await res.json().catch(() => ({}));
      if (d.error === "No autenticado") {
        router.push("/login");
        return;
      }
      if (d && !d.error) setMe(d);
      else setError(d?.error || "Error al cargar tu suscripción");
      setLoading(false);
    })();
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
    // Modo transferencia (MP apagado o no configurado): va al circuito de
    // reclamo + comprobante (datos bancarios del portal).
    if (data.ok && data.mode === "transfer") {
      await renew();
      document.getElementById("renovar")?.scrollIntoView({ behavior: "smooth" });
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
        : eff.status === "past_due"
          ? { label: "Pago en revisión", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }
          : { label: "Gratuito", cls: "bg-muted text-muted-foreground" };

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="sticky top-14 sm:top-0 z-40 bg-background border-b border-border">
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
        {renewMsg && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{renewMsg}</p>}

        {/* Circuito de renovación por transferencia: reclamo + comprobante.
            Mientras el pago está en revisión el plan NO se corta (gracia). */}
        {eff.eligibleForPaid && eff.slug !== "gratuito" && (
          <div id="renovar" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">Renovar por transferencia</h3>
              {eff.grace && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">
                  Pago en revisión · plan activo
                </Badge>
              )}
            </div>

            {eff.grace && (
              <p className="text-xs text-muted-foreground">
                Tu plan venció pero sigue funcionando mientras revisamos tu comprobante. Si lo rechazamos, te avisamos con el motivo.
              </p>
            )}

            {me.bank && (me.bank.alias || me.bank.cbu || me.bank.qr_url) && (
              <div className="text-sm space-y-1 rounded-xl bg-muted p-4">
                <p className="text-xs font-semibold text-muted-foreground">Transferí a la cuenta del portal</p>
                {me.bank.alias && <p>Alias: <b>{me.bank.alias}</b></p>}
                {me.bank.cbu && <p>CBU: <b>{me.bank.cbu}</b></p>}
                {me.bank.titular && <p className="text-muted-foreground">Titular: {me.bank.titular}</p>}
                {me.bank.qr_url && (
                  <span className="block pt-1">
                    <img src={me.bank.qr_url} alt="QR" className="h-28 w-28 rounded-lg" />
                  </span>
                )}
              </div>
            )}

            {me.pending ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-border p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {me.pending.plan_name ?? "Plan"} · ${Number(me.pending.amount).toLocaleString("es-AR")}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {me.pending.comprobante_at ? "Comprobante recibido" : "Falta el comprobante"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Cubre hasta el {new Date(me.pending.period_end).toLocaleDateString("es-AR")} · Referencia:{" "}
                    <code className="text-[10px]">{me.pending.reference}</code>
                  </p>
                  {me.pending.comprobante_url ? (
                    <a
                      href={me.pending.comprobante_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary font-medium hover:underline inline-block mt-2"
                    >
                      Ver comprobante subido ({me.pending.comprobante_name || "archivo"})
                    </a>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                      />
                      <Button
                        className="w-full"
                        size="sm"
                        disabled={!file || uploading}
                        onClick={() => uploadComprobante(me.pending!.id)}
                      >
                        {uploading ? "Subiendo..." : "Subir comprobante"}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Foto o PDF del comprobante (máx. 5 MB). Lo revisamos y te avisamos.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Transferí el monto del mes a la cuenta del portal y subí el comprobante.
                  Verificamos el pago y te emitimos el Recibo X. Mientras se revisa, tu plan no se corta.
                </p>
                <Button className="w-full" disabled={busy === "renew"} onClick={() => renew()}>
                  {busy === "renew" ? "Generando..." : "Iniciar renovación por transferencia"}
                </Button>
              </div>
            )}

            {(me.payments || []).some((p) => p.status === "rejected") && (
              <div className="text-xs text-red-600 space-y-1">
                <p className="font-semibold">Pagos rechazados:</p>
                {me.payments
                  .filter((p) => p.status === "rejected")
                  .slice(0, 3)
                  .map((p) => (
                    <p key={p.id}>
                      {new Date(p.created_at).toLocaleDateString("es-AR")} · {p.review_note || "sin motivo"}
                    </p>
                  ))}
              </div>
            )}
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

          {(me.vertical === "servicio" || me.vertical === "estetica") && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Solicitudes este mes ({me.vertical === "estetica" ? "consultas + turnos" : "presupuestos + turnos"})</span>
              <span>
                {me.usage.quotesThisMonth}
                {me.usage.maxQuotesMonth != null ? ` de ${me.usage.maxQuotesMonth}` : " ilimitadas"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${me.usage.quotesOverLimit ? "bg-red-500" : "bg-primary"}`}
                style={{
                  width: `${me.usage.maxQuotesMonth != null
                    ? Math.min(100, Math.round((me.usage.quotesThisMonth / me.usage.maxQuotesMonth) * 100))
                    : 10}%`,
                }}
              />
            </div>
            {me.usage.quotesOverLimit && (
              <p className="text-[11px] text-red-500 mt-1">
                Llegaste al límite de solicitudes de este mes. Con un plan pago son ilimitadas.
              </p>
            )}
          </div>
          )}
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
              Los planes de pago están disponibles para <b>gastronomía</b>, <b>comercios de barrio</b>, <b>moda</b>, <b>peluquería y estética</b> y <b>servicios</b> (plan Oficios).
              Para tu rubro, el plan <b>Gratuito</b> incluye tu ficha y vidriera completa.
            </div>
          )}
          {eff.eligibleForPaid && (
            <div className="grid sm:grid-cols-2 gap-3">
              {me.plans
                .filter((p) => p.slug !== "gratuito")
                // Oficios ya no se ofrece a estética; solo se ve su card quien
                // ya lo tiene como plan (grandfathering: puede renovarlo).
                .filter((p) => (me.vertical === "servicio" ? p.slug === "oficios" : p.slug !== "oficios" || eff.slug === "oficios"))
                .map((plan) => {
                  const current = eff.slug === plan.slug && (eff.status === "trial" || eff.status === "active");
                  const active = eff.status === "trial" || eff.status === "active";
                  const gated = active && !current;
                  const promo = activePromo(plan);
                  return (
                    <div key={plan.id} className="rounded-2xl border border-border bg-card p-4 flex flex-col">
                      <div className="flex items-center justify-between">
                        <h4 className="font-display font-semibold">{planCopyFor(plan.slug, me.vertical)?.title ?? plan.name}</h4>
                        {plan.popular && <Badge variant="secondary" className="text-[10px]">Popular</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">{planCopyFor(plan.slug, me.vertical)?.desc ?? plan.description}</p>
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

        {me.receipts && me.receipts.length > 0 && (
          <div>
            <h3 className="font-display font-semibold mb-2">Recibos de pago</h3>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              {me.receipts.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <a
                      href={`/vendor/suscripcion/recibo/${r.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Recibo X {String(r.seq).padStart(4, "0")}/{r.year} · Plan {r.plan_name}
                    </a>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(r.issued_at).toLocaleDateString("es-AR")} · ${Number(r.amount || 0).toLocaleString("es-AR")}
                      {r.period_end ? ` · cubre hasta ${new Date(r.period_end).toLocaleDateString("es-AR")}` : ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">No válido como factura</span>
                </div>
              ))}
            </div>
          </div>
        )}

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