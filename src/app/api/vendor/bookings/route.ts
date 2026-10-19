import { getVendorByRequest } from "@/lib/vendor-utils";
import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { computeBookingWarnings, computeStartsEnds, resolveBookingRefs, toMinutes } from "@/lib/vendor-booking";
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
  // Normaliza booking_date a "YYYY-MM-DD" (pg devuelve `date` como Date → el
  // JSON lo serializa como ISO con hora y rompía agrupado/formato en el panel).
  const normalized = (bookings || []).map((b: any) => ({
    ...b,
    booking_date: b?.booking_date
      ? b.booking_date instanceof Date
        ? b.booking_date.toISOString().slice(0, 10)
        : String(b.booking_date).slice(0, 10)
      : b?.booking_date,
  }));
  return NextResponse.json({ bookings: normalized });
}

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
  // Servicio/profesional/sede (estética): resuelve duración, buffer, precios y
  // comisiones. Todo tolerante a migración sin aplicar.
  const refs = await resolveBookingRefs(gate.vendor.id, {
    serviceId: body.service_id,
    staffId: body.staff_id,
    locationId: body.location_id,
    durationMin: body.duration_min,
  });
  const durationMin = refs.durationMin;
  const bufferMin = refs.bufferMin;
  const staffId = refs.staffId;
  const serviceId = refs.serviceId;
  const serviceName = refs.serviceName;
  const servicePrice = refs.servicePrice;
  const snapshotCommission = refs.snapshotCommission;
  const locationId = refs.locationId;

  const { overlapWarning, blockWarning, scheduleWarning } = await computeBookingWarnings(gate.vendor.id, {
    dateISO: bookingDate,
    time: bookingTime,
    durationMin,
    bufferMin,
    staffId,
  });

  const { startsAt, endsAt } = computeStartsEnds(bookingDate, bookingTime, durationMin, bufferMin);
  // Sesión de prueba compartida: el turno no cuenta en CRM/topes.
  const isPreview = gate.previewSession === true;

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
          `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, service_price, commission_pct, location_id, confirm_token, notes, status, origin, quote_id, is_preview)
           VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, 'confirmed', 'vendor', $17, $18) RETURNING id`,
          [gate.vendor.id, pnameVal, customerName, customerPhone, bookingDate, bookingTime, durationMin, staffId, serviceId, startsAt, endsAt, servicePrice, snapshotCommission, locationId, confirmVal, notesVal, quoteVal, isPreview]
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
      if (!isPreview) {
        await ensureServiceCustomer(tx, gate.vendor.id, { phone: customerPhone, name: customerName });
      }
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
  return NextResponse.json({ booking: booking || { id: bookingId }, warning: overlapWarning, blockWarning, scheduleWarning });
}