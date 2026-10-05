import { query, queryMany, queryOne } from "@/lib/db";
import { notifyServiceClient } from "@/lib/service-notify";
import { sendPushToUser } from "@/lib/push";
import { isDaytimeAR, sendWaText } from "@/lib/wa-send";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TZ_AR = "America/Argentina/Buenos_Aires";

/** Capacidad de fichas (tablas + columnas presentes). Se calcula por request. */
let fichaCapable = false;

/** Fecha AR (YYYY-MM-DD) de hoy +offset días. */
function arDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // YYYY-MM-DD
}

/** Hora AR actual (HH:MM). */
function arTimeHHMM(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function plusHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const norm = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
}

type DueBooking = {
  id: string;
  vendor_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  product_name: string | null;
  booking_date: string;
  booking_time: string;
  store_name: string;
  user_id: string | null;
  confirm_token?: string | null;
  service_id?: string | null;
  wa_reminders?: boolean | null;
};

/** Ficha pendiente con require_before: crea borrador y devuelve link, o null. */
const tplCache = new Map<string, { id: string; name: string; service_ids: string[] }[]>();
async function fichaLinkFor(b: DueBooking): Promise<string | null> {
  if (!fichaCapable || !b.customer_phone) return null;
  try {
    let tpls = tplCache.get(b.vendor_id);
    if (!tpls) {
      const rows = await queryMany<{ id: string; name: string; service_ids: string[] }>(
        `SELECT id::text AS id, name, service_ids FROM customer_form_templates
         WHERE vendor_id = $1 AND active = true AND require_before = true`,
        [b.vendor_id]
      ).catch(() => []);
      tpls = (rows || []).map((t) => ({
        id: String(t.id),
        name: String(t.name ?? ""),
        service_ids: Array.isArray(t.service_ids) ? t.service_ids.map(String) : [],
      }));
      tplCache.set(b.vendor_id, tpls);
    }
    const match = tpls.find(
      (t) => t.service_ids.length === 0 || !b.service_id || t.service_ids.includes(String(b.service_id))
    );
    if (!match) return null;
    const existing = await queryMany<{ status: string; public_token: string }>(
      `SELECT status, public_token FROM customer_form_entries
       WHERE vendor_id = $1 AND template_id = $2 AND customer_phone = $3
       ORDER BY created_at DESC LIMIT 1`,
      [b.vendor_id, match.id, b.customer_phone]
    ).catch(() => []);
    if (existing?.[0]?.public_token) {
      if (existing[0].status === "complete") return null;
      return `/ficha/${existing[0].public_token}`;
    }
    const count = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM customer_form_entries WHERE vendor_id = $1 AND template_id = $2 AND customer_phone = $3`,
      [b.vendor_id, match.id, b.customer_phone]
    ).catch(() => ({ c: 0 }));
    const { randomBytes } = await import("crypto");
    const row = await queryOne<{ public_token: string }>(
      `INSERT INTO customer_form_entries (vendor_id, template_id, customer_phone, booking_id, answers, session_no, status, public_token)
       VALUES ($1, $2, $3, $4, '{}', $5, 'draft', $6) RETURNING public_token`,
      [b.vendor_id, match.id, b.customer_phone, b.id, (count?.c || 0) + 1, randomBytes(16).toString("hex")]
    ).catch(() => undefined);
    return row?.public_token ? `/ficha/${row.public_token}` : null;
  } catch {
    return null;
  }
}

/**
 * Job de recordatorios de turnos (cron en el host cada 15 min):
 *   GET /api/cron/booking-reminders?secret=...
 * - T-24h: turnos confirmados de mañana AR → avisa a comercio (push) + cliente.
 * - T-2h: turnos confirmados de hoy AR en ventana de 2h → avisa al cliente.
 * Idempotente por service_reminder_log. Fail-closed sin CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const todayAR = arDate(0);
  const tomorrowAR = arDate(1);
  const nowHHMM = arTimeHHMM();
  const in2hHHMM = plusHours(nowHHMM, 2);
  const sameDay = in2hHHMM > nowHHMM; // si cruza medianoche, solo ventana de hoy

  const sent = { t24: 0, t2: 0 };

  // Token de confirmación (migrate-estetica-confirm-token.sql): el recordatorio
  // lleva el link /turno/[token] para confirmar sin cuenta. Tolerante a
  // migración sin aplicar (sin link, como antes).
  let tokenSel = "";
  let svcSel = "";
  let waSel = "";
  fichaCapable = false;
  try {
    const col = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'confirm_token') AS exists`
    );
    if (col?.exists === true) tokenSel = ", b.confirm_token";
    const svc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'service_id') AS exists`
    );
    const tpl = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_form_templates') AS exists`
    );
    const ent = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_form_entries') AS exists`
    );
    if (svc?.exists === true) svcSel = ", b.service_id::text AS service_id";
    try {
      const wr = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'wa_reminders') AS exists`
      );
      if (wr?.exists === true) waSel = ", v.wa_reminders";
    } catch { /* opt-out no disponible: se asume activado */ }
    fichaCapable = !!svc?.exists && !!tpl?.exists && !!ent?.exists;
  } catch { /* sin link */ }

  // Flag de prueba (migrate-service-preview.sql): no recordar ni reseñar
  // turnos de prueba. Sin columna, no se filtra (como antes).
  let previewFilter = "";
  try {
    const pc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'is_preview') AS exists`
    );
    if (pc?.exists === true) previewFilter = " AND COALESCE(b.is_preview, false) = false";
  } catch { /* sin flag */ }

  // --- T-24h: mañana, comercio + cliente ---
  const due24 = await queryMany<DueBooking>(
    `SELECT b.id, b.vendor_id, b.customer_name, b.customer_phone, b.product_name,
            b.booking_date::text AS booking_date, b.booking_time::text AS booking_time,
            v.store_name, v.user_id${waSel}${tokenSel}${svcSel}
     FROM bookings b JOIN vendors v ON v.id = b.vendor_id
     WHERE b.status = 'confirmed' AND b.booking_date = $1${previewFilter}
       AND NOT EXISTS (SELECT 1 FROM service_reminder_log l WHERE l.booking_id = b.id AND l.kind = 't24')`,
    [tomorrowAR]
  ).catch(() => []);
  for (const b of due24 || []) {
    const when = `${b.booking_date} ${String(b.booking_time || "").slice(0, 5)}`;
    const title = "⏰ Turno mañana";
    const bodyVendor = `${b.customer_name || "Cliente"} · mañana ${when}${b.product_name ? ` · ${b.product_name}` : ""}`;
    const bodyClient = `Te recordamos tu turno de mañana ${when} en ${b.store_name}.`;
    // Ficha exigida pendiente: borrador + link (una sola vez por el log t24).
    const fichaUrl = await fichaLinkFor(b);
    try {
      if (b.user_id) {
        await query(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
          [b.user_id, title, bodyVendor]
        );
        try {
          await sendPushToUser(b.user_id, { title, body: bodyVendor, link: "/vendor/dashboard" });
        } catch { /* best-effort */ }
      }
      await notifyServiceClient(b.customer_phone, {
        title,
        body: `${bodyClient}${b.confirm_token ? " Confirmá o cancelá acá: /turno/" + b.confirm_token : ""}${fichaUrl ? ` Completá tu ficha antes de venir: ${fichaUrl}` : ""}`,
        ...(b.confirm_token ? { link: `/turno/${b.confirm_token}` } : {}),
      });
      // WhatsApp por el número del comercio (opt-out vendors.wa_reminders,
      // solo diurno; si el relay no está vinculado se sigue con push).
      let channel: string | null = null;
      if (b.wa_reminders !== false && isDaytimeAR() && b.customer_phone) {
        const siteUrl = getSiteUrl(request);
        const waBody =
          `⏰ Hola ${String(b.customer_name || "").split(" ")[0] || ""}! Te recordamos tu turno de mañana ${when} en ${b.store_name}.`.trim() +
          (b.confirm_token ? ` Confirmá o cancelá acá: ${siteUrl}/turno/${b.confirm_token}` : "");
        const wa = await sendWaText({ vendorId: b.vendor_id, waId: b.customer_phone, text: waBody });
        if (wa.sent) channel = "wa";
      }
      try {
        await query(
          `INSERT INTO service_reminder_log (booking_id, kind, channel) VALUES ($1, 't24', $2) ON CONFLICT DO NOTHING`,
          [b.id, channel]
        );
      } catch {
        await query(`INSERT INTO service_reminder_log (booking_id, kind) VALUES ($1, 't24') ON CONFLICT DO NOTHING`, [b.id]);
      }
      sent.t24++;
    } catch { /* sigue con el próximo */ }
  }

  // --- T-2h: hoy en ventana, solo cliente ---
  if (sameDay) {
    const due2 = await queryMany<DueBooking>(
      `SELECT b.id, b.vendor_id, b.customer_name, b.customer_phone, b.product_name,
              b.booking_date::text AS booking_date, b.booking_time::text AS booking_time,
              v.store_name, v.user_id${waSel}${tokenSel}
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       WHERE b.status = 'confirmed' AND b.booking_date = $1
         AND b.booking_time >= $2 AND b.booking_time <= $3${previewFilter}
         AND NOT EXISTS (SELECT 1 FROM service_reminder_log l WHERE l.booking_id = b.id AND l.kind = 't2')`,
      [todayAR, nowHHMM, in2hHHMM]
    ).catch(() => []);
    for (const b of due2 || []) {
      const when = `${String(b.booking_time || "").slice(0, 5)}`;
      try {
        await notifyServiceClient(b.customer_phone, {
          title: "⏰ Tu turno es hoy",
          body: `Te esperamos hoy ${when} en ${b.store_name}${b.product_name ? ` · ${b.product_name}` : ""}.${b.confirm_token ? " Si surge algo, avisá acá: /turno/" + b.confirm_token : ""}`,
          ...(b.confirm_token ? { link: `/turno/${b.confirm_token}` } : {}),
        });
        let channel2: string | null = null;
        if (b.wa_reminders !== false && isDaytimeAR() && b.customer_phone) {
          const siteUrl = getSiteUrl(request);
          const wa = await sendWaText({
            vendorId: b.vendor_id,
            waId: b.customer_phone,
            text: `⏰ Hola ${String(b.customer_name || "").split(" ")[0] || ""}! Te esperamos hoy ${when} en ${b.store_name}.${b.confirm_token ? ` Si surge algo, avisá acá: ${siteUrl}/turno/${b.confirm_token}` : ""}`.trim(),
          });
          if (wa.sent) channel2 = "wa";
        }
        try {
          await query(`INSERT INTO service_reminder_log (booking_id, kind, channel) VALUES ($1, 't2', $2) ON CONFLICT DO NOTHING`, [b.id, channel2]);
        } catch {
          await query(`INSERT INTO service_reminder_log (booking_id, kind) VALUES ($1, 't2') ON CONFLICT DO NOTHING`, [b.id]);
        }
        sent.t2++;
      } catch { /* sigue con el próximo */ }
    }
  }

  // --- Seña obligatoria vencida: cancela turnos impagos ("si no paga, no reserva").
  // Solo origin portal (los manuales los maneja el comercio), deposit no pagada
  // y creada hace más de deposit_hours. Tolerante a migración sin aplicar.
  let expired = 0;
  try {
    const stale = await queryMany<{
      id: string;
      vendor_id: string;
      customer_name: string | null;
      customer_phone: string | null;
      booking_date: string;
      booking_time: string;
      store_name: string;
      user_id: string | null;
      wa_reminders: boolean | null;
      deposit_amount: number | null;
    }>(
      `SELECT b.id, b.vendor_id, b.customer_name, b.customer_phone,
              b.booking_date::text AS booking_date, b.booking_time::text AS booking_time,
              v.store_name, v.user_id, v.wa_reminders, b.deposit_amount
       FROM bookings b
       JOIN vendors v ON v.id = b.vendor_id
       JOIN services s ON s.id = b.service_id
       WHERE b.status = 'pending' AND COALESCE(b.origin, 'portal') = 'portal'
         AND COALESCE(b.deposit_status, 'none') <> 'paid'
         AND COALESCE(s.require_deposit, false) = true${previewFilter}
         AND b.created_at < now() - (COALESCE(s.deposit_hours, 24) || ' hours')::interval`
    ).catch(() => []);
    for (const b of stale || []) {
      try {
        await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [b.id]);
        const when = `${b.booking_date} ${String(b.booking_time || "").slice(0, 5)}`;
        if (b.user_id) {
          const title = "Turno liberado (seña impaga)";
          const body = `${b.customer_name || "La clienta"} no abonó la seña en término: se liberó el turno del ${when}.`;
          await query(
            `INSERT INTO notifications (user_id, title, body, type, link)
             VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
            [b.user_id, title, body]
          ).catch(() => undefined);
          try {
            await sendPushToUser(b.user_id, { title, body, link: "/vendor/dashboard" });
          } catch { /* best-effort */ }
        }
        await notifyServiceClient(b.customer_phone, {
          title: "Tu turno se liberó",
          body: `No se acreditó la seña en término y tu turno del ${when} en ${b.store_name} quedó libre. Escribinos para reprogramar.`,
        });
        if (b.wa_reminders !== false && isDaytimeAR() && b.customer_phone) {
          await sendWaText({
            vendorId: b.vendor_id,
            waId: b.customer_phone,
            text: `Hola ${String(b.customer_name || "").split(" ")[0] || ""}! Como no se acreditó la seña, tu turno del ${when} en ${b.store_name} quedó libre. Escribinos si querés reprogramarlo.`.trim(),
          }).catch(() => undefined);
        }
        expired++;
      } catch { /* sigue con el próximo */ }
    }
  } catch { /* sin columnas: sin expiración */ }

  // --- Pedido de reseña post-visita (1 vez al día, 10:00 AR): turnos de ayer.
  // Push si tiene cuenta + WA diurno. Log anti-duplicados service_review_log.
  // --- Win-back (misma ventana): clientas sin venir hace 45+ días.
  try {
    const hhmm = arTimeHHMM();
    if (hhmm >= "10:00" && hhmm < "10:15") {
      const yesterdayAR = arDate(-1);
      // Reviews.
      const done = await queryMany<{
        booking_id: string;
        vendor_id: string;
        customer_name: string | null;
        customer_phone: string | null;
        store_name: string;
        slug: string | null;
        google_review_url: string | null;
        wa_reminders: boolean | null;
      }>(
        `SELECT b.id AS booking_id, b.vendor_id, b.customer_name, b.customer_phone,
                v.store_name, v.slug, v.google_review_url, v.wa_reminders
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
         WHERE b.status = 'confirmed' AND b.booking_date = $1
           AND v.vertical = 'estetica'${previewFilter}
           AND NOT EXISTS (SELECT 1 FROM service_review_log l WHERE l.booking_id = b.id)
         LIMIT 100`,
        [yesterdayAR]
      ).catch(() => []);
      const siteUrl = getSiteUrl(request);
      for (const b of done || []) {
        try {
          const reviewUrl = `${siteUrl}/tienda/${b.slug || b.vendor_id}`;
          await notifyServiceClient(b.customer_phone, {
            title: `¿Cómo te atendieron ayer en ${b.store_name}? ⭐`,
            body: `Contanos con 1 a 5 estrellas acá: ${reviewUrl}`,
            link: `/tienda/${b.slug || b.vendor_id}`,
          });
          if (b.wa_reminders !== false && isDaytimeAR() && b.customer_phone) {
            await sendWaText({
              vendorId: b.vendor_id,
              waId: b.customer_phone,
              text:
                `Hola ${String(b.customer_name || "").split(" ")[0] || ""}! ¿Cómo te atendimos ayer en ${b.store_name}? Dejanos tu opinión acá: ${reviewUrl}`.trim() +
                (b.google_review_url ? ` (o en Google: ${b.google_review_url})` : ""),
            }).catch(() => undefined);
          }
          await query(`INSERT INTO service_review_log (booking_id) VALUES ($1) ON CONFLICT DO NOTHING`, [b.booking_id]).catch(() => undefined);
        } catch { /* sigue */ }
      }
      // Win-back.
      const gone = await queryMany<{
        vendor_id: string;
        phone: string;
        name: string | null;
        store_name: string;
        slug: string | null;
        wa_reminders: boolean | null;
      }>(
        `SELECT c.vendor_id, c.phone, c.name, v.store_name, v.slug, v.wa_reminders
         FROM customers c JOIN vendors v ON v.id = c.vendor_id
         WHERE v.vertical = 'estetica'
           AND c.last_order_at IS NOT NULL AND c.last_order_at < now() - interval '45 days'
           AND (c.last_winback_at IS NULL OR c.last_winback_at < now() - interval '45 days')
         LIMIT 50`
      ).catch(() => []);
      for (const c of gone || []) {
        try {
          await notifyServiceClient(c.phone, {
            title: `¡Te extrañamos en ${c.store_name}! 💅`,
            body: `Hace rato no venís. Reservá tu próximo turno acá: ${siteUrl}/tienda/${c.slug || c.vendor_id}`,
            link: `/tienda/${c.slug || c.vendor_id}`,
          });
          if (c.wa_reminders !== false && isDaytimeAR()) {
            await sendWaText({
              vendorId: c.vendor_id,
              waId: c.phone,
              text: `Hola ${String(c.name || "").split(" ")[0] || ""}! En ${c.store_name} te extrañamos 💅 Reservá tu próximo turno acá: ${siteUrl}/tienda/${c.slug || c.vendor_id}`.trim(),
            }).catch(() => undefined);
          }
          await query(`UPDATE customers SET last_winback_at = now() WHERE vendor_id = $1 AND phone = $2`, [c.vendor_id, c.phone]).catch(() => undefined);
        } catch { /* sigue */ }
      }
    }
  } catch { /* recordatorios principales ya salieron */ }

  return NextResponse.json({ ok: true, date: todayAR, sent, expired });
}
