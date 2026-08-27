import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json();
  const { vendorId, productName, bookingDate, bookingTime, notes, customerName, customerPhone } = body;

  if (!vendorId || !bookingDate || !bookingTime || !customerName || !customerPhone) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const booking = await queryOne<{ id: string }>(
    `INSERT INTO bookings (vendor_id, product_id, customer_id, product_name, booking_date, booking_time, notes, status)
     VALUES ($1, NULL, NULL, $2, $3, $4, $5, 'pending') RETURNING id`,
    [vendorId, productName || null, bookingDate, bookingTime, notes || null]
  );

  const vendor = await queryOne<{ user_id: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendor?.user_id) {
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       VALUES ($1, $2, $3, 'booking', '/vendor/dashboard')`,
      [
        vendor.user_id,
        "Nuevo turno reservado",
        `${customerName} reservó turno para ${bookingDate} a las ${bookingTime}${productName ? ` — ${productName}` : ""}`,
      ]
    );
  }

  return NextResponse.json({ ok: true, bookingId: booking?.id });
}, { maxRequests: 10 });