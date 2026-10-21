"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/product-image";
import { DeliverCertSheet } from "@/components/envios/deliver-cert-sheet";
import { mapsDirectionsUrl, waUrlFromPhone, buyerVoyText } from "@/lib/shipping-geo";
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
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
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

/**
 * Acciones de reparto SIN login (el paquete es la llave): quien escanea el QR
 * de la oblea con el paquete en la mano avanza la entrega. Regla dura: para
 * entregar hay que marcar antes "En camino".
 */
const COURIER_STEPS: Record<string, { to: string; label: string; primary?: boolean; needsNote?: boolean }[]> = {
  picked_up: [
    { to: "in_transit", label: "🚚 En camino", primary: true },
    { to: "failed_attempt", label: "⚠️ No entregado", needsNote: true },
    { to: "returned", label: "↩️ Devolver al local", needsNote: true },
  ],
  in_transit: [
    { to: "delivered", label: "✅ Entregar", primary: true },
    { to: "failed_attempt", label: "⚠️ No entregado", needsNote: true },
  ],
  failed_attempt: [
    { to: "in_transit", label: "🚚 Reintentar", primary: true },
    { to: "returned", label: "↩️ Devolver al local", needsNote: true },
  ],
};

export default function EnvioTrackingPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code;
  const [shipment, setShipment] = useState<ShipmentInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Modo repartidor (sin login): nombre + acciones.
  const [courierName, setCourierName] = useState("");
  const [stepConfirm, setStepConfirm] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [certOpen, setCertOpen] = useState(false);

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

  // Nombre del repartidor recordado en el teléfono (traspaso entre repartidores).
  useEffect(() => {
    try {
      setCourierName(localStorage.getItem("portal659-courier-name") || "");
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      if (courierName.trim()) localStorage.setItem("portal659-courier-name", courierName.trim());
    } catch {
      /* noop */
    }
  }, [courierName]);

  // Auto-refresh breve (la logística va moviendo estados).
  useEffect(() => {
    if (!shipment) return;
    if (shipment.status === "delivered" || shipment.status === "cancelled" || shipment.status === "returned") {
      return;
    }
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, [shipment, fetchData]);

  /** Avanza el envío sin login (POST por código; el nombre va en el evento). */
  const handMove = useCallback(
    async (
      to: string,
      note: string,
      cert?: { name: string; dni: string; lat: number; lng: number; podPhotoUrl: string | null }
    ) => {
      if (!code) return;
      setBusy(true);
      setActionMsg("");
      try {
        const res = await fetch(`/api/shipments/hand/${encodeURIComponent(String(code))}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: to,
            note: note || undefined,
            courierName: courierName.trim() || undefined,
            ...(cert
              ? {
                  deliveredToName: cert.name,
                  deliveredDni: cert.dni,
                  deliveredLat: cert.lat,
                  deliveredLng: cert.lng,
                  podPhotoUrl: cert.podPhotoUrl || undefined,
                }
              : {}),
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionMsg(j.error || "No se pudo actualizar el envío");
        } else {
          setStepConfirm(null);
          setNoteText("");
          setCertOpen(false);
          await fetchData();
        }
      } catch {
        setActionMsg("Error de red");
      } finally {
        setBusy(false);
      }
    },
    [code, courierName, fetchData]
  );

  async function uploadHandPod(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/shipment-upload/hand?code=${encodeURIComponent(String(code))}`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      return res.ok ? (j.url as string) : null;
    } catch {
      return null;
    }
  }

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
  const courierSteps = COURIER_STEPS[shipment.status] || [];
  const destUrl = shipment.customerAddress
    ? mapsDirectionsUrl(shipment.customerAddress)
    : null;

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

        {/* Hoja del repartidor: escaneó el paquete, sin login */}
        {courierSteps.length > 0 && (
          <div className="rounded-2xl border-2 border-violet-300 bg-background p-4 space-y-3">
            <div>
              <p className="text-sm font-bold">📦 ¿Vas a entregar este paquete?</p>
              <p className="text-[11px] text-muted-foreground">
                No hace falta cuenta: avanzá el envío desde acá. El traspaso queda registrado con tu nombre.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tu nombre (repartidor)</label>
              <input
                className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
                placeholder="Ej: Juan"
                value={courierName}
                onChange={(e) => setCourierName(e.target.value.slice(0, 60))}
              />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-bold leading-tight">Entregar a: {shipment.customerName || "—"}</p>
              <div className="rounded-xl bg-muted/40 p-2.5">
                <p className="text-sm font-medium leading-snug break-words">{shipment.customerAddress || "Sin dirección"}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {destUrl && (
                    <a href={destUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" className="h-8 text-xs px-3">🗺️ Mapa</Button>
                    </a>
                  )}
                  {destUrl && (
                    <a href={destUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="h-8 text-xs px-3">🚗 Cómo llegar</Button>
                    </a>
                  )}
                  {(() => {
                    const wa = shipment.customerPhone
                      ? waUrlFromPhone(shipment.customerPhone, buyerVoyText(shipment.code, shipment.storeName))
                      : null;
                    return wa ? (
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-8 text-xs px-3">💬 WhatsApp</Button>
                      </a>
                    ) : null;
                  })()}
                </div>
                {shipment.customerPhone && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">Tel: {shipment.customerPhone}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              {courierSteps.map((step) => (
                <Button
                  key={step.to}
                  size="sm"
                  variant={step.primary ? "default" : "outline"}
                  className="w-full h-10 text-sm"
                  disabled={busy}
                  onClick={() => {
                    if (step.to === "delivered") {
                      setCertOpen(true);
                    } else if (step.needsNote) {
                      setStepConfirm(step.to);
                      setNoteText("");
                    } else {
                      handMove(step.to, "");
                    }
                  }}
                >
                  {step.label}
                </Button>
              ))}
            </div>

            {stepConfirm && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-xs font-medium">
                  {courierSteps.find((s) => s.to === stepConfirm)?.label} — contá qué pasó (opcional):
                </p>
                <textarea
                  className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 min-h-16"
                  placeholder="Ej: no había nadie / dirección incorrecta / rechazó el paquete"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  maxLength={250}
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStepConfirm(null)}>Cancelar</Button>
                  <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => handMove(stepConfirm, noteText.trim())}>
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
            {actionMsg && <p className="text-[11px] text-amber-700">{actionMsg}</p>}
          </div>
        )}

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

      {certOpen && (
        <DeliverCertSheet
          busy={busy}
          uploadEndpoint={uploadHandPod}
          onCancel={() => setCertOpen(false)}
          onSubmit={(payload) =>
            handMove("delivered", payload.note, {
              name: payload.deliveredToName,
              dni: payload.deliveredDni,
              lat: payload.deliveredLat,
              lng: payload.deliveredLng,
              podPhotoUrl: payload.podPhotoUrl,
            })
          }
        />
      )}
    </main>
  );
}
