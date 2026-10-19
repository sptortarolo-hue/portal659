import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { dayKeyForISO, shiftISODate } from "@/lib/booking-schedule";
import { loadSlotContext, daySlots, type DaySlots } from "@/lib/slot-availability-server";

/**
 * Huecos de turnera para una semana (estética / servicios), en modo `grid`.
 * GET /api/slot-week?vendorId=&serviceId=&staffId=&from=YYYY-MM-DD&days=7
 * → { days: [{ date, weekday, closed, blocked, estimated, slots: [{time,available}] }] }.
 *
 * Mismo cálculo que `/api/slot-availability` (duración + buffer del servicio
 * mandan); acá se devuelven los 7 días juntos para la grilla semanal del cliente.
 */
export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId") || "";
  const serviceId = searchParams.get("serviceId") || "";
  const staffId = searchParams.get("staffId") || "";
  const from = searchParams.get("from") || "";
  const days = Math.min(Math.max(Number(searchParams.get("days")) || 7, 1), 14);

  if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ days: [] });
  }

  const ctx = await loadSlotContext(vendorId, serviceId || null, staffId || null);
  if (!ctx.ok) return NextResponse.json({ days: [] });

  const empty: DaySlots = { slots: [], estimated: true, closed: false };
  const out = await Promise.all(
    Array.from({ length: days }, async (_, i) => {
      const date = shiftISODate(from, i);
      const day = await daySlots(ctx, date).catch(() => empty);
      return {
        date,
        weekday: dayKeyForISO(date),
        closed: day.closed,
        blocked: !!day.blocked,
        estimated: day.estimated,
        slots: day.slots,
      };
    })
  );

  return NextResponse.json({ days: out });
}, { maxRequests: 20 });
