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
  // Punto vivo: solo un pedido compartiendo a la vez (el que se va a entregar).
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const activeShareRef = useRef<string | null>(null);
  const resumeTriedRef = useRef(false);

  const SHARE_KEY = "portal659-sharing-order";

  function stopSharing() {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    lastSentRef.current = null;
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    try {
      localStorage.removeItem(SHARE_KEY);
    } catch {
      /* storage no disponible: nada que limpiar */
    }
    activeShareRef.current = null;
    setSharingId(null);
  }

  // Corta el watch al desmontar (si cambia de pestaña sin pausar).
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

  async function sendPosition(orderId: string, lat: number, lng: number) {
    try {
      const res = await fetch(`/api/vendor/orders/${orderId}/position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El server solo acepta en `sent`: si el local aún no lo despachó
        // (o ya se entregó), se corta solo mostrando el motivo.
        stopSharing();
        setShareError(data.error || "No se pudo compartir la ubicación.");
        return false;
      }
      return true;
    } catch {
      return false; // sin red: se reintenta en el próximo fix (best-effort)
    }
  }

  async function startSharing(orderId: string) {
    setShareError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShareError("Tu celu/navegador no soporta geolocalización.");
      return;
    }
    // Best-effort: evita que se apague la pantalla mientras reparte.
    try {
      const wl = await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen");
      if (wl) wakeLockRef.current = wl;
    } catch {
      /* sin WakeLock: igual se comparte con la pantalla prendida */
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastSentRef.current = null;
    try {
      localStorage.setItem(SHARE_KEY, orderId);
    } catch {
      /* sin storage: el sharing vive igual hasta recargar */
    }

    // Fix inmediato: no espera al primer movimiento (clave al retomar con
    // la pantalla recién prendida o al abrir desde el push-nudge).
    activeShareRef.current = orderId;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (activeShareRef.current !== orderId) return;
        const ok = await sendPosition(orderId, pos.coords.latitude, pos.coords.longitude);
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
        const ok = await sendPosition(orderId, lat, lng);
        if (ok !== false) lastSentRef.current = { lat, lng, at: Date.now() };
      },
      (err) => {
        stopSharing();
        setShareError(
          err.code === err.PERMISSION_DENIED
            ? "Permiso de ubicación denegado: activalo para compartir el recorrido."
            : "No se pudo obtener tu ubicación (GPS apagado o sin señal)."
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setSharingId(orderId);
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

  // Auto-resume: si se recargó la página (o se reabrió desde el push-nudge)
  // con un sharing pendiente y el pedido sigue En camino + asignado,
  // se retoma solo. Si ya no aplica, se limpia el pendiente.
  useEffect(() => {
    if (loading || resumeTriedRef.current || activeShareRef.current) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem(SHARE_KEY);
    } catch {
      return;
    }
    if (!pending) return;
    resumeTriedRef.current = true;
    const o = orders.find((x) => x.id === pending);
    if (o && o.status === "sent" && o.method === "delivery" && o.assigned_to === userId) {
      setMsg("📡 Retomando ubicación en vivo…");
      setTimeout(() => setMsg(""), 3000);
      startSharing(pending);
    } else {
      try {
        localStorage.removeItem(SHARE_KEY);
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orders, userId]);

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
    if (sharingId === orderId) stopSharing();
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
      if (sharingId === orderId) stopSharing();
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

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
      {shareError && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">📡 {shareError}</p>}

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
                sharing={sharingId === o.id}
                onToggleShare={() => (sharingId === o.id ? stopSharing() : startSharing(o.id))}
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
  sharing,
  onToggleShare,
}: {
  o: DeliveryOrder;
  mapsUrl: string | null;
  action: React.ReactNode;
  sharing?: boolean;
  onToggleShare?: () => void;
}) {
  // El punto vivo solo existe en `sent` (el server lo exige): antes de que el
  // local despache, el botón explica que se activa solo.
  const canShare = o.status === "sent";
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
      {onToggleShare && (
        <button
          type="button"
          onClick={onToggleShare}
          disabled={!canShare && !sharing}
          title={
            sharing
              ? "Dejar de compartir tu ubicación"
              : canShare
                ? "Compartir tu ubicación en vivo con el local y el cliente"
                : "Se activa cuando el local despacha el pedido (En camino)"
          }
          className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            sharing
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 animate-pulse"
              : "border-violet-200 bg-violet-50 text-violet-700"
          }`}
        >
          {sharing ? "🛰️ Compartiendo ubicación… (tocá para pausar)" : canShare ? "🛰️ Compartir mi ubicación" : "🛰️ Ubicación en vivo (se activa al despachar)"}
        </button>
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
            Comparte tu ubicación con la pantalla apagada. Instalala una vez y
            usá “Compartir ubicación” desde la app en cada entrega.
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
        href="/downloads/portal-reparto.apk?v=1"
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