import { query, queryMany, queryOne } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { getServiceQuota, ServiceQuotaError } from "@/lib/service-quota";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

const toMinutes = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json();
  const { vendorId, productName, bookingDate, bookingTime, notes, customerName, customerPhone } = body;
  const staffId = typeof body.staffId === "string" && body.staffId ? body.staffId : null;
  const serviceId = typeof body.serviceId === "string" && body.serviceId ? body.serviceId : null;
  const locationIdRaw = typeof body.locationId === "string" && body.locationId ? body.locationId : null;

  if (!vendorId || !bookingDate || !bookingTime || !customerName || !customerPhone) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDate)) || toMinutes(String(bookingTime)) == null) {
    return NextResponse.json({ error: "Fecha u hora inválida" }, { status: 400 });
  }

  // Tope mensual del plan (servicios: 5; estética gratis: 10). 429 si se alcanza.
  try {
    const quota = await getServiceQuota(vendorId);
    if (quota.limit != null && quota.used >= quota.limit) throw new ServiceQuotaError();
  } catch (e) {
    if (e instanceof ServiceQuotaError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    // Sin tabla/columna (migración pendiente): seguir sin tope.
  }

  // Servicio/profesional (estética): resuelve duración + buffer + seña.
  // Todo tolerante a migración sin aplicar (las tablas pueden no existir).
  let durationMin = 60;
  let bufferMin = 0;
  let depositAmount: number | null = null;
  let serviceName: string | null = null;
  let servicePrice: number | null = null;
  let serviceCommission: number | null = null;
  let staffCommission: number | null = null;
  try {
    if (serviceId) {
      const svc = await queryOne<{
        name: string;
        duration_min: number | null;
        buffer_min: number | null;
        deposit_amount: number | null;
        price: number | null;
        commission_pct: number | null;
        active: boolean | null;
      }>(
        `SELECT name, duration_min, buffer_min, deposit_amount, price, commission_pct, active FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [serviceId, vendorId]
      ).catch(() =>
        queryOne<{
          name: string;
          duration_min: number | null;
          buffer_min: number | null;
          deposit_amount: number | null;
          price: number | null;
          commission_pct: number | null;
          active: boolean | null;
        }>(
          `SELECT name, duration_min, buffer_min, deposit_amount, active FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [serviceId, vendorId]
        )
      );
      if (!svc || svc.active === false) {
        return NextResponse.json({ error: "El servicio elegido ya no está disponible" }, { status: 400 });
      }
      serviceName = svc.name;
      if (Number(svc.duration_min) > 0) durationMin = Math.min(480, Math.max(15, Math.floor(Number(svc.duration_min))));
      if (Number(svc.buffer_min) > 0) bufferMin = Math.min(120, Math.max(0, Math.floor(Number(svc.buffer_min))));
      if (svc.deposit_amount != null && Number(svc.deposit_amount) > 0) depositAmount = Number(svc.deposit_amount);
      if (svc.price != null && Number(svc.price) >= 0) servicePrice = Number(svc.price);
      if (svc.commission_pct != null && Number(svc.commission_pct) >= 0) serviceCommission = Number(svc.commission_pct);
    }
    if (staffId) {
      const st = await queryOne<{ id: string; commission_pct: number | null }>(
        `SELECT id, commission_pct FROM estetica_staff WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
        [staffId, vendorId]
      ).catch(() =>
        queryOne<{ id: string; commission_pct: number | null }>(
          `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
          [staffId, vendorId]
        )
      );
      if (!st) {
        return NextResponse.json({ error: "El profesional elegido ya no está disponible" }, { status: 400 });
      }
      if (st.commission_pct != null && Number(st.commission_pct) >= 0) staffCommission = Number(st.commission_pct);
    }
  } catch {
    // Sin tablas (migración pendiente): se sigue como turno simple.
  }
  // % vigente al reservar: el del servicio, si no el del profesional.
  const snapshotCommission = serviceCommission ?? staffCommission;
  // Sede elegida (multi-sede light): se valida y se guarda; NULL = sin preferencia.
  let locationId: string | null = null;
  if (locationIdRaw) {
    try {
      const loc = await queryOne<{ id: string }>(
        `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
        [locationIdRaw, vendorId]
      );
      if (!loc) {
        return NextResponse.json({ error: "La sede elegida ya no está disponible" }, { status: 400 });
      }
      locationId = locationIdRaw;
    } catch {
      // Sin tabla (migración pendiente): se ignora la sede.
    }
  }

  const startMin = toMinutes(String(bookingTime))!;
  const endMin = startMin + durationMin + bufferMin;

  // Control de solape (bloquea): turnos no cancelados del mismo día que se
  // pisan. Con profesional elegido solo bloquea su agenda; sin profesional,
  // bloquea contra todos (conservador). Tolera filas legacy sin starts_at.
  try {
    const rows = await queryMany<{
      booking_time: string;
      duration_min: number | null;
      starts_at: string | null;
      ends_at: string | null;
      staff_id: string | null;
    }>(
      `SELECT booking_time::text AS booking_time, duration_min, starts_at::text AS starts_at, ends_at::text AS ends_at,
              staff_id::text AS staff_id
       FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed')`,
      [vendorId, bookingDate]
    );
    const clash = (rows || []).find((b) => {
      if (staffId && b.staff_id && b.staff_id !== staffId) return false;
      if (b.starts_at && b.ends_at) {
        const bs = new Date(b.starts_at).getTime();
        const be = new Date(b.ends_at).getTime();
        if (Number.isNaN(bs) || Number.isNaN(be)) return false;
        const dayStart = new Date(`${bookingDate}T00:00:00`).getTime();
        const s = dayStart + startMin * 60000;
        const e = dayStart + endMin * 60000;
        return s < be && bs < e;
      }
      const bs = toMinutes(b.booking_time);
      if (bs == null) return false;
      const be = bs + (Number(b.duration_min) || 60);
      return startMin < be && bs < endMin;
    });
    if (clash) {
      return NextResponse.json(
        { error: "Ese horario ya está ocupado. Elegí otro horario." },
        { status: 409 }
      );
    }
  } catch { /* sin tabla: sin chequeo */ }

  const startsAt = `${bookingDate}T${String(bookingTime).slice(0, 5)}:00`;
  const endsAtDate = new Date(new Date(startsAt).getTime() + (durationMin + bufferMin) * 60000);
  const endsAt = Number.isNaN(endsAtDate.getTime())
    ? null
    : `${bookingDate}T${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}:00`;

  // customer_name/phone viven en migrate-service-requests.sql; staff/service/
  // starts/ends/deposit en migrate-estetica.sql; service_price/commission_pct
  // en migrate-estetica-commissions.sql. Fallbacks en cascada.
  let booking: { id: string } | undefined;
  try {
    booking = await queryOne<{ id: string }>(
      `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, deposit_amount, service_price, commission_pct, location_id, notes, status)
       VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, 'pending') RETURNING id`,
      [vendorId, serviceName || productName || null, customerName, customerPhone, bookingDate, String(bookingTime).slice(0, 5), durationMin, staffId, serviceId, startsAt, endsAt, depositAmount, servicePrice, snapshotCommission, locationId, notes || null]
    );
  } catch {
    try {
      booking = await queryOne<{ id: string }>(
        `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, deposit_amount, location_id, notes, status)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, 'pending') RETURNING id`,
        [vendorId, serviceName || productName || null, customerName, customerPhone, bookingDate, String(bookingTime).slice(0, 5), durationMin, staffId, serviceId, startsAt, endsAt, depositAmount, locationId, notes || null]
      );
    } catch {
      try {
        booking = await queryOne<{ id: string }>(
          `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, deposit_amount, notes, status)
           VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, 'pending') RETURNING id`,
          [vendorId, serviceName || productName || null, customerName, customerPhone, bookingDate, String(bookingTime).slice(0, 5), durationMin, staffId, serviceId, startsAt, endsAt, depositAmount, notes || null]
        );
      } catch {
        try {
          booking = await queryOne<{ id: string }>(
            `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, notes, status)
             VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
            [vendorId, serviceName || productName || null, customerName, customerPhone, bookingDate, bookingTime, notes || null]
          );
        } catch {
          booking = await queryOne<{ id: string }>(
            `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, booking_date, booking_time, notes, status)
             VALUES ($1, NULL, NULL, $2, $3, $4, $5, 'pending') RETURNING id`,
            [vendorId, serviceName || productName || null, bookingDate, bookingTime, notes || null]
          );
        }
      }
    }
  }

  const vendor = await queryOne<{ user_id: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendor?.user_id) {
    const label = serviceName || productName;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
      [
        vendor.user_id,
        "Nuevo turno reservado",
        `${customerName} reservó turno para ${bookingDate} a las ${bookingTime}${label ? ` — ${label}` : ""}`,
      ]
    );
    try {
      await sendPushToUser(vendor.user_id, {
        title: "Nuevo turno reservado",
        body: `${customerName} · ${bookingDate} ${bookingTime}`,
        link: "/vendor/dashboard",
        tag: booking?.id ? `new-booking-${booking.id}` : "new-booking",
        renotify: true,
        requireInteraction: true,
        urgency: "high",
        ttl: 86400,
      });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, bookingId: booking?.id });
}, { maxRequests: 10 });
