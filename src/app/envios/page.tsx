"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorShipmentsMap, type OperatorMapPin } from "@/components/envios/operator-shipments-map";
import {
  mapsDirectionsUrl,
  mapsDirectionsUrlFromCoords,
  waUrlFromPhone,
  telUrl,
  buyerVoyText,
} from "@/lib/shipping-geo";

/**
 * Panel del operador de logística (Portal 659 Envíos): lista/mapa de encargos
 * de su carrier y avance de estados. Entrega certificada estilo Mercado
 * Envíos Flex: quién recibió + DNI (sin foto del documento) + GPS del
 * celular. Acceso por login normal del portal con rol de operador
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
  vendorWhatsapp: string | null;
  carrierName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  destLat: number | null;
  destLng: number | null;
  deliveryWindow: string | null;
  orderNumber: number | null;
  items: { name: string; qty: number; price: number; combo_members?: { name: string; qty: number }[] }[];
  total: number;
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

const NEXT_STEPS: Record<string, { to: string; label: string }[]> = {
  requested: [
    { to: "picked_up", label: "📦 Colectado" },
    { to: "in_transit", label: "🚚 En camino" },
    { to: "returned", label: "↩️ Devuelto" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
  picked_up: [
    { to: "in_transit", label: "🚚 En camino" },
    { to: "delivered", label: "✅ Entregar" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
    { to: "returned", label: "↩️ Devuelto" },
  ],
  in_transit: [
    { to: "delivered", label: "✅ Entregar" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
  ],
  failed_attempt: [
    { to: "in_transit", label: "🚚 Reintentar" },
    { to: "delivered", label: "✅ Entregar" },
    { to: "returned", label: "↩️ Devuelto" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
};

const OPEN_STATUSES = new Set(["requested", "picked_up", "in_transit", "failed_attempt"]);

export default function EnviosOperadorPage() {
  const [data, setData] = useState<LoadData | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [podPhotos, setPodPhotos] = useState<Record<string, string>>({});
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const [focused, setFocused] = useState<string | null>(null);
  // Sheet de certificado de entrega (status delivered).
  const [certFor, setCertFor] = useState<string | null>(null);
  const [certName, setCertName] = useState("");
  const [certDni, setCertDni] = useState("");
  const [certNote, setCertNote] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsMsg, setGpsMsg] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);

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
    cert?: { name: string; dni: string; lat: number; lng: number }
  ) {
    setBusyId(`${s.id}:${to}`);
    setRowMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      const res = await fetch("/api/shipments/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId: s.id,
          status: to,
          note: note || undefined,
          podPhotoUrl: podPhotos[s.id] || undefined,
          ...(cert ? { deliveredToName: cert.name, deliveredDni: cert.dni, deliveredLat: cert.lat, deliveredLng: cert.lng } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [s.id]: j.error || "No se pudo actualizar" }));
      } else {
        setShowNoteFor(null);
        setNoteText("");
        closeCert();
        await fetchData();
      }
    } catch {
      setRowMsg((m) => ({ ...m, [s.id]: "Error de red" }));
    } finally {
      setBusyId(null);
    }
  }

  /** Captura del punto exacto del operativo (obligatorio al entregar). */
  function captureGps() {
    setGpsBusy(true);
    setGpsMsg("");
    if (!("geolocation" in navigator)) {
      setGpsMsg("Tu navegador no soporta ubicación: probá desde Chrome en el celular.");
      setGpsBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setGpsMsg("📍 Ubicación capturada");
        setGpsBusy(false);
      },
      (err) => {
        setGps(null);
        setGpsMsg(
          err.code === 1
            ? "Permiso de ubicación denegado: habilitalo en el navegador para certificar la entrega."
            : "No pudimos leer el GPS. Verificá que la ubicación del celular esté activa y reintentá."
        );
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
    );
  }

  function openCert(s: ShipmentRow) {
    setCertFor(s.code);
    setCertName("");
    setCertDni("");
    setCertNote("");
    setGps(null);
    setGpsMsg("");
    captureGps();
  }

  function closeCert() {
    setCertFor(null);
  }

  async function uploadPod(shipmentId: string, file: File) {
    setRowMsg((m) => ({ ...m, [shipmentId]: "" }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/shipment-upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [shipmentId]: j.error || "No se pudo subir la foto" }));
        return;
      }
      setPodPhotos((p) => ({ ...p, [shipmentId]: j.url }));
      setRowMsg((m) => ({ ...m, [shipmentId]: "📷 Foto cargada" }));
    } catch {
      setRowMsg((m) => ({ ...m, [shipmentId]: "Error de red al subir la foto" }));
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
  const pins: OperatorMapPin[] = open.map((s) => ({
    id: s.id,
    code: s.code,
    customerName: s.customerName,
    status: s.status,
    vendor: { name: s.storeName, lat: s.vendorLat, lng: s.vendorLng },
    dest: s.destLat != null && s.destLng != null ? { lat: s.destLat, lng: s.destLng } : null,
  }));
  const certPendingCode = certFor;

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

        {/* Instrucciones (colapsable, estilo instructivo Mercadolibre) */}
        <details className="rounded-xl border border-border bg-background px-3 py-2">
          <summary className="text-xs font-semibold cursor-pointer">¿Cómo uso el panel?</summary>
          <ul className="text-[11px] text-muted-foreground mt-2 space-y-1 list-disc pl-4">
            <li>Retirá los paquetes y marcalos <b>📦 Colectado</b> al salir.</li>
            <li>En el <b>🗺️ Mapa</b> ves cada dirección como pin (📦/🚚) y el 🏪 del local de retiro. Tap en el pin te lleva al detalle de la lista.</li>
            <li>Antes de llegar, tocá <b>💬 WA</b> para avisar al comprador (y <b>🚗 Cómo llegar</b> abre la ruta en Google Maps).</li>
            <li>Al entregar: <b>✅ Entregar</b> pide <b>quién recibió + DNI + tu ubicación GPS</b> (y la foto opcional del paquete en la puerta). Sin DNI ni GPS no se puede cerrar la entrega.</li>
            <li>Si nadie recibe: <b>⚠️ No entregado</b> con la nota de lo que pasó; reintentás luego o devolvés al local.</li>
          </ul>
        </details>

        {view === "lista" && data && data.shipments.length === 0 && (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">Todavía no tenés encargos pendientes 🎉</p>
          </div>
        )}

        {/* Encargos en curso */}
        {(view === "lista" ? open : focused ? open.filter((s) => s.id === focused) : []).map((s) => (
          <div key={s.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-wide">{s.code}{s.orderNumber != null ? ` · #${s.orderNumber}` : ""}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.zoneName || "Zona extendida"} · {s.customerName || "—"}{s.deliveryWindow ? ` · ${s.deliveryWindow}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-100 text-violet-900 whitespace-nowrap">
                  {STATUS_ICON[s.status]} {s.statusLabel}
                </span>
                <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setFocused(null); setView("lista"); }}>
                  ← volver a la lista
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-xs space-y-0.5">
              <p>🏪 Retiro: <b>{s.storeName}</b> · {s.storeAddress}</p>
              <p>📍 Entrego: <b>{s.customerName}</b></p>
              <p className="pl-3 truncate">{s.customerAddress}</p>
              <p>🧾 {s.items.length} ítems · ${s.total.toLocaleString("es-AR")}</p>
            </div>

            {/* Acciones de contacto / navegación */}
            <div className="flex flex-wrap gap-1.5">
              {s.customerPhone && (
                <>
                  {(() => {
                    const tel = telUrl(s.customerPhone);
                    return tel ? (
                      <a href={tel}><Button size="sm" variant="outline" className="h-7 text-xs">📞 Llamar</Button></a>
                    ) : null;
                  })()}
                  {(() => {
                    const wa = waUrlFromPhone(s.customerPhone, buyerVoyText(s.code, s.storeName));
                    return wa ? (
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-7 text-xs">💬 WA comprador</Button>
                      </a>
                    ) : null;
                  })()}
                </>
              )}
              {(() => {
                const destUrl = s.destLat != null && s.destLng != null
                  ? mapsDirectionsUrlFromCoords(s.destLat, s.destLng)
                  : s.customerAddress ? mapsDirectionsUrl(s.customerAddress) : null;
                return destUrl ? (
                  <a href={destUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="h-7 text-xs">🚗 Cómo llegar</Button>
                  </a>
                ) : null;
              })()}
              {(() => {
                const comercianteTel = s.vendorWhatsapp || null;
                const wa = comercianteTel ? waUrlFromPhone(comercianteTel, `Hola! Soy de ${s.carrierName || "la logística"}: sobre el encargo ${s.code} (retiro en tu local). `) : null;
                return wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="h-7 text-xs">💬 Local</Button>
                  </a>
                ) : null;
              })()}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(NEXT_STEPS[s.status] || []).map((step) => (
                <Button
                  key={step.to}
                  size="sm"
                  variant={step.to === "delivered" ? "default" : "outline"}
                  className="h-7 text-xs"
                  disabled={busyId !== null}
                  onClick={() => {
                    if (step.to === "delivered") {
                      openCert(s);
                    } else {
                      setShowNoteFor(`${s.id}:${step.to}`);
                      setNoteText("");
                    }
                  }}
                >
                  {step.label}
                </Button>
              ))}
              {(s.status === "in_transit" || s.status === "picked_up" || s.status === "failed_attempt") && (
                <label className={podPhotos[s.id] ? "text-xs border border-emerald-400 bg-emerald-50 rounded-md px-2 py-1 h-7 cursor-pointer" : "text-xs border border-input rounded-md px-2 py-1 h-7 cursor-pointer hover:bg-muted/50"}>
                  {podPhotos[s.id] ? "📷 Foto ✔" : "📷 Foto"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPod(s.id, f);
                    }}
                  />
                </label>
              )}
            </div>
            {showNoteFor?.startsWith(`${s.id}:`) && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-xs font-medium">{NEXT_STEPS[s.status].find((n) => `${s.id}:${n.to}` === showNoteFor)?.label} — nota (opcional):</p>
                <textarea
                  className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 min-h-16"
                  placeholder="Ej: no estaba el destinatario / firmó el portero / reprogramó para mañana"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  maxLength={300}
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

        {/* Certificado de entrega */}
        {certPendingCode && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={closeCert}>
            <div className="w-full max-w-md rounded-xl bg-background p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div>
                <p className="text-sm font-bold">✅ Certifico la entrega</p>
                <p className="text-[11px] text-muted-foreground">Envío {certPendingCode} · igual que Mercado Libre: identidad por DNI, sin foto del documento ni de la persona.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">¿Quién recibió el paquete? *</label>
                <input
                  className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
                  placeholder="Nombre y apellido (puede no ser el comprador)"
                  value={certName}
                  onChange={(e) => setCertName(e.target.value)}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">DNI de quien recibió *</label>
                <input
                  className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
                  placeholder="Solo números, sin puntos"
                  inputMode="numeric"
                  value={certDni}
                  onChange={(e) => setCertDni(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </div>
              <div className="flex items-center gap-2">
                {gps ? (
                  <span className="text-xs text-emerald-700">📍 GPS listo ({gps.lat}, {gps.lng})</span>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gpsBusy} onClick={captureGps}>
                      📍 Capturar ubicación
                    </Button>
                    {gpsMsg && <span className="text-[11px] text-amber-700">{gpsMsg}</span>}
                  </>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Nota (opcional)</label>
                <input
                  className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
                  placeholder="Ej: firmó el portero / el paquete quedó en recepción"
                  value={certNote}
                  onChange={(e) => setCertNote(e.target.value)}
                  maxLength={300}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={closeCert}>Cancelar</Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={
                    busyId !== null ||
                    certName.trim().length < 3 ||
                    certDni.length < 7 ||
                    gps === null
                  }
                  onClick={() => {
                    const s = open.find((x) => x.code === certPendingCode);
                    if (s && gps) {
                      moveShipment(s, "delivered", certNote.trim(), {
                        name: certName.trim(),
                        dni: certDni,
                        lat: gps.lat,
                        lng: gps.lng,
                      });
                    }
                  }}
                >
                  Confirmar entrega
                </Button>
              </div>
              {(certName.trim().length < 3 || certDni.length < 7 || gps === null) && (
                <p className="text-[11px] text-muted-foreground">Falta {certName.trim().length < 3 ? "el nombre" : certDni.length < 7 ? "el DNI" : "la ubicación GPS"} para confirmar.</p>
              )}
            </div>
          </div>
        )}

        {/* Cerrados */}
        {closed.length > 0 && view === "lista" && (
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-semibold mb-2 text-muted-foreground">Recientes</p>
            <div className="space-y-1.5">
              {closed.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono tracking-wide">{s.code}</span>
                  <span className="truncate text-muted-foreground">{s.zoneName}</span>
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
