"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorShipmentsMap, type OperatorMapPin } from "@/components/envios/operator-shipments-map";
import { DeliverCertSheet } from "@/components/envios/deliver-cert-sheet";
import {
  mapsDirectionsUrl,
  mapsDirectionsUrlFromCoords,
  waUrlFromPhone,
  buyerVoyText,
} from "@/lib/shipping-geo";

/**
 * Panel del operador de logística (Portal 659 Envíos): lista/mapa de encargos
 * de su carrier y avance de estados. Tarjetas centradas en el destinatario
 * (nombre + dirección + WhatsApp), sin datos del local — solo un plegable
 * "Colectar en" cuando el paquete aún está en el comercio. La entrega se
 * certifica (nombre + DNI + GPS) y el flujo exige En camino antes de
 * Entregar. Acceso por login normal del portal con rol de operador
 * (carrier_operators).
 */

type ShipmentRow = {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  zoneName: string | null;
  requestedAt: string;
  storeName: string | null;
  storeAddress: string | null;
  vendorLat: number | null;
  vendorLng: number | null;
  carrierName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  destLat: number | null;
  destLng: number | null;
  orderNumber: number | null;
  items: { name: string; qty: number; price: number }[];
  total: number;
  deliveredToName: string | null;
  deliveredDni: string | null;
  deliveredLat: number | null;
  deliveredLng: number | null;
  deliveredGeoOk: boolean;
};

type CarrierRow = { id: string; name: string };

type LoadData = {
  shipments: ShipmentRow[];
  carriers: CarrierRow[];
  ready: boolean;
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

/**
 * Transiciones del panel (espejo server: Entregar exige En camino — nunca
 * Colectado→Entregado ni Reintentar→Entregado directo).
 */
const NEXT_STEPS: Record<string, { to: string; label: string }[]> = {
  requested: [
    { to: "picked_up", label: "📦 Colectado" },
    { to: "returned", label: "↩️ Devolver" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
  picked_up: [
    { to: "in_transit", label: "🚚 En camino" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
    { to: "returned", label: "↩️ Devolver" },
  ],
  in_transit: [
    { to: "delivered", label: "✅ Entregar" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
  ],
  failed_attempt: [
    { to: "in_transit", label: "🚚 Reintentar" },
    { to: "returned", label: "↩️ Devolver" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
};

const OPEN_STATUSES = new Set(["requested", "picked_up", "in_transit", "failed_attempt"]);

/** "Hoy"/"Ayer"/"21 oct 10:24" a partir de la fecha del encargo. */
function shipmentDateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const dayOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayOf(now) - dayOf(d)) / 86400000);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diff === 0) return `Hoy ${hhmm}`;
  if (diff === 1) return `Ayer ${hhmm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getMonth()];
  return `${dd} ${mm} ${hhmm}`;
}

export default function EnviosOperadorPage() {
  const [data, setData] = useState<LoadData | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [certS, setCertS] = useState<ShipmentRow | null>(null);
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const [focused, setFocused] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/shipments/operator");
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Iniciá sesión en Portal 659 con tu cuenta de operador.");
        setData(null);
        return;
      }
      if (!res.ok) {
        setError(j.error || "Error al cargar");
        setData(null);
        return;
      }
      const shipments: ShipmentRow[] = Array.isArray(j?.shipments) ? j.shipments : [];
      setData({ shipments, carriers: Array.isArray(j?.carriers) ? j.carriers : [], ready: j.ready !== false });
      setError("");
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function moveShipment(
    s: ShipmentRow,
    to: string,
    note: string,
    cert?: { name: string; dni: string; lat: number; lng: number; podPhotoUrl: string | null }
  ) {
    setBusyId(`${s.id}`);
    setRowMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      const res = await fetch("/api/shipments/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId: s.id,
          status: to,
          note: note || undefined,
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
        setRowMsg((m) => ({ ...m, [s.id]: j.error || "No se pudo actualizar" }));
      } else {
        setShowNoteFor(null);
        setNoteText("");
        setCertS(null);
        await fetchData();
      }
    } catch {
      setRowMsg((m) => ({ ...m, [s.id]: "Error de red" }));
    } finally {
      setBusyId(null);
    }
  }

  /** Subida de la foto POD (endpoint con login del operador). */
  async function uploadOperatorPod(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/shipment-upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      return res.ok ? (j.url as string) : null;
    } catch {
      return null;
    }
  }

  if (data && data.carriers.length === 0 && data.ready) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-4 bg-background text-center">
        <p className="text-sm text-muted-foreground">
          Tu cuenta no está vinculada a una logística partner. Pedile al equipo de Portal 659 el alta como operador.
        </p>
        <Link href="/">
          <Button size="sm" variant="outline">← Ir a Portal 659</Button>
        </Link>
      </main>
    );
  }

  const open = (data?.shipments || []).filter((s) => OPEN_STATUSES.has(s.status));
  const closed = (data?.shipments || []).filter((s) => !OPEN_STATUSES.has(s.status)).slice(0, 30);
  const pins: OperatorMapPin[] = open
    .filter((s) => s.destLat != null && s.destLng != null)
    .map((s) => ({
      id: s.id,
      code: s.code,
      customerName: s.customerName,
      status: s.status,
      dest: { lat: s.destLat as number, lng: s.destLng as number },
    }));
  const visibleCards = view === "lista" ? open : focused ? open.filter((s) => s.id === focused) : [];

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">🚚 Portal 659 Envíos</h1>
            <p className="text-xs text-muted-foreground">
              {data?.carriers ? `${data.carriers.map((c) => c.name).join(" · ")}` : "Operador"}
              {" · "}{open.length} en curso
            </p>
          </div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">Salir</Link>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}

        {/* Toggle Lista / Mapa */}
        <div className="flex gap-2">
          <Button size="sm" variant={view === "lista" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setView("lista")}>
            📋 Lista
          </Button>
          <Button size="sm" variant={view === "mapa" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setView("mapa")}>
            🗺️ Mapa
          </Button>
        </div>

        {view === "mapa" && <OperatorShipmentsMap pins={pins} focusId={focused} onSelectPin={(id) => setFocused(id)} />}

        {/* Instrucciones (colapsable) */}
        <details className="rounded-xl border border-border bg-background px-3 py-2">
          <summary className="text-xs font-semibold cursor-pointer">¿Cómo uso el panel?</summary>
          <ul className="text-[11px] text-muted-foreground mt-2 space-y-1 list-disc pl-4">
            <li>Retirá los paquetes del local y marcalos <b>📦 Colectado</b>. Ahí mismo los pones <b>🚚 En camino</b> antes de repartir.</li>
            <li>En el <b>🗺️ Mapa</b> ves cada dirección con pin (solo se ubican las que el sistema pudo geocodificar).</li>
            <li>Antes de llegar, avisale al comprador con <b>💬 WhatsApp</b> ("viene en camino") y navegá con <b>🚗 Cómo llegar</b>.</li>
            <li>Al entregar: <b>✅ Entregar</b> pide <b>quién recibió + DNI + GPS</b> (y la foto opcional del paquete). Sin DNI ni GPS no se cierra.</li>
            <li>Si nadie recibe: <b>⚠️ No entregado</b> y después reintentás (primero En camino otra vez) o devolvés al local.</li>
          </ul>
        </details>

        {view === "lista" && data && data.shipments.length === 0 && (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">Todavía no tenés encargos pendientes 🎉</p>
          </div>
        )}

        {visibleCards.map((s) => (
          <div key={s.id} className="rounded-2xl border border-border bg-background p-3.5 space-y-2.5 shadow-sm">
            {/* Encabezado chico: chip de estado + código + volver */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] px-2 py-1 rounded-full bg-violet-100 text-violet-900 font-semibold whitespace-nowrap">
                {STATUS_ICON[s.status]} {s.statusLabel}
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] text-muted-foreground font-mono truncate">{s.code}</span>
                {focused && (
                  <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setFocused(null); setView("lista"); }}>
                    ← lista
                  </button>
                )}
              </div>
            </div>

            {/* Datos de entrega: destinatario protagonista */}
            <div className="space-y-1">
              <p className="text-lg font-bold leading-tight">Entregar a: {s.customerName || "—"}</p>
              <div className="rounded-xl bg-muted/40 p-2.5">
                <p className="text-sm font-medium leading-snug break-words">{s.customerAddress || "Sin dirección"}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(() => {
                    const destUrl = s.destLat != null && s.destLng != null
                      ? mapsDirectionsUrlFromCoords(s.destLat, s.destLng)
                      : s.customerAddress ? mapsDirectionsUrl(s.customerAddress) : null;
                    return destUrl ? (
                      <a href={destUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" className="h-8 text-xs px-3">🗺️ Mapa</Button>
                      </a>
                    ) : null;
                  })()}
                  {(() => {
                    const destUrl = s.destLat != null && s.destLng != null
                      ? mapsDirectionsUrlFromCoords(s.destLat, s.destLng)
                      : s.customerAddress ? mapsDirectionsUrl(s.customerAddress) : null;
                    return destUrl ? (
                      <a href={destUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-8 text-xs px-3">🚗 Cómo llegar</Button>
                      </a>
                    ) : null;
                  })()}
                  {(() => {
                    const wa = s.customerPhone
                      ? waUrlFromPhone(s.customerPhone, buyerVoyText(s.code, s.storeName))
                      : null;
                    return wa ? (
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-8 text-xs px-3">💬 WhatsApp</Button>
                      </a>
                    ) : null;
                  })()}
                </div>
                {s.customerPhone && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">Tel: {s.customerPhone}</p>
                )}
              </div>
              {/* Meta: tipo de envío + fecha */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border">🏠 Entrega a domicilio · {s.zoneName || "Zona extendida"}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border">📅 {shipmentDateLabel(s.requestedAt)}</span>
              </div>
              {/* Colecta: solo hasta que el paquete sale del local */}
              {s.status === "requested" && (s.storeName || s.storeAddress) && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">🏪 Colectar en: {s.storeName || "el local"}</summary>
                  <p className="pl-3 pt-1">{s.storeAddress}</p>
                  {s.vendorLat != null && s.vendorLng != null && (
                    <a
                      className="pl-3 underline"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${s.vendorLat},${s.vendorLng}&travelmode=driving`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🚗 Cómo llegar al local
                    </a>
                  )}
                </details>
              )}
            </div>

            {/* Acciones de flujo (full width, en el orden que toca) */}
            <div className="space-y-1.5">
              {(NEXT_STEPS[s.status] || []).map((step) => (
                <Button
                  key={step.to}
                  size="sm"
                  variant={step.to === "delivered" || (step.to === "picked_up" && s.status === "requested") ? "default" : "outline"}
                  className="w-full h-10 text-sm"
                  disabled={busyId !== null}
                  onClick={() => {
                    if (step.to === "delivered") {
                      setCertS(s);
                    } else {
                      setShowNoteFor(`${s.id}:${step.to}`);
                      setNoteText("");
                    }
                  }}
                >
                  {step.label}
                </Button>
              ))}
            </div>
            {showNoteFor?.startsWith(`${s.id}:`) && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-xs font-medium">
                  {NEXT_STEPS[s.status].find((n) => `${s.id}:${n.to}` === showNoteFor)?.label} — nota (opcional):
                </p>
                <textarea
                  className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 min-h-16"
                  placeholder="Ej: no estaba el destinatario / firmó el portero / reprogramó para mañana"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  maxLength={250}
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNoteFor(null)}>Cancelar</Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busyId !== null}
                    onClick={() => {
                      const to = showNoteFor.split(":")[1];
                      moveShipment(s, to, noteText.trim());
                    }}
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
            {rowMsg[s.id] && <p className="text-[11px] text-amber-700">{rowMsg[s.id]}</p>}
          </div>
        ))}

        {/* Certificado de entrega ( compartido con la hoja del repartidor) */}
        {certS && (
          <DeliverCertSheet
            busy={busyId !== null}
            uploadEndpoint={uploadOperatorPod}
            onCancel={() => setCertS(null)}
            onSubmit={(payload) => {
              const s = certS;
              if (s) {
                moveShipment(s, "delivered", payload.note, {
                  name: payload.deliveredToName,
                  dni: payload.deliveredDni,
                  lat: payload.deliveredLat,
                  lng: payload.deliveredLng,
                  podPhotoUrl: payload.podPhotoUrl,
                });
              }
            }}
          />
        )}

        {/* Cerrados */}
        {closed.length > 0 && view === "lista" && (
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-semibold mb-2 text-muted-foreground">Recientes</p>
            <div className="space-y-1.5">
              {closed.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono tracking-wide">{s.code}</span>
                  <span className="truncate text-muted-foreground">
                    {s.status === "delivered" && s.deliveredToName ? `Entregado a ${s.deliveredToName}` : s.zoneName || ""}
                  </span>
                  <span className="whitespace-nowrap">{STATUS_ICON[s.status]} {s.statusLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Los pedidos asociados se sincronizan en el panel del comercio automáticamente.
        </p>
      </div>
    </main>
  );
}
