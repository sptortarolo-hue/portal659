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

  const allowedFields = ["group_name", "options", "required", "max_selections", "position"] as const;
  const safeUpdate: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) safeUpdate[key] = body[key];
  }

  const existing = await queryOne<{ id: string; product_id: string; vendor_id: string }>(
    `SELECT pm.id, pm.product_id, p.vendor_id
     FROM product_modifiers pm
     JOIN products p ON p.id = pm.product_id
     WHERE pm.id = $1 LIMIT 1`,
    [id]
  );

  if (!existing || existing.vendor_id === undefined) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const cols = allowedFields.filter((k) => k in safeUpdate);
  if (cols.length > 0) {
    const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = cols.map((k) => safeUpdate[k]);
    await query(`UPDATE product_modifiers SET ${set} WHERE id = $${cols.length + 1}`, [
      ...values,
      id,
    ]);
  }

  const modifier = await queryOne<Record<string, unknown>>(
    `SELECT * FROM product_modifiers WHERE id = $1 LIMIT 1`,
    [id]
  );

  return NextResponse.json({ modifier });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const existing = await queryOne<{ id: string; product_id: string; vendor_id: string }>(
    `SELECT pm.id, pm.product_id, p.vendor_id
     FROM product_modifiers pm
     JOIN products p ON p.id = pm.product_id
     WHERE pm.id = $1 LIMIT 1`,
    [id]
  );

  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await query(`DELETE FROM product_modifiers WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}