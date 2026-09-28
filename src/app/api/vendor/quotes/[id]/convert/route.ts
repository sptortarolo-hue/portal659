import { gateRequest } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { addServiceJob } from "@/lib/customers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Convertir un presupuesto en turno: lo marca aceptado (suma el trabajo al
 * libro con el precio cotizado) y crea el turno confirmado linkeado.
 * El turno futuro no vuelve a contar (el trabajo ya contó al aceptar).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (gate.vendor.vertical !== "servicio") {
    return NextResponse.json({ error: "Solo disponible para servicios" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const bookingDate = String(body.booking_date || "").trim();
  const bookingTime = String(body.booking_time || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !/^(\d{1,2}):(\d{2})/.test(bookingTime)) {
    return NextResponse.json({ error: "Falta fecha/hora válida del turno" }, { status: 400 });
  }
  const durationMin = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));

  const quote = await queryOne<{
    id: string;
    vendor_id: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    service_name: string | null;
    quoted_price: number | null;
  }>(
    `SELECT id, vendor_id, status, customer_name, customer_phone, service_name, quoted_price
     FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (quote.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (quote.status === "cancelled") {
    return NextResponse.json({ error: "El presupuesto está descartado" }, { status: 400 });
  }

  try {
    const bookingId = await withTransaction(async (tx) => {
      if (quote.status !== "accepted") {
        await tx.queryVoid(`UPDATE quotes SET status = 'accepted', accepted_at = now() WHERE id = $1`, [id]);
        await addServiceJob(tx, gate.vendor.id, {
          phone: quote.customer_phone,
          name: quote.customer_name,
          total: Number(quote.quoted_price) || 0,
        });
      }
      const b = await tx.query<{ id: string }>(
        `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, customer_name, customer_phone, booking_date, booking_time, duration_min, notes, status, origin, quote_id)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'vendor', $9) RETURNING id`,
        [
          gate.vendor.id,
          quote.service_name,
          quote.customer_name,
          quote.customer_phone,
          bookingDate,
          bookingTime,
          durationMin,
          String(body.notes || "").trim().slice(0, 2000) || null,
          id,
        ]
      );
      const bid = b[0]?.id;
      if (!bid) throw new Error("No se pudo crear el turno");
      return bid;
    });

    const booking = await queryOne<Record<string, unknown>>(
      `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
      [bookingId]
    ).catch(() => undefined);
    return NextResponse.json({ booking: booking || { id: bookingId } });
  } catch (e) {
    if (/origin|duration_min|quote_id|accepted_at/i.test((e as Error)?.message || "")) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    throw e;
  }
}
