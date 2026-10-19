import { NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { DEVICE_COOKIE, deviceCookieOptions, getDeviceId, newDeviceId } from "@/lib/device";

/**
 * Beacon público de vistas de página (portal_page_views): 1 fila por
 * (página, dispositivo, día). Idempotente por UNIQUE + ON CONFLICT —
 * el cliente además se auto-línea con sessionStorage. Los paths del
 * panel (admin/vendor/preview) y assets internos no se trackean.
 *
 * No rompe nunca la página: siempre 200. Tolerante a migración pendiente
 * (sin tabla → ok + skipped).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
    // Solo el path (sin query): la query puede llevar tokens/términos.
    const path = rawPath.split("?")[0].replace(/\/+$/, "") || "/";

    let deviceId = getDeviceId(request);
    let freshCookie: string | null = null;
    if (!deviceId) {
      deviceId = newDeviceId();
      freshCookie = deviceId;
    }

    try {
      await query(
        `INSERT INTO portal_page_views (path, device_id) VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT uq_portal_pv_path_device_day DO NOTHING`,
        [path.slice(0, 300), deviceId]
      );
    } catch (e: any) {
      // Tabla inexistente (migración pendiente): no contar, no romper.
      if (e?.code === "42P01") return NextResponse.json({ ok: true, skipped: true });
      throw e;
    }

    const res = NextResponse.json({ ok: true });
    if (freshCookie) res.cookies.set(DEVICE_COOKIE, freshCookie, deviceCookieOptions());
    return res;
  } catch (e) {
    console.error("[api/track-page] error:", e);
    return NextResponse.json({ ok: true, skipped: true });
  }
}

/** Probe de salud: la migración está aplicada? */
export async function GET() {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'portal_page_views'
     ) AS exists`
  ).catch(() => null);
  return NextResponse.json({ ready: row?.exists === true });
}
