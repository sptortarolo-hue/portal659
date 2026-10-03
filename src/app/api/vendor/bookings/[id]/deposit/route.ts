import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera el link de cobro de seña por Mercado Pago para un TURNO
 * (plan Oficios). Espejo MP de la ruta Stripe (`stripe-deposit`).
 * Usa la seña del servicio (snapshot en el turno); la plata cae en la
 * cuenta MP del comercio. El webhook la marca pagada.
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
  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados por ahora" },
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

  let vendorRow;
  try {
    vendorRow = await queryOne<
      { store_name: string; slug: string | null } & VendorMpRow
    >(
      `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
       FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
  } catch {
    vendorRow = undefined;
  }
  if (!vendorRow) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const mpToken = await getVendorMpToken(vendorRow);
  if (!mpToken) {
    return NextResponse.json(
      { error: "Conectá tu Mercado Pago desde el panel para cobrar seña online", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const externalReference = `portal659_sena_turno_${booking.id}_${Date.now()}`;
  try {
    const preference = {
      items: [
        {
          title: `Seña turno — ${vendorRow.store_name} (${booking.customer_name || ""} ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)})`.slice(0, 120),
          unit_price: amount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: { vendor_id: gate.vendor.id, booking_id: booking.id, kind: "service_deposit" },
      external_reference: externalReference,
      back_urls: {
        success: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
        failure: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
        pending: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
      body: JSON.stringify(preference),
    });
    const data = await res.json();
    if (!data.id) {
      return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
    }
    const isTest = mpToken.startsWith("TEST-");
    const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;

    try {
      await query(
        `UPDATE bookings SET deposit_amount = $1, deposit_status = 'pending', mp_payment_id = NULL WHERE id = $2`,
        [amount, booking.id]
      );
    } catch {
      throw new Error("Falta aplicar la migración migrate-estetica.sql en la base");
    }

    return NextResponse.json({ initPoint, amount, via: "mp", sandbox: isTest });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error de conexión con Mercado Pago";
    const status = msg.startsWith("Falta aplicar") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
