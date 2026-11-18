import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany, query, withTransaction, hasTable, type Tx } from "@/lib/db";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vendors WHERE id = $1`,
    [id]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const products = await queryMany(
    `SELECT * FROM products WHERE vendor_id = $1`,
    [id]
  );

  const subscriptions = await queryMany(
    `SELECT s.*, p.slug AS plan_slug, p.name AS plan_name
     FROM vendor_subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.vendor_id = $1
     ORDER BY s.created_at DESC
     LIMIT 24`,
    [id]
  );

  return NextResponse.json({ vendor: { ...vendor, products }, subscriptions: subscriptions || [] });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const body = await request.json();
  const action = body?.action;

  // Inicializar datos de prueba (hand-over "llave en mano").
  //
  // El reset original solo borraba PEDIDOS, así que las pruebas de los
  // verticales de servicio (turnos, órdenes de taller, presupuestos, equipos,
  // clientes, caja...) quedaban en la base. Ahora borra toda la operación del
  // comercio y conserva la configuración: catálogo (productos/categorías/
  // modificadores), servicios, equipo de trabajo, sedes, planes y suscripción.
  //
  // Tolerante a migraciones sin aplicar: cada tabla se borra solo si existe
  // (`to_regclass`), así el reset nunca rompe un vertical sin la migración.
  if (action === "reset_orders" || action === "reset_all") {
    const vendor = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!vendor) {
      return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
    }

    // Borra las filas del comercio en `table` si la migración está aplicada.
    // Se pregunta por la tabla antes de tocarla (to_regclass): un DELETE sobre
    // una tabla inexistente aborta la transacción (25P02).
    const wipe = async (tx: Tx, table: string): Promise<number> => {
      if (!(await hasTable(tx, table))) return 0;
      const rows = await tx.query<Record<string, unknown>>(
        `DELETE FROM public.${table} WHERE vendor_id = $1 RETURNING 1`,
        [id]
      );
      return Array.isArray(rows) ? rows.length : 0;
    };

    const result = await withTransaction(async (tx) => {
      const counted: Record<string, number> = {};
      // --- Caja / gastos (van antes: cash_shifts linkea cash_closings) ---
      counted.cashMovements = await wipe(tx, "cash_movements");
      counted.cashShifts = await wipe(tx, "cash_shifts");
      counted.cashAdjustments = await wipe(tx, "cash_closing_adjustments");
      counted.cashClosings = await wipe(tx, "cash_closings");
      counted.expenses = await wipe(tx, "expenses");
      // --- Tarjetas de regalo (giftcard_moves cae en cascada) ---
      counted.giftcards = await wipe(tx, "giftcards");
      // --- Servicios: créditos de packs (los packs son configuración) ---
      counted.packCredits = await wipe(tx, "service_pack_credits");
      counted.waitlist = await wipe(tx, "waitlist");
      // --- Presupuestos / consultas ---
      counted.quotes = await wipe(tx, "quotes");
      // --- Turnos + órdenes de servicio (event feed, repuestos, recordatorios,
      //     reseñas y facturas caen por cascada; quotes.booking_id → NULL) ---
      counted.bookings = await wipe(tx, "bookings");
      // --- Equipos (ficha de taller/bici/celular) ---
      counted.equipmentReminders = await wipe(tx, "equipment_reminder_log");
      counted.equipment = await wipe(tx, "equipment");
      // --- Libro de clientes (CRM) ---
      counted.customers = await wipe(tx, "customers");
      // --- Pedidos (order_status_log / order_payments caen por cascada) ---
      counted.orders = await wipe(tx, "orders");
      // Parciales de mesa sin order_id (no caen por cascada del pedido).
      counted.orderPayments = await wipe(tx, "order_payments");
      // Idempotencia del sync offline: claves viejas que podrían bloquear replays.
      counted.syncKeys = await wipe(tx, "sync_idempotency");
      // Mesas en libre.
      const tables = await tx.query<{ id: string }>(
        `UPDATE tables SET status = 'libre' WHERE vendor_id = $1 RETURNING id`,
        [id]
      );
      counted.tablesReset = Array.isArray(tables) ? tables.length : 0;
      // Notificaciones de pedido/pago/reseña del dueño (best-effort).
      if (vendor.user_id) {
        await tx.queryVoid(
          `DELETE FROM notifications WHERE user_id = $1 AND type IN ('order', 'payment', 'review')`,
          [vendor.user_id]
        );
      }
      return counted;
    });

    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const body = await request.json();
  const allowed = [
    "store_name", "slug", "category", "vertical", "neighborhood", "whatsapp", "phone",
    "instagram", "facebook", "description", "address", "hours", "location", "image_url",
    "logo_url", "payment_methods", "delivery_options", "services_list", "service_area",
    "free_estimate", "accepting_quotes", "verified", "featured", "is_admin",
    "prep_time_min", "urgent_enabled", "lat", "lng", "visible", "visibility", "user_id",
  ];
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (allowed.includes(k)) clean[k] = body[k];
  }
  // Visibilidad enum: validar valor (nunca escribir un string arbitrario).
  if ("visibility" in clean && !["hidden", "private", "public"].includes(clean.visibility as string)) {
    return NextResponse.json({ error: "Visibilidad inválida" }, { status: 400 });
  }
  const cols = Object.keys(clean);
  if (cols.length === 0) return NextResponse.json({ ok: true });
  await query(`UPDATE vendors SET ${buildSetClauses(clean)} WHERE id = $1`, buildValues(id, clean));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  await query(`DELETE FROM vendors WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

function buildSetClauses(body: Record<string, unknown>): string {
  const cols = Object.keys(body);
  return cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
}

function buildValues(id: string, body: Record<string, unknown>): unknown[] {
  return [id, ...Object.values(body)];
}