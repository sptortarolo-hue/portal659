"use client";

import { useEffect } from "react";

/**
 * Beacon de visita al micrositio: 1 llamada por sesión y comercio.
 * El server dedupea por (comercio, dispositivo, día), así que reintentos o
 * doble montaje no inflan nada. No se monta en modo prueba (preview).
 */
export function VisitBeacon({ vendorId }: { vendorId: string }) {
  useEffect(() => {
    let already = false;
    try {
      const key = `portal659-visited:${vendorId}`;
      already = sessionStorage.getItem(key) === "1";
      if (!already) sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage no disponible: igual se envía, el server dedupea.
    }
    if (already) return;
    fetch("/api/track-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId }),
      keepalive: true,
    }).catch(() => {});
  }, [vendorId]);
  return null;
}
