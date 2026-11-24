// @ts-nocheck
import { config } from "./config.mjs";
import { appFetch } from "./sandbox.mjs";

/** @typedef {{ id: string; name: string; description?: string | null; category?: string | null; duration_min?: number | null; price?: number | null; price_from?: number | null; image_url?: string | null; featured_today?: boolean }} Service */

/** @typedef {{ id: string; store_name: string; vertical: string; hours?: string | null; store_open?: boolean; open_text?: string; next_open_text?: string | null; slug?: string | null; microsite_url?: string | null; reserve_url?: string | null }} VendorInfo */

/** @type {Map<string, { vendor: VendorInfo; services: Service[]; at: number }>} */
const cache = new Map();

const SERVICE_VERTICALS = new Set(["estetica", "servicio", "taller", "salud"]);

export function isServiceVertical(vertical) {
  return SERVICE_VERTICALS.has(String(vertical || "").toLowerCase());
}

/**
 * Obtiene los servicios de un vendor (con cache de 60s).
 * @param {string | number} vendorId
 * @returns {Promise<{ vendor: VendorInfo | null; services: Service[] }>}
 */
export async function getServices(vendorId) {
  const key = String(vendorId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) {
    return { vendor: hit.vendor, services: hit.services };
  }

  try {
    const res = await appFetch(`${config.appUrl}/api/wa/services?vendorId=${encodeURIComponent(vendorId)}`, {
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[bot] services error ${res.status}`);
      return { vendor: hit?.vendor || null, services: hit?.services || [] };
    }
    const data = await res.json();
    const vendor = data.vendor || null;
    const services = Array.isArray(data.services) ? data.services : [];
    cache.set(key, { vendor, services, at: Date.now() });
    return { vendor, services };
  } catch (e) {
    console.error(`[bot] services fetch fail: ${/** @type {any} */ (e)?.message}`);
    return { vendor: hit?.vendor || null, services: hit?.services || [] };
  }
}

/**
 * Arma el saludo inicial (info + link de reserva).
 * @param {VendorInfo} vendor
 * @param {Service[]} services
 * @returns {string}
 */
export function buildGreeting(vendor, services) {
  const name = vendor?.store_name || "el comercio";
  const lines = [];
  lines.push(`¡Hola! 👋 Soy el asistente de "${name}".`);
  lines.push("");

  if (vendor?.reserve_url) {
    lines.push("Reservá tu turno online:");
    lines.push(vendor.reserve_url);
  } else if (vendor?.microsite_url) {
    lines.push("Más info:");
    lines.push(vendor.microsite_url);
  }

  return lines.join("\n");
}
