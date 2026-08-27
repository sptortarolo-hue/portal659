import { query, queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json();
  const { vendorId, customerName, customerPhone, serviceName, description, preferredDate, preferredTime } = body;

  if (!vendorId || !customerName || !customerPhone || !description) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const quote = await queryOne<{ id: string }>(
    `INSERT INTO quotes (vendor_id, customer_name, customer_phone, service_name, description, preferred_date, preferred_time, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
    [vendorId, customerName, customerPhone, serviceName || null, description, preferredDate || null, preferredTime || null]
  );

  const vendor = await queryOne<{ user_id: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendor?.user_id) {
    const desc = `${description.slice(0, 80)}${description.length > 80 ? "..." : ""}`;
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'quote', '/vendor/dashboard')`,
      [vendor.user_id, "Nuevo presupuesto solicitado", `${customerName} solicitó presupuesto: "${desc}"`]
    );
  }

  return NextResponse.json({ ok: true, quoteId: quote?.id });
}, { maxRequests: 10 });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId");
  if (!vendorId) return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });

  const quotes = await queryMany<Record<string, unknown>>(
    `SELECT * FROM quotes WHERE vendor_id = $1 ORDER BY created_at DESC`,
    [vendorId]
  );
  return NextResponse.json({ quotes });
}