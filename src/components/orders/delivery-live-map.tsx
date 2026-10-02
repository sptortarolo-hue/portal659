"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  storeName: string;
  vendorLat: number | null;
  vendorLng: number | null;
  courierLat: number;
  courierLng: number;
  courierUpdatedAt: string | null;
};

function ageText(iso: string | null): string {
  if (!iso) return "recién";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "ahora mismo";
  if (s < 60) return `hace ${s} seg`;
  const m = Math.floor(s / 60);
  return m === 1 ? "hace 1 min" : `hace ${m} min`;
}

/** Distancia recta en metros (sin ruta: la dirección del cliente es texto). */
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function distText(m: number): string {
  if (m < 1000) return `a ${Math.round(m / 10) * 10} m del local`;
  return `a ${(m / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} km del local`;
}

/**
 * Punto vivo del repartidor: mapa OSM (sin keys) con el local y la moto.
 * Solo se monta cuando hay posición (el padre decide), y se actualiza con
 * el polling de 15s del seguimiento. Sin ruta ni historial: último punto.
 */
export function DeliveryLiveMap({
  storeName,
  vendorLat,
  vendorLng,
  courierLat,
  courierLng,
  courierUpdatedAt,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const courierMarkerRef = useRef<any>(null);
  const [tick, setTick] = useState(0);

  // "Actualizado hace Xs" en vivo.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm", minzoom: 0, maxzoom: 19 }],
        },
        center: [courierLng, courierLat],
        zoom: 15,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      // Pin del local.
      if (vendorLat != null && vendorLng != null) {
        const el = document.createElement("div");
        el.textContent = "🏠";
        el.style.cssText = "font-size:24px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));";
        new maplibregl.Marker({ element: el })
          .setLngLat([vendorLng, vendorLat])
          .setPopup(new maplibregl.Popup({ offset: 20 }).setText(storeName))
          .addTo(map);
      }

      // Pin de la moto (se mueve con cada update).
      const moto = document.createElement("div");
      moto.textContent = "🛵";
      moto.style.cssText =
        "font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));" +
        "background:#fff;border-radius:50%;width:44px;height:44px;" +
        "display:flex;align-items:center;justify-content:center;" +
        "border:3px solid #7c3aed;animation:moto-pulse 1.6s ease-in-out infinite;";
      const style = document.createElement("style");
      style.textContent =
        "@keyframes moto-pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.5)}50%{box-shadow:0 0 0 10px rgba(124,58,237,0)}}";
      document.head.appendChild(style);
      courierMarkerRef.current = new maplibregl.Marker({ element: moto })
        .setLngLat([courierLng, courierLat])
        .addTo(map);

      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        courierMarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mover la moto + encuadrar ambos puntos en cada update del polling.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !courierMarkerRef.current) return;
    courierMarkerRef.current.setLngLat([courierLng, courierLat]);
    if (vendorLat != null && vendorLng != null) {
      import("maplibre-gl").then((maplibregl) => {
        const b = new maplibregl.LngLatBounds();
        b.extend([courierLng, courierLat]);
        b.extend([vendorLng, vendorLat]);
        map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 800 });
      });
    } else {
      map.flyTo({ center: [courierLng, courierLat], zoom: 15, duration: 800 });
    }
  }, [courierLat, courierLng, vendorLat, vendorLng]);

  const stale = !courierUpdatedAt || Date.now() - new Date(courierUpdatedAt).getTime() > 90_000;
  const hasVendor = vendorLat != null && vendorLng != null;
  const dist = hasVendor ? distText(distM(courierLat, courierLng, vendorLat, vendorLng)) : null;

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/50 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-sm font-semibold">🛵 Tu pedido va en camino</p>
        <span className={`text-[11px] font-medium ${stale ? "text-amber-600" : "text-emerald-600"}`}>
          {stale ? `⚠️ ubicación de ${ageText(courierUpdatedAt)}` : `● en vivo · ${ageText(courierUpdatedAt)}`}
        </span>
      </div>
      <div ref={containerRef} className="w-full h-64" />
      <p className="text-[11px] text-muted-foreground px-4 py-2">
        🏠 {storeName}{dist ? ` · la moto está ${dist}` : ""} · se actualiza sola cada ~15 segundos
      </p>
    </div>
  );
}
