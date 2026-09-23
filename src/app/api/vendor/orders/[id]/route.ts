import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { sendEmail, reviewRequestEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import { canTransition } from "@/lib/order-utils";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { isRetailVendor } from "@/lib/plans";
import { PricingError, resolveOrderPricing } from "@/lib/pricing";
import { phoneVariantsAR } from "@/lib/phone";
import { decrementCustomerFromOrder } from "@/lib/customers";
import type { OrderItem, OrderStatus } from "@/types/database";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "confirmado",
  preparing: "en preparación",
  ready: "listo",
  sent: "enviado",
  completed: "entregado",
  cancelled: "cancelado",
};

/** Textos de la notificación al cliente; los verticales retail (moda/comercio) tienen wording propio (aceptación/empaque). */
function customerNotificationText(
  status: string,
  isRetail: boolean,
  storeName: string | undefined,
  total: number,
  pickupNumber: number | null
): { title: string; body: string } | null {
  const totalStr = `$${Number(total).toLocaleString("es-AR")}`;
  const numStr = pickupNumber != null ? ` Nro. ${pickupNumber}` : "";
  if (!isRetail) {
    const label = STATUS_LABELS[status];
    if (!label) return null;
    return { title: `Tu pedido${numStr} fue ${label}`, body: `${storeName} ${label} tu pedido${numStr} de ${totalStr}` };
  }
  switch (status) {
    case "confirmed":
      return { title: `¡Pedido${numStr} aceptado!`, body: `${storeName} aceptó tu pedido${numStr} de ${totalStr} y ya lo está empaquetando` };
    case "preparing":
      return { title: `Estamos empaquetando tu pedido${numStr}`, body: `${storeName} está empaquetando tu pedido${numStr} de ${totalStr}` };
    case "ready":
      return { title: `¡Tu pedido${numStr} está listo!`, body: `${storeName} ya tiene listo tu pedido${numStr} de ${totalStr}. Si elegiste retiro, ya podés pasar a buscarlo` };
    case "sent":
      return { title: `¡Tu pedido${numStr} va en camino!`, body: `${storeName} despachó tu pedido${numStr} de ${totalStr}` };
    case "completed":
      return { title: `¡Tu pedido${numStr} fue entregado!`, body: `Gracias por comprarle a ${storeName}` };
    case "cancelled":
      return { title: `Tu pedido${numStr} fue cancelado`, body: `${storeName} canceló tu pedido${numStr} de ${totalStr}` };
    default:
      return null;
  }
}

const RETURN_COLUMNS =
  "customer_phone, customer_name, customer_address, total, payment_method, payment_status, notes, modification_notes, method, items, pickup_number, transfer_proof_url, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'kitchen_done') THEN kitchen_done ELSE '[]'::jsonb END AS kitchen_done";

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

  const fullVendor = await queryOne<{ id: string; store_name: string; slug: string | null; block_unpaid_orders: boolean; vertical: string; delivery_fee: number | null; free_delivery_min: number | null; cash_discount_pct: number | null; kitchen_strict_close: boolean | null }>(
    `SELECT id, store_name, slug, block_unpaid_orders, vertical, delivery_fee, free_delivery_min, cash_discount_pct,
      -- Tolerante a migración de cierre estricto sin aplicar (default: exige).
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'kitchen_strict_close')
        THEN kitchen_strict_close ELSE true END AS kitchen_strict_close
      FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );

  const body = await request.json();
  const { status, estimated_minutes, modification_notes, payment_status } = body;
  const rawItems = body.items; // validado/recomputado server-side si viene
  const method = body.method;
  const customer_phone = body.customer_phone;
  const customer_address = body.customer_address;
  const toggleItem = body.toggle_item;
  const rawKitchenDone = body.kitchen_done;

  // Conversión de mostrador pickup → delivery en el medio del circuito.
  const isConvertDelivery =
    method === "delivery" &&
    !status &&
    !payment_status &&
    rawItems === undefined &&
    modification_notes === undefined &&
    toggleItem === undefined &&
    rawKitchenDone === undefined;

  const isModifyOnly = !status && !payment_status && (rawItems !== undefined || modification_notes !== undefined);

  // Tildado de cocina (KDS acumulativo): alterna o reemplaza el array de
  // progreso sin cambiar el estado del pedido. Solo en estados operativos.
  const isKitchenOnly =
    !status && !payment_status && rawItems === undefined &&
    modification_notes === undefined && !isConvertDelivery &&
    (toggleItem !== undefined || rawKitchenDone !== undefined);

  if (toggleItem !== undefined && (!Number.isInteger(toggleItem) || toggleItem < 0)) {
    return NextResponse.json({ error: "Ítem inválido" }, { status: 400 });
  }
  if (rawKitchenDone !== undefined && !Array.isArray(rawKitchenDone)) {
    return NextResponse.json({ error: "Progreso inválido" }, { status: 400 });
  }

  if (status && !["new", "confirmed", "preparing", "ready", "sent", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  if (payment_status && !["paid", "pending"].includes(payment_status)) {
    return NextResponse.json({ error: "Estado de pago inválido" }, { status: 400 });
  }

  const currentOrder = await queryOne<{ status: string; payment_status: string; payment_method: string; channel: string; method: string; items: OrderItem[] | null; customer_phone: string | null; total: number; is_preview: boolean | null; kitchen_done: boolean[] | null }>(
    `SELECT status, payment_status, payment_method, channel, method, items, customer_phone, total, is_preview,
      -- Tolerante a migración de progreso de cocina sin aplicar.
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'kitchen_done')
        THEN kitchen_done ELSE '[]'::jsonb END AS kitchen_done
      FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
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

  if (isKitchenOnly && (currentOrder.status === "completed" || currentOrder.status === "cancelled")) {
    return NextResponse.json(
      { error: "No se puede tildar un pedido ya finalizado" },
      { status: 400 }
    );
  }

  // Cierre estricto de cocina (solo gastronomía con elaboración): para
  // marcar "Listo" todos los ítems tienen que estar tildados en el KDS.
  // Retail (moda/comercio) y pedidos sin cocina no pasan por este gate.
  // El comercio puede apagarlo (on/off "Exigir tildado" en la Comanda).
  if (status === "ready" && fullVendor?.kitchen_strict_close !== false) {
    const vertical = fullVendor?.vertical ?? null;
    const isGastro = vertical === null || vertical === "gastronomia";
    const needsKitchen = (currentOrder.items || []).some(
      (i) => (i as OrderItem)?.requires_prep !== false
    );
    if (isGastro && needsKitchen) {
      const itemsLen = (currentOrder.items || []).length;
      const rawDone = Array.isArray(currentOrder.kitchen_done) ? currentOrder.kitchen_done : [];
      const pending = itemsLen - rawDone.filter(Boolean).length;
      // Si el pedido trae ítems legacy con `done` embebido, también cuentan.
      const legacyDone = (currentOrder.items || []).filter(
        (it, idx) => idx >= rawDone.length && (it as { done?: boolean })?.done === true
      ).length;
      if (pending - legacyDone > 0) {
        return NextResponse.json(
          { error: `Faltan ${pending - legacyDone} ítems por tildar en cocina`, code: "kitchen_incomplete" },
          { status: 409 }
        );
      }
    }
  }

  let order: Record<string, unknown> | null = null;
  try {
    order = await withTransaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      // Tolerante a migración de progreso de cocina sin aplicar.
      let hasKitchenCol = false;
      try {
        const col = await tx.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'orders' AND column_name = 'kitchen_done'
           ) AS exists`
        );
        hasKitchenCol = col[0]?.exists === true;
      } catch {
        hasKitchenCol = false;
      }
      if (isKitchenOnly && !hasKitchenCol) {
        throw new PricingError("Progreso de cocina no disponible (falta migración)");
      }
      if (status) updateData.status = status;
      if (status === "completed" || status === "cancelled") updateData.closed_at = new Date().toISOString();
      if (estimated_minutes !== undefined) updateData.estimated_minutes = estimated_minutes;
      if (modification_notes !== undefined) updateData.modification_notes = modification_notes;
      if (isConvertDelivery) {
        updateData.method = "delivery";
        updateData.customer_phone = (customer_phone as string).trim();
        updateData.customer_address = typeof customer_address === "string" && customer_address.trim() ? customer_address.trim() : null;
        // pickup_number se mantiene igual: es el número universal del pedido
        // del día, y al convertir a delivery no debe "saltar" de nombre.
      }
      if (payment_status !== undefined) {
        updateData.payment_status = payment_status;
        if (payment_status === "paid") updateData.paid_at = new Date().toISOString();
      }

      // Modificación de ítems: los precios/total se recalculan server-side
      // (desde la DB, no desde el body) para que el pedido quede coherente y
      // el cliente no pueda forzar un precio.
      if (isModifyOnly && rawItems !== undefined) {
        // Los ítems llegan en formato OrderItem (product_id/variant_id). Se
        // normalizan a la forma que espera resolveOrderPricing (offerId/variantId).
        const priceItems = (Array.isArray(rawItems) ? rawItems : []).map((i: any) => ({
          offerId: i.offerId ?? i.product_id ?? null,
          variantId: i.variantId ?? i.variant_id ?? null,
          qty: i.qty ?? 1,
          modifiers: i.modifiers ?? undefined,
        }));
        const pricing = await resolveOrderPricing({
          tx,
          vendorId: vendor.id,
          items: priceItems,
          method: currentOrder.method,
          deliveryFee: fullVendor?.delivery_fee,
          freeDeliveryMin: fullVendor?.free_delivery_min,
          paymentMethod: currentOrder.payment_method,
          cashDiscountPct: fullVendor?.cash_discount_pct ?? null,
        });
        updateData.items = JSON.stringify(pricing.items);
        updateData.total = pricing.total;
        updateData.cash_discount = pricing.cashDiscount;
        updateData.cash_pct = pricing.cashPct;
        // Tolerante a migración de volumen sin aplicar.
        try {
          const col = await tx.query<{ exists: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'orders' AND column_name = 'volume_discount'
             ) AS exists`
          );
          if (col[0]?.exists === true) updateData.volume_discount = pricing.volumeDiscount;
        } catch {
          /* sin columna: se sigue sin persistir el detalle */
        }

        // Re-stock del pedido viejo + reserva del nuevo (canales que reservan
        // stock al crear: app y mostrador; mesa nunca reserva).
        if (currentOrder.channel === "app" || currentOrder.channel === "mostrador") {
          await adjustStockForItems(tx, currentOrder.items, "increment");
          await adjustStockForItems(tx, pricing.items, "decrement");
        }
        // Ítems nuevos = producción nueva: se resetea el tildado de cocina.
        if (hasKitchenCol) {
          updateData.kitchen_done = JSON.stringify(
            Array.from({ length: pricing.items.length }, () => false)
          );
        }
      }

      // Tildado de cocina (KDS acumulativo): se normaliza al largo de items.
      if (isKitchenOnly) {
        const itemsLen = (currentOrder.items || []).length;
        if (toggleItem !== undefined && (toggleItem as number) >= itemsLen) {
          throw new PricingError("Ítem inválido");
        }
        const base = Array.isArray(currentOrder.kitchen_done)
          ? currentOrder.kitchen_done
          : [];
        // Legacy: ítems con `done` embebido cuentan como tildados.
        const normalized: boolean[] = Array.from({ length: itemsLen }, (_, i) =>
          i < base.length ? base[i] === true : (currentOrder.items?.[i] as { done?: boolean } | undefined)?.done === true
        );
        if (toggleItem !== undefined) {
          normalized[toggleItem as number] = !normalized[toggleItem as number];
        } else {
          const incoming = rawKitchenDone as unknown[];
          for (let i = 0; i < normalized.length; i++) {
            if (i < incoming.length) normalized[i] = incoming[i] === true;
          }
        }
        updateData.kitchen_done = JSON.stringify(normalized);
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

      // Cancelación/rechazo: reposición del stock reservado al crear el pedido
      // (app y mostrador reservan; mesa nunca reservó; los pedidos de prueba
      // tampoco descontaron → no hay nada que reponer).
      if (status === "cancelled" && (currentOrder.channel === "app" || currentOrder.channel === "mostrador") && currentOrder.is_preview !== true) {
        const updatedItems = (orderRows[0].items as OrderItem[] | null) ?? currentOrder.items;
        await adjustStockForItems(tx, updatedItems, "increment");
      }

      // CRM: la compra cancelada sale del libro (solo pedidos con cliente real:
      // app y mostrador delivery; mesa/mostrador-retiro nunca generaron ficha).
      if (status === "cancelled" && currentOrder.customer_phone) {
        const hasCustomerRow =
          currentOrder.channel === "app" ||
          (currentOrder.channel === "mostrador" && currentOrder.method === "delivery");
        if (hasCustomerRow && !currentOrder.customer_phone.startsWith("lid:")) {
          await decrementCustomerFromOrder(tx, vendor.id, {
            phone: currentOrder.customer_phone,
            total: currentOrder.total,
          });
        }
      }

      return orderRows[0];
    });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
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
    isRetailVendor({ vertical: fullVendor?.vertical ?? null }),
    fullVendor?.store_name,
    Number(order.total),
    order.pickup_number as number | null
  );

  if (order && pushText && order.customer_phone && !isCounterPickup) {
    try {
      const phoneVariants = phoneVariantsAR(order.customer_phone as string);
      const customerProfile = await queryOne<{ id: string; email: string | null }>(
        `SELECT id, email FROM profiles
         WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
            OR regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
         LIMIT 1`,
        [phoneVariants]
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const order = await queryOne<{ id: string; channel: string; status: string; items: OrderItem[] | null; is_preview: boolean | null }>(
    `SELECT id, channel, status, items, is_preview FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );
  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  await withTransaction(async (tx) => {
    // Reponer stock reservado: si el pedido no está en estado terminal
    // (cancelado ya repuso al cancelar; completado ya vendió el stock).
    // Los pedidos de prueba nunca descontaron: nada que reponer.
    if (
      (order.channel === "app" || order.channel === "mostrador") &&
      order.status !== "completed" &&
      order.status !== "cancelled" &&
      order.is_preview !== true &&
      order.items &&
      order.items.length > 0
    ) {
      await adjustStockForItems(tx, order.items, "increment");
    }
    await tx.queryVoid(`DELETE FROM orders WHERE id = $1 AND vendor_id = $2`, [params.id, vendor.id]);
  });

  return NextResponse.json({ ok: true });
}