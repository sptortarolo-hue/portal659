import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { toE164 } from "@/lib/phone";

/**
 * GET /api/orders/latest-token
 *   ?payment_id=1234            (vuelta de MP — exacto, sin depender del storage del cliente)
 *   ?vendor=<slug>&phone=<e164> (fallback: última orden del teléfono en ese local)
 *
 * Responde el track_token público del pedido + datos mínimos del comercio para
 * armar el botón de WhatsApp de consulta desde la pantalla de vuelta del pago
 * (el sessionStorage del cliente no sobrevive cuando MP vuelve por la app).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const paymentId = (searchParams.get("payment_id") || "").trim();

  if (paymentId) {
    const row = await queryOne<{
      token: string | null;
      store_name: string;
      slug: string;
      whatsapp: string | null;
      phone_vendor: string | null;
      pickup_number: number | null;
      total: string;
      customer_name: string;
    }>(
      `SELECT o.track_token AS token, v.store_name, v.slug, v.whatsapp, v.phone AS phone_vendor,
              o.pickup_number, o.total, o.customer_name
       FROM orders o JOIN vendors v ON v.id = o.vendor_id
       WHERE o.mp_payment_id = $1
       LIMIT 1`,
      [paymentId]
    );
    return NextResponse.json({
      ok: true,
      token: row?.token ?? null,
      storeName: row?.store_name ?? null,
      slug: row?.slug ?? null,
      whatsapp: row?.whatsapp ?? null,
      phoneVendor: row?.phone_vendor ?? null,
      pickupNumber: row?.pickup_number ?? null,
      total: row ? Number(row.total) : null,
      customerName: row?.customer_name ?? null,
    });
  }

  const slug = (searchParams.get("vendor") || "").trim();
  const e164 = toE164(searchParams.get("phone") || "");
  if (!slug || !e164) {
    return NextResponse.json({ ok: false, error: "Parámetros inválidos" }, { status: 400 });
  }

  const row = await queryOne<{
    token: string | null;
    store_name: string;
    whatsapp: string | null;
    phone_vendor: string | null;
    pickup_number: number | null;
    total: string;
  }>(
    `SELECT o.track_token AS token, v.store_name, v.whatsapp, v.phone AS phone_vendor,
            o.pickup_number, o.total
     FROM orders o
     JOIN vendors v ON v.id = o.vendor_id
     WHERE v.slug = $1 AND o.customer_phone = $2 AND o.created_at > now() - interval '2 hours'
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [slug, e164]
  );

  return NextResponse.json({
    ok: true,
    token: row?.token ?? null,
    storeName: row?.store_name ?? null,
    slug,
    whatsapp: row?.whatsapp ?? null,
    phoneVendor: row?.phone_vendor ?? null,
    pickupNumber: row?.pickup_number ?? null,
    total: row ? Number(row.total) : null,
    customerName: null,
  });
}
