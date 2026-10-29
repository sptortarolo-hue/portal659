"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PlanInfo = {
  carrier: { id: string; name: string };
  plan: { slug: string; name: string; price_monthly: number } | null;
  status: string;
  expiresAt: string | null;
  trialEndsAt: string | null;
  analyticsDays: number;
  maxShipmentsMonth: number | null;
  active: boolean;
  availablePlans: Array<{ slug: string; name: string; price_monthly: number; features?: unknown }>;
};

export default function CarrierPlanPage() {
  const [info, setInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [renewal, setRenewal] = useState<any | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/carrier/subscription");
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setError(j.error || "No autenticado");
        return;
      }
      if (!res.ok) {
        setError(j.error || "No se pudo cargar el plan");
        return;
      }
      setInfo(j as PlanInfo);
      if (!selectedSlug && j.availablePlans?.length) {
        const paid = j.availablePlans.find((p: any) => Number(p.price_monthly) > 0);
        setSelectedSlug(paid?.slug || j.availablePlans[0].slug);
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    load();
  }, [load]);

  async function renew() {
    setBusy(true);
    setError("");
    setMsg("");
    setRenewal(null);
    try {
      const res = await fetch("/api/carrier/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: selectedSlug }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo iniciar la renovación");
        return;
      }
      setRenewal(j);
      setMsg("Reclamo creado. Transferí el monto y subí el comprobante.");
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center"><p className="text-sm text-muted-foreground">Cargando...</p></main>;
  }

  const statusColor =
    info?.status === "active" ? "text-emerald-700" :
    info?.status === "expired" ? "text-red-600" :
    info?.status === "past_due" ? "text-amber-700" : "text-muted-foreground";

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">💳 Mi plan de logística</h1>
            <p className="text-xs text-muted-foreground">
              {info?.carrier?.name || "Logística"} · suscripción mensual por transferencia
            </p>
          </div>
          <Link href="/envios" className="text-xs text-muted-foreground hover:text-foreground">
            ← Mis envíos
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}
        {msg && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</div>
        )}

        {/* Estado actual */}
        <div className="rounded-xl border border-border bg-background p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Plan actual</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold">{info?.plan?.name || "Transportista Gratuito"}</p>
            <span className={`text-xs font-bold ${statusColor}`}>
              {info?.status === "gratuito" ? "Gratuito" :
               info?.status === "active" ? "Activo" :
               info?.status === "expired" ? "Vencido" :
               info?.status === "past_due" ? "En gracia" :
               info?.status || "—"}
            </span>
          </div>
          {info?.expiresAt && (
            <p className="text-xs text-muted-foreground">
              Vence: {new Date(info.expiresAt).toLocaleDateString("es-AR")}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium">
              Envíos/mes: {info?.maxShipmentsMonth == null ? "ilimitados" : info.maxShipmentsMonth}
            </span>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium">
              Analytics: {info?.analyticsDays ? `${info.analyticsDays} días` : "no"}
            </span>
          </div>
        </div>

        {/* Renovar / upgradear */}
        <div className="rounded-xl border border-border bg-background p-4 space-y-3">
          <p className="text-sm font-semibold">Renovar o cambiar de plan</p>
          <div className="space-y-2">
            {(info?.availablePlans || []).map((p: any) => (
              <label
                key={p.slug}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                  selectedSlug === p.slug ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                }`}
              >
                <input
                  type="radio"
                  name="plan"
                  value={p.slug}
                  checked={selectedSlug === p.slug}
                  onChange={() => setSelectedSlug(p.slug)}
                  className="accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {Number(p.price_monthly) > 0
                      ? `$${Number(p.price_monthly).toLocaleString("es-AR")}/mes`
                      : "Gratis"}
                  </p>
                </div>
              </label>
            ))}
          </div>
          <Button size="sm" className="w-full h-10" disabled={busy || !selectedSlug} onClick={renew}>
            {busy ? "Generando..." : "Generar datos de pago (transferencia)"}
          </Button>
        </div>

        {/* Datos de cobro */}
        {renewal && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
            <p className="text-sm font-bold text-emerald-900">Transferí y subí el comprobante</p>
            <p className="text-xs text-emerald-800">
              Monto: <b>${Number(renewal.amount).toLocaleString("es-AR")}</b> · Ref: <b>{renewal.reference}</b>
            </p>
            {renewal.bank?.alias && <p className="text-xs text-emerald-800">Alias: <b>{renewal.bank.alias}</b></p>}
            {renewal.bank?.cbu && <p className="text-xs text-emerald-800">CBU: <b>{renewal.bank.cbu}</b></p>}
            {renewal.bank?.titular && <p className="text-xs text-emerald-800">Titular: <b>{renewal.bank.titular}</b></p>}
            <p className="text-[11px] text-emerald-700">
              El admin revisa el comprobante y activa el plan. Mientras tanto tu servicio no se corta.
            </p>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          El plan se renueva por transferencia al portal. El admin aprueba el pago y extiende el período.
        </p>
      </div>
    </main>
  );
}
