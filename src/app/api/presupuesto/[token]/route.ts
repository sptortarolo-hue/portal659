import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Datos públicos del presupuesto por token (página /presupuesto/[token]):
 * el mismo contenido del impreso (partidas incluidas) +, si está vinculado a
 * una orden de taller y aceptado, el estado de esa orden (seguimiento).
 * El token es aleatorio de 48 hex: sin él no hay nada.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f]{24,64}$/i.test(token)) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  }

  const quote = await queryOne<{
    id: string;
    status: string;
    customer_name: string | null;
    service_name: string | null;
    description: string | null;
    preferred_date: string | null;
    quoted_price: number | null;
    deposit_pct: number | null;
    deposit_amount: number | null;
    created_at: string;
    accepted_at: string | null;
    booking_id: string | null;
    equipment_kind: string | null;
    equipment_brand: string | null;
    equipment_model: string | null;
    equipment_identifier: string | null;
    equipment_rodado: number | string | null;
    equipment_color: string | null;
    store_name: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    vertical: string | null;
  }>(
    `SELECT q.id, q.status, q.customer_name, q.service_name, q.description,
            q.preferred_date, q.quoted_price, q.deposit_pct, q.deposit_amount,
            q.created_at, q.accepted_at, q.booking_id,
            e.kind AS equipment_kind, e.brand AS equipment_brand, e.model AS equipment_model,
            e.identifier AS equipment_identifier, e.rodado AS equipment_rodado, e.color AS equipment_color,
            v.store_name, v.address, v.phone, v.whatsapp, v.vertical
     FROM quotes q
     JOIN vendors v ON v.id = q.vendor_id
     LEFT JOIN equipment e ON e.id = q.equipment_id
     WHERE q.public_token = $1
     LIMIT 1`,
    [token]
  ).catch(() => null);

  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  const items = await queryMany<{ id: string; kind: string | null; description: string | null; qty: number | string; unit_price: number | string }>(
    `SELECT id, kind, description, qty, unit_price
     FROM quote_items WHERE quote_id = $1 ORDER BY position ASC`,
    [quote.id]
  ).catch(() => []);

  // Seguimiento: si hay orden vinculada, su estado actual (tolerante a que
  // la columna work_order_no no exista todavía).
  let order: { status: string; work_order_no: number | null; delivery_date: string | null } | null = null;
  if (quote.booking_id) {
    order = (await queryOne<{ status: string; work_order_no: number | null; delivery_date: string | null }>(
      `SELECT status, work_order_no, delivery_date FROM bookings WHERE id = $1 AND vendor_id = (SELECT vendor_id FROM quotes WHERE public_token = $2) LIMIT 1`,
      [quote.booking_id, token]
    ).catch(async () => {
      return await queryOne<{ status: string; work_order_no: number | null; delivery_date: string | null }>(
        `SELECT status, NULL::numeric AS work_order_no, NULL::date AS delivery_date FROM bookings WHERE id = $1 LIMIT 1`,
        [quote.booking_id]
      ).catch(() => null);
    })) || null;
  }

  return NextResponse.json({
    quote: {
      id: quote.id,
      status: quote.status,
      customer_name: quote.customer_name,
      service_name: quote.service_name,
      description: quote.description,
      preferred_date: quote.preferred_date,
      quoted_price: quote.quoted_price,
      deposit_pct: quote.deposit_pct,
      deposit_amount: quote.deposit_amount,
      created_at: quote.created_at,
      accepted_at: quote.accepted_at,
      equipment_kind: quote.equipment_kind,
      equipment_brand: quote.equipment_brand,
      equipment_model: quote.equipment_model,
      equipment_identifier: quote.equipment_identifier,
      equipment_rodado: quote.equipment_rodado,
      equipment_color: quote.equipment_color,
    },
    items: items || [],
    vendor: {
      store_name: quote.store_name,
      address: quote.address,
      phone: quote.phone,
      whatsapp: quote.whatsapp,
      vertical: quote.vertical,
    },
    order,
  });
}
