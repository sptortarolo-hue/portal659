"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
  neighborhood?: string | null;
};

// Coordenadas base por defecto si el comercio no tiene coordenadas
const DEFAULT_COORDS: Record<string, [number, number]> = {
  sicardi: [-34.9875, -57.8565],
  garibaldi: [-34.989, -57.8548],
};
const FALLBACK_CENTER: [number, number] = [-34.9881, -57.8561];

export function LocationPicker({ lat, lng, onChange, neighborhood }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(lat != null && lng != null);

  const currentCenter: [number, number] =
    lat != null && lng != null
      ? [lat, lng]
      : (neighborhood && DEFAULT_COORDS[neighborhood]) || FALLBACK_CENTER;

  useEffect(() => {
    if (!isOpen || !mapContainer.current || mapRef.current) return;

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
        center: [currentCenter[1], currentCenter[0]],
        zoom: lat != null && lng != null ? 16 : 14.5,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled) return;

        // Crear marcador arrastrable si hay coordenadas
        if (lat != null && lng != null) {
          const marker = new maplibregl.Marker({
            draggable: true,
            color: "#4f46e5",
          })
            .setLngLat([lng, lat])
            .addTo(map);

          marker.on("dragend", () => {
            const pos = marker.getLngLat();
            onChange(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
          });

          markerRef.current = marker;
        }

        // Permitir hacer click en cualquier parte del mapa para fijar o mover el pin
        map.on("click", (e: any) => {
          const newLat = Number(e.lngLat.lat.toFixed(6));
          const newLng = Number(e.lngLat.lng.toFixed(6));

          if (markerRef.current) {
            markerRef.current.setLngLat([newLng, newLat]);
          } else {
            const marker = new maplibregl.Marker({
              draggable: true,
              color: "#4f46e5",
            })
              .setLngLat([newLng, newLat])
              .addTo(map);

            marker.on("dragend", () => {
              const pos = marker.getLngLat();
              onChange(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
            });

            markerRef.current = marker;
          }

          onChange(newLat, newLng);
        });

        setMapLoaded(true);
      });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapLoaded(false);
    };
  }, [isOpen]);

  // Si cambia lat o lng externamente, actualizar posición del marcador en el mapa
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (lat != null && lng != null) {
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        import("maplibre-gl").then((maplibregl) => {
          if (!mapRef.current) return;
          const marker = new maplibregl.Marker({
            draggable: true,
            color: "#4f46e5",
          })
            .setLngLat([lng, lat])
            .addTo(mapRef.current);

          marker.on("dragend", () => {
            const pos = marker.getLngLat();
            onChange(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
          });

          markerRef.current = marker;
        });
      }
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [lat, lng, mapLoaded, onChange]);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta geolocalización.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = Number(pos.coords.latitude.toFixed(6));
        const userLng = Number(pos.coords.longitude.toFixed(6));
        setGeoLoading(false);
        if (!isOpen) setIsOpen(true);

        onChange(userLat, userLng);

        if (mapRef.current) {
          mapRef.current.flyTo({ center: [userLng, userLat], zoom: 16 });
        }
      },
      (err) => {
        setGeoLoading(false);
        alert("No se pudo obtener tu ubicación actual: " + (err.message || "Permiso denegado"));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleClear = () => {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    onChange(null, null);
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">
            Ubicación exacta en el mapa
          </span>
          {lat != null && lng != null ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Pin ubicado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Aproximada por barrio
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={handleGetCurrentLocation}
            disabled={geoLoading}
          >
            {geoLoading ? "Obteniendo..." : "📍 Mi ubicación actual"}
          </Button>

          {!isOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setIsOpen(true)}
            >
              🗺️ Marcar en el mapa
            </Button>
          )}

          {isOpen && lat != null && lng != null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-destructive px-2"
              onClick={handleClear}
            >
              Quitar pin
            </Button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Hacé clic o arrastrá el pin en el mapa hasta la puerta exacta de tu local para que los clientes te encuentren fácilmente en la sección Mapa.
      </p>

      {isOpen && (
        <div className="space-y-2">
          <div className="relative w-full h-[240px] rounded-lg overflow-hidden border border-border bg-muted/40 shadow-inner">
            <div ref={mapContainer} className="w-full h-full" />
            {!mapLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-xs text-xs text-muted-foreground">
                Cargando mapa...
              </div>
            )}
          </div>

          {lat != null && lng != null && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono bg-muted/50 px-2.5 py-1 rounded-md border border-border/60">
              <span>Coordenadas: {lat}, {lng}</span>
              <span className="text-[10px] font-sans text-primary">✓ Guardar cambios para aplicar</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
