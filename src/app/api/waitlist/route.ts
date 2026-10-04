import { queryMany, queryOne } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Lista de espera pública (estética): "avisame si se libera".
 * POST { vendorId, customerName, customerPhone, serviceId?, staffId?,
 *        bookingDate, bookingTime?, notes? }.
 * No crea turno ni bloquea agenda: el comercio contacta si se libera.
 */
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const vendorId = String(body.vendorId || "");
  const customerName = String(body.customerName || body.name || "").trim().slice(0, 120);
  const phone = toE164(String(body.customerPhone || body.phone || ""));
  const bookingDate = String(body.bookingDate || body.date || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !customerName || !phone || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }
  // Sin espera para fechas pasadas (ensucia el panel).
  try {
    const todayAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (bookingDate < todayAR) {
      return NextResponse.json({ error: "La fecha ya pasó" }, { status: 400 });
    }
  } catch { /* sin TZ: se sigue */ }
  try {
    const vendor = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE id = $1 AND vertical = 'estetica' LIMIT 1`,
      [vendorId]
    ).catch(() => undefined);
    if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

    const serviceId = typeof body.serviceId === "string" && body.serviceId ? body.serviceId : null;
    const staffId = typeof body.staffId === "string" && body.staffId ? body.staffId : null;
    const bookingTime = /^(\d{1,2}):(\d{2})/.test(String(body.bookingTime || "")) ? String(body.bookingTime).slice(0, 5) : null;
    // Duplicado exacto del día: no repetir.
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM waitlist WHERE vendor_id = $1 AND customer_phone = $2 AND booking_date = $3 LIMIT 1`,
      [vendorId, phone, bookingDate]
    ).catch(() => undefined);
    if (dup) return NextResponse.json({ ok: true, waiting: true, duplicate: true });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO waitlist (vendor_id, customer_name, customer_phone, service_id, staff_id, booking_date, booking_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        vendorId,
        customerName,
        phone,
        serviceId,
        staffId,
        bookingDate,
        bookingTime,
        String(body.notes || "").trim().slice(0, 500) || null,
      ]
    );
    if (!row) throw new Error("insert failed");

    // Aviso al comercio (notif + push best-effort).
    try {
      const vrow = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      ).catch(() => undefined);
      if (vrow?.user_id) {
        const { query } = await import("@/lib/db");
        await query(
          `INSERT INTO notifications (user_id, title, body, type, link)
           VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
          [vrow.user_id, "🔔 Nueva en lista de espera", `${customerName} quiere turno el ${bookingDate}${bookingTime ? ` ${bookingTime}` : ""}.`]
        ).catch(() => undefined);
        try {
          const { sendPushToUser } = await import("@/lib/push");
          await sendPushToUser(vrow.user_id, { title: "🔔 Lista de espera", body: `${customerName} · ${bookingDate}`, link: "/vendor/dashboard" });
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, waiting: true });
  } catch {
    return NextResponse.json(
      { error: "Lista de espera no disponible (falta migración)" },
      { status: 503 }
    );
  }
}, { maxRequests: 10 });
