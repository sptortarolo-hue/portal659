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
};

/** Card compacta del setup guide de precios para el Dashboard / Hoy. */
export function PricingCard({ vendorId }: { vendorId: string }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `portal659:pricing-card-dismissed:${vendorId}`;
    try { setDismissed(window.localStorage.getItem(key) === "1"); } catch { /* noop */ }
    getJson<{ offers?: Product[] }>("/api/vendor/offers")
      .then((d) => {
        const products = d?.offers || [];
        if (products.length === 0) return setProgress(0);
        const done = [
          products.some((p) => p.price_source === "factura"),
          products.some((p) => p.cost_last != null),
          products.every((p) => p.cost_last != null),
          products.every((p) => p.margin_list_id || getPricingStatus(p).skipped.list),
          products.every((p) => getPricingStatus(p).stage === "listo"),
        ].filter(Boolean).length;
        setProgress(done);
      })
      .catch(() => setProgress(null));
  }, [vendorId]);

  if (dismissed || progress === null || progress >= 5) return null;

  function dismiss() {
    setDismissed(true);
    try { window.localStorage.setItem(`portal659:pricing-card-dismissed:${vendorId}`, "1"); } catch { /* noop */ }
  }

  return (
    <Card className="p-4 border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">Dejá tus productos listos para vender</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Costo → lista → precio, en 5 pasos. Podés entrar por donde quieras.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(progress / 5) * 100}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{progress}/5</span>
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
