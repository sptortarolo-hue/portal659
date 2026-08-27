import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

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
  const { vendorId, items, total, customerName, customerPhone, customerAddress, method } = body;

  if (!vendorId || !items || !total) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const vendor = await queryOne<{ store_name: string; slug: string }>(
    `SELECT store_name, slug FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

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
      },
      external_reference: `portal659_${vendorId}_${Date.now()}`,
      back_urls: {
        success: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/checkout?payment=success`,
        failure: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/checkout?payment=failure`,
        pending: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/checkout?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/webhooks/mercadopago`,
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