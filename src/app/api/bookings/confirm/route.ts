import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Confirmación pública de turnos (sin cuenta): la clienta abre /turno/[token]
 * y confirma o cancela su turno.
 * - POST { token, action: "confirm" }: pending → confirmed.
 * - POST { token, action: "cancel" }: pending/confirmed → cancelled. Si falta
 *   menos de cancel_hours (default 24) se marca como tardía (el comercio ve
 *   que la seña no se devuelve, según su política).
 */
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const action = String(body.action || "");
  if (!/^[0-9a-f]{32}$/i.test(token) || (action !== "confirm" && action !== "cancel")) {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const booking = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string | null;
    booking_date: string;
    booking_time: string;
    starts_at: string | null;
    status: string;
  }>(
    `SELECT id, vendor_id, customer_name, booking_date::text AS booking_date,
            booking_time::text AS booking_time, starts_at::text AS starts_at, status
     FROM bookings WHERE confirm_token = $1 LIMIT 1`,
    [token]
  ).catch(() => undefined);
  if (!booking) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "Este turno ya está cancelado", status: "cancelled" }, { status: 409 });
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return NextResponse.json({ error: "Este turno ya no se puede modificar", status: booking.status }, { status: 409 });
  }

  if (action === "confirm") {
    if (booking.status === "confirmed") {
      return NextResponse.json({ ok: true, status: "confirmed", already: true });
    }
    await query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [booking.id]).catch(() => undefined);
    await notifyVendor(booking.vendor_id, booking.id, "Turno confirmado por la clienta", `${booking.customer_name || "La clienta"} confirmó su turno del ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)}.`);
    return NextResponse.json({ ok: true, status: "confirmed" });
  }

  // Cancelación: ¿tardía? (dentro de cancel_hours del comercio, default 24).
  let late = false;
  try {
    const vrow = await queryOne<{ cancel_hours: number | null }>(
      `SELECT cancel_hours FROM vendors WHERE id = $1 LIMIT 1`,
      [booking.vendor_id]
    ).catch(() => null);
    const limitHours = vrow?.cancel_hours != null ? Number(vrow.cancel_hours) : 24;
    const startMs = booking.starts_at
      ? new Date(booking.starts_at).getTime()
      : new Date(`${booking.booking_date}T${String(booking.booking_time).slice(0, 5)}:00`).getTime();
    if (Number.isFinite(startMs)) {
      late = startMs - Date.now() < limitHours * 3600 * 1000;
    }
  } catch { /* sin columnas: no tardía */ }
  await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [booking.id]).catch(() => undefined);
  await notifyVendor(
    booking.vendor_id,
    booking.id,
    late ? "Turno cancelado (tardío)" : "Turno cancelado por la clienta",
    `${booking.customer_name || "La clienta"} canceló su turno del ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)}${late ? " dentro del plazo de cancelación (revisá tu política de seña)" : ""}.`
  );
  return NextResponse.json({ ok: true, status: "cancelled", late });
}, { maxRequests: 10 });

async function notifyVendor(vendorId: string, bookingId: string, title: string, body: string) {
  try {
    const vrow = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    ).catch(() => undefined);
    if (!vrow?.user_id) return;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
      [vrow.user_id, title, body]
    ).catch(() => undefined);
    try {
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(vrow.user_id, { title, body, link: "/vendor/dashboard" });
    } catch { /* best-effort */ }
  } catch { /* best-effort */ }
}
