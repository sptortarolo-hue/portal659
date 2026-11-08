import { gateRequest } from "@/lib/subscription-gate";
import { query, queryMany, queryOne, withTransaction, hasColumn } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Convierte un presupuesto de consulta aceptado en una orden de servicio.
 *
 * POST /api/vendor/quotes/[id]/convert-to-order
 * Body: { booking_date?, delivery_date?, notes?, deposit_amount?, service_price?, equipment_id? }
 *
 * Requiere que la quote exista, sea del vendor, sea tipo 'consulta' y esté en 'accepted'.
 * Crea un booking de tipo 'orden' con los datos de la quote precargados y la vincula.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const quote = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string;
    customer_phone: string;
    description: string;
    service_name: string | null;
    quoted_price: number | null;
    quote_type: string | null;
    status: string;
    booking_id: string | null;
  }>(
    `SELECT id, vendor_id, customer_name, customer_phone, description, service_name,
            quoted_price, quote_type, status, booking_id
     FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (quote.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (quote.quote_type !== "consulta") {
    return NextResponse.json({ error: "Solo se puede convertir una consulta" }, { status: 400 });
  }
  if (quote.status !== "accepted") {
    return NextResponse.json({ error: "La consulta debe estar aceptada para convertir en orden" }, { status: 400 });
  }
  if (quote.booking_id) {
    return NextResponse.json({ error: "Esta consulta ya tiene una orden vinculada" }, { status: 400 });
  }

  const bookingDate = body.booking_date ? String(body.booking_date).slice(0, 10) : null;
  const deliveryDate = body.delivery_date ? String(body.delivery_date).slice(0, 10) : null;
  const notes = body.notes != null ? String(body.notes).trim().slice(0, 2000) || null : null;
  const depositAmount = body.deposit_amount != null && Number(body.deposit_amount) > 0
    ? Math.round(Number(body.deposit_amount) * 100) / 100 : null;
  const servicePrice = body.service_price != null && Number(body.service_price) > 0
    ? Math.round(Number(body.service_price) * 100) / 100
    : (quote.quoted_price != null && quote.quoted_price > 0 ? quote.quoted_price : null);

  const dbQuerier = { query: <T extends { [k: string]: unknown }>(sql: string, p?: unknown[]) => queryMany<T>(sql, p) };

  // Verificar que las columnas existan (tolerante a migración pendiente).
  const hasKindCol = await hasColumn(dbQuerier, "bookings", "kind");
  const hasDeliveryCol = await hasColumn(dbQuerier, "bookings", "delivery_date");
  const hasDeclaredCol = await hasColumn(dbQuerier, "bookings", "declared_issue");
  const hasDiagnosisCol = await hasColumn(dbQuerier, "bookings", "diagnosis");
  const hasDepositCol = await hasColumn(dbQuerier, "bookings", "deposit_amount");
  const hasServicePriceCol = await hasColumn(dbQuerier, "bookings", "service_price");
  const hasEquipmentCol = await hasColumn(dbQuerier, "bookings", "equipment_id");
  const hasQuoteIdCol = await hasColumn(dbQuerier, "bookings", "quote_id");
  const hasBookingIdCol = await hasColumn(dbQuerier, "quotes", "booking_id");

  if (!hasKindCol) {
    return NextResponse.json({ error: "Falta aplicar la migración migrate-work-orders.sql en la base" }, { status: 503 });
  }

  let orderId: string | null = null;
  try {
    orderId = await withTransaction(async (tx) => {
      const cols: string[] = [
        "vendor_id", "product_id", "customer_id", "product_name", "customer_name",
        "customer_phone", "booking_date", "status", "origin", "kind",
      ];
      const vals: unknown[] = [
        gate.vendor.id, null, null,
        quote.description.slice(0, 120),
        quote.customer_name,
        quote.customer_phone,
        bookingDate || new Date().toISOString().slice(0, 10),
        "quoted",
        "vendor",
        "orden",
      ];
      if (hasDeliveryCol && deliveryDate) {
        cols.push("delivery_date");
        vals.push(deliveryDate);
      }
      if (hasDeclaredCol) {
        cols.push("declared_issue");
        vals.push(quote.description);
      }
      if (hasDiagnosisCol) {
        cols.push("diagnosis");
        vals.push(null);
      }
      if (hasDepositCol && depositAmount) {
        cols.push("deposit_amount");
        vals.push(depositAmount);
      }
      if (hasServicePriceCol && servicePrice) {
        cols.push("service_price");
        vals.push(servicePrice);
      }
      if (hasEquipmentCol && body.equipment_id) {
        cols.push("equipment_id");
        vals.push(body.equipment_id);
      }
      if (hasQuoteIdCol) {
        cols.push("quote_id");
        vals.push(quote.id);
      }

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const q = await tx.query<{ id: string }>(
        `INSERT INTO bookings (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      const id = q[0]?.id;
      if (!id) throw new Error("No se pudo crear la orden");
      return id;
    });
  } catch (e) {
    throw e;
  }

  // Vincular la quote a la orden.
  if (hasBookingIdCol) {
    await query(`UPDATE quotes SET booking_id = $1 WHERE id = $2`, [orderId, quote.id]);
  }

  const order = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [orderId]
  );

  return NextResponse.json({ ok: true, order, quote_id: quote.id });
}
