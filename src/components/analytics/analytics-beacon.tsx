"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SKIP_PREFIXES = ["/vendor", "/admin", "/preview"];

function sendBeacon(url: string, body: Record<string, unknown>) {
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // El tracking nunca puede romper la página.
  }
}

/** Marca 1 vez por (clave, día): reintentos y doble montaje no inflan nada. */
function sendOncePerDay(key: string, url: string, body: Record<string, unknown>) {
  const day = new Date().toISOString().slice(0, 10);
  const id = `portal659-t:${key}:${day}`;
  try {
    if (sessionStorage.getItem(id) === "1") return;
    sessionStorage.setItem(id, "1");
  } catch {
    // Sin sessionStorage: manda igual, el server dedupea por (path, device, día).
  }
  sendBeacon(url, body);
}

function clickPayload(a: HTMLAnchorElement): { kind: "wa_click" | "store_open"; value: string; vendorId: string | null } | null {
  let href: string;
  try {
    href = new URL(a.getAttribute("href") || a.href, window.location.origin).href;
  } catch {
    return null;
  }

  let vendorId: string | null = false as unknown as string;
  try {
    vendorId = (a.closest("[data-vendor-id]") as HTMLElement | null)?.dataset?.vendorId || null;
  } catch {
    vendorId = null;
  }

  try {
    const u = new URL(href);
    // WhatsApp de cualquier pareja: micrositio, buscar, footer de tarjeta...
    if (/(^|\.)(wa\.me|api\.whatsapp\.com)$/i.test(u.hostname)) {
      const value = `${u.hostname}${u.pathname}`; // sin query (el texto prearmado es ruido)
      return { kind: "wa_click", value: value.slice(0, 120), vendorId };
    }
    // Apertura de micrositio (link interno a /tienda/[slug]).
    const m = u.pathname.match(/^\/tienda\/([^/]+)/);
    if (m && m[1]) {
      return { kind: "store_open", value: decodeURIComponent(m[1]).slice(0, 120), vendorId };
    }
  } catch {}
  return null;
}

function BeaconInner() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const listenerRef = useRef<((e: MouseEvent) => void) | null>(null);

  // Vista de página: 1 por (página, dispositivo, día).
  useEffect(() => {
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;
    sendOncePerDay(`view:${pathname}`, "/api/track-page", { path: pathname });
  }, [pathname]);

  // Búsqueda en /buscar: término (`q`) o navegación por rubro (`vertical`).
  useEffect(() => {
    if (!pathname.startsWith("/buscar")) return;
    const q = (searchParams.get("q") || "").trim();
    const vertical = (searchParams.get("vertical") || "").trim();
    if (q) sendOncePerDay(`search:q:${q}`, "/api/track-event", { kind: "search", value: q, path: pathname });
    else if (vertical)
      sendOncePerDay(`search:v:${vertical}`, "/api/track-event", {
        kind: "search",
        value: `vertical:${vertical}`,
        path: pathname,
      });
  }, [pathname, searchParams]);

  // Clicks: WhatsApp (wa.me / api.whatsapp) y apertura de micrositios.
  useEffect(() => {
    if (listenerRef.current) document.removeEventListener("click", listenerRef.current, true);
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const payload = clickPayload(anchor);
      if (payload) sendBeacon("/api/track-event", { path: window.location.pathname, ...payload });
    };
    listenerRef.current = handler;
    document.addEventListener("click", handler, true);
    return () => {
      if (listenerRef.current) {
        document.removeEventListener("click", listenerRef.current, true);
        listenerRef.current = null;
      }
    };
  }, []);

  return null;
}

/**
 * Beacon global de tráfico (solo páginas públicas): vistas de página,
 * búsquedas y clicks de WhatsApp / apertura de micrositio. No trackea
 * /vendor, /admin ni /preview.
 */
export function AnalyticsBeacon() {
  return (
    <Suspense fallback={null}>
      <BeaconInner />
    </Suspense>
  );
}
