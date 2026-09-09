import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, queryMany, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reordena los grupos de modificadores asignados a un plato. */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { product_id, group_ids } = body;

  if (!product_id || !Array.isArray(group_ids)) {
    return NextResponse.json({ error: "product_id y group_ids son requeridos" }, { status: 400 });
  }

  const product = await queryOne<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [product_id, vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  // Validar que los grupos pertenezcan al vendor.
  const valid = await queryMany<{ id: string }>(
    `SELECT id FROM modifier_groups WHERE vendor_id = $1 AND id = ANY($2)`,
    [vendor.id, group_ids]
  );
  const validIds = new Set(valid.map((r) => r.id));

  await query(`DELETE FROM product_modifier_links WHERE product_id = $1`, [product_id]);
  let pos = 0;
  for (const gid of group_ids) {
    if (!validIds.has(gid)) continue;
    await query(
      `INSERT INTO product_modifier_links (group_id, product_id, position) VALUES ($1, $2, $3)`,
      [gid, product_id, pos]
    );
    pos++;
  }

  return NextResponse.json({ ok: true });
}