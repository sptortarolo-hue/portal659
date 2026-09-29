import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/vendor/barcode-lookup?code=7791234567890
 * → { code, name, brand, image_url, source: "cache"|"off" }
 * Fuente: Open Food Facts (ODbL, ver atribución en el footer) con caché
 * propia en `barcode_cache`. 404 si el código no existe en ningún lado.
 * Rate-limit en memoria (20/min por IP): endpoint autenticado pero la
 * API externa no tiene SLA y no queremos martillarla.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 1000) hits.delete(hits.keys().next().value as string);
  return arr.length > MAX_HITS;
}

/** Dígito verificador EAN-13/EAN-8 (GTIN-8 se paddea a 8). */
export function isValidBarcode(code: string): boolean {
  const d = (code || "").replace(/\D/g, "");
  if (d.length !== 8 && d.length !== 13) return false;
  const digits = d.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // EAN: desde la derecha (sin el dígito), pesos 3,1,3,1...
  const rev = digits.reverse();
  for (let i = 0; i < rev.length; i++) {
    sum += rev[i] * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

type CachedRow = {
  code: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  hit_count: number;
};

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Demasiadas consultas, probá en un minuto" }, { status: 429 });
  }
  const code = (new URL(request.url).searchParams.get("code") || "").replace(/\D/g, "");
  if (!code) return NextResponse.json({ error: "Código requerido" }, { status: 400 });
  if (!isValidBarcode(code)) {
    return NextResponse.json({ error: "Código inválido (revisá el dígito)" }, { status: 400 });
  }

  // 1) Caché propia.
  try {
    const cached = await queryOne<CachedRow>(
      `SELECT code, name, brand, image_url, hit_count FROM barcode_cache WHERE code = $1 LIMIT 1`,
      [code]
    );
    if (cached?.name) {
      queryOne(`UPDATE barcode_cache SET hit_count = hit_count + 1 WHERE code = $1`, [code]).catch(
        () => null
      );
      return NextResponse.json({
        code,
        name: cached.name,
        brand: cached.brand,
        image_url: cached.image_url,
        source: "cache",
      });
    }
  } catch {
    /* tabla sin migrar: se sigue a OFF sin caché */
  }

  // 2) Open Food Facts (solo campos necesarios).
  let name: string | null = null;
  let brand: string | null = null;
  let imageUrl: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,image_url,categories`,
      {
        signal: ctrl.signal,
        headers: { "User-Agent": "Portal659/1.0 (https://www.portal659.com.ar)" },
      }
    );
    clearTimeout(timer);
    const data = (await res.json().catch(() => null)) as any;
    const p = data?.product;
    if (res.ok && data?.status === 1 && p) {
      name = typeof p.product_name === "string" && p.product_name.trim() ? p.product_name.trim() : null;
      brand = typeof p.brands === "string" && p.brands.trim() ? p.brands.trim().split(",")[0].trim() : null;
      imageUrl =
        typeof p.image_url === "string" && /^https:\/\//.test(p.image_url) ? p.image_url : null;
    }
  } catch {
    /* sin red / timeout: 404 abajo */
  }
  if (!name) {
    return NextResponse.json({ error: "Código no encontrado (cargalo manual)" }, { status: 404 });
  }

  // 3) Guardar en caché (best-effort).
  try {
    await queryOne(
      `INSERT INTO barcode_cache (code, name, brand, image_url, source)
       VALUES ($1, $2, $3, $4, 'off')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, brand = EXCLUDED.brand,
         image_url = EXCLUDED.image_url, hit_count = barcode_cache.hit_count + 1, fetched_at = now()`,
      [code, name, brand, imageUrl]
    );
  } catch {
    /* noop */
  }

  return NextResponse.json({ code, name, brand, image_url: imageUrl, source: "off" });
}
