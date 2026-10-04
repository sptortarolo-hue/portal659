import { getVendorByRequest } from "@/lib/vendor-utils";
import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ bookings: [] });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const date = searchParams.get("date");

  const conditions: string[] = [`b.vendor_id = $1`];
  const params: unknown[] = [vendor.id];
  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }
  if (date) {
    params.push(date);
    conditions.push(`b.booking_date = $${params.length}`);
  }

  let bookings;
  try {
    bookings = await queryMany<Record<string, unknown>>(
      `SELECT b.*, p.name AS product_label, s.name AS service_label, st.name AS staff_label, l.name AS location_label
       FROM bookings b
       LEFT JOIN products p ON p.id = b.product_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN estetica_staff st ON st.id = b.staff_id
       LEFT JOIN estetica_locations l ON l.id = b.location_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY b.booking_date ASC, b.booking_time ASC`,
      params
    );
  } catch {
    try {
      bookings = await queryMany<Record<string, unknown>>(
        `SELECT b.*, p.name AS product_label, s.name AS service_label, st.name AS staff_label
         FROM bookings b
         LEFT JOIN products p ON p.id = b.product_id
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN estetica_staff st ON st.id = b.staff_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY b.booking_date ASC, b.booking_time ASC`,
        params
      );
    } catch {
      // Sin migración de estética: listado legacy.
      bookings = await queryMany<Record<string, unknown>>(
        `SELECT b.*, p.name AS product_label
         FROM bookings b
         LEFT JOIN products p ON p.id = b.product_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY b.booking_date ASC, b.booking_time ASC`,
        params
      );
    }
  }
  return NextResponse.json({ bookings: bookings || [] });
}

const toMinutes = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Crear turno MANUAL desde el panel (no cuenta para el tope gratuito:
 * origin='vendor'). Nace confirmado (entra a recordatorios y a historial).
 * Avisa solape con otro turno sin bloquear (el comercio decide).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (gate.vendor.vertical !== "servicio" && gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para servicios y estética" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customer_name || "").trim();
  const customerPhone = toE164(String(body.customer_phone || ""));
  const bookingDate = String(body.booking_date || "").trim();
  const bookingTime = String(body.booking_time || "").trim();
  if (!customerName || !customerPhone || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || toMinutes(bookingTime) == null) {
    return NextResponse.json({ error: "Faltan cliente, teléfono o fecha/hora válida" }, { status: 400 });
  }
  // Servicio/profesional (estética): duración + buffer + staff. Todo tolerante
  // a migración sin aplicar.
  let durationMin = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));
  let bufferMin = 0;
  let staffId: string | null = typeof body.staff_id === "string" && body.staff_id ? body.staff_id : null;
  let serviceId: string | null = typeof body.service_id === "string" && body.service_id ? body.service_id : null;
  let serviceName: string | null = null;
  let servicePrice: number | null = null;
  let serviceCommission: number | null = null;
  let staffCommission: number | null = null;
  try {
    if (serviceId) {
      const svc = await queryOne<{ name: string; duration_min: number | null; buffer_min: number | null; price: number | null; commission_pct: number | null }>(
        `SELECT name, duration_min, buffer_min, price, commission_pct FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [serviceId, gate.vendor.id]
      ).catch(() =>
        queryOne<{ name: string; duration_min: number | null; buffer_min: number | null; price: number | null; commission_pct: number | null }>(
          `SELECT name, duration_min, buffer_min FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [serviceId, gate.vendor.id]
        )
      );
      if (svc) {
        serviceName = svc.name;
        if (Number(svc.duration_min) > 0) durationMin = Math.min(480, Math.max(15, Math.floor(Number(svc.duration_min))));
        if (Number(svc.buffer_min) > 0) bufferMin = Math.min(120, Math.max(0, Math.floor(Number(svc.buffer_min))));
        if (svc.price != null && Number(svc.price) >= 0) servicePrice = Number(svc.price);
        if (svc.commission_pct != null && Number(svc.commission_pct) >= 0) serviceCommission = Number(svc.commission_pct);
      } else {
        serviceId = null;
      }
    }
    if (staffId) {
      const st = await queryOne<{ id: string; commission_pct: number | null }>(
        `SELECT id, commission_pct FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [staffId, gate.vendor.id]
      ).catch(() =>
        queryOne<{ id: string; commission_pct: number | null }>(
          `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [staffId, gate.vendor.id]
        )
      );
      if (!st) {
        staffId = null;
      } else if (st.commission_pct != null && Number(st.commission_pct) >= 0) {
        staffCommission = Number(st.commission_pct);
      }
    }
  } catch {
    staffId = null;
    serviceId = null;
  }
  const snapshotCommission = serviceCommission ?? staffCommission;
  // Sede (multi-sede light): se valida; NULL = sin preferencia.
  let locationId: string | null = typeof body.location_id === "string" && body.location_id ? body.location_id : null;
  if (locationId) {
    try {
      const loc = await queryOne<{ id: string }>(
        `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [locationId, gate.vendor.id]
      );
      if (!loc) locationId = null;
    } catch {
      locationId = null;
    }
  }

  // Aviso de solape (no bloquea): turnos no cancelados del mismo día que se pisan.
  // Con profesional elegido solo avisa su agenda.
  let overlapWarning: string | null = null;
  try {
    const sameDay = await queryMany<{ booking_time: string; duration_min: number | null; customer_name: string | null; staff_id: string | null }>(
      `SELECT booking_time::text AS booking_time, duration_min, customer_name, staff_id::text AS staff_id
       FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed')`,
      [gate.vendor.id, bookingDate]
    );
    const start = toMinutes(bookingTime)!;
    const end = start + durationMin + bufferMin;
    const clash = (sameDay || []).find((b) => {
      if (staffId && b.staff_id && b.staff_id !== staffId) return false;
      const bs = toMinutes(b.booking_time);
      if (bs == null) return false;
      const be = bs + (Number(b.duration_min) || 60);
      return start < be && bs < end;
    });
    if (clash) {
      overlapWarning = `Se pisa con el turno de ${clash.customer_name || "otro cliente"} (${String(clash.booking_time).slice(0, 5)})`;
    }
  } catch { /* sin tabla: sin chequeo */ }

  // Día bloqueado (feriado/vacaciones): avisa sin bloquear (el comercio decide).
  let blockWarning: string | null = null;
  try {
    const blocks = await queryMany<{ staff_id: string | null; reason: string | null }>(
      `SELECT staff_id::text AS staff_id, reason FROM estetica_blocks
       WHERE vendor_id = $1 AND block_date = $2::date LIMIT 20`,
      [gate.vendor.id, bookingDate]
    ).catch(() => []);
    const hit = (blocks || []).find((b) => !b.staff_id || (staffId && b.staff_id === staffId));
    if (hit) {
      blockWarning = `Ese día está bloqueado${hit.reason ? `: ${hit.reason}` : ""}`;
    }
  } catch { /* sin tabla: sin aviso */ }

  const startsAt = `${bookingDate}T${String(bookingTime).slice(0, 5)}:00`;
  const endMin = toMinutes(bookingTime)! + durationMin + bufferMin;
  const endsAt = `${bookingDate}T${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}:00`;

  let bookingId: string | null = null;
  try {
    bookingId = await withTransaction(async (tx) => {
      let b;
      const notesVal = String(body.notes || "").trim().slice(0, 2000) || null;
      const pnameVal = serviceName || String(body.product_name || "").trim() || null;
      const quoteVal = typeof body.quote_id === "string" && body.quote_id ? body.quote_id : null;
      const confirmVal = crypto.randomBytes(16).toString("hex");
      try {
        b = await tx.query<{ id: string }>(
          `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, service_price, commission_pct, location_id, confirm_token, notes, status, origin, quote_id)
           VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, 'confirmed', 'vendor', $17) RETURNING id`,
          [gate.vendor.id, pnameVal, customerName, customerPhone, bookingDate, bookingTime, durationMin, staffId, serviceId, startsAt, endsAt, servicePrice, snapshotCommission, locationId, confirmVal, notesVal, quoteVal]
        );
      } catch {
        try {
          b = await tx.query<{ id: string }>(
            `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, location_id, notes, status, origin, quote_id)
             VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, 'confirmed', 'vendor', $14) RETURNING id`,
            [gate.vendor.id, pnameVal, customerName, customerPhone, bookingDate, bookingTime, durationMin, staffId, serviceId, startsAt, endsAt, locationId, notesVal, quoteVal]
          );
        } catch {
          try {
            b = await tx.query<{ id: string }>(
              `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, notes, status, origin, quote_id)
               VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, 'confirmed', 'vendor', $13) RETURNING id`,
              [gate.vendor.id, pnameVal, customerName, customerPhone, bookingDate, bookingTime, durationMin, staffId, serviceId, startsAt, endsAt, notesVal, quoteVal]
            );
          } catch {
            b = await tx.query<{ id: string }>(
              `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, notes, status, origin, quote_id)
               VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'vendor', $9) RETURNING id`,
              [gate.vendor.id, pnameVal, customerName, customerPhone, bookingDate, bookingTime, durationMin, notesVal, quoteVal]
            );
          }
        }
      }
      const id = b[0]?.id;
      if (!id) throw new Error("No se pudo crear el turno");
      await ensureServiceCustomer(tx, gate.vendor.id, { phone: customerPhone, name: customerName });
      return id;
    });
  } catch (e) {
    if (/origin|duration_min|quote_id/i.test((e as Error)?.message || "")) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    throw e;
  }

  const booking = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [bookingId]
  ).catch(() => undefined);
  return NextResponse.json({ booking: booking || { id: bookingId }, warning: overlapWarning, blockWarning });
}