import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const existing = await queryOne<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM vendor_gallery WHERE id = $1 LIMIT 1`,
    [id]
  );

  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await query(`DELETE FROM vendor_gallery WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const caption =
    body.caption != null && String(body.caption).trim() !== ""
      ? String(body.caption).trim().slice(0, 200)
      : null;

  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE vendor_gallery SET caption = $2 WHERE id = $1 AND vendor_id = $3 RETURNING *`,
    [id, caption, vendor.id]
  );
  if (!updated) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return NextResponse.json({ item: updated });
}