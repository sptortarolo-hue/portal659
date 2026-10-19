import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { loadSlotContext, daySlots } from "@/lib/slot-availability-server";

/**
 * Huecos disponibles de turnera para un día (estética + servicios).
 * GET /api/slot-availability?vendorId=&serviceId=&staffId=&date=YYYY-MM-DD
 * → { slots: [{time, available}], estimated, closed }.
 *
 * Modo `hours` (default): usa el horario del local.
 * Modo `grid`: disponibilidad por profesional (semanal recurrente + ajustes
 *   por fecha); lo no marcado queda bloqueado. Sin profesional elegido, el
 *   hueco es libre si algún profesional lo tiene disponible y sin solape.
 * El POST /api/bookings sigue siendo la autoridad (409 ante carrera).
 */
export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId") || "";
  const serviceId = searchParams.get("serviceId") || "";
  const staffId = searchParams.get("staffId") || "";
  const date = searchParams.get("date") || "";
  if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ slots: [], estimated: true, closed: false });
  }

  const ctx = await loadSlotContext(vendorId, serviceId || null, staffId || null);
  if (!ctx.ok) {
    return NextResponse.json({ slots: [], estimated: true, closed: false });
  }
  const day = await daySlots(ctx, date);
  return NextResponse.json(day);
}, { maxRequests: 20 });
