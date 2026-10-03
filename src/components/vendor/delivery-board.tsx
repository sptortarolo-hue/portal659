"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DeliveryOrder = {
  id: string;
  status: string;
  method: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  total: number;
  items: { name: string; qty: number }[];
  created_at: string;
  assigned_to: string | null;
  delivery_zone_name?: string | null;
  delivery_out_of_area?: boolean | null;
};

/**
 * Módulo exclusivo del repartidor (vendor_staff.role='delivery').
 * Vista multi-repartidor:
 *  - "Disponibles": pedidos delivery en ready/sent sin asignar → botón "Tomar".
 *  - "Mis entregas": pedidos asignados a este repartidor → botón "Entregado".
 * Cada repartidor ve el pool común y se asigna el que va a entregar.
 */
export function DeliveryBoard({ vendorId, userId }: { vendorId: string; userId: string | null }) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  // Punto vivo AUTOMÁTICO: mientras haya pedidos asignados a este repartidor
  // en `sent`, se comparte a todos (sin botón manual). Un solo watch (las
  // coordenadas son las mismas) + un POST por pedido destino.
  const [sharing, setSharing] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [shareError, setShareError] = useState("");
  const [shareBlocked, setShareBlocked] = useState(false);
  // Pulso manual (botón Reintentar): re-evalúa el auto-arranque.
  const [tick, setTick] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const targetsRef = useRef<string[]>([]);

  function stopWatch() {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    lastSentRef.current = null;
    targetsRef.current = [];
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    setSharing(false);
    setShareCount(0);
  }

  // Corta el watch al desmontar (si cambia de pestaña).
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
    };
  }, []);

  function distM(aLat: number, aLng: number, bLat: number, bLng: number) {
    const R = 6371000;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLng = ((bLng - aLng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Postea a todos los destinos (best-effort por pedido: si uno ya se
  // entregó/canceló, el server lo rechaza y el poll de pedidos lo saca de
  // la lista; los demás siguen). 401/403 = sesión vencida: se corta con
  // aviso (no se reintenta solo).
  async function sendPosition(lat: number, lng: number): Promise<boolean> {
    const targets = targetsRef.current;
    if (targets.length === 0 || watchIdRef.current === null) return false;
    let okAny = false;
    let authFailed = false;
    for (const orderId of targets) {
      try {
        const res = await fetch(`/api/vendor/orders/${orderId}/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        if (res.status === 401 || res.status === 403) authFailed = true;
        else if (res.ok) okAny = true;
      } catch {
        /* sin red: se reintenta en el próximo fix */
      }
    }
    if (authFailed) {
      stopWatch();
      setShareBlocked(true);
      setShareError("Sesión vencida: recargá la página para seguir compartiendo.");
      return false;
    }
    return okAny;
  }

  function startWatch() {
    if (watchIdRef.current !== null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShareBlocked(true);
      setShareError("Tu celu/navegador no soporta geolocalización.");
      return;
    }
    // Best-effort: evita que se apague la pantalla mientras reparte.
    (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then(
      (wl) => {
        if (wl) wakeLockRef.current = wl;
      },
      () => {
        /* sin WakeLock: igual se comparte con la pantalla prendida */
      }
    );
    lastSentRef.current = null;

    // Fix inmediato: no espera al primer movimiento (clave al retomar con
    // la pantalla recién prendida).
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (watchIdRef.current === null) return;
        const ok = await sendPosition(pos.coords.latitude, pos.coords.longitude);
        if (ok) lastSentRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const last = lastSentRef.current;
        const now = Date.now();
        if (last && now - last.at < 15_000 && distM(last.lat, last.lng, lat, lng) < 20) return;
        const ok = await sendPosition(lat, lng);
        if (ok) lastSentRef.current = { lat, lng, at: Date.now() };
      },
      (err) => {
        // DENEGADO = no reintentar solo (el poll de pedidos lo reintentaría
        // cada 15s): aviso persistente + botón Reintentar.
        if (err.code === err.PERMISSION_DENIED) {
          stopWatch();
          setShareBlocked(true);
          setShareError("Permiso de ubicación denegado: permitilo para compartir el recorrido.");
        }
        // Error transitorio (GPS apagado/sin señal): el watch sigue vivo y
        // retoma solo; solo se avisa.
        else {
          setShareError("Sin señal GPS por ahora: se sigue intentando solo.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setShareBlocked(false);
    setShareError("");
    setSharing(true);
  }

  function retrySharing() {
    setShareBlocked(false);
    setShareError("");
    lastSentRef.current = null;
    // El efecto de abajo arranca el watch si hay destinos.
    setTick((t) => t + 1);
  }

  async function load() {
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) {
        setOrders(
          (data.orders as DeliveryOrder[])
            .filter((o) => o.method === "delivery" && (o.status === "ready" || o.status === "sent"))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        );
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  // Reconciliación automática: con pedidos asignados a mí en `sent` el
  // watch tiene que estar prendido; sin ellos, apagado. Corre en cada
  // carga de pedidos (poll 15s) + reintento manual. Sin botón: el usuario
  // no prende/apaga nada.
  useEffect(() => {
    const targets = orders
      .filter((o) => o.method === "delivery" && o.status === "sent" && o.assigned_to === userId)
      .map((o) => o.id);
    targetsRef.current = targets;
    setShareCount(targets.length);
    if (targets.length === 0) {
      if (watchIdRef.current !== null) stopWatch();
      return;
    }
    if (watchIdRef.current === null && !shareBlocked) startWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, userId, shareBlocked, tick]);

  async function claim(orderId: string) {
    setMsg("");
    const res = await fetch(`/api/vendor/orders/${orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg("✅ Pedido tomado — ahora es tu entrega");
    else setMsg(`❌ ${data.error || "No se pudo tomar el pedido"}`);
    setTimeout(() => setMsg(""), 3000);
    load();
  }

  async function release(orderId: string) {
    await fetch(`/api/vendor/orders/${orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release" }),
    });
    load();
  }

  async function markDelivered(orderId: string) {
    setMsg("");
    const res = await fetch(`/api/vendor/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) setMsg(`❌ ${data.error}`);
    else {
      setMsg("✅ Pedido entregado");
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    }
    setTimeout(() => setMsg(""), 3000);
  }

  function mapsUrl(o: DeliveryOrder) {
    const addr = o.customer_address;
    if (!addr) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando pedidos a entregar...</p>;

  // Disponibles = sin asignar (los tomó nadie). Míos = asignados a este repartidor.
  const disponibles = orders.filter((o) => !o.assigned_to);
  const mios = orders.filter((o) => o.assigned_to === userId);
  const miosEnCamino = mios.filter((o) => o.status === "sent").length;

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
      {shareError && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          📡 {shareError}{" "}
          {shareBlocked && (
            <button type="button" onClick={retrySharing} className="underline font-semibold">
              Reintentar
            </button>
          )}
        </p>
      )}

      <RepartoAppCard />

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">🛵 Reparto</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {disponibles.length} disponible{disponibles.length !== 1 ? "s" : ""} ·{" "}
          {mios.length} asignado{mios.length !== 1 ? "s" : ""} a vos.
        </p>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🛵</div>
          <p className="text-muted-foreground text-sm">No hay pedidos para entregar ahora.</p>
        </div>
      )}

      {/* Disponibles (pool común) */}
      {disponibles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <span className="text-base">🟡</span> Disponibles para tomar
          </h3>
          <div className="space-y-2">
            {disponibles.map((o) => (
              <DeliveryCard
                key={o.id}
                o={o}
                mapsUrl={mapsUrl(o)}
                action={
                  <Button size="sm" className="flex-1" onClick={() => claim(o.id)}>
                    🙋 Tomar pedido
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Estado del punto vivo: automático, sin botón. */}
      {sharing ? (
        <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 animate-pulse">
          🛰️ Compartiendo ubicación en vivo{shareCount > 1 ? ` (${shareCount} pedidos)` : ""} · se apaga sola al entregar
        </p>
      ) : (
        mios.length > 0 && (
          <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
            🛰️ La ubicación se comparte sola cuando el local despacha (En camino).
          </p>
        )
      )}

      {/* Mis entregas */}
      {mios.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <span className="text-base">🟢</span> Mis entregas
          </h3>
          <div className="space-y-2">
            {mios.map((o) => (
              <DeliveryCard
                key={o.id}
                o={o}
                mapsUrl={mapsUrl(o)}
                live={sharing && o.status === "sent"}
                action={
                  <div className="flex flex-1 gap-2">
                    <Button size="sm" className="flex-1" onClick={() => markDelivered(o.id)}>
                      ✅ Entregado
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => release(o.id)} title="Devolver al pool">
                      ↩︎
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryCard({
  o,
  mapsUrl,
  action,
  live,
}: {
  o: DeliveryOrder;
  mapsUrl: string | null;
  action: React.ReactNode;
  /** La ubicación de este pedido se está compartiendo ahora. */
  live?: boolean;
}) {
  // El punto vivo solo existe en `sent` (el server lo exige): es automático,
  // sin botón. La tarjeta solo indica si este pedido se está compartiendo.
  return (
    <div className="border border-border rounded-xl p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium text-sm">{o.customer_name}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            {o.customer_phone && <> · {o.customer_phone}</>}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs font-bold">
          ${Number(o.total).toLocaleString("es-AR")}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-1">
        {(o.items || []).map((i) => (i as any).unit === "kg" ? `${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg ${i.name}` : `${i.qty}x ${i.name}`).join(", ")}
      </p>

      {o.customer_address && <p className="text-xs mb-2">📍 {o.customer_address}</p>}
      {(o.delivery_zone_name || o.delivery_out_of_area) && (
        <p className="text-xs mb-2 font-semibold">
          {o.delivery_out_of_area ? (
            <span className="text-amber-700">⚠️ Otra zona — envío a convenir</span>
          ) : (
            <span className="text-blue-700">🗺️ {o.delivery_zone_name}</span>
          )}
        </p>
      )}

      <div className="flex gap-2">
        {o.customer_phone && (
          <a
            href={`https://wa.me/${o.customer_phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center rounded-lg border border-green-200 bg-green-50 text-green-700 px-2 py-1.5 text-xs font-medium"
          >
            💬 WhatsApp
          </a>
        )}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-2 py-1.5 text-xs font-medium"
          >
            🗺️ Mapa
          </a>
        )}
        {action}
      </div>
      {live && (
        <p className="mt-2 text-[11px] font-semibold text-emerald-700">
          🛰️ <span className="animate-pulse">Compartiendo ubicación en vivo</span>
        </p>
      )}
    </div>
  );
}

/**
 * Tarjeta de la app Reparto: el botón web comparte solo con la pantalla
 * prendida; la app nativa sigue con pantalla apagada. Solo Android muestra
 * la descarga (iPhone: respaldo por WhatsApp al local). Dismiss persistido.
 */
function RepartoAppCard() {
  const [dismissed, setDismissed] = useState(false);
  const [kind, setKind] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    try {
      if (localStorage.getItem("portal659-reparto-app-dismissed") === "1") setDismissed(true);
    } catch {
      /* noop */
    }
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/Android/i.test(ua)) setKind("android");
    else if (/iPhone|iPad|iPod/i.test(ua)) setKind("ios");
  }, []);

  if (dismissed || kind === "other") return null;

  function dismiss() {
    try {
      localStorage.setItem("portal659-reparto-app-dismissed", "1");
    } catch {
      /* noop */
    }
    setDismissed(true);
  }

  if (kind === "ios") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <p className="font-semibold mb-1">📱 Estás en iPhone</p>
        <p>
          La ubicación en vivo funciona con esta pantalla abierta. Como respaldo,
          compartí tu ubicación en vivo por WhatsApp al local cuando salgas a repartir.
        </p>
        <button type="button" onClick={dismiss} className="mt-1 font-medium underline">
          Entendido
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">📲 App Portal Reparto</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comparte tu ubicación con la pantalla apagada. Instalala una vez:
            la ubicación se comparte sola en cada entrega.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ocultar"
          className="text-muted-foreground text-lg leading-none px-1"
        >
          ×
        </button>
      </div>
      <a
        href="/downloads/portal-reparto.apk?v=2"
        className="mt-2 block text-center rounded-lg bg-violet-600 text-white px-2 py-2 text-sm font-semibold"
      >
        ⬇️ Descargar para Android
      </a>
      <p className="text-[11px] text-muted-foreground mt-1 text-center">
        Al instalar permití ubicación “siempre” y sacá la optimización de batería.
      </p>
    </div>
  );
}