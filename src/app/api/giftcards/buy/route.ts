import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Compra online de giftcard (estética) con Mercado Pago.
 * La plata cae en la cuenta MP del comercio; el webhook emite el código
 * EST-XXXXXX con saldo (rama portal659_giftcard_) y le avisa al comercio
 * para que se lo pase a la clienta por WhatsApp.
 */
export const POST = withRateLimit(async (request: Request) => {
  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados por ahora", code: "mp_disabled" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { vendorId, amount, customerName, customerPhone } = body;
  const cents = Math.round(Number(amount));
  if (!vendorId || !(cents > 0) || !customerName || !customerPhone) {
    return NextResponse.json({ error: "Faltan datos requeridos (monto y tus datos)" }, { status: 400 });
  }
  if (cents < 1000) {
    return NextResponse.json({ error: "El monto mínimo es $1.000" }, { status: 400 });
  }
  const phone = toE164(String(customerPhone));
  if (!phone) {
    return NextResponse.json({ error: "Ingresá un celular válido" }, { status: 400 });
  }

  const vendor = await queryOne<
    { store_name: string; slug: string | null; vertical: string } & VendorMpRow
  >(
    `SELECT id, store_name, slug, vertical, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  ).catch(() => undefined);
  if (!vendor || vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no cobra online: escribile por WhatsApp y lo coordinan", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const externalReference = `portal659_giftcard_${vendorId}_${cents}_${Date.now()}`;
  try {
    const siteUrl = getSiteUrl();
    const back = `${siteUrl}/tienda/${vendor.slug || vendorId}`;
    const preference = {
      items: [
        {
          title: `Giftcard $${cents.toLocaleString("es-AR")} — ${vendor.store_name}`.slice(0, 120),
          unit_price: cents,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: {
        vendor_id: vendorId,
        giftcard_amount: String(cents),
        customer_phone: phone,
        customer_name: String(customerName).trim().slice(0, 120),
        kind: "giftcard_purchase",
      },
      external_reference: externalReference,
      back_urls: { success: back, failure: back, pending: back },
      auto_return: "approved",
      notification_url: `${siteUrl}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
      body: JSON.stringify(preference),
    });
    const data = await res.json().catch(() => null);
    if (!data?.id) {
      return NextResponse.json({ error: data?.message || "Error al crear el pago" }, { status: 500 });
    }
    const isTest = mpToken.startsWith("TEST-");
    const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       SELECT user_id, $2, $3, 'payment', '/vendor/dashboard' FROM vendors WHERE id = $1`,
      [vendorId, "Giftcard online en camino", `${String(customerName).trim().slice(0, 60)} inició una giftcard de $${cents.toLocaleString("es-AR")}. El código se emite solo al acreditarse. `]
    ).catch(() => undefined);
    return NextResponse.json({ initPoint, amount: cents, sandbox: isTest });
  } catch {
    return NextResponse.json({ error: "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}, { maxRequests: 10 });
