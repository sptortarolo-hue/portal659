"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Vendor } from "@/types/database";

type VerticalInfo = {
  slug: string;
  name: string;
  emoji: string;
  hex: string;
};

type Props = {
  center: [number, number];
  zoom: number;
  vendors: Vendor[];
  verticals: VerticalInfo[];
  filter: string | null;
  neighborhoodFilter: string | null;
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

function getVendorCoords(v: Vendor): [number, number] {
  if (v.lat != null && v.lng != null) {
    return [v.lat, v.lng];
  }
  const bases: Record<string, [number, number]> = {
    sicardi: [-34.9875, -57.8565],
    garibaldi: [-34.989, -57.8548],
  };
  const base = bases[v.neighborhood || "sicardi"] || bases.sicardi;
  const hash = v.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return [
    base[0] + ((hash % 20) - 10) * 0.0003,
    base[1] + (((hash * 7) % 20) - 10) * 0.0003,
  ];
}

export function MaplibreMap({
  center,
  zoom,
  vendors,
  verticals,
  filter,
  neighborhoodFilter,
}: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    let cancelled = false;

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !mapContainer.current) return;

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
        pitch: 45,
        bearing: -17.6,
        canvasContextAttributes: { antialias: true },
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.ScaleControl(), "bottom-left");

      map.on("load", () => {
        // Barrio boundary polygon
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

        // Street labels as markers
        STREET_LABELS.forEach((s) => {
          const el = document.createElement("div");
          el.textContent = s.text;
          el.style.cssText = `background:${s.color};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;font-family:Inter,system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.2);`;
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([s.lng, s.lat])
            .addTo(map);
        });

        // Fly-in camera animation
        map.flyTo({
          center: [center[1], center[0]],
          zoom,
          pitch: 45,
          bearing: -17.6,
          duration: 2000,
          essential: true,
        });
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      if (mapRef.current && typeof (mapRef.current as { remove: () => void }).remove === "function") {
        (mapRef.current as { remove: () => void }).remove();
        mapRef.current = null;
      }
    };
  }, [center, zoom]);

  const updateMarkers = useCallback(() => {
    const map = mapRef.current as {
      isStyleLoaded: () => boolean;
      on: (e: string, fn: () => void) => void;
    } | null;
    if (!map) return;

    const clearMarkers = () => {
      (markersRef.current as Array<{ remove: () => void }>).forEach((m) => m.remove());
      markersRef.current = [];
    };

    const renderMarkers = async () => {
      const maplibregl = await import("maplibre-gl");
      clearMarkers();

      const filtered = vendors.filter((v) => {
        if (filter && v.vertical !== filter) return false;
        if (neighborhoodFilter && v.neighborhood !== neighborhoodFilter) return false;
        return true;
      });

      filtered.forEach((v) => {
        const [lat, lng] = getVendorCoords(v);
        const vert = verticals.find((vt) => vt.slug === v.vertical);
        const color = vert?.hex || "#6B7280";
        const emoji = vert?.emoji || "📍";
        const vName = vert?.name || v.vertical;

        const el = document.createElement("div");
        if (v.logo_url) {
          el.style.cssText = `
            width:36px;height:36px;border-radius:50%;
            background:url(${v.logo_url}) center/cover no-repeat;
            box-shadow:0 3px 10px rgba(0,0,0,0.3);border:3px solid ${color};
            cursor:pointer;transition:transform 0.2s;
          `;
        } else {
          el.style.cssText = `
            width:32px;height:32px;border-radius:50% 50% 50% 0;
            background:${color};transform:rotate(-45deg);
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 3px 10px rgba(0,0,0,0.3);border:2px solid #fff;
            cursor:pointer;transition:transform 0.2s;
          `;
          const span = document.createElement("span");
          span.textContent = emoji;
          span.style.cssText = "transform:rotate(45deg);font-size:14px;";
          el.appendChild(span);
        }

        el.addEventListener("mouseenter", () => { el.style.transform = v.logo_url ? "scale(1.15)" : "rotate(-45deg) scale(1.15)"; });
        el.addEventListener("mouseleave", () => { el.style.transform = v.logo_url ? "scale(1)" : "rotate(-45deg) scale(1)"; });

        const popupHtml = `
          <div style="font-family:Inter,system-ui,sans-serif;width:220px">
            ${v.image_url ? `<img src="${v.image_url}" style="width:100%;height:80px;object-fit:cover;border-radius:6px 6px 0 0" alt="${v.store_name}" />` : ""}
            <div style="padding:6px 8px${v.image_url ? ";padding-top:4px" : ""}">
              <div style="font-weight:700;font-size:13px;margin-bottom:2px">${v.store_name}</div>
              <div style="display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;color:#fff;background:${color};margin-bottom:4px">${vName}</div>
              <div style="font-size:11px;color:#667085">${v.neighborhood || ""}</div>
              ${v.address ? `<div style="font-size:11px;color:#667085">📍 ${v.address}</div>` : ""}
              <a href="/tienda/${v.slug}" style="display:inline-block;margin-top:4px;font-size:11px;font-weight:600;color:#4f46e5;text-decoration:none">Ver tienda →</a>
            </div>
          </div>
        `;

        const popup = new maplibregl.Popup({ offset: 20, closeButton: true }).setHTML(popupHtml);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map as unknown as InstanceType<typeof maplibregl.Map>);

        markersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) {
      renderMarkers();
    } else {
      map.on("load", renderMarkers);
    }
  }, [vendors, verticals, filter, neighborhoodFilter, mapReady]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  return (
    <div
      ref={mapContainer}
      className="w-full h-[500px] md:h-[600px]"
    />
  );
}
