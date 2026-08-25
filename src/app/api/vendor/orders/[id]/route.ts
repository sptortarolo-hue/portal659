import { getAuthSupabase } from "@/lib/auth-utils";
import { getServiceClient } from "@/lib/supabase";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;

  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, store_name")
    .eq("user_id", user.user.id)
    .maybeSingle();

  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { status, estimated_minutes, items, modification_notes } = body;

  const isModifyOnly = !status && (items !== undefined || modification_notes !== undefined);

  if (status && !["new", "confirmed", "preparing", "ready", "sent", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const { data: currentOrderRows, error: fetchErr } = await supabase
    .from("orders")
    .select("status")
    .eq("id", params.id)
    .eq("vendor_id", vendor.id);

  if (fetchErr || !currentOrderRows || currentOrderRows.length === 0) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const currentOrder = currentOrderRows[0];

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
  if (items !== undefined) updateData.items = items;
  if (modification_notes !== undefined) updateData.modification_notes = modification_notes;

  const { data: orderRows, error: updateErr } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", params.id)
    .eq("vendor_id", vendor.id)
    .select("customer_phone, customer_name, total, payment_method, notes, modification_notes, method, items");

  if (updateErr || !orderRows || orderRows.length === 0) {
    return NextResponse.json({ error: updateErr?.message || "Error al actualizar" }, { status: 500 });
  }

  const order = orderRows[0];

  if (status) {
    await supabase.from("order_status_log").insert({
      order_id: params.id,
      status,
    });
  }

  if (order && STATUS_LABELS[status] && order.customer_phone) {
    try {
      const serviceClient = getServiceClient();
      if (serviceClient) {
        const { data: profiles } = await serviceClient.auth.admin.listUsers();
        const customerProfile = profiles?.users?.find(
          (u: { phone?: string; user_metadata?: Record<string, unknown> }) =>
            u.phone === order.customer_phone || (u.user_metadata?.phone as string) === order.customer_phone
        );

        if (customerProfile) {
          await serviceClient.from("notifications").insert({
            user_id: customerProfile.id,
            title: `Tu pedido fue ${STATUS_LABELS[status]}`,
            body: `${vendor.store_name} ${STATUS_LABELS[status]} tu pedido de $${Number(order.total).toLocaleString("es-AR")}`,
            type: "order",
            link: "/mis-pedidos",
          });
        }
      }
    } catch {
      // Notification is best-effort, don't fail the request
    }
  }

  return NextResponse.json({ order });
}
