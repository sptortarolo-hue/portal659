import { query, queryMany, queryOne } from "@/lib/db";
import { canSellGiftcards } from "@/lib/giftcards";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Compra online de giftcard (estética, comercio, moda) con Mercado Pago.
 * La plata cae en la cuenta MP del comercio; el webhook emite el código
 * con saldo (rama portal659_giftcard_) y le avisa al comercio
 * para que se lo pase al cliente por WhatsApp.
 * Comercio/moda venden por montos fijos (giftcard_denominations);
 * estética legacy mantiene monto abierto.
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
  // Tope anti-typo ($500.000): un cero de más no debería emitir una giftcard gigante.
  if (cents > 500000) {
    return NextResponse.json({ error: "El monto máximo online es $500.000 (por más, coordiná por WhatsApp)" }, { status: 400 });
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
  if (!vendor || !canSellGiftcards(vendor.vertical)) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  // Montos fijos (comercio/moda): el monto debe estar en la lista del local.
  // Estética legacy sin lista mantiene monto abierto.
  try {
    const dens = await queryMany<{ amount: number }>(
      `SELECT amount FROM giftcard_denominations WHERE vendor_id = $1 AND active IS DISTINCT FROM false ORDER BY amount ASC`,
      [vendorId]
    ).catch(() => null);
    if (dens && dens.length > 0) {
      const ok = dens.some((d) => Math.round(Number(d.amount)) === cents);
      if (!ok) {
        return NextResponse.json({ error: "Elegí uno de los montos ofrecidos" }, { status: 400 });
      }
    } else if (vendor.vertical !== "estetica") {
      return NextResponse.json({ error: "Este comercio todavía no definió montos de giftcard" }, { status: 400 });
    }
  } catch {
    if (vendor.vertical !== "estetica") {
      return NextResponse.json({ error: "Este comercio todavía no definió montos de giftcard" }, { status: 400 });
    }
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
