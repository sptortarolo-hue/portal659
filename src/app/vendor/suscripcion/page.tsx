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
  daysLeftPlan: number;
  /** Precio de hoy del plan (promo si está vigente, si no lista). */
  priceToday: {
    amount: number;
    isPromo: boolean;
    listPrice: number;
    offPct: number | null;
    months: number;
    promoEndsAt: string | null;
  } | null;
  projected: {
    orders: number;
    ordersLimit: number | null;
    ordersOverProjected: boolean;
    quotes: number | null;
    quotesLimit: number | null;
    quotesOverProjected: boolean;
  };
  monthResetOn: string | null;
  /** Qué se pierde al bajar a Gratuito (límites + features). */
  wouldLose: { key: string; label: string; current: string; free: string }[];
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
  bank: {
    alias: string | null;
    cbu: string | null;
    titular: string | null;
    qr_url: string | null;
    whatsapp: string | null;
  } | null;
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

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;
const dmy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR") : "-");

/** Botón de copiar (alias/CBU/referencia): patrón clipboard del repo. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
      title={`Copiar ${label ?? "al portapapeles"}`}
    >
      {copied ? "✓ Copiado" : label || "Copiar"}
    </button>
  );
}

function UsageBar({
  label,
  used,
  max,
  overLabel,
  projected,
  projectedOver,
}: {
  label: string;
  used: number;
  max: number | null;
  overLabel: string;
  projected?: number | null;
  projectedOver?: boolean;
}) {
  const pct = max != null ? Math.min(100, Math.round((used / max) * 100)) : used > 0 ? 100 : 0;
  const left = max != null ? Math.max(0, max - used) : null;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span>
          {used}
          {max != null ? ` de ${max}` : " (sin límite)"}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${overLabel && (max != null && used >= max) ? "bg-red-500" : "bg-primary"}`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <p className="text-[11px] text-muted-foreground">
          {max != null ? (left != null && left > 0 ? `Te quedan ${left}` : "Llegaste al tope") : "Sin tope en tu plan"}
        </p>
        {projected != null && max != null && (
          <p className={`text-[11px] ${projectedOver ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
            Cierre estimado: ~{projected}
            {projectedOver ? " (te pasás)" : ""}
          </p>
        )}
      </div>
      {overLabel && max != null && used >= max && <p className="text-[11px] text-red-500 mt-1">{overLabel}</p>}
    </div>
  );
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
    if (data.error === "No autenticado") {
      router.push("/login");
      return;
    }
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
        await load();
        document.getElementById("pago-en-curso")?.scrollIntoView({ behavior: "smooth" });
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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Modo transferencia (MP apagado o no configurado): circuito de reclamo.
    if (data.ok && data.mode === "transfer") {
      await renew(slug);
      return;
    }
    setError(data.error || "No se pudo generar el pago");
  }

  if (loading) {
    return <main className="container mx-auto px-4 py-8 max-w-2xl"><p className="text-muted-foreground">Cargando...</p></main>;
  }
  if (!me) {
    return <main className="container mx-auto px-4 py-8 max-w-2xl"><p className="text-sm text-red-500">{error}</p></main>;
  }

  const eff = me.effective;
  const pending = me.pending;
  const rejectedCount = (me.payments || []).filter((p) => p.status === "rejected").length;
  const hasPaidPlan = eff.slug !== "gratuito";
  const price = me.priceToday;

  // Estado del plan: badge + semáforo del vencimiento.
  const statusBadge =
    eff.status === "preview"
      ? { label: "Modo prueba", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" }
      : eff.status === "past_due"
        ? { label: "Pago en revisión", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }
        : eff.status === "trial"
          ? { label: `En prueba · ${me.trial.daysLeft} días`, cls: "bg-sun text-ink" }
          : eff.status === "active"
            ? { label: "Activo", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" }
            : eff.status === "expired"
              ? { label: "Vencido", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
              : { label: "Gratuito", cls: "bg-muted text-muted-foreground" };

  // CTA principal según estado: una sola acción obvia.
  let primaryCta: { label: string; disabled?: boolean; onClick: () => void; hint?: string } | null = null;
  if (pending) {
    primaryCta = pending.comprobante_at
      ? { label: "Comprobante recibido · esperando revisión", disabled: true, onClick: () => {} }
      : { label: "Subir el comprobante", onClick: () => document.getElementById("subir-comprobante")?.scrollIntoView({ behavior: "smooth" }) };
  } else if (eff.slug === "preview") {
    primaryCta = null;
  } else if (hasPaidPlan && me.daysLeftPlan <= 7) {
    primaryCta = {
      label: busy === "renew" ? "Generando..." : `Renovar ahora · ${money(price?.amount ?? 0)}`,
      disabled: busy === "renew",
      onClick: () => renew(),
      hint: `Vence el ${dmy(me.planExpiresAt)}`,
    };
  } else if (eff.status === "expired") {
    primaryCta = {
      label: "Renovar el plan",
      disabled: busy === "renew",
      onClick: () => renew(),
      hint: "Tu plan venció: volviste al Gratuito",
    };
  } else if (eff.status === "trial") {
    primaryCta = { label: "Ver planes para activar", onClick: () => document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" }) };
  } else if (hasPaidPlan) {
    primaryCta = {
      label: "Renovar por transferencia",
      disabled: busy === "renew",
      onClick: () => renew(),
    };
  }

  const waHelp = me.bank?.whatsapp;

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="sticky top-14 sm:top-0 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-base font-semibold">Mi suscripción</h1>
            <p className="text-xs text-muted-foreground">Tu plan, tus pagos y tus recibos</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push("/vendor/dashboard")}>Volver al panel</Button>
        </div>
      </div>

      <div className="container mx-auto px-4 mt-6 max-w-2xl space-y-6">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {renewMsg && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{renewMsg}</p>}

        {/* 1) RESUMEN: plan, precio de hoy, vencimiento y una sola acción */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Plan actual</p>
              <h2 className="font-display text-xl font-semibold">{eff.name ?? "Gratuito"}</h2>
            </div>
            <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
          </div>

          {price && price.amount > 0 && (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-display text-2xl font-bold">{money(price.amount)}</span>
              <span className="text-xs text-muted-foreground">/mes</span>
              {price.isPromo && (
                <>
                  <span className="text-sm text-muted-foreground line-through">{money(price.listPrice)}</span>
                  <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px] font-bold px-1.5 py-0.5">
                    −{price.offPct}% promo
                  </span>
                  {price.promoEndsAt && (
                    <span className="text-[11px] text-muted-foreground">
                      hasta el {dmy(price.promoEndsAt)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {price?.isPromo && (
            <p className="text-[11px] text-primary mt-1">
              El precio promo vale también para tu renovación mientras esté vigente.
            </p>
          )}

          {hasPaidPlan && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span>📅</span>
              <span>
                {me.daysLeftPlan > 0 ? (
                  <>
                    Vence el <b>{dmy(me.planExpiresAt)}</b>
                    <span className={me.daysLeftPlan <= 2 ? "text-red-600 font-semibold" : me.daysLeftPlan <= 7 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
                      {" "}· quedan {me.daysLeftPlan} {me.daysLeftPlan === 1 ? "día" : "días"}
                    </span>
                  </>
                ) : (
                  <span className="text-red-600 font-semibold">Venció el {dmy(me.planExpiresAt)}</span>
                )}
              </span>
            </div>
          )}

          {me.trial.hasTrial && (
            <p className="text-xs text-muted-foreground mt-2">
              Estás en la prueba gratis del plan: termina el {dmy(me.trial.endsAt)}. Después podés activar un plan pago o seguir en Gratuito.
            </p>
          )}

          {eff.status === "expired" && (
            <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-xs text-red-600 dark:text-red-300">
              Tu periodo venció y volviste al plan Gratuito. Tus datos siguen acá; renová para volver a vender online.
            </div>
          )}

          {/* Chips de uso del mes */}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
              Pedidos: {me.usage.ordersThisMonth}
              {me.usage.maxOrdersMonth != null ? `/ ${me.usage.maxOrdersMonth}` : " · sin tope"}
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
              Productos: {me.usage.products}
              {me.usage.maxProducts != null ? `/ ${me.usage.maxProducts}` : " · sin tope"}
            </span>
            {(me.vertical === "servicio" || me.vertical === "estetica") && (
              <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                Solicitudes: {me.usage.quotesThisMonth}
                {me.usage.maxQuotesMonth != null ? `/ ${me.usage.maxQuotesMonth}` : " · sin tope"}
              </span>
            )}
          </div>

          {primaryCta && (
            <div className="mt-4">
              <Button className="w-full" disabled={primaryCta.disabled} onClick={primaryCta.onClick}>
                {primaryCta.label}
              </Button>
              {primaryCta.hint && <p className="text-[11px] text-muted-foreground text-center mt-1">{primaryCta.hint}</p>}
            </div>
          )}
        </div>

        {/* 2) PAGO EN CURSO: los 3 pasos del circuito */}
        {pending && (
          <div id="pago-en-curso" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">Tu pago en curso</h3>
              <Badge variant="secondary" className="text-[10px]">
                {pending.comprobante_at ? "Comprobante recibido" : "Falta el comprobante"}
              </Badge>
            </div>

            <ol className="space-y-2 text-sm">
              <li className={`flex items-start gap-2 ${pending.comprobante_at ? "text-muted-foreground" : ""}`}>
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">1</span>
                <span>
                  Transferí <b className="text-foreground">{money(pending.amount)}</b> a la cuenta del portal
                  {pending.plan_name ? ` (plan ${pending.plan_name})` : ""}. Cubre hasta el {dmy(pending.period_end)}.
                </span>
              </li>
              <li className={`flex items-start gap-2 ${pending.comprobante_at ? "text-muted-foreground" : ""}`}>
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">2</span>
                <span>
                  Subí la foto o el PDF del comprobante{" "}
                  {pending.comprobante_url ? (
                    <a href={pending.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
                      (ver el que subiste)
                    </a>
                  ) : (
                    <span className="text-muted-foreground">(todavía no lo recibimos)</span>
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2 text-muted-foreground">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold">3</span>
                <span>Lo revisamos y te emitimos el Recibo X por mail. Mientras tanto tu plan sigue funcionando.</span>
              </li>
            </ol>

            {!pending.comprobante_at && (
              <div id="subir-comprobante" className="space-y-2 rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  Referencia: <code className="text-[10px]">{pending.reference}</code>{" "}
                  <CopyButton value={pending.reference} label="Copiar referencia" />
                </p>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                />
                <Button className="w-full" size="sm" disabled={!file || uploading} onClick={() => uploadComprobante(pending.id)}>
                  {uploading ? "Subiendo..." : "Subir comprobante"}
                </Button>
                <p className="text-[11px] text-muted-foreground">Foto o PDF del comprobante (máx. 5 MB).</p>
              </div>
            )}
          </div>
        )}

        {/* 3) CÓMO PAGÁS: datos del portal siempre a mano */}
        {eff.eligibleForPaid && eff.slug !== "gratuito" && me.bank && (me.bank.alias || me.bank.cbu || me.bank.qr_url) && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h3 className="font-display font-semibold text-sm">Cómo pagás</h3>
            <p className="text-xs text-muted-foreground">Transferencia a la cuenta del portal (la revisamos y te emitimos el recibo).</p>
            <div className="text-sm space-y-1 rounded-xl bg-muted p-4">
              {me.bank.alias && (
                <p className="flex items-center gap-2">
                  Alias: <b>{me.bank.alias}</b> <CopyButton value={me.bank.alias} label="Copiar alias" />
                </p>
              )}
              {me.bank.cbu && (
                <p className="flex items-center gap-2">
                  CBU: <b className="break-all">{me.bank.cbu}</b> <CopyButton value={me.bank.cbu} label="Copiar CBU" />
                </p>
              )}
              {me.bank.titular && <p className="text-muted-foreground">Titular: {me.bank.titular}</p>}
              {me.bank.qr_url && (
                <span className="block pt-1">
                  <img src={me.bank.qr_url} alt="QR" className="h-28 w-28 rounded-lg" />
                </span>
              )}
            </div>
            {waHelp && (
              <p className="text-[11px] text-muted-foreground">
                ¿Dudas con el pago?{" "}
                <a
                  href={`https://wa.me/${waHelp.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-medium hover:underline"
                >
                  Escribinos por WhatsApp
                </a>
                .
              </p>
            )}
          </div>
        )}

        {/* 4) USO DEL MES */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-sm">Uso de este mes</h3>
            <span className="text-[11px] text-muted-foreground">Se reinicia el 1º</span>
          </div>
          <UsageBar
            label="Pedidos este mes"
            used={me.usage.ordersThisMonth}
            max={me.usage.maxOrdersMonth}
            overLabel="Llegaste al límite: los pedidos online se pausan hasta el mes que viene o hasta que subas de plan."
            projected={me.projected.orders}
            projectedOver={me.projected.ordersOverProjected}
          />
          <UsageBar
            label="Productos publicados"
            used={me.usage.products}
            max={me.usage.maxProducts}
            overLabel="Pasaste el límite: algunos productos quedaron ocultos hasta que bajes el nivel o subas de plan."
          />
          {(me.vertical === "servicio" || me.vertical === "estetica") && (
            <UsageBar
              label={`Solicitudes este mes (${me.vertical === "estetica" ? "consultas + turnos" : "presupuestos + turnos"})`}
              used={me.usage.quotesThisMonth}
              max={me.usage.maxQuotesMonth}
              overLabel="Llegaste al límite de solicitudes: con un plan pago son ilimitadas."
              projected={me.projected.quotes}
              projectedOver={me.projected.quotesOverProjected}
            />
          )}
        </div>

        {/* 5) PLANES */}
        <div id="planes">
          <h3 className="font-display font-semibold mb-2">Planes</h3>
          {eff.status === "preview" ? (
            <div className="rounded-2xl border border-violet-300 bg-violet-50 dark:bg-violet-950/30 p-5 text-sm">
              <p className="font-semibold text-violet-700 dark:text-violet-300 mb-1">🧪 Estás en modo prueba</p>
              <p className="text-muted-foreground text-xs">
                Tenés todo habilitado sin límites y sin que corra ningún reloj. Cuando publiques tu comercio vas a poder activar una prueba gratis o un plan pago.
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
                    // Oficios ya no se ofrece a estética; solo ve su card quien ya lo tiene.
                    .filter((p) => (me.vertical === "servicio" ? p.slug === "oficios" : p.slug !== "oficios" || eff.slug === "oficios"))
                    .map((plan) => {
                      const current = eff.slug === plan.slug && (eff.status === "active" || eff.status === "past_due");
                      const active = eff.status === "active" || eff.status === "past_due" || eff.status === "trial";
                      const promo = activePromo(plan);
                      const priceToday = promo ? promo.price : Number(plan.price_monthly);
                      const diff = priceToday - (price?.amount ?? 0);
                      return (
                        <div key={plan.id} className="rounded-2xl border border-border bg-card p-4 flex flex-col">
                          <div className="flex items-center justify-between">
                            <h4 className="font-display font-semibold">{planCopyFor(plan.slug, me.vertical)?.title ?? plan.name}</h4>
                            {plan.popular && <Badge variant="secondary" className="text-[10px]">Popular</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 mb-3">{planCopyFor(plan.slug, me.vertical)?.desc ?? plan.description}</p>

                          <div className="mb-2">
                            <span className="font-display font-bold text-lg">{money(priceToday)}</span>
                            {promo ? (
                              <>
                                <span className="font-display text-sm font-semibold text-muted-foreground line-through ml-2">{money(plan.price_monthly)}</span>
                                <span className="ml-2 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px] font-bold px-1.5 py-0.5">
                                  −{promo.offPct}%
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground"> · precio de lista</span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-3">
                            {promo
                              ? `Promo de ${promo.months} ${promo.months === 1 ? "mes" : "meses"} por adelantado${promo.endsAt ? `, hasta el ${new Date(promo.endsAt).toLocaleDateString("es-AR")}` : ""} · válida para nuevos y renovaciones`
                              : "Prueba gratis de 30 días (una vez, al primer plan)"}
                          </p>

                          {current ? (
                            <div className="mt-auto space-y-2">
                              <Button className="w-full" variant="outline" disabled>Tu plan actual</Button>
                              {eff.status === "past_due" && (
                                <p className="text-[10px] text-amber-600 text-center">
                                  Tu pago está en revisión: el plan sigue activo hasta que lo acreditemos.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="mt-auto space-y-2">
                              {active ? (
                                <>
                                  <Button className="w-full" variant="outline" onClick={() => pay(plan.slug)} disabled={busy === `pay-${plan.slug}`}>
                                    {busy === `pay-${plan.slug}` ? "Generando pago..." : diff === 0 ? "Pagar y cambiar" : diff > 0 ? `Cambiar · +${money(diff)}` : `Cambiar · −${money(-diff)}`}
                                  </Button>
                                  <p className="text-[10px] text-muted-foreground text-center">
                                    Se paga la diferencia desde el próximo período.
                                  </p>
                                </>
                              ) : (
                                <Button className="w-full" onClick={() => activate(plan.slug)} disabled={busy === plan.slug}>
                                  {busy === plan.slug ? "Activando..." : "Activar prueba gratis"}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Antes de bajar a Gratuito: qué se pierde */}
              {hasPaidPlan && me.wouldLose.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-4">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Si volvés al plan Gratuito perdés:</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
                    {me.wouldLose.slice(0, 8).map((w) => (
                      <li key={w.key}>
                        • {w.label}: hoy {w.current} → en Gratuito {w.free.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
                    Para bajar de plan, escribinos{waHelp ? " por WhatsApp" : ""}: lo hacemos nosotros y no perdés el historial.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 6) RECIBOS */}
        {me.receipts && me.receipts.length > 0 && (
          <div>
            <h3 className="font-display font-semibold mb-2">Recibos de pago</h3>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              {me.receipts.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <a href={`/vendor/suscripcion/recibo/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                      Recibo X {String(r.seq).padStart(4, "0")}/{r.year} · Plan {r.plan_name}
                    </a>
                    <p className="text-[11px] text-muted-foreground">
                      {dmy(r.issued_at)} · {money(r.amount)}
                      {r.period_end ? ` · cubre hasta ${dmy(r.period_end)}` : ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">No válido como factura</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7) HISTORIAL DE PAGOS */}
        {(me.payments || []).length > 0 && (
          <div>
            <h3 className="font-display font-semibold mb-2">Pagos</h3>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              {(me.payments || []).slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {p.plan_name ?? "Plan"} · {money(p.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {dmy(p.created_at)}
                      {p.status === "rejected" && p.review_note ? ` · ${p.review_note}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] capitalize ${
                      p.status === "approved"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : p.status === "rejected"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                  >
                    {p.status === "approved" ? "Acreditado" : p.status === "rejected" ? "Rechazado" : "En revisión"}
                  </Badge>
                </div>
              ))}
            </div>
            {rejectedCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Los rechazados podés volver a pagar: iniciá una nueva renovación y subí el comprobante correcto.
              </p>
            )}
          </div>
        )}

        {/* 8) HISTORIAL DE PERÍODOS */}
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
                        {dmy(h.current_period_start)} → {h.current_period_end ? dmy(h.current_period_end) : "—"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize">{h.status}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 9) AYUDA */}
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            ¿Dudas con tu plan o con un pago?
          </p>
          {waHelp ? (
            <a
              href={`https://wa.me/${waHelp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Escribinos por WhatsApp
            </a>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">Escribinos desde el botón de WhatsApp de tu panel.</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">Portal 659 · 0% comisión por venta</p>
        </div>
      </div>
    </main>
  );
}
