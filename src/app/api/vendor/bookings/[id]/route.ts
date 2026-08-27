import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const existing = await queryOne<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await query(`UPDATE bookings SET status = $1 WHERE id = $2`, [body.status, id]);

  const booking = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  return NextResponse.json({ booking });
}