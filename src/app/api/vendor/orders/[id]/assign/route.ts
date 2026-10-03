import { NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { sendPushToUser } from "@/lib/push";

// Asigna o libera un pedido a un repartidor.
// claim    → toma el pedido (solo si está sin asignar y en ready/sent)
// release  → lo devuelve al pool (solo el titular)
// assign   → el DUEÑO asigna a un repartidor específico (solo ready/sent;
//            409 si otro lo tomó primero: nunca se pisa un reparto en curso)
// unassign → el DUEÑO suelta cualquier toma (ej: repartidor que desaparece)
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor, userId, staffRole, previewSession } = await getVendorByRequest(request);
  if (!vendor || !userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const isOwner = staffRole !== "delivery";

  const body = await request.json().catch(() => ({}));
  const rawAction = String(body.action || "claim");
  const action = ["release", "assign", "unassign"].includes(rawAction) ? rawAction : "claim";
  if ((action === "assign" || action === "unassign") && !isOwner) {
    return NextResponse.json({ error: "Solo el comercio puede asignar repartidores" }, { status: 403 });
  }

  const order = await queryOne<{ id: string; assigned_to: string | null; status: string; pickup_number: number | null }>(
    `SELECT id, assigned_to, status, pickup_number FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  if (action === "claim") {
    if (!["ready", "sent"].includes(order.status)) {
      return NextResponse.json({ error: "Este pedido no está listo para entregar" }, { status: 400 });
    }
    // Atómico: si el dueño asignó (o otro tomó) entre el SELECT y acá, no
    // hay fila para actualizar → 409 en vez de pisar el reparto en curso.
    const taken = await queryOne<{ id: string }>(
      `UPDATE orders SET assigned_to = $1, claimed_at = now()
       WHERE id = $2 AND assigned_to IS NULL RETURNING id`,
      [userId, params.id]
    );
    if (!taken) {
      return NextResponse.json({ error: "El pedido ya lo tomó otro repartidor" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, assigned: true });
  }

  if (action === "release") {
    if (order.assigned_to !== userId) {
      return NextResponse.json({ error: "No tenés este pedido asignado" }, { status: 403 });
    }
    await query(`UPDATE orders SET assigned_to = NULL, claimed_at = NULL WHERE id = $1`, [params.id]);
    return NextResponse.json({ ok: true, assigned: false });
  }

  // --- Acciones del dueño ---
  if (!["ready", "sent"].includes(order.status)) {
    return NextResponse.json({ error: "Este pedido no está listo para entregar" }, { status: 400 });
  }

  if (action === "unassign") {
    if (!order.assigned_to) {
      return NextResponse.json({ ok: true, assigned: false });
    }
    await query(`UPDATE orders SET assigned_to = NULL, claimed_at = NULL WHERE id = $1`, [params.id]);
    // Aviso al repartidor soltado (`assigned_to` es profile id: así lo guarda
    // el claim y así lo matchea el tablero). Solo con perfil y no en prueba.
    if (!previewSession && order.assigned_to) {
      const numTxt = order.pickup_number != null ? `Nro. ${order.pickup_number}` : "sin número";
      void sendPushToUser(order.assigned_to, {
        title: "↩️ Te liberaron un pedido",
        body: `El comercio soltó tu pedido ${numTxt}: volvió al pool de disponibles.`,
        link: "/vendor/dashboard",
      }).catch(() => {});
      await query(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
        [order.assigned_to, "↩️ Pedido liberado", `El comercio soltó tu pedido ${numTxt}: volvió al pool.`, "order", "/vendor/dashboard"]
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, assigned: false });
  }

  // assign — se guarda el PROFILE id (igual que el claim): es lo que el
  // tablero compara (`assigned_to === userId`) y lo que recibe el push.
  const staffId = String(body.staffId || "");
  if (!staffId) return NextResponse.json({ error: "Falta el repartidor" }, { status: 400 });
  const target = await queryOne<{ id: string; profile_id: string | null; status: string; full_name: string | null }>(
    `SELECT vs.id, vs.profile_id, vs.status, p.full_name
     FROM vendor_staff vs LEFT JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.id = $1 AND vs.vendor_id = $2 LIMIT 1`,
    [staffId, vendor.id]
  );
  if (!target || target.status === "revoked") {
    return NextResponse.json({ error: "Ese repartidor no está activo" }, { status: 400 });
  }
  if (!target.profile_id) {
    return NextResponse.json({ error: "Ese repartidor aún no se vinculó (sin código aceptado)" }, { status: 400 });
  }
  if (order.assigned_to && order.assigned_to !== target.profile_id) {
    return NextResponse.json({ error: "Otro repartidor lo tomó primero: actualizá la lista" }, { status: 409 });
  }
  if (order.assigned_to === target.profile_id) {
    return NextResponse.json({ ok: true, assigned: true });
  }
  const storeName =
    (await queryOne<{ store_name: string }>(`SELECT store_name FROM vendors WHERE id = $1 LIMIT 1`, [vendor.id]).catch(() => null))?.store_name ||
    "Tu comercio";
  // Atómico como el claim: si lo tomaron entre el SELECT y acá, no pisa.
  const assigned = await queryOne<{ id: string }>(
    `UPDATE orders SET assigned_to = $1, claimed_at = now()
     WHERE id = $2 AND (assigned_to IS NULL OR assigned_to = $1) RETURNING id`,
    [target.profile_id, params.id]
  );
  if (!assigned) {
    return NextResponse.json({ error: "Otro repartidor lo tomó primero: actualizá la lista" }, { status: 409 });
  }
  // Aviso al repartidor asignado (no en prueba).
  if (!previewSession) {
    const numTxt = order.pickup_number != null ? `Nro. ${order.pickup_number}` : "sin número";
    void sendPushToUser(target.profile_id, {
      title: `🛵 Pedido asignado ${numTxt}`,
      body: `${storeName} te asignó un pedido. Mirá "Mis entregas".`,
      link: "/vendor/dashboard",
      tag: `assign-${params.id}`,
      renotify: true,
      urgency: "high",
    }).catch(() => {});
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
      [target.profile_id, `🛵 Pedido asignado ${numTxt}`, `${storeName} te asignó un pedido.`, "order", "/vendor/dashboard"]
    ).catch(() => {});
  }
  return NextResponse.json({ ok: true, assigned: true, staffId: target.id });
}