import { getVendorByRequest } from "@/lib/vendor-utils";
import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";

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

  const bookings = await queryMany<Record<string, unknown>>(
    `SELECT b.*, p.name AS product_label
     FROM bookings b
     LEFT JOIN products p ON p.id = b.product_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY b.booking_date ASC, b.booking_time ASC`,
    params
  );
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
  if (gate.vendor.vertical !== "servicio") {
    return NextResponse.json({ error: "Solo disponible para servicios" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customer_name || "").trim();
  const customerPhone = toE164(String(body.customer_phone || ""));
  const bookingDate = String(body.booking_date || "").trim();
  const bookingTime = String(body.booking_time || "").trim();
  if (!customerName || !customerPhone || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || toMinutes(bookingTime) == null) {
    return NextResponse.json({ error: "Faltan cliente, teléfono o fecha/hora válida" }, { status: 400 });
  }
  const durationMin = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));

  // Aviso de solape (no bloquea): turnos no cancelados del mismo día que se pisan.
  let overlapWarning: string | null = null;
  try {
    const sameDay = await queryMany<{ booking_time: string; duration_min: number | null; customer_name: string | null }>(
      `SELECT booking_time::text AS booking_time, duration_min, customer_name
       FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed')`,
      [gate.vendor.id, bookingDate]
    );
    const start = toMinutes(bookingTime)!;
    const end = start + durationMin;
    const clash = (sameDay || []).find((b) => {
      const bs = toMinutes(b.booking_time);
      if (bs == null) return false;
      const be = bs + (Number(b.duration_min) || 60);
      return start < be && bs < end;
    });
    if (clash) {
      overlapWarning = `Se pisa con el turno de ${clash.customer_name || "otro cliente"} (${String(clash.booking_time).slice(0, 5)})`;
    }
  } catch { /* sin tabla: sin chequeo */ }

  let bookingId: string | null = null;
  try {
    bookingId = await withTransaction(async (tx) => {
      const b = await tx.query<{ id: string }>(
        `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, notes, status, origin, quote_id)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'vendor', $9) RETURNING id`,
        [
          gate.vendor.id,
          String(body.product_name || "").trim() || null,
          customerName,
          customerPhone,
          bookingDate,
          bookingTime,
          durationMin,
          String(body.notes || "").trim().slice(0, 2000) || null,
          typeof body.quote_id === "string" && body.quote_id ? body.quote_id : null,
        ]
      );
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
  return NextResponse.json({ booking: booking || { id: bookingId }, warning: overlapWarning });
}