import { query, queryMany, queryOne, hasTable } from "@/lib/db";
import { notifyServiceClient } from "@/lib/service-notify";
import { isDaytimeAR, sendWaText } from "@/lib/wa-send";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TZ_AR = "America/Argentina/Buenos_Aires";

/** Hora AR actual (HH:MM). */
function arTimeHHMM(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_AR,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Recordatorio automático de service vencido (talleres):
 *   GET /api/cron/equipment-recalls?secret=...
 *
 * Encuentra equipos con al menos 1 trabajo completado, cuyo último service
 * fue hace más de 180 días, sin orden abierta, y manda recordatorio por
 * WhatsApp diurno + push (si tiene cuenta). Anti-spam: un recordatorio cada
 * 90 días por equipo (tabla equipment_reminder_log). Fail-closed sin
 * CRON_SECRET. Tolerante a migraciones sin aplicar (skip).
 *
 * Cron sugerido en el host (diario 10:00 AR = 13:00 UTC):
 *   0 13 * * * root curl -fsS "https://www.portal659.com.ar/api/cron/equipment-recalls?secret=$CRON_SECRET" >> /var/log/portal659-cron.log 2>&1
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Solo ventana diurna AR (no despertar a nadie de noche).
  if (!isDaytimeAR()) {
    return NextResponse.json({ ok: true, skipped: "off_hours" });
  }

  // Tolerancia a migraciones pendientes.
  const hasEq = await hasTable({ query: (sql: string, p?: unknown[]) => queryMany(sql, p) }, "equipment");
  if (!hasEq) {
    return NextResponse.json({ ok: true, skipped: "no_equipment_table" });
  }
  const hasLog = await hasTable({ query: (sql: string, p?: unknown[]) => queryMany(sql, p) }, "equipment_reminder_log");
  if (!hasLog) {
    return NextResponse.json({ ok: true, skipped: "no_reminder_log" });
  }

  // Ventana: corre diario 10:00 AR; si el host llamó fuera de hora, igual
  // procesa (el gate diurno ya filtró), pero con tope de envíos por corrida.
  const THRESHOLD_DAYS = 180;
  const RESEND_DAYS = 90;

  const candidates = await queryMany<{
    equipment_id: string;
    vendor_id: string;
    store_name: string;
    equipment_label: string;
    customer_name: string | null;
    customer_phone: string | null;
    last_service_at: string;
    wa_reminders: boolean | null;
  }>(
    `WITH last_service AS (
       SELECT b.equipment_id, MAX(COALESCE(b.completed_at, b.updated_at, b.created_at)) AS last_service_at
         FROM bookings b
        WHERE b.equipment_id IS NOT NULL AND b.status = 'completed'
        GROUP BY b.equipment_id
     )
     SELECT e.id AS equipment_id, e.vendor_id, v.store_name,
            TRIM(COALESCE(e.brand,'') || ' ' || COALESCE(e.model,'')) AS equipment_label,
            e.customer_name, e.customer_phone, ls.last_service_at::text AS last_service_at,
            v.wa_reminders
       FROM equipment e
       JOIN vendors v ON v.id = e.vendor_id
       JOIN last_service ls ON ls.equipment_id = e.id
      WHERE v.vertical = 'taller'
        AND e.customer_phone IS NOT NULL AND e.customer_phone <> ''
        AND ls.last_service_at < now() - ($1 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM bookings b2
           WHERE b2.equipment_id = e.id AND b2.status NOT IN ('completed', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1 FROM equipment_reminder_log l
           WHERE l.equipment_id = e.id AND l.sent_at > now() - ($2 || ' days')::interval
        )
      ORDER BY ls.last_service_at ASC
      LIMIT 50`,
    [THRESHOLD_DAYS, RESEND_DAYS]
  ).catch(() => []);

  let sent = 0;
  for (const row of candidates || []) {
    try {
      const phone = String(row.customer_phone || "");
      const monthsAgo = Math.max(1, Math.floor((Date.now() - new Date(row.last_service_at).getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
      const eqLabel = String(row.equipment_label || "tu equipo").trim();
      const storeName = String(row.store_name || "tu taller");
      const firstName = String(row.customer_name || "").split(/\s+/)[0] || "";
      const text =
        `Hola${firstName ? ` ${firstName}` : ""}! Te escribimos de ${storeName} 🛠️ ` +
        `Ya pasaron ${monthsAgo} ${monthsAgo === 1 ? "mes" : "meses"} del último service de tu ${eqLabel}. ` +
        `¿Querés que te anote para una revisión? Respondé este mensaje y coordinamos.`;

      // Push (si tiene cuenta con ese teléfono).
      await notifyServiceClient(phone, {
        title: `¿Tu ${eqLabel} necesita service? 🛠️`,
        body: `Pasaron ${monthsAgo} ${monthsAgo === 1 ? "mes" : "meses"} de ${storeName}. Escribinos y coordinamos.`,
        link: "/perfil",
      });

      // WhatsApp diurno por el número del comercio (opt-out wa_reminders).
      let waSent = false;
      if (row.wa_reminders !== false && isDaytimeAR()) {
        const res = await sendWaText({ vendorId: row.vendor_id, waId: phone, text });
        waSent = res.sent === true;
      }

      await query(
        `INSERT INTO equipment_reminder_log (vendor_id, equipment_id, kind, last_service_at)
         VALUES ($1, $2, 'service_due', $3)`,
        [row.vendor_id, row.equipment_id, row.last_service_at]
      ).catch(() => {});
      if (waSent) sent++;
    } catch {
      /* sigue con el próximo */
    }
  }

  return NextResponse.json({ ok: true, candidates: (candidates || []).length, sent });
}
