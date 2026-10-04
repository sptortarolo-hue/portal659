import { query, queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Confirmación pública de turnos (sin cuenta): la clienta abre /turno/[token]
 * y confirma, cancela o reprograma su turno.
 * - POST { token, action: "confirm" }: pending → confirmed.
 * - POST { token, action: "cancel" }: pending/confirmed → cancelled. Si falta
 *   menos de cancel_hours (default 24) se marca como tardía (el comercio ve
 *   que la seña no se devuelve, según su política).
 * - POST { token, action: "reschedule", bookingDate, bookingTime }:
 *   pending/confirmed → misma fila con nueva fecha/hora (previo chequeo de
 *   solape como en POST /api/bookings; 409 si choca). La seña pagada, los
 *   packs usados y la ficha siguen atados (no se tocan).
 */
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const action = String(body.action || "");
  if (!/^[0-9a-f]{32}$/i.test(token) || (action !== "confirm" && action !== "cancel" && action !== "reschedule")) {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  let booking = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string | null;
    booking_date: string;
    booking_time: string;
    starts_at: string | null;
    status: string;
    staff_id: string | null;
    service_id: string | null;
    duration_min: number | null;
  }>(
    `SELECT id, vendor_id, customer_name, booking_date::text AS booking_date,
            booking_time::text AS booking_time, starts_at::text AS starts_at, status,
            staff_id::text AS staff_id, service_id::text AS service_id, duration_min
     FROM bookings WHERE confirm_token = $1 LIMIT 1`,
    [token]
  ).catch(() => undefined);
  if (!booking) {
    // Sin migraciones de estética: datos mínimos (sin reprogramar).
    const legacy = await queryOne<{
      id: string;
      vendor_id: string;
      customer_name: string | null;
      booking_date: string;
      booking_time: string;
      status: string;
    }>(
      `SELECT id, vendor_id, customer_name, booking_date::text AS booking_date,
              booking_time::text AS booking_time, status
       FROM bookings WHERE confirm_token = $1 LIMIT 1`,
      [token]
    ).catch(() => undefined);
    if (legacy) {
      booking = {
        ...legacy,
        starts_at: null,
        staff_id: null,
        service_id: null,
        duration_min: null,
      };
    }
  }
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

  if (action === "cancel") {
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
  }

if (action === "reschedule") {
  const newDate = String(body.bookingDate || "").trim();
  const newTime = String(body.bookingTime || "").trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^(\d{1,2}):(\d{2})/.test(newTime)) {
    return NextResponse.json({ error: "Fecha u hora inválida" }, { status: 400 });
  }
  if (newDate === booking.booking_date && newTime === String(booking.booking_time).slice(0, 5)) {
    return NextResponse.json({ ok: true, status: booking.status, unchanged: true });
  }
  // Sin fecha pasada.
  try {
    const todayAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    if (newDate < todayAR) {
      return NextResponse.json({ error: "La fecha ya pasó" }, { status: 400 });
    }
  } catch { /* sin TZ: se sigue */ }

  // Solape con la misma lógica del POST (por profesional si tiene).
  try {
    const toMin = (t: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    let dur = Number(booking.duration_min) || 60;
    if (booking.service_id) {
      const svc = await queryOne<{ duration_min: number | null; buffer_min: number | null }>(
        `SELECT duration_min, buffer_min FROM services WHERE id = $1 LIMIT 1`,
        [booking.service_id]
      ).catch(() => undefined);
      if (svc) {
        if (Number(svc.duration_min) > 0) dur = Math.min(480, Math.max(15, Math.floor(Number(svc.duration_min))));
        if (Number(svc.buffer_min) > 0) dur += Math.min(120, Math.max(0, Math.floor(Number(svc.buffer_min))));
      }
    }
    const start = toMin(newTime);
    if (start == null) {
      return NextResponse.json({ error: "Hora inválida" }, { status: 400 });
    }
    const rows = await queryMany<{
      booking_time: string;
      duration_min: number | null;
      starts_at: string | null;
      ends_at: string | null;
      staff_id: string | null;
    }>(
      `SELECT booking_time::text AS booking_time, duration_min, starts_at::text AS starts_at,
              ends_at::text AS ends_at, staff_id::text AS staff_id
       FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed') AND id <> $3`,
      [booking.vendor_id, newDate, booking.id]
    ).catch(() => []);
    const clash = (rows || []).find((b) => {
      if (booking.staff_id && b.staff_id && b.staff_id !== booking.staff_id) return false;
      const end = start + dur;
      if (b.starts_at && b.ends_at) {
        const dayStart = new Date(`${newDate}T00:00:00`).getTime();
        const bs = new Date(b.starts_at).getTime();
        const be = new Date(b.ends_at).getTime();
        if (Number.isNaN(bs) || Number.isNaN(be)) return false;
        const s = dayStart + start * 60000;
        const e = dayStart + end * 60000;
        return s < be && bs < e;
      }
      const bs = toMin(b.booking_time);
      if (bs == null) return false;
      return start < bs + (Number(b.duration_min) || 60) && bs < end;
    });
    if (clash) {
      return NextResponse.json({ error: "Ese horario ya está ocupado. Elegí otro." }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "No se pudo verificar disponibilidad" }, { status: 500 });
  }

  const newStartsAt = `${newDate}T${newTime}:00`;
  try {
    await query(
      `UPDATE bookings SET booking_date = $1, booking_time = $2, starts_at = $3::timestamptz, ends_at = (($3::timestamptz) + ((COALESCE(duration_min, 60) + COALESCE(
        (SELECT buffer_min FROM services WHERE id = bookings.service_id), 0
      )) || ' minutes')::interval) WHERE id = $4`,
      [newDate, newTime, newStartsAt, booking.id]
    );
  } catch {
    // Sin columnas nuevas: solo fecha y hora.
    await query(`UPDATE bookings SET booking_date = $1, booking_time = $2 WHERE id = $3`, [
      newDate,
      newTime,
      booking.id,
    ]).catch(() => undefined);
  }
  await notifyVendor(
    booking.vendor_id,
    booking.id,
    "Turno reprogramado por la clienta",
    `${booking.customer_name || "La clienta"} pasó su turno del ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)} al ${newDate} ${newTime}.`
  );
  return NextResponse.json({ ok: true, status: booking.status, bookingDate: newDate, bookingTime: newTime });
  }

  return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
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
