import { query, queryMany } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { getPortalBank } from "@/lib/plan-payments";
import { planPriceFor } from "@/lib/plans";
import { getSiteUrl } from "@/lib/site-url";
import { planRenewalEmail, sendEmail } from "@/lib/email";
import { NextResponse } from "next/server";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

const TZ_AR = "America/Argentina/Buenos_Aires";

/** Clave del ciclo de vencimiento: fecha AR del vencimiento (idempotencia). */
function periodKeyOf(iso: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return p; // "YYYY-MM-DD"
}

type DueVendor = {
  id: string;
  user_id: string | null;
  store_name: string;
  email: string | null;
  plan_name: string;
  plan_price: number;
  plan_promo_price: number | null;
  plan_promo_months: number | null;
  plan_promo_ends_at: string | null;
  plan_promo_label: string | null;
  plan_expires_at: string;
  plan_status: string;
};

/**
 * Avisos de vencimiento de planes (cron en el host, diario 10:00 AR):
 *   GET /api/cron/plan-reminders?secret=...
 *
 * - T-7: primer aviso con los datos de transferencia del portal y el link
 *   para renovar y subir el comprobante (mail + push + campana).
 * - T-2: reenvío corto (mismo circuito).
 * - vencido: aviso de que el plan cayó a Gratuito + cómo renovar.
 *
 * Idempotente por ciclo: subscription_reminder_log(vendor, period_key, kind).
 * En gracia ('past_due', comprobante en revisión) no se insiste: el comercio
 * ya está en el circuito de pago.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let rows: DueVendor[] = [];
  try {
    rows = (await queryMany<DueVendor>(
      `SELECT v.id, v.user_id, v.store_name, v.plan_status,
              pr.email AS email,
              p.name AS plan_name,
              p.price_monthly AS plan_price,
              p.promo_price AS plan_promo_price,
              p.promo_months AS plan_promo_months,
              p.promo_ends_at AS plan_promo_ends_at,
              p.promo_label AS plan_promo_label,
              v.plan_expires_at
         FROM vendors v
         JOIN plans p ON p.id = v.plan_id
         LEFT JOIN profiles pr ON pr.id = v.user_id
        WHERE p.slug <> 'gratuito'
          AND v.plan_expires_at IS NOT NULL
          AND v.plan_status IN ('active', 'trial', 'expired')
          AND COALESCE(v.visibility, CASE WHEN v.visible THEN 'public' ELSE 'hidden' END) = 'public'
        ORDER BY v.plan_expires_at ASC
        LIMIT 200`
    )) || [];
  } catch {
    return NextResponse.json({ ok: true, skipped: "sin migración o sin datos" });
  }

  const bank = await getPortalBank().catch(() => null);
  const renewUrl = `${getSiteUrl()}/vendor/suscripcion#renovar`;
  const now = Date.now();

  let t7 = 0;
  let t2 = 0;
  let vencidos = 0;
  let failed = 0;

  for (const v of rows) {
    try {
      const daysLeft = Math.ceil((new Date(v.plan_expires_at).getTime() - now) / 86400000);
      let kind: "t7" | "t2" | "vencido" | null = null;
      if (daysLeft <= 7 && daysLeft > 2) kind = "t7";
      else if (daysLeft <= 2 && daysLeft >= 0) kind = "t2";
      else if (daysLeft < 0) kind = "vencido";
      if (!kind) continue;

      const periodKey = periodKeyOf(v.plan_expires_at);

      // Idempotencia: si ya se avisó en este ciclo, no se repite.
      const ins = await queryMany<{ vendor_id: string }>(
        `INSERT INTO subscription_reminder_log (vendor_id, period_key, kind)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING vendor_id`,
        [v.id, periodKey, kind]
      ).catch(() => [] as { vendor_id: string }[]);
      if (!ins || ins.length === 0) continue;

      const subject =
        kind === "vencido"
          ? `Tu plan ${v.plan_name} venció — renová para no cortar el servicio`
          : kind === "t7"
            ? `Tu plan ${v.plan_name} vence en ${daysLeft} días — renová por transferencia`
            : `⏳ 2 días: tu plan ${v.plan_name} vence pronto`;
      const bodyText =
        kind === "vencido"
          ? `Tu plan ${v.plan_name} venció y volviste al plan Gratuito. Renová por transferencia y subí el comprobante: el servicio se reanuda apenas lo acreditamos.`
          : kind === "t7"
            ? `Tu plan ${v.plan_name} vence en ${daysLeft} días. Transferí el monto del mes y subí el comprobante desde Mi suscripción: verificamos el pago y te emitimos el Recibo X.`
            : `Tu plan ${v.plan_name} vence en ${Math.max(daysLeft, 1)} ${daysLeft === 1 ? "día" : "días"}. Si ya transferiste, subí el comprobante para que lo acreditemos.`;

      // 1) Campana + push en la app.
      if (v.user_id) {
        await query(
          `INSERT INTO notifications (user_id, title, body, type, link)
           VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
          [v.user_id, subject, bodyText]
        ).catch(() => undefined);
        try {
          await sendPushToUser(v.user_id, { title: subject, body: bodyText, link: "/vendor/suscripcion" });
        } catch {
          /* push best-effort */
        }
      }

      // 2) Mail al dueño.
      if (v.email) {
        try {
          const listAmount = Number(v.plan_price) || 0;
          const price = planPriceFor({
            price_monthly: listAmount,
            promo_price: v.plan_promo_price == null ? null : Number(v.plan_promo_price),
            promo_months: v.plan_promo_months == null ? null : Number(v.plan_promo_months),
            promo_ends_at: v.plan_promo_ends_at,
            promo_label: v.plan_promo_label,
          } as Plan);
          const mail = planRenewalEmail({
            storeName: v.store_name,
            planName: v.plan_name,
            price: {
              amount: price?.amount ?? listAmount,
              isPromo: !!price?.isPromo,
              listPrice: price?.listPrice ?? listAmount,
              offPct: price?.offPct ?? null,
              promoEndsAt: price?.promoEndsAt ?? null,
            },
            daysLeft,
            renewUrl,
            bank: {
              alias: bank?.alias ?? null,
              cbu: bank?.cbu ?? null,
              titular: bank?.titular ?? null,
              qrUrl: bank?.qr_url ?? null,
            },
          });
          await sendEmail({ to: v.email, subject: mail.subject, html: mail.html });
        } catch {
          /* mail best-effort */
        }
      }

      if (kind === "t7") t7++;
      else if (kind === "t2") t2++;
      else vencidos++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, t7, t2, vencidos, failed, checked: rows.length });
}
