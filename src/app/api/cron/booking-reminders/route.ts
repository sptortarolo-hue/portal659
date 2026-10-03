import { query, queryMany, queryOne } from "@/lib/db";
import { notifyServiceClient } from "@/lib/service-notify";
import { sendPushToUser } from "@/lib/push";
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
    fichaCapable = !!svc?.exists && !!tpl?.exists && !!ent?.exists;
  } catch { /* sin link */ }

  // --- T-24h: mañana, comercio + cliente ---
  const due24 = await queryMany<DueBooking>(
    `SELECT b.id, b.vendor_id, b.customer_name, b.customer_phone, b.product_name,
            b.booking_date::text AS booking_date, b.booking_time::text AS booking_time,
            v.store_name, v.user_id${tokenSel}${svcSel}
     FROM bookings b JOIN vendors v ON v.id = b.vendor_id
     WHERE b.status = 'confirmed' AND b.booking_date = $1
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
      await query(`INSERT INTO service_reminder_log (booking_id, kind) VALUES ($1, 't24') ON CONFLICT DO NOTHING`, [b.id]);
      sent.t24++;
    } catch { /* sigue con el próximo */ }
  }

  // --- T-2h: hoy en ventana, solo cliente ---
  if (sameDay) {
    const due2 = await queryMany<DueBooking>(
      `SELECT b.id, b.vendor_id, b.customer_name, b.customer_phone, b.product_name,
              b.booking_date::text AS booking_date, b.booking_time::text AS booking_time,
              v.store_name, v.user_id${tokenSel}
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       WHERE b.status = 'confirmed' AND b.booking_date = $1
         AND b.booking_time >= $2 AND b.booking_time <= $3
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
        await query(`INSERT INTO service_reminder_log (booking_id, kind) VALUES ($1, 't2') ON CONFLICT DO NOTHING`, [b.id]);
        sent.t2++;
      } catch { /* sigue con el próximo */ }
    }
  }

  return NextResponse.json({ ok: true, date: todayAR, sent });
}
