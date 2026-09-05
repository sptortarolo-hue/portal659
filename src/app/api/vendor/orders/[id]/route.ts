import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { sendEmail, reviewRequestEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import { canTransition } from "@/lib/order-utils";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { PricingError, resolveOrderPricing } from "@/lib/pricing";
import type { OrderItem, OrderStatus } from "@/types/database";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "confirmado",
  preparing: "en preparación",
  ready: "listo",
  sent: "enviado",
  completed: "entregado",
  cancelled: "cancelado",
};

/** Textos de la notificación al cliente; moda tiene wording propio (aceptación/empaque). */
function customerNotificationText(
  status: string,
  isModa: boolean,
  storeName: string | undefined,
  total: number
): { title: string; body: string } | null {
  const totalStr = `$${Number(total).toLocaleString("es-AR")}`;
  if (!isModa) {
    const label = STATUS_LABELS[status];
    if (!label) return null;
    return { title: `Tu pedido fue ${label}`, body: `${storeName} ${label} tu pedido de ${totalStr}` };
  }
  switch (status) {
    case "confirmed":
      return { title: "¡Pedido aceptado!", body: `${storeName} aceptó tu pedido de ${totalStr} y ya lo está empaquetando` };
    case "preparing":
      return { title: "Estamos empaquetando tu pedido", body: `${storeName} está empaquetando tu pedido de ${totalStr}` };
    case "ready":
      return { title: "¡Tu pedido está listo!", body: `${storeName} ya tiene listo tu pedido de ${totalStr}. Si elegiste retiro, ya podés pasar a buscarlo` };
    case "sent":
      return { title: "¡Tu pedido va en camino!", body: `${storeName} despachó tu pedido de ${totalStr}` };
    case "completed":
      return { title: "¡Tu pedido fue entregado!", body: `Gracias por comprarle a ${storeName}` };
    case "cancelled":
      return { title: "Tu pedido fue cancelado", body: `${storeName} canceló tu pedido de ${totalStr}` };
    default:
      return null;
  }
}

const RETURN_COLUMNS =
  "customer_phone, customer_name, customer_address, total, payment_method, notes, modification_notes, method, items, pickup_number";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const order = await queryOne<Record<string, unknown>>(
    `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );

  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ order });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const fullVendor = await queryOne<{ id: string; store_name: string; slug: string | null; block_unpaid_orders: boolean; vertical: string; delivery_fee: number | null; free_delivery_min: number | null }>(
    `SELECT id, store_name, slug, block_unpaid_orders, vertical, delivery_fee, free_delivery_min FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );

  const body = await request.json();
  const { status, estimated_minutes, modification_notes, payment_status } = body;
  const rawItems = body.items; // validado/recomputado server-side si viene
  const method = body.method;
  const customer_phone = body.customer_phone;
  const customer_address = body.customer_address;

  // Conversión de mostrador pickup → delivery en el medio del circuito.
  const isConvertDelivery =
    method === "delivery" &&
    !status &&
    !payment_status &&
    rawItems === undefined &&
    modification_notes === undefined;

  const isModifyOnly = !status && !payment_status && (rawItems !== undefined || modification_notes !== undefined);

  if (status && !["new", "confirmed", "preparing", "ready", "sent", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  if (payment_status && !["paid", "pending"].includes(payment_status)) {
    return NextResponse.json({ error: "Estado de pago inválido" }, { status: 400 });
  }

  const currentOrder = await queryOne<{ status: string; payment_status: string; payment_method: string; channel: string; method: string; items: OrderItem[] | null }>(
    `SELECT status, payment_status, payment_method, channel, method, items FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );

  if (!currentOrder) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const ADVANCE_STATUSES = ["preparing", "ready", "sent", "completed"];
  if (
    status &&
    fullVendor?.block_unpaid_orders &&
    currentOrder.payment_method === "transferencia" &&
    currentOrder.channel === "app" &&
    currentOrder.payment_status === "pending" &&
    ADVANCE_STATUSES.includes(status)
  ) {
    return NextResponse.json(
      { error: "Primero confirmá el pago (marcá el pedido como pagado) para avanzar", code: "payment_pending" },
      { status: 403 }
    );
  }

  if (isModifyOnly && currentOrder.status !== "new") {
    return NextResponse.json(
      { error: "Solo se pueden modificar pedidos en estado nuevo" },
      { status: 400 }
    );
  }

  if (isConvertDelivery) {
    if (currentOrder.channel !== "mostrador") {
      return NextResponse.json(
        { error: "Solo se puede convertir a domicilio un pedido de mostrador" },
        { status: 400 }
      );
    }
    if (currentOrder.status === "completed" || currentOrder.status === "cancelled") {
      return NextResponse.json(
        { error: "No se puede convertir un pedido ya finalizado" },
        { status: 400 }
      );
    }
    const phoneClean = typeof customer_phone === "string" ? customer_phone.trim() : "";
    if (!phoneClean) {
      return NextResponse.json({ error: "El envío a domicilio requiere el teléfono del cliente" }, { status: 400 });
    }
  }

  if (status && !canTransition(currentOrder.status as OrderStatus, status as OrderStatus)) {
    return NextResponse.json(
      { error: `No se puede pasar de "${currentOrder.status}" a "${status}"` },
      { status: 400 }
    );
  }

  let order: Record<string, unknown> | null = null;
  try {
    order = await withTransaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (status) updateData.status = status;
      if (estimated_minutes !== undefined) updateData.estimated_minutes = estimated_minutes;
      if (modification_notes !== undefined) updateData.modification_notes = modification_notes;
      if (isConvertDelivery) {
        updateData.method = "delivery";
        updateData.customer_phone = (customer_phone as string).trim();
        updateData.customer_address = typeof customer_address === "string" && customer_address.trim() ? customer_address.trim() : null;
        updateData.pickup_number = null; // ya no es retiro: libera el número comprobante
      }
      if (payment_status !== undefined) {
        updateData.payment_status = payment_status;
        if (payment_status === "paid") updateData.paid_at = new Date().toISOString();
      }

      // Modificación de ítems: los precios/total se recalculan server-side
      // (desde la DB, no desde el body) para que el pedido quede coherente y
      // el cliente no pueda forzar un precio.
      if (isModifyOnly && rawItems !== undefined) {
        const pricing = await resolveOrderPricing({
          tx,
          vendorId: vendor.id,
          items: rawItems,
          method: currentOrder.method,
          deliveryFee: fullVendor?.delivery_fee,
          freeDeliveryMin: fullVendor?.free_delivery_min,
        });
        updateData.items = JSON.stringify(pricing.items);
        updateData.total = pricing.total;

        // Re-stock del pedido viejo + reserva del nuevo (solo canal app; los
        // canales presenciales no habían reservado stock al crear).
        if (currentOrder.channel === "app") {
          await adjustStockForItems(tx, currentOrder.items, "increment");
          await adjustStockForItems(tx, pricing.items, "decrement");
        }
      }

      const setClauses: string[] = [];
      const values: unknown[] = [params.id, vendor.id];
      let idx = 3;
      for (const [key, val] of Object.entries(updateData)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
      if (setClauses.length === 0) {
        throw new PricingError("Nada para actualizar");
      }

      const orderRows = await tx.query<Record<string, unknown>>(
        `UPDATE orders SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING ${RETURN_COLUMNS}`,
        values
      );
      if (orderRows.length === 0) {
        return null;
      }

      if (status) {
        await tx.queryVoid(
          `INSERT INTO order_status_log (order_id, status) VALUES ($1, $2)`,
          [params.id, status]
        );
      }

      // Cancelación/rechazo: reposición del stock reservado al crear el pedido.
      if (status === "cancelled" && currentOrder.channel === "app") {
        const updatedItems = (orderRows[0].items as OrderItem[] | null) ?? currentOrder.items;
        await adjustStockForItems(tx, updatedItems, "increment");
      }

      return orderRows[0];
    });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  if (!order) {
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }

  // Notificaciones al cliente solo tienen sentido cuando hay un cliente real
  // esperando novedades (online o mostrador→delivery). Mesa y mostrador-retiro
  // son presenciales y guardan el WhatsApp del propio comercio.
  const isCounterPickup =
    currentOrder.channel === "mesa" ||
    (currentOrder.channel === "mostrador" && order.method !== "delivery");

  const pushText = customerNotificationText(
    status,
    fullVendor?.vertical === "moda",
    fullVendor?.store_name,
    Number(order.total)
  );

  if (order && pushText && order.customer_phone && !isCounterPickup) {
    try {
      const customerProfile = await queryOne<{ id: string; email: string | null }>(
        `SELECT id, email FROM profiles WHERE phone = $1 OR whatsapp = $1 LIMIT 1`,
        [order.customer_phone as string]
      );

      if (customerProfile) {
        const { title, body } = pushText;

        await queryMany<Record<string, unknown>>(
          `INSERT INTO notifications (user_id, title, body, type, link)
           VALUES ($1, $2, $3, $4, $5)`,
          [customerProfile.id, title, body, "order", "/mis-pedidos"]
        );

        await sendPushToUser(customerProfile.id, { title, body, link: "/mis-pedidos" });

        if (status === "completed" && customerProfile.email) {
          const baseUrl = getSiteUrl();
          const reviewUrl = `${baseUrl}/tienda/${fullVendor?.slug || ""}`;
          const { subject, html } = reviewRequestEmail(fullVendor?.store_name || "tu pedido", reviewUrl);
          await sendEmail({ to: customerProfile.email, subject, html });
        }
      }
    } catch {
      // Notification is best-effort, don't fail the request
    }
  }

  return NextResponse.json({ order });
}