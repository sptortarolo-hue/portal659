import { query, queryOne } from "@/lib/db";
import { isStripeEnabled, verifyWebhookSignature } from "@/lib/stripe-connect";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 * Webhook de Stripe Connect (señas de servicios/turnos con direct charge).
 * Verifica firma con STRIPE_WEBHOOK_SECRET sobre el body CRUDO.
 * Sin `STRIPE_ENABLED=1` se ignora todo.
 *
 * En Stripe Dashboard → Developers → Webhooks: endpoint
 * `https://www.portal659.com.ar/api/webhooks/stripe`, eventos
 * `checkout.session.completed` (marcar "Connect" para recibir los de las
 * cuentas conectadas).
 */
export async function POST(request: Request) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const signature = request.headers.get("stripe-signature") || "";
  if (!signature) {
    return NextResponse.json({ error: "Sin firma" }, { status: 400 });
  }

  let event;
  try {
    const rawBody = await request.text();
    event = verifyWebhookSignature(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        amount_total: number | null;
        metadata?: Record<string, string> | null;
      };
      const meta = session.metadata || {};
      if (meta.kind === "service_deposit") {
        const paidAmount = Math.round(((session.amount_total || 0) / 100) * 100) / 100;
        if (meta.quote_id) await markQuoteDepositPaid(meta.quote_id, session.id, paidAmount);
        else if (meta.booking_id) await markBookingDepositPaid(meta.booking_id, session.id, paidAmount);
      }
    }
  } catch (e) {
    // Fallo persistiendo (plata cobrada pero seña sin marcar): 500 para que
    // Stripe reintente, no ok silencioso.
    console.error("[stripe-webhook]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Reintentar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function markQuoteDepositPaid(quoteId: string, sessionId: string, paidAmount: number) {
  const quote = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string;
    customer_phone: string;
    deposit_amount: number | null;
    deposit_status: string | null;
  }>(
    `SELECT id, vendor_id, customer_name, customer_phone, deposit_amount, deposit_status
     FROM quotes WHERE id = $1 LIMIT 1`,
    [quoteId]
  ).catch(() => undefined);
  if (!quote || quote.deposit_status === "paid") return;

  const expected = Number(quote.deposit_amount) || 0;
  const mismatch = expected > 0 && Math.abs(paidAmount - expected) > 1;
  // Si no persiste (migración sin aplicar), lanzar para que Stripe reintente.
  const marked = await queryOne<{ id: string }>(
    `UPDATE quotes SET deposit_status = 'paid', status = 'accepted', mp_payment_id = $1, accepted_at = now()
     WHERE id = $2 RETURNING id`,
    [`stripe:${sessionId}`, quoteId]
  ).catch(() => undefined);
  if (!marked) throw new Error("markQuoteDepositPaid sin persistencia");
  const vrow = await queryOne<{ user_id: string; store_name: string; vertical: string | null }>(
    `SELECT user_id, store_name, vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [quote.vendor_id]
  ).catch(() => undefined);
  if (vrow?.user_id) {
    const title = "¡Seña pagada! (Stripe)";
    const body = `${quote.customer_name} pagó $${paidAmount.toLocaleString("es-AR")} de seña${mismatch ? ` (difiere de $${expected.toLocaleString("es-AR")}, revisar)` : ""}. ${vrow.vertical === "estetica" ? "Consulta aceptada." : "Presupuesto aceptado."}`;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
      [vrow.user_id, title, body]
    ).catch(() => undefined);
    try {
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(vrow.user_id, { title, body, link: "/vendor/dashboard" });
    } catch { /* best-effort */ }
  }
  try {
    const { notifyServiceClient } = await import("@/lib/service-notify");
    await notifyServiceClient(quote.customer_phone, {
      title: `Seña recibida — ${quote.customer_name.split(" ")[0] || "gracias"}`,
      body: "Tu seña fue acreditada. El profesional coordina el trabajo con vos.",
    });
  } catch { /* best-effort */ }
}

async function markBookingDepositPaid(bookingId: string, sessionId: string, paidAmount: number) {
  const booking = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    deposit_amount: number | null;
    deposit_status: string | null;
  }>(
    `SELECT id, vendor_id, customer_name, customer_phone, deposit_amount, deposit_status
     FROM bookings WHERE id = $1 LIMIT 1`,
    [bookingId]
  ).catch(() => undefined);
  if (!booking || booking.deposit_status === "paid") return;

  const expected = Number(booking.deposit_amount) || 0;
  const mismatch = expected > 0 && Math.abs(paidAmount - expected) > 1;
  await query(
    `UPDATE bookings SET deposit_status = 'paid', mp_payment_id = $1 WHERE id = $2`,
    [`stripe:${sessionId}`, bookingId]
  ).catch(async () => {
    // Sin columnas de seña en bookings (migración sin aplicar): al menos
    // marcar con stripe_session_id si existe.
    await query(`UPDATE bookings SET stripe_session_id = $1 WHERE id = $2`, [sessionId, bookingId]).catch(() => undefined);
  });
  const vrow = await queryOne<{ user_id: string; store_name: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [booking.vendor_id]
  ).catch(() => undefined);
  if (vrow?.user_id) {
    const title = "¡Seña de turno pagada! (Stripe)";
    const body = `${booking.customer_name || "La clienta"} pagó $${paidAmount.toLocaleString("es-AR")} de seña${mismatch ? ` (difiere de $${expected.toLocaleString("es-AR")}, revisar)` : ""}.`;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
      [vrow.user_id, title, body]
    ).catch(() => undefined);
    try {
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(vrow.user_id, { title, body, link: "/vendor/dashboard" });
    } catch { /* best-effort */ }
  }
  if (booking.customer_phone) {
    try {
      const { notifyServiceClient } = await import("@/lib/service-notify");
      await notifyServiceClient(booking.customer_phone, {
        title: `Seña recibida — ${(booking.customer_name || "").split(" ")[0] || "gracias"}`,
        body: "Tu seña fue acreditada. Te esperamos en tu turno.",
      });
    } catch { /* best-effort */ }
  }
}
