import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { queryOne, query } from "@/lib/db";
import { DEVICE_COOKIE, deviceCookieOptions, getDeviceId, newDeviceId } from "@/lib/device";

/**
 * Beacon público de visitas a micrositios (una llamada por sesión y comercio
 * desde `VisitBeacon`). Registra (vendor, dispositivo, día), idempotente por
 * constraint UNIQUE + ON CONFLICT DO NOTHING.
 *
 * No rompe nunca la página: siempre 200. No cuenta vistas del dueño ni del
 * admin (autovisitas), ni visitas en modo prueba (el beacon no se monta ahí).
 * Tolerante a migración pendiente (sin tabla `store_visits` → ok + skipped).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const vendorId = typeof body?.vendorId === "string" ? body.vendorId : null;
    if (!vendorId) return NextResponse.json({ ok: true, skipped: true });

    const vendor = await queryOne<{ user_id: string | null }>(
      `SELECT user_id FROM vendors WHERE id = $1`,
      [vendorId]
    ).catch(() => undefined);
    if (!vendor) return NextResponse.json({ ok: true, skipped: true });

    // Autovisitas fuera: dueño del comercio o admin.
    const user = await getAuthUser(request).catch(() => null);
    if (user && (user.is_admin || (vendor.user_id && user.id === vendor.user_id))) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    let deviceId = getDeviceId(request);
    let freshCookie: string | null = null;
    if (!deviceId) {
      deviceId = newDeviceId();
      freshCookie = deviceId;
    }

    try {
      await query(
        `INSERT INTO store_visits (vendor_id, device_id) VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT uq_store_visits_vendor_device_day DO NOTHING`,
        [vendorId, deviceId]
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
    console.error("[api/track-visit] error:", e);
    return NextResponse.json({ ok: true, skipped: true });
  }
}
