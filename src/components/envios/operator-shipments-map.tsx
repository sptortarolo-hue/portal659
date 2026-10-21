"use client";

import { useEffect, useRef, useState } from "react";

export type OperatorMapPin = {
  id: string;
  code: string;
  customerName: string | null;
  status: string;
  vendor: { name: string | null; lat: number | null; lng: number | null };
  dest: { lat: number; lng: number } | null;
};

type Props = {
  pins: OperatorMapPin[];
  /** Envío resaltado (tap en la lista → pin centrado). */
  focusId?: string | null;
  onSelectPin?: (id: string) => void;
};

/**
 * Mapa de paradas del operador (Portal 659 Envíos): 🏪 pin del local de
 * retiro + 📦 pin del destino geocodificado de cada envío en curso.
 * Sin keys (raster OSM, mismo estilo que el mapa vivo del reparto). El pin
 * destino solo aparece cuando la dirección se pudo geocodificar; los envíos
 * sin coords quedan solo en la lista (con el link "Cómo llegar").
 */
export function OperatorShipmentsMap({ pins, focusId, onSelectPin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const lastKeyRef = useRef("");
  const [mapReady, setMapReady] = useState(0);

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
        center: [-58.38, -34.6],
        zoom: 11,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("load", () => setMapReady((n) => n + 1));
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = [];
        lastKeyRef.current = "";
      }
    };
  }, []);

  // Pins según el listado (re-render si cambian o carga el mapa).
  useEffect(() => {
    import("maplibre-gl").then((maplibregl) => {
      const map = mapRef.current;
      if (!map) return;

      const key = pins.map((p) => `${p.id}:${p.status}:${p.dest?.lat ?? ""},${p.dest?.lng ?? ""}`).join("|");
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;

      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      const b = new maplibregl.LngLatBounds();

      for (const p of pins) {
        // Local de retiro (una vez por combinación de local/pin: cada envío
        // tiene su propio par, repetir 🏪 es ruido — se repite por envío
        // porque cada uno puede retirar en un local distinto).
        if (p.vendor.lat != null && p.vendor.lng != null) {
          const el = document.createElement("div");
          el.textContent = "🏪";
          el.style.cssText = "font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));cursor:pointer;";
          el.onclick = () => onSelectPin?.(p.id);
          markersRef.current.push(
            new maplibregl.Marker({ element: el })
              .setLngLat([p.vendor.lng, p.vendor.lat])
              .setPopup(
                new maplibregl.Popup({ offset: 18 }).setHTML(
                  `<div style="font-size:12px"><b>Retiro</b><br/>${p.vendor.name || ""}<br/><span style="color:#666">${p.code}</span></div>`
                )
              )
              .addTo(map)
          );
          b.extend([p.vendor.lng, p.vendor.lat]);
        }

        // Destino (solo si la dirección geocodificó).
        if (p.dest) {
          const el = document.createElement("div");
          el.textContent = p.status === "in_transit" ? "🚚" : "📦";
          el.style.cssText =
            "font-size:20px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));cursor:pointer;" +
            "background:#fff;border-radius:50%;width:34px;height:34px;" +
            "display:flex;align-items:center;justify-content:center;border:2px solid #7c3aed;";
          el.onclick = () => onSelectPin?.(p.id);
          markersRef.current.push(
            new maplibregl.Marker({ element: el })
              .setLngLat([p.dest.lng, p.dest.lat])
              .setPopup(
                new maplibregl.Popup({ offset: 18 }).setHTML(
                  `<div style="font-size:12px"><b>${p.code}</b><br/>${p.customerName || ""}<br/><span style="color:#666">Tocá en la lista para operar</span></div>`
                )
              )
              .addTo(map)
          );
          b.extend([p.dest.lng, p.dest.lat]);
        }
      }

      if (!b.isEmpty()) {
        map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
      }
    });
  }, [pins, onSelectPin, mapReady]);

  // Focus desde la lista: centrar el pin destino/retiro de ese envío.
  useEffect(() => {
    if (!focusId) return;
    import("maplibre-gl").then((maplibregl) => {
      const map = mapRef.current;
      const p = pins.find((x) => x.id === focusId);
      if (!map || !p) return;
      const target = p.dest
        ? [p.dest.lng, p.dest.lat]
        : p.vendor.lat != null && p.vendor.lng != null
          ? [p.vendor.lng, p.vendor.lat]
          : null;
      if (target) {
        map.flyTo({ center: target, zoom: 15.5, duration: 600 });
      }
    });
  }, [focusId, pins]);

  const withDest = pins.filter((p) => p.dest).length;

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div ref={containerRef} className="w-full h-80 sm:h-96" />
      <p className="text-[11px] text-muted-foreground px-3 py-2">
        🏪 retiro · 📦 entregá en ese punto{withDest < pins.length ? ` · ${pins.length - withDest} sin pin (usá "Cómo llegar" de la tarjeta)` : ""}
      </p>
    </div>
  );
}
