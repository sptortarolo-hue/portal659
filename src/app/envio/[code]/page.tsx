"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/product-image";
import { timeAgo } from "@/lib/order-utils";

type ShipmentInfo = {
  code: string;
  status: string;
  statusLabel: string;
  zoneName: string | null;
  requestedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  storeName: string | null;
  storeSlug: string | null;
  storeAddress: string | null;
};

type TimelineEvent = {
  status: string;
  label: string;
  note: string | null;
  photoUrl: string | null;
  createdAt: string;
};

const STATUS_ICON: Record<string, string> = {
  requested: "📋",
  picked_up: "📦",
  in_transit: "🚚",
  delivered: "✅",
  failed_attempt: "⚠️",
  returned: "↩️",
  cancelled: "❌",
};

const STATUS_TONE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-900",
  picked_up: "bg-violet-100 text-violet-900",
  in_transit: "bg-violet-100 text-violet-900",
  delivered: "bg-green-100 text-green-900",
  failed_attempt: "bg-orange-100 text-orange-900",
  returned: "bg-neutral-200 text-neutral-800",
  cancelled: "bg-red-100 text-red-900",
};

export default function EnvioTrackingPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code;
  const [shipment, setShipment] = useState<ShipmentInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    if (!code) return;
    try {
      const res = await fetch(`/api/shipments/track/${encodeURIComponent(String(code))}`);
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setError(data.error);
        setShipment(null);
      } else {
        setError("");
        setShipment(data.shipment || null);
        setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
      }
    } catch {
      setError("Error al cargar el seguimiento");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh breve (la logística va moviendo estados).
  useEffect(() => {
    if (!shipment) return;
    if (shipment.status === "delivered" || shipment.status === "cancelled" || shipment.status === "returned") {
      return;
    }
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, [shipment, fetchData]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-background">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  if (error || !shipment) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-4 bg-background text-center">
        <p className="text-sm text-muted-foreground">{error || "Envío no encontrado"}</p>
        <Link href="/">
          <Button size="sm" variant="outline">← Ir a Portal 659</Button>
        </Link>
      </main>
    );
  }

  const storeHref = shipment.storeSlug ? `/tienda/${shipment.storeSlug}` : "/comercios";
  const terminal = shipment.status === "delivered";

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* Encabezado */}
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-xs text-muted-foreground">Seguimiento de envío</p>
          <div className="flex items-center justify-between gap-2 mt-1">
            <h1 className="text-xl font-bold tracking-wide">{shipment.code}</h1>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_TONE[shipment.status] || "bg-muted text-foreground"}`}>
              {STATUS_ICON[shipment.status] || "✉️"} {shipment.statusLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Hacia <span className="font-medium text-foreground">{shipment.zoneName || "zona extendida"}</span>
          </p>
        </div>

        {/* Tienda origen */}
        <div className="rounded-xl border border-border bg-background p-4 flex items-center gap-3">
          {shipment.storeSlug && (
            <Link href={storeHref} className="text-sm font-medium text-primary hover:underline">
              🏪 {shipment.storeName || "Comercio"}
            </Link>
          )}
          {(!shipment.storeSlug || shipment.storeAddress) && (
            <p className="text-xs text-muted-foreground truncate">{shipment.storeAddress || ""}</p>
          )}
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-semibold mb-3">Recorrido del paquete</p>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay novedades del envío.</p>
          ) : (
            <ol className="space-y-3">
              {[...timeline].reverse().map((ev, i) => (
                <li key={`${ev.status}-${ev.createdAt}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-lg leading-none">{STATUS_ICON[ev.status] || "•"}</span>
                    {i > 0 && <span className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="pb-1 min-w-0">
                    <p className="text-sm font-medium">{ev.label}</p>
                    {ev.note && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ev.note}</p>}
                    <p className="text-[11px] text-muted-foreground">{timeAgo(ev.createdAt)}</p>
                    {ev.photoUrl && (
                      <a href={ev.photoUrl} target="_blank" rel="noreferrer" className="block mt-1">
                        <ProductImage src={ev.photoUrl} name="Prueba de entrega" alt="Prueba de entrega" className="w-32 h-32 rounded-lg border border-border object-cover" />
                        <span className="text-[11px] text-primary hover:underline">Ver foto de la entrega</span>
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {terminal && timeline.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">Paquete entregado 🎉</p>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Seguimiento por Portal 659 · el comercio y la logística coordinan esta entrega
        </p>
      </div>
    </main>
  );
}
