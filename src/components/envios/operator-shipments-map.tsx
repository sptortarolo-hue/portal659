"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Mapa de la hoja de ruta del operador (Portal 659 Envíos): un pin por
 * entrego (dirección geocodificada), sin tile server propio — raster OSM
 * gratuito, mismo patrón que el mapa vivo del repartidor. Tap en el pin
 * selecciona el encargo (la tarjeta correspondiente se abre/foca).
 */

export type OperatorMapPin = {
  id: string;
  code: string;
  customerName: string | null;
  status: string;
  dest: { lat: number; lng: number };
};

const STATUS_ICON: Record<string, string> = {
  requested: "📋",
  picked_up: "📦",
  in_transit: "🚚",
  failed_attempt: "⚠️",
  delivered: "✅",
  returned: "↩️",
  cancelled: "❌",
};

type Props = {
  pins: OperatorMapPin[];
  /** Encargo seleccionado: centra el mapa ese pin (flyTo). */
  focusId: string | null;
  onSelectPin: (shipmentId: string) => void;
};

export function OperatorShipmentsMap({ pins, focusId, onSelectPin }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const selectRef = useRef(onSelectPin);
  selectRef.current = onSelectPin;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-58.3662, -34.6629], // Campana/cuenca del Plata RD ajusta con bounds
      zoom: 11,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", () => setMapReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
      markerRefs.current.clear();
    };
  }, []);

  // Marcadores: uno por destino (idempotente; se recrean solo si cambia el set).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const signature = pins.map((p) => `${p.id}:${p.dest.lat},${p.dest.lng}:${p.code}`).sort().join("|");
    const current = Array.from(markerRefs.current.keys()).sort().join("|");
    if (signature === current) return;

    // Limpiar y recrear (los markers son baratos con listas de operación chica).
    for (const marker of markerRefs.current.values()) marker.remove();
    markerRefs.current.clear();

    const b = new maplibregl.LngLatBounds();
    for (const pin of pins) {
      const el = document.createElement("button");
      el.className =
        "maplibre-pin flex items-center justify-center w-9 h-9 rounded-full bg-white border-2 shadow-md text-base cursor-pointer hover:scale-110 transition-transform";
      el.style.borderColor = pin.status === "in_transit" ? "#7c3aed" : pin.status === "failed_attempt" ? "#f97316" : "#6b21a8";
      el.textContent = STATUS_ICON[pin.status] || "📦";
      el.title = `${pin.code} · ${pin.customerName || ""}`;
      el.addEventListener("click", () => selectRef.current(pin.id));
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.dest.lng, pin.dest.lat])
        .addTo(map);
      markerRefs.current.set(pin.id, marker);
      b.extend([pin.dest.lng, pin.dest.lat]);
    }
    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
    }
  }, [pins, mapReady]);

  // Foco: al elegir un encargo (desde la lista o el popup) vuela al punto.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const pin = pins.find((p) => p.id === focusId);
    if (pin) map.flyTo({ center: [pin.dest.lng, pin.dest.lat], zoom: 16, duration: 700 });
  }, [focusId, pins]);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div ref={containerRef} style={{ width: "100%", height: 360 }} />
      {pins.length === 0 && (
        <div className="p-8 text-center text-xs text-muted-foreground bg-background">
          Sin entregas ubicables en el mapa (esperando direcciones geocodificadas).
        </div>
      )}
    </div>
  );
}
