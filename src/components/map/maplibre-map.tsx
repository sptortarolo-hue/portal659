"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { Vendor } from "@/types/database";

type VerticalInfo = {
  slug: string;
  name: string;
  emoji: string;
  hex: string;
};

type FitPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type Props = {
  center: [number, number];
  zoom: number;
  /** Comercios ya filtrados por la página. */
  vendors: Vendor[];
  verticals: VerticalInfo[];
  /** Aire alrededor del encuadre para que los pins no queden bajo la UI. */
  fitPadding?: FitPadding;
  /** Cambiar el valor re-encuadra todos los pins (botón "Ver todos"). */
  fitNonce?: number;
  /** Comercio elegido en la lista: vuela al pin y abre su popup. */
  focusVendorId?: string | null;
  className?: string;
};

const BOUNDARY = {
  north: -34.9855,
  south: -34.9925,
  east: -57.853,
  west: -57.86,
};

const STREET_LABELS = [
  { text: "Av. 7", lat: -34.9855, lng: -57.8565, color: "#4f46e5" },
  { text: "Av. 13", lat: -34.9925, lng: -57.8565, color: "#4f46e5" },
  { text: "Calle 659", lat: -34.989, lng: -57.8525, color: "#f97316" },
];

function hasRealCoords(v: Vendor): boolean {
  return (
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng)
  );
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getVendorCoords(v: Vendor): [number, number] {
  if (hasRealCoords(v)) {
    return [v.lat as number, v.lng as number];
  }
  const bases: Record<string, [number, number]> = {
    sicardi: [-34.9875, -57.8565],
    garibaldi: [-34.989, -57.8548],
  };
  const base = bases[v.neighborhood || "sicardi"] || bases.sicardi;
  // FNV-1a + dos tramos independientes: reparte los pins aproximados sin
  // amontonarlos en el mismo punto (el hash viejo colisionaba).
  const hash = hashText(v.id);
  return [
    base[0] + ((hash % 41) - 20) * 0.00018,
    base[1] + (((hash >>> 11) % 41) - 20) * 0.00018,
  ];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function MaplibreMap({
  center,
  zoom,
  vendors,
  verticals,
  fitPadding,
  fitNonce = 0,
  focusVendorId,
  className,
}: Props) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, MapLibreMarker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  const didFitRef = useRef(false);

  // En mobile el encuadre deja aire para la barra de filtros y la hoja;
  // en desktop no hay overlays, así que alcanza con un margen parejo.
  const padTop = compact ? fitPadding?.top ?? 48 : 48;
  const padRight = fitPadding?.right ?? 48;
  const padBottom = compact ? fitPadding?.bottom ?? 48 : 48;
  const padLeft = fitPadding?.left ?? 48;

  // Mobile: mapa plano (el pitch 3D recorta los puntos al encuadrar) y sin
  // controles flotantes grandes. Se decide en cliente para no romper SSR.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    let cancelled = false;
    const initialCompact = window.matchMedia("(max-width: 1023px)").matches;

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !mapContainer.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainer.current,
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
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center: [center[1], center[0]],
        zoom,
        pitch: initialCompact ? 0 : 40,
        bearing: initialCompact ? 0 : -17.6,
        canvasContextAttributes: { antialias: true },
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl(), "bottom-left");

      // Street labels as markers (no dependen de que bajen los tiles).
      STREET_LABELS.forEach((s) => {
        const el = document.createElement("div");
        el.textContent = s.text;
        el.style.cssText = `background:${s.color};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;font-family:Inter,system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.2);`;
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([s.lng, s.lat])
          .addTo(map);
      });

      // El polígono del barrio sí necesita el estilo listo.
      map.once("style.load", () => {
        if (map.getSource("barrio-boundary")) return;
        map.addSource("barrio-boundary", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [BOUNDARY.west, BOUNDARY.north],
                  [BOUNDARY.east, BOUNDARY.north],
                  [BOUNDARY.east, BOUNDARY.south],
                  [BOUNDARY.west, BOUNDARY.south],
                  [BOUNDARY.west, BOUNDARY.north],
                ],
              ],
            },
            properties: {},
          },
        });
        map.addLayer({
          id: "barrio-fill",
          type: "fill",
          source: "barrio-boundary",
          paint: { "fill-color": "#4f46e5", "fill-opacity": 0.05 },
        });
        map.addLayer({
          id: "barrio-border",
          type: "line",
          source: "barrio-boundary",
          paint: {
            "line-color": "#4f46e5",
            "line-width": 2,
            "line-opacity": 0.4,
            "line-dasharray": [3, 2],
          },
        });
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      const map = mapRef.current;
      if (map) {
        map.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();
      setMapReady(false);
    };
    // El centro/zoom iniciales no cambian en esta página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setPitch(compact ? 0 : 40);
    map.setBearing(compact ? 0 : -17.6);
  }, [compact, mapReady]);

  // Marcadores: se recrean cuando cambia la lista filtrada.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let cancelled = false;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    const renderMarkers = async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !mapRef.current) return;

      vendors.forEach((v) => {
        const [lat, lng] = getVendorCoords(v);
        const vert = verticals.find((vt) => vt.slug === v.vertical);
        const color = vert?.hex || "#6B7280";
        const emoji = vert?.emoji || "•";
        const vName = vert?.name || v.vertical;
        const approximate = !hasRealCoords(v);

        // El elemento externo lo posiciona MapLibre (no tocar su transform);
        // el hover escala el pin interno.
        const el = document.createElement("div");
        el.style.cssText = "cursor:pointer;";
        const pin = document.createElement("div");
        const opacity = approximate ? "opacity:0.7;" : "";

        if (v.logo_url) {
          pin.style.cssText = `
            ${opacity}
            width:36px;height:36px;border-radius:50%;
            background:url(${JSON.stringify(v.logo_url)}) center/cover no-repeat;
            box-shadow:0 3px 10px rgba(0,0,0,0.3);border:3px ${approximate ? "dashed" : "solid"} ${color};
            transition:transform 0.2s;
          `;
        } else {
          pin.style.cssText = `
            ${opacity}
            width:32px;height:32px;border-radius:50% 50% 50% 0;
            background:${color};transform:rotate(-45deg);
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 3px 10px rgba(0,0,0,0.3);border:2px ${approximate ? "dashed" : "solid"} #fff;
            transition:transform 0.2s;
          `;
          const span = document.createElement("span");
          span.textContent = emoji;
          span.style.cssText = "transform:rotate(45deg);font-size:14px;";
          pin.appendChild(span);
        }
        el.appendChild(pin);

        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute(
          "aria-label",
          approximate ? `${v.store_name} (ubicación aproximada)` : v.store_name
        );
        el.title = approximate ? `${v.store_name} (ubicación aproximada)` : v.store_name;

        el.addEventListener("mouseenter", () => {
          pin.style.transform = v.logo_url ? "scale(1.15)" : "rotate(-45deg) scale(1.15)";
        });
        el.addEventListener("mouseleave", () => {
          pin.style.transform = v.logo_url ? "scale(1)" : "rotate(-45deg) scale(1)";
        });

        const popupHtml = `
          <div style="font-family:Inter,system-ui,sans-serif;width:220px">
            ${v.image_url ? `<img src="${escapeHtml(v.image_url)}" style="width:100%;height:80px;object-fit:cover;border-radius:6px 6px 0 0" alt="${escapeHtml(v.store_name)}" />` : ""}
            <div style="padding:6px 8px${v.image_url ? ";padding-top:4px" : ""}">
              <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(v.store_name)}</div>
              <div style="display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;color:#fff;background:${color};margin-bottom:4px">${escapeHtml(vName)}</div>
              <div style="font-size:11px;color:#667085">${escapeHtml(v.neighborhood || "")}</div>
              ${v.address ? `<div style="font-size:11px;color:#667085">📍 ${escapeHtml(v.address)}</div>` : ""}
              ${approximate ? `<div style="font-size:10px;color:#b45309;margin-top:2px">◌ Ubicación aproximada</div>` : ""}
              <a href="/tienda/${encodeURIComponent(v.slug || "")}" style="display:inline-block;margin-top:4px;font-size:11px;font-weight:600;color:#4f46e5;text-decoration:none">Ver tienda →</a>
            </div>
          </div>
        `;

        const popup = new maplibregl.Popup({ offset: 20, closeButton: true, maxWidth: "260px" }).setHTML(
          popupHtml
        );

        const marker = new maplibregl.Marker({
          element: el,
          anchor: v.logo_url ? "center" : "bottom",
        })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.set(v.id, marker);
      });
    };

    void renderMarkers();

    return () => {
      cancelled = true;
    };
  }, [vendors, verticals, mapReady]);

  const fitToVendors = useCallback(
    (duration: number) => {
      const map = mapRef.current;
      if (!map || vendors.length === 0) return;

      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      for (const v of vendors) {
        const [lat, lng] = getVendorCoords(v);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: padTop, right: padRight, bottom: padBottom, left: padLeft },
          maxZoom: 16,
          duration,
          essential: true,
        }
      );
    },
    [vendors, padTop, padRight, padBottom, padLeft]
  );

  // Encuadre inicial (instantáneo) y re-encuadre al filtrar o pedir "Ver todos".
  useEffect(() => {
    if (!mapReady) return;
    fitToVendors(didFitRef.current ? 500 : 0);
    didFitRef.current = true;
  }, [mapReady, fitToVendors, fitNonce]);

  // Foco desde la lista: vuela al comercio elegido y abre su ficha.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusVendorId) return;
    const vendor = vendors.find((v) => v.id === focusVendorId);
    if (!vendor) return;

    const [lat, lng] = getVendorCoords(vendor);
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 16),
      duration: 650,
      essential: true,
    });

    const popup = markersRef.current.get(vendor.id)?.getPopup();
    // El popup del marker todavía no tiene coordenadas hasta que se abre
    // desde el pin; sin setLngLat, addTo() no crea el contenedor.
    if (popup && !popup.isOpen()) popup.setLngLat([lng, lat]).addTo(map);
  }, [focusVendorId, mapReady, vendors]);

  return (
    <div
      ref={mapContainer}
      className={`mapa-map ${compact ? "mapa-map--mobile" : ""} ${className ?? "h-full w-full"}`}
    />
  );
}
