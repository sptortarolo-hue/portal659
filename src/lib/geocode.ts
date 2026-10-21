/**
 * Geocoding con Nominatim (OpenStreetMap), gratis y sin API key.
 *
 * - Cache en DB (geocode_cache): cada dirección se consulta UNA vez.
 * - Rate limit 1 req/s (buena manera con Nominatim: UA propia + nunca
 *   concurrentes; los pedidos que no podemos atender salen con null y se
 *   geocodifican en un request futuro).
 * - Tolerante: si la cache/la red falla devuelve null (el panel del operador
 *   muestra el link de Google Maps con la dirección en texto, igual funciona).
 */
import { queryOne } from "@/lib/db";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const UA = "Portal659/1.0 (envios; site: www.portal659.com.ar)";

let lastCall = 0;

function addressKey(address: string): string {
  return (address || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function rateLimit(): Promise<void> {
  const wait = 1000 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function fetchNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  await rateLimit();
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = rows?.[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Geocode una dirección argentina. Devuelve coords o null (no encontrada /
 * sin servicio). Cachea el resultado en DB (ok true/false).
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const addr = (address || "").trim();
  if (!addr) return null;
  const key = addressKey(addr);

  let cached: { lat: number | null; lng: number | null; ok: boolean } | undefined;
  try {
    cached = await queryOne<{ lat: number | null; lng: number | null; ok: boolean }>(
      `SELECT lat, lng, ok FROM geocode_cache WHERE address_key = $1 LIMIT 1`,
      [key]
    );
  } catch {
    cached = undefined; // sin cache (migración pendiente): seguimos directo a Nominatim
  }
  if (cached && cached.ok && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }
  if (cached && !cached.ok) return null;

  const hit = await fetchNominatim(addr);
  try {
    if (hit) {
      await queryOne(
        `INSERT INTO geocode_cache (address_key, lat, lng, ok) VALUES ($1, $2, $3, true)
         ON CONFLICT (address_key) DO UPDATE SET lat = $2, lng = $3, ok = true, created_at = now()`,
        [key, hit.lat, hit.lng]
      );
    } else {
      await queryOne(
        `INSERT INTO geocode_cache (address_key, ok) VALUES ($1, false)
         ON CONFLICT (address_key) DO UPDATE SET ok = false, created_at = now()`,
        [key]
      );
    }
  } catch {
    /* cache best-effort */
  }
  return hit;
}

/** Batching perezoso: máximo N lookups por request (1/s cada uno → 3 = 3s máx). */
export async function geocodeAddressesBatch(addresses: string[], cap = 3): Promise<void> {
  const seen = new Set<string>();
  let count = 0;
  for (const a of addresses) {
    if (count >= cap) break;
    const key = addressKey(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await geocodeAddress(a);
    count++;
  }
}
