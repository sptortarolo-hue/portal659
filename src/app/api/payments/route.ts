import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import { resolveVendorPlan } from "@/lib/plans";
import { isStoreOpen } from "@/lib/open-hours";
import { PricingError, resolveOrderPricing } from "@/lib/pricing";

// Mercado Pago Preference API
// Docs: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/landing

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY;

export async function POST(request: Request) {
  if (!MP_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Pasarela de pagos no configurada. Configurá MP_ACCESS_TOKEN en .env.local" },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { vendorId, items, customerName, customerPhone, customerAddress, method } = body;

  if (!vendorId || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT id, store_name, slug, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, hours, open_override, delivery_fee, free_delivery_min FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  // Mismo gating que pedidos online: plan con cart + abierto.
  const plans = await queryMany<Record<string, unknown>>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor as any, plans as any);
  if (!plan.can("cart")) {
    return NextResponse.json(
      { error: "Este comercio no acepta pagos online por ahora." },
      { status: 403 }
    );
  }
  if (isStoreOpen(vendor as any) === false) {
    return NextResponse.json({ error: "El comercio está cerrado ahora." }, { status: 409 });
  }

  // Precios/stock/monedas se computan desde la base, nunca del cliente.
  let pricing;
  try {
    pricing = await resolveOrderPricing({
      tx: { query: queryMany },
      vendorId,
      items,
      method,
      deliveryFee: (vendor as any).delivery_fee,
      freeDeliveryMin: (vendor as any).free_delivery_min,
    });
  } catch (e) {
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  try {
    const preference = {
      items: pricing.items.map((i) => ({
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
        // items resueltos server-side: las ids vienen de la DB.
        stock_items: JSON.stringify(
          pricing.items.map((i) => ({
            variant_id: i.variant_id || null,
            product_id: i.product_id || null,
            qty: i.qty,
            name: i.name,
            price: i.price,
          }))
        ),
      },
      external_reference: `portal659_${vendorId}_${Date.now()}`,
      back_urls: {
        success: `${getSiteUrl()}/checkout?payment=success`,
        failure: `${getSiteUrl()}/checkout?payment=failure`,
        pending: `${getSiteUrl()}/checkout?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await res.json();

    if (data.id) {
      return NextResponse.json({
        preferenceId: data.id,
        initPoint: data.init_point,
        sandboxInitPoint: data.sandbox_init_point,
        total: pricing.total,
      });
    }

    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    configured: !!MP_ACCESS_TOKEN,
    publicKey: MP_PUBLIC_KEY || null,
  });
}
