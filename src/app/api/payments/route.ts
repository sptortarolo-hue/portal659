import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

// Mercado Pago Preference API (multi-market: cada comercio cobra con SU cuenta)
// Docs: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/landing

export async function POST(request: Request) {
  // Llave maestra: sin OK de MP no se cobra online por ningún canal.
  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados por ahora", code: "mp_disabled" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { vendorId, items, total, customerName, customerPhone, customerAddress, method, isPreview } = body;

  if (!vendorId || !items || !total) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  // En modo prueba nunca se cobra online con dinero real.
  if (isPreview) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados en modo prueba." },
      { status: 400 }
    );
  }

  const vendor = await queryOne<
    { store_name: string; slug: string } & VendorMpRow
  >(
    `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  // Cobros online siempre con la cuenta del COMERCIO (multi-tenant).
  // Si no está conectado, no hay pago online (la torta no la come el portal).
  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no conectó Mercado Pago", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  try {
    const preference = {
      items: items.map((i: any) => ({
        title: i.name,
        unit_price: i.price,
        quantity: i.qty,
        currency_id: "ARS",
      })),
      payer: {
        name: customerName,
        // Sin phone: MP es estricto con el formato (area_code/number separados)
        // y un formato raro puede hacer la preferencia rebotar al home de MP
        // en vez de abrir el checkout. El teléfono del cliente igual queda en
        // metadata.customer_phone (es donde lo lee el webhook para el pedido).
      },
      metadata: {
        vendor_id: vendorId,
        customer_phone: customerPhone,
        customer_address: customerAddress || "",
        delivery_method: method || "delivery",
        // JSON string: referencias para descontar stock al aprobarse el pago.
        stock_items: JSON.stringify(
          items.map((i: any) => ({
            variant_id: typeof i.variantId === "string" ? i.variantId : null,
            product_id: typeof i.offerId === "string" ? i.offerId : null,
            qty: Number(i.qty) || 1,
            name: i.name,
          }))
        ),
      },
      external_reference: `portal659_${vendorId}_${Date.now()}`,
      back_urls: {
        success: `${getSiteUrl()}/checkout?payment=success&vendor=${vendor.slug || vendorId}`,
        failure: `${getSiteUrl()}/checkout?payment=failure&vendor=${vendor.slug || vendorId}`,
        pending: `${getSiteUrl()}/checkout?payment=pending&vendor=${vendor.slug || vendorId}`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await res.json();

    if (data.id) {
      // init_point (producción) vs sandbox_init_point: depende del TOKEN del
      // comercio, no del cliente. Un token TEST- tiene que abrir el sandbox;
      // si abrimos init_point con token de prueba, MP manda al home/login en
      // vez de al checkout (el "te lleva a MP pero no al lugar para pagar").
      const isTest = mpToken.startsWith("TEST-");
      const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
      console.log(`[MP preference] ok id=${data.id} vendor=${vendorId} sandbox=${isTest}`);
      return NextResponse.json({
        preferenceId: data.id,
        initPoint,
        sandbox: isTest,
      });
    }

    // Sin data.id: algo del contenido de la preferencia no le gusta a MP.
    // Logueamos el mensaje en docker logs para diagnosticar de un vistazo
    // (sin tokens ni datos sensibles).
    console.warn(
      `[MP preference] FAIL status=${res.status} vendor=${vendorId} message=${data.message || data.error || "sin detalle"}`
    );
    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

// El checkout le pregunta "¿puedo cobrar online?" por un comercio dado.
export async function GET(request: Request) {
  // Sin OK de MP el checkout nunca ofrece pago online.
  if (!isMpEnabled()) {
    return NextResponse.json({ configured: false, reason: "mp_disabled" });
  }

  const vendorId = new URL(request.url).searchParams.get("vendorId");
  if (!vendorId) {
    return NextResponse.json({ configured: false, reason: "vendorId requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{ mp_user_id: number | null }>(
    `SELECT mp_user_id FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  return NextResponse.json({
    configured: !!vendor?.mp_user_id,
    publicKey: null,
  });
}
