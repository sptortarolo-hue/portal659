import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

// Mercado Pago Preference API (multi-market: cada comercio cobra con SU cuenta)
// Docs: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/landing

export async function POST(request: Request) {
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
        phone: { number: customerPhone },
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
      return NextResponse.json({
        preferenceId: data.id,
        initPoint: data.init_point,
        sandboxInitPoint: data.sandbox_init_point,
      });
    }

    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

// El checkout le pregunta "¿puedo cobrar online?" por un comercio dado.
export async function GET(request: Request) {
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
