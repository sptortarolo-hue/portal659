import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ bookings: [] });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const date = searchParams.get("date");

  const conditions: string[] = [`b.vendor_id = $1`];
  const params: unknown[] = [vendor.id];
  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }
  if (date) {
    params.push(date);
    conditions.push(`b.booking_date = $${params.length}`);
  }

  const bookings = await queryMany<Record<string, unknown>>(
    `SELECT b.*, p.name
     FROM bookings b
     JOIN products p ON p.id = b.product_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY b.booking_date ASC, b.booking_time ASC`,
    params
  );
  return NextResponse.json({ bookings: bookings || [] });
}