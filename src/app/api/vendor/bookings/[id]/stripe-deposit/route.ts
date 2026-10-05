import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { createDepositSession, isStripeEnabled } from "@/lib/stripe-connect";
import { isPreviewRow } from "@/lib/preview-flag";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera el link de cobro de seña por Stripe para un TURNO (plan Oficios).
 * Usa la seña del servicio (services.deposit_amount snapshot en el turno);
 * si el turno no tiene seña configurada, responde 400.
 * Direct charge a la cuenta Stripe del comercio; el webhook la marca pagada.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.plan.can("deposits")) {
    return NextResponse.json(
      { error: "Cobrar seña online requiere el plan Oficios." },
      { status: 403 }
    );
  }
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online con Stripe están deshabilitados por ahora" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const booking = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string | null;
    booking_date: string;
    booking_time: string;
    deposit_amount: number | null;
    deposit_status: string | null;
    service_id: string | null;
  }>(
    `SELECT id, vendor_id, customer_name, booking_date::text AS booking_date, booking_time::text AS booking_time,
            deposit_amount, deposit_status, service_id::text AS service_id
     FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!booking) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (booking.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (booking.deposit_status === "paid") {
    return NextResponse.json({ error: "La seña ya está pagada" }, { status: 400 });
  }
  if (await isPreviewRow("bookings", id)) {
    return NextResponse.json({ error: "No se cobran señas en turnos de prueba" }, { status: 400 });
  }

  // Monto: snapshot del turno; si no tiene, el vigente del servicio.
  let amount = booking.deposit_amount != null ? Number(booking.deposit_amount) : 0;
  if (!(amount > 0) && booking.service_id) {
    const svc = await queryOne<{ deposit_amount: number | null }>(
      `SELECT deposit_amount FROM services WHERE id = $1 LIMIT 1`,
      [booking.service_id]
    ).catch(() => undefined);
    if (svc?.deposit_amount != null) amount = Number(svc.deposit_amount);
  }
  if (!(amount > 0)) {
    return NextResponse.json(
      { error: "Este turno no tiene seña configurada (ponela en el servicio)" },
      { status: 400 }
    );
  }

  const vendorRow = await queryOne<{
    id: string;
    store_name: string;
    slug: string | null;
    stripe_account_id: string | null;
  }>(
    `SELECT id, store_name, slug, stripe_account_id FROM vendors WHERE id = $1 LIMIT 1`,
    [gate.vendor.id]
  ).catch(() => undefined);
  if (!vendorRow) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (!vendorRow.stripe_account_id) {
    return NextResponse.json(
      { error: "Conectá tu Stripe desde el panel para cobrar seña online", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const siteUrl = getSiteUrl();
  const back = `${siteUrl}/tienda/${vendorRow.slug || gate.vendor.id}`;
  const created = await createDepositSession({
    stripeAccountId: vendorRow.stripe_account_id,
    amount,
    title: `Seña turno — ${vendorRow.store_name} (${booking.customer_name || ""} ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)})`,
    metadata: { kind: "service_deposit", booking_id: booking.id, vendor_id: gate.vendor.id },
    successUrl: back,
    cancelUrl: back,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error || "Error al crear el pago" }, { status: 500 });
  }

  try {
    await query(
      `UPDATE bookings SET deposit_amount = $1, deposit_status = 'pending', stripe_session_id = $2 WHERE id = $3`,
      [amount, created.sessionId || null, booking.id]
    );
  } catch {
    await query(
      `UPDATE bookings SET deposit_amount = $1, deposit_status = 'pending' WHERE id = $2`,
      [amount, booking.id]
    ).catch(() => {
      throw new Error("Falta aplicar la migración migrate-estetica.sql en la base");
    });
  }

  return NextResponse.json({ initPoint: created.url, amount, via: "stripe" });
}
