import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { sendEmail, reviewRequestEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";
import { canTransition } from "@/lib/order-utils";
import type { OrderStatus } from "@/types/database";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "confirmado",
  preparing: "en preparación",
  ready: "listo",
  sent: "enviado",
  completed: "entregado",
  cancelled: "cancelado",
};

const RETURN_COLUMNS =
  "customer_phone, customer_name, total, payment_method, notes, modification_notes, method, items";

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

  const fullVendor = await queryOne<{ id: string; store_name: string; slug: string | null; block_unpaid_orders: boolean }>(
    `SELECT id, store_name, slug, block_unpaid_orders FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );

  const body = await request.json();
  const { status, estimated_minutes, items, modification_notes, payment_status } = body;

  const isModifyOnly = !status && !payment_status && (items !== undefined || modification_notes !== undefined);

  if (status && !["new", "confirmed", "preparing", "ready", "sent", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  if (payment_status && !["paid", "pending"].includes(payment_status)) {
    return NextResponse.json({ error: "Estado de pago inválido" }, { status: 400 });
  }

  const currentOrder = await queryOne<{ status: string; payment_status: string; payment_method: string; channel: string }>(
    `SELECT status, payment_status, payment_method, channel FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );

  if (!currentOrder) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const ADVANCE_STATUSES = ["confirmed", "preparing", "ready", "sent", "completed"];
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

  if (status && !canTransition(currentOrder.status as OrderStatus, status as OrderStatus)) {
    return NextResponse.json(
      { error: `No se puede pasar de "${currentOrder.status}" a "${status}"` },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (status) updateData.status = status;
  if (estimated_minutes !== undefined) updateData.estimated_minutes = estimated_minutes;
  if (items !== undefined) updateData.items = JSON.stringify(items);
  if (modification_notes !== undefined) updateData.modification_notes = modification_notes;
  if (payment_status !== undefined) {
    updateData.payment_status = payment_status;
    if (payment_status === "paid") updateData.paid_at = new Date().toISOString();
  }

  const setClauses: string[] = [];
  const values: unknown[] = [params.id, vendor.id];
  let idx = 3;
  for (const [key, val] of Object.entries(updateData)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }

  const order = await withTransaction(async (tx) => {
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

    return orderRows[0];
  });

  if (!order) {
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }

  if (order && STATUS_LABELS[status] && order.customer_phone) {
    try {
      const customerProfile = await queryOne<{ id: string; email: string | null }>(
        `SELECT id, email FROM profiles WHERE phone = $1 OR whatsapp = $1 LIMIT 1`,
        [order.customer_phone as string]
      );

      if (customerProfile) {
        const title = `Tu pedido fue ${STATUS_LABELS[status]}`;
        const body = `${fullVendor?.store_name} ${STATUS_LABELS[status]} tu pedido de $${Number(order.total).toLocaleString("es-AR")}`;

        await queryMany<Record<string, unknown>>(
          `INSERT INTO notifications (user_id, title, body, type, link)
           VALUES ($1, $2, $3, $4, $5)`,
          [customerProfile.id, title, body, "order", "/mis-pedidos"]
        );

        await sendPushToUser(customerProfile.id, { title, body, link: "/mis-pedidos" });

        if (status === "completed" && customerProfile.email) {
          const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
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