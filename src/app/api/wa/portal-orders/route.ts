import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { toE164, phoneVariantsAR } from "@/lib/phone";

/**
 * GET /api/wa/portal-orders?phone= — últimos pedidos (no cancelados) del
 * teléfono en los últimos 7 días, de TODAS las tiendas visibles. Lo usa el bot
 * del portal para responder "¿cómo va mi pedido?" / "¿dónde está?".
 * Normaliza ambos lados a E.164 (549XXXXXXXXXX) y compara exacto + variantes.
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const phoneRaw = url.searchParams.get("phone") || "";
  const phoneE164 = toE164(phoneRaw);
  if (!phoneE164) {
    return NextResponse.json({ error: "phone inválido" }, { status: 403 });
  }

  // Generar variantes del teléfono para matchear contra formatos legacy en la BD
  const variants = phoneVariantsAR(phoneRaw);
  if (variants.length === 0) {
    return NextResponse.json({ error: "phone inválido" }, { status: 403 });
  }

  // Intentar primero con el E.164 canónico (formato actual)
  let orders = await queryMany<{
    id: string;
    pickup_number: number | null;
    status: string;
    track_token: string | null;
    customer_name: string;
    store_name: string;
    store_slug: string | null;
    store_id: string;
    total: number;
    method: string | null;
    payment_method: string | null;
    items: any;
    transfer_alias: string | null;
    transfer_cbu: string | null;
    transfer_holder: string | null;
    delivery_options: string | null;
    created_at: string;
  }>(
    `SELECT o.id, o.pickup_number, o.status, o.track_token, o.customer_name, o.total, o.method, o.payment_method, o.items, o.created_at,
            v.id AS store_id, v.store_name, v.slug AS store_slug, v.transfer_alias, v.transfer_cbu, v.transfer_holder, v.delivery_options
     FROM orders o
     JOIN vendors v ON v.id = o.vendor_id
     WHERE regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') = $1
       AND o.status <> 'cancelled'
       AND COALESCE(o.is_preview, false) = false
       AND o.created_at > now() - interval '7 days'
       AND COALESCE(v.visible, true) = true
     ORDER BY o.created_at DESC
     LIMIT 5`,
    [phoneE164]
  ).catch(() => []);

  // Fallback: probar variantes legacy si no hay resultados
  if (!orders || orders.length === 0) {
    for (const variant of variants) {
      if (variant === phoneE164) continue; // ya probamos el canónico
      const res = await queryMany<{
        id: string;
        pickup_number: number | null;
        status: string;
        track_token: string | null;
        customer_name: string;
        store_name: string;
        store_slug: string | null;
        store_id: string;
        total: number;
        method: string | null;
        payment_method: string | null;
        items: any;
        transfer_alias: string | null;
        transfer_cbu: string | null;
        transfer_holder: string | null;
        delivery_options: string | null;
        created_at: string;
      }>(
        `SELECT o.id, o.pickup_number, o.status, o.track_token, o.customer_name, o.total, o.method, o.payment_method, o.items, o.created_at,
                v.id AS store_id, v.store_name, v.slug AS store_slug, v.transfer_alias, v.transfer_cbu, v.transfer_holder, v.delivery_options
         FROM orders o
         JOIN vendors v ON v.id = o.vendor_id
         WHERE regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') = $1
           AND o.status <> 'cancelled'
           AND COALESCE(o.is_preview, false) = false
           AND o.created_at > now() - interval '7 days'
           AND COALESCE(v.visible, true) = true
         ORDER BY o.created_at DESC
         LIMIT 5`,
        [variant]
      ).catch(() => []);
      if (res && res.length > 0) {
        orders = res;
        break;
      }
    }
  }

  // Fallback final: buscar en tabla customers si no hay pedidos recientes
  if (!orders || orders.length === 0) {
    const customer = await queryOne<{ id: string; customer_name: string }>(
      `SELECT c.id, c.customer_name
       FROM customers c
       WHERE regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = $1
         OR regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') = $1
       LIMIT 1`,
      [phoneE164]
    ).catch(() => null);

    if (customer) {
      // Buscar pedidos de este customer_id
      const res = await queryMany<{
        id: string;
        pickup_number: number | null;
        status: string;
        track_token: string | null;
        customer_name: string;
        store_name: string;
        store_slug: string | null;
        store_id: string;
        total: number;
        method: string | null;
        payment_method: string | null;
        items: any;
        transfer_alias: string | null;
        transfer_cbu: string | null;
        transfer_holder: string | null;
        delivery_options: string | null;
        created_at: string;
      }>(
        `SELECT o.id, o.pickup_number, o.status, o.track_token, o.customer_name, o.total, o.method, o.payment_method, o.items, o.created_at,
                v.id AS store_id, v.store_name, v.slug AS store_slug, v.transfer_alias, v.transfer_cbu, v.transfer_holder, v.delivery_options
         FROM orders o
         JOIN vendors v ON v.id = o.vendor_id
         WHERE o.customer_id = $1
           AND o.status <> 'cancelled'
           AND COALESCE(o.is_preview, false) = false
           AND o.created_at > now() - interval '7 days'
           AND COALESCE(v.visible, true) = true
         ORDER BY o.created_at DESC
         LIMIT 5`,
        [customer.id]
      ).catch(() => []);
      if (res && res.length > 0) orders = res;
    }
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const siteUrl = getSiteUrl();
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      pickupNumber: o.pickup_number,
      status: o.status,
      storeName: o.store_name,
      storeSlug: o.store_slug,
      storeId: o.store_id,
      total: Number(o.total),
      method: o.method || "pickup",
      paymentMethod: o.payment_method || "whatsapp",
      items: Array.isArray(o.items) ? o.items : [],
      transferAlias: o.transfer_alias || null,
      transferCbu: o.transfer_cbu || null,
      transferHolder: o.transfer_holder || null,
      deliveryOptions: o.delivery_options || "ambos",
      trackUrl: o.track_token ? `${getSiteUrl()}/seguimiento/${o.track_token}` : null,
      createdAt: o.created_at,
    })),
  });
}
