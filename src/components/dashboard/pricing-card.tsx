"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { getJson } from "@/components/dashboard/shared";
import { getPricingStatus } from "@/lib/pricing-status";

type Product = {
  id: string;
  cost_last?: number | null;
  price?: number | null;
  margin_list_id?: string | null;
  price_source?: string | null;
  pricing_skipped?: unknown;
  is_combo?: boolean | null;
  sku?: string | null;
};

/** Card compacta del setup guide de precios para el Dashboard / Hoy. */
export function PricingCard({ vendorId }: { vendorId: string }) {
  const [stats, setStats] = useState<{ done: number; pending: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `portal659:pricing-card-dismissed:${vendorId}`;
    try { setDismissed(window.localStorage.getItem(key) === "1"); } catch { /* noop */ }
    getJson<{ offers?: Product[] }>("/api/vendor/offers")
      .then((d) => {
        const products = (d?.offers || []).filter(
          (p) => !p.is_combo && !(p.sku || "").startsWith("GC-")
        );
        if (products.length === 0) return setStats({ done: 0, pending: 0 });
        const sinCosto = products.filter((p) => getPricingStatus(p).missing.includes("costo")).length;
        const sinLista = products.filter(
          (p) => !p.margin_list_id && !getPricingStatus(p).skipped.list && p.cost_last != null
        ).length;
        const sinPrecio = products.filter(
          (p) => p.cost_last != null && (p.margin_list_id || getPricingStatus(p).skipped.list) && (!p.price || Number(p.price) <= 0)
        ).length;
        const done = [sinCosto === 0, sinLista === 0, sinPrecio === 0].filter(Boolean).length;
        setStats({ done, pending: sinCosto + sinLista + sinPrecio });
      })
      .catch(() => setStats(null));
  }, [vendorId]);

  if (dismissed || stats === null || stats.pending === 0) return null;

  function dismiss() {
    setDismissed(true);
    try { window.localStorage.setItem(`portal659:pricing-card-dismissed:${vendorId}`, "1"); } catch { /* noop */ }
  }

  return (
    <Card className="p-4 border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">Prepará tus productos para vender</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats.pending} producto{stats.pending === 1 ? "" : "s"} con pasos pendientes.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(stats.done / 3) * 100}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{stats.done}/3</span>
          </div>
        </div>
        <a href="/vendor/precios/asistente">
          <button className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
            Continuar →
          </button>
        </a>
        <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground" aria-label="Ocultar">
          ✕
        </button>
      </div>
    </Card>
  );
}
