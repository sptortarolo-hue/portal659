import { NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { DEVICE_COOKIE, deviceCookieOptions, getDeviceId, newDeviceId } from "@/lib/device";
import { AR_DAY_SQL } from "@/lib/analytics-day";

const KINDS = new Set(["search", "wa_click", "store_open"]);

/**
 * Beacon público de interacciones (portal_events):
 *  - search     → value = término buscado (/buscar?q=)
 *  - wa_click   → value = link destino (cap de caracteres), vendor_id si hay
 *  - store_open → value = slug del comercio (click a un micrositio)
 *
 * Sin dedupe por diseño (cada búsqueda/click cuenta — eso es la métrica).
 * No rompe nunca la página: siempre 200. Tolerante a migración pendiente.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const kind = typeof body?.kind === "string" ? body.kind.trim() : "";
    if (!KINDS.has(kind)) return NextResponse.json({ ok: true, skipped: true });

    const value =
      typeof body?.value === "string" && body.value.trim()
        ? body.value.trim().slice(0, 120)
        : null;
    const rawPath = typeof body?.path === "string" ? body.path.split("?")[0] : "";
    // El vendor viaja solo desde micrositios (data-vendor-id): se valida que
    // exista para no guardar basura en la FK.
    const vendorIdIn = typeof body?.vendorId === "string" ? body.vendorId : null;

    let deviceId = getDeviceId(request);
    let freshCookie: string | null = null;
    if (!deviceId) {
      deviceId = newDeviceId();
      freshCookie = deviceId;
    }

    let vendorId: string | null = null;
    if (vendorIdIn) {
      const v = await queryOne<{ id: string }>(
        `SELECT id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorIdIn]
      ).catch(() => null);
      vendorId = v?.id || null;
    }

    try {
      // El día se pasa explícito en huso AR (mismo motivo que track-page:
      // el default de columna CURRENT_DATE corre en UTC en el contenedor).
      await query(
        `INSERT INTO portal_events (kind, value, vendor_id, path, device_id, day)
         VALUES ($1, $2, $3, $4, $5, ${AR_DAY_SQL})`,
        [kind, value, vendorId, rawPath.slice(0, 300) || null, deviceId]
      );
    } catch (e: any) {
      if (e?.code === "42P01") return NextResponse.json({ ok: true, skipped: true });
      throw e;
    }

    const res = NextResponse.json({ ok: true });
    if (freshCookie) res.cookies.set(DEVICE_COOKIE, freshCookie, deviceCookieOptions());
    return res;
  } catch (e) {
    console.error("[api/track-event] error:", e);
    return NextResponse.json({ ok: true, skipped: true });
  }
}
