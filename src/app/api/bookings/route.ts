import { query, queryMany, queryOne } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { getSiteUrl } from "@/lib/site-url";
import { getServiceQuota, ServiceQuotaError } from "@/lib/service-quota";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import crypto from "crypto";

const toMinutes = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const vendorId = String(raw.vendorId || "");
  const productName = raw.productName != null ? String(raw.productName) : null;
  const bookingDate = String(raw.bookingDate || "");
  const bookingTime = String(raw.bookingTime || "");
  const notes = raw.notes != null ? String(raw.notes) : null;
  const customerName = String(raw.customerName || "").trim();
  const customerPhoneRaw = String(raw.customerPhone || "");
  // Teléfono normalizado E164 (matchea créditos de packs y evita duplicados
  // por formato). Sin celular válido no hay turno (se avisa por WA).
  const customerPhone = String(toE164(customerPhoneRaw) || "");
  if (!customerPhone) {
    return NextResponse.json({ error: "Ingresá un celular válido" }, { status: 400 });
  }
  const staffId = typeof body.staffId === "string" && body.staffId ? body.staffId : null;
  const serviceId = typeof body.serviceId === "string" && body.serviceId ? body.serviceId : null;
  const locationIdRaw = typeof body.locationId === "string" && body.locationId ? body.locationId : null;

  if (!vendorId || !bookingDate || !bookingTime || !customerName) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDate)) || toMinutes(String(bookingTime)) == null) {
    return NextResponse.json({ error: "Fecha u hora inválida" }, { status: 400 });
  }
  // Sin turnos en el pasado (compara fecha AR, sin hora: el de hoy vale).
  try {
    const todayAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (String(bookingDate) < todayAR) {
      return NextResponse.json({ error: "La fecha ya pasó" }, { status: 400 });
    }
  } catch { /* sin TZ: se sigue */ }

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

  // Día bloqueado (feriado/vacaciones): 409 como el solape. Sin tabla se ignora.
  try {
    const blocks = await queryMany<{ staff_id: string | null }>(
      `SELECT staff_id::text AS staff_id FROM estetica_blocks
       WHERE vendor_id = $1 AND block_date = $2::date LIMIT 20`,
      [vendorId, bookingDate]
    ).catch(() => []);
    const hit = (blocks || []).find((b) => !b.staff_id || (staffId && b.staff_id === staffId));
    if (hit) {
      return NextResponse.json({ error: "Ese día el centro está cerrado" }, { status: 409 });
    }
  } catch { /* sin tabla: sin bloqueo */ }

  // Servicio/profesional (estética): resuelve duración + buffer + seña.
  // Todo tolerante a migración sin aplicar (las tablas pueden no existir).
  let durationMin = 60;
  let bufferMin = 0;
  let depositAmount: number | null = null;
  let serviceName: string | null = null;
  let servicePrice: number | null = null;
  let serviceCommission: number | null = null;
  let staffCommission: number | null = null;
  let requireDeposit = false;
  let depositHours = 24;
  try {
    if (serviceId) {
      const svc = await queryOne<{
        name: string;
        duration_min: number | null;
        buffer_min: number | null;
        deposit_amount: number | null;
        price: number | null;
        commission_pct: number | null;
        require_deposit: boolean | null;
        deposit_hours: number | null;
        active: boolean | null;
      }>(
        `SELECT name, duration_min, buffer_min, deposit_amount, price, commission_pct, require_deposit, deposit_hours, active FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [serviceId, vendorId]
      ).catch(() =>
        queryOne<{
          name: string;
          duration_min: number | null;
          buffer_min: number | null;
          deposit_amount: number | null;
          price: number | null;
          commission_pct: number | null;
          require_deposit: boolean | null;
          deposit_hours: number | null;
          active: boolean | null;
        }>(
          `SELECT name, duration_min, buffer_min, deposit_amount, price, commission_pct, active FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [serviceId, vendorId]
        )
      ).catch(() =>
        queryOne<{
          name: string;
          duration_min: number | null;
          buffer_min: number | null;
          deposit_amount: number | null;
          price: number | null;
          commission_pct: number | null;
          require_deposit: boolean | null;
          deposit_hours: number | null;
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
      // Seña obligatoria solo si hay monto configurado (si no, se ignora).
      if (svc.require_deposit === true && depositAmount != null && depositAmount > 0) {
        requireDeposit = true;
        if (svc.deposit_hours != null && Number(svc.deposit_hours) >= 1) {
          depositHours = Math.min(168, Math.max(1, Math.floor(Number(svc.deposit_hours))));
        }
      }
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

  // Token público de confirmación (/turno/[token]): la clienta confirma o
  // cancela sin cuenta. Solo tier 1 (migrate-estetica-confirm-token.sql);
  // los demás tiers lo omiten (queda NULL y el panel puede generarlo).
  const confirmToken = crypto.randomBytes(16).toString("hex");

  // customer_name/phone viven en migrate-service-requests.sql; staff/service/
  // starts/ends/deposit en migrate-estetica.sql; service_price/commission_pct
  // en migrate-estetica-commissions.sql. Fallbacks en cascada.
  let booking: { id: string } | undefined;
  try {
    booking = await queryOne<{ id: string }>(
      `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, staff_id, service_id, starts_at, ends_at, deposit_amount, service_price, commission_pct, location_id, confirm_token, notes, status)
       VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, $17, 'pending') RETURNING id`,
      [vendorId, serviceName || productName || null, customerName, customerPhone, bookingDate, String(bookingTime).slice(0, 5), durationMin, staffId, serviceId, startsAt, endsAt, depositAmount, servicePrice, snapshotCommission, locationId, confirmToken, notes || null]
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

  // Seña obligatoria ("si no paga, no reserva"): el turno nace pendiente de
  // pago. Si el comercio tiene MP, se genera la preferencia en el acto y se
  // devuelve el link; si no, queda pendiente y se coordina por WhatsApp.
  // El cron auto-cancela vencidos (deposit_hours).
  let depositInitPoint: string | null = null;
  let depositWarning: string | null = null;
  if (requireDeposit && booking?.id && depositAmount != null && depositAmount > 0) {
    try {
      await query(
        `UPDATE bookings SET deposit_amount = $1, deposit_status = 'pending' WHERE id = $2`,
        [depositAmount, booking.id]
      );
    } catch { /* sin columnas: el cron lo trata como normal */ }
    try {
      const { getVendorMpToken, isMpEnabled } = await import("@/lib/mp-oauth");
      if (isMpEnabled()) {
        const vmp = await queryOne<{
          store_name: string | null;
          slug: string | null;
          mp_access_token: string | null;
          mp_refresh_token: string | null;
          mp_public_key: string | null;
          mp_user_id: number | null;
          mp_expires_at: string | null;
        }>(
          `SELECT store_name, slug, mp_access_token, mp_refresh_token, mp_public_key, mp_user_id, mp_expires_at
           FROM vendors WHERE id = $1 LIMIT 1`,
          [vendorId]
        ).catch(() => undefined);
        const mpToken = vmp ? await getVendorMpToken(vmp as never).catch(() => null) : null;
        if (mpToken) {
          const siteUrl = getSiteUrl(request);
          const back = `${siteUrl}/tienda/${(vmp as { slug?: string | null })?.slug || vendorId}`;
          const externalReference = `portal659_sena_turno_${booking.id}_${Date.now()}`;
          const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
            body: JSON.stringify({
              items: [
                {
                  title: `Seña turno — ${serviceName || "servicio"} (${customerName})`.slice(0, 120),
                  unit_price: depositAmount,
                  quantity: 1,
                  currency_id: "ARS",
                },
              ],
              metadata: { vendor_id: vendorId, booking_id: booking.id, kind: "service_deposit" },
              external_reference: externalReference,
              back_urls: { success: back, failure: back, pending: back },
              auto_return: "approved",
              notification_url: `${siteUrl}/api/webhooks/mercadopago`,
            }),
            signal: AbortSignal.timeout(15000),
          });
          const pdata = await pref.json().catch(() => null);
          if (pdata?.id) {
            const isTest = mpToken.startsWith("TEST-");
            depositInitPoint = (isTest && pdata.sandbox_init_point ? pdata.sandbox_init_point : pdata.init_point) || null;
          } else {
            depositWarning = "No se pudo generar el pago online: coordiná la seña por WhatsApp.";
          }
        } else {
          depositWarning = "Este servicio exige seña: coordiná el pago por WhatsApp.";
        }
      } else {
        depositWarning = "Este servicio exige seña: coordiná el pago por WhatsApp.";
      }
    } catch {
      depositWarning = "Este servicio exige seña: coordiná el pago por WhatsApp.";
    }
  }

  const vendor = await queryOne<{ user_id: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  // Usar 1 sesión de pack (estética): la clienta paga el turno con su saldo.
  // Se descuenta DESPUÉS de crear el turno; si no hay saldo, el turno queda
  // igual y se avisa (se cobra normal).
  let packWarning: string | null = null;
  let packUsed: { pack_name: string; remaining: number } | null = null;
  const usePack = body.usePackCredit;
  if (usePack && booking?.id) {
    try {
      const phoneE164 = toE164(String(customerPhone));
      const wantPack = typeof usePack === "string" && usePack ? usePack : null;
      if (phoneE164) {
        const params: unknown[] = [vendorId, phoneE164];
        let extra = "";
        if (wantPack) {
          params.push(wantPack);
          extra = "AND c.pack_id = $3";
        }
        const credit = await queryOne<{ id: string }>(
          `SELECT c.id FROM service_pack_credits c
           WHERE c.vendor_id = $1 AND c.customer_phone = $2 AND c.remaining > 0 ${extra}
           ORDER BY c.created_at ASC LIMIT 1`,
          params
        ).catch(() => undefined);
        if (credit) {
          const updated = await queryOne<{ remaining: number; pack_name: string }>(
            `UPDATE service_pack_credits SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0
             RETURNING remaining, (SELECT name FROM service_packs WHERE id = service_pack_credits.pack_id) AS pack_name`,
            [credit.id]
          ).catch(() => undefined);
          if (updated) {
            packUsed = { pack_name: String(updated.pack_name || "pack"), remaining: Number(updated.remaining) || 0 };
          } else {
            packWarning = "No se pudo usar tu sesión (se terminó justo ahora): el turno quedó reservado igual.";
          }
        } else {
          packWarning = "No encontramos sesiones disponibles en tu teléfono: el turno quedó reservado igual.";
        }
      }
    } catch {
      packWarning = "No se pudo usar tu sesión: el turno quedó reservado igual.";
    }
  }

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

  // Confirmación por WhatsApp (fire-and-forget): no frena la respuesta.
  // Solo diurno; opt-out vendors.wa_reminders; sin relay vinculado no sale.
  try {
    const { isDaytimeAR: isDay, sendWaText: sendWa } = await import("@/lib/wa-send");
    if (isDay() && customerPhone && booking?.id) {
      const vrow = await queryOne<{ store_name: string | null; wa_reminders: boolean | null }>(
        `SELECT store_name, wa_reminders FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      ).catch(() => null);
      if ((vrow as any)?.wa_reminders !== false) {
        // Si la migración de confirm_token no está, se avisa sin link.
        let withLink = true;
        try {
          await queryOne(`SELECT confirm_token FROM bookings WHERE id = $1 LIMIT 1`, [booking.id]);
        } catch {
          withLink = false;
        }
        const siteUrl = getSiteUrl(request);
        void sendWa({
          vendorId,
          waId: customerPhone,
          text:
            `✅ ¡Turno recibido en ${(vrow as any)?.store_name || "el local"}! ${bookingDate} a las ${String(bookingTime).slice(0, 5)}` +
            (serviceName ? ` · ${serviceName}` : "") +
            (requireDeposit && depositAmount
              ? ` Para confirmarlo aboná la seña de $${Number(depositAmount).toLocaleString("es-AR")} dentro de ${depositHours}h${depositInitPoint ? ` acá: ${depositInitPoint}` : ""}. Si no se acredita, el turno se libera.`
              : withLink ? ` Confirmalo o cancelalo acá: ${siteUrl}/turno/${confirmToken}` : ""),
        }).catch(() => undefined);
      }
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, bookingId: booking?.id, packUsed, packWarning, depositRequired: requireDeposit, depositAmount, depositInitPoint, depositWarning });
}, { maxRequests: 10 });
