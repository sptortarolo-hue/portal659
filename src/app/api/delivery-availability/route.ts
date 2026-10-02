import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { fetchVendorDelivery } from "@/lib/delivery-server";
import {
  DELIVERY_TZ,
  deliveryPauseClientMessage,
  isDeliveryOpen,
  isDeliveryPaused,
  nextDeliverySlots,
  normalizePrepMin,
  usesStoreHours,
  DELIVERY_SLOTS_OFFERED,
} from "@/lib/delivery-schedule";

/**
 * GET /api/delivery-availability?vendorId=
 * Turnos de reparto del comercio (público, para micrositio + checkout).
 * Solo tiene sentido en retail (moda/comercio): el caller decide si mostrar.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId");
  if (!vendorId) {
    return NextResponse.json({ error: "Falta vendorId" }, { status: 400 });
  }
  try {
    const cfg = await fetchVendorDelivery(vendorId);
    const sched = {
      hours: cfg.hours,
      delivery_hours: cfg.deliveryHours,
      open_override: cfg.openOverride,
      delivery_override: cfg.deliveryOverride,
      delivery_paused_until: cfg.deliveryPausedUntil,
      delivery_pause_reason: cfg.deliveryPauseReason,
      delivery_extra_days: cfg.deliveryExtraDays,
    };
    const slots = nextDeliverySlots(sched, { timeZone: DELIVERY_TZ, count: DELIVERY_SLOTS_OFFERED });
    const open = isDeliveryOpen(sched, { timeZone: DELIVERY_TZ });
    const paused = isDeliveryPaused(sched);
    // Vertical (el caller filtra retail, pero se devuelve para ahorrar un fetch).
    let vertical: string | null = null;
    try {
      const row = await queryOne<{ vertical: string }>(
        `SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );
      vertical = row?.vertical || null;
    } catch {
      vertical = null;
    }
    return NextResponse.json({
      ok: true,
      vertical,
      deliveryOpen: open,
      slots,
      prepMin: normalizePrepMin(cfg.deliveryPrepMin),
      usesStoreHours: usesStoreHours(sched),
      deliveryPaused: paused,
      deliveryPausedUntil: cfg.deliveryPausedUntil,
      deliveryPauseReason: cfg.deliveryPauseReason,
      pauseClientMsg: paused ? deliveryPauseClientMessage(cfg.deliveryPauseReason) : null,
      deliveryForced: cfg.deliveryOverride === true,
    });
  } catch {
    return NextResponse.json({ error: "No se pudo cargar la disponibilidad" }, { status: 500 });
  }
}
