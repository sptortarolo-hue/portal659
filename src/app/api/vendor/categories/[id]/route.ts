import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json();

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vendor_categories WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  );
  if (!existing) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body.position === "number") {
    patch.position = body.position;
  }

  const category = await queryOne<Record<string, unknown>>(
    `UPDATE vendor_categories SET name = COALESCE($1, name), position = COALESCE($2, position) WHERE id = $3 RETURNING *`,
    [patch.name ?? null, patch.position ?? null, id]
  );

  if (patch.name && patch.name !== existing.name) {
    await query(
      `UPDATE products SET category = $1 WHERE vendor_id = $2 AND category ILIKE $3`,
      [patch.name, vendor.id, existing.name as string]
    );
  }

  return NextResponse.json({ category });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const existing = await queryOne<{ name: string }>(
    `SELECT name FROM vendor_categories WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  );
  if (!existing) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  await query(`DELETE FROM vendor_categories WHERE id = $1 AND vendor_id = $2`, [id, vendor.id]);
  await query(`UPDATE products SET category = 'otras' WHERE vendor_id = $1 AND category ILIKE $2`, [vendor.id, existing.name]);

  return NextResponse.json({ ok: true });
}