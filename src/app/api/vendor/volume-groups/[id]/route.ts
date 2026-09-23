import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { validateVolumeGroupPayload } from "@/lib/volume-pricing";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Edita un grupo (nombre, productos, tramos y combinaciones). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  const vrow = await queryOne<{ vertical: string | null }>(
    `SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  if (vrow?.vertical && vrow.vertical !== "gastronomia") {
    return NextResponse.json({ error: "Los precios por volumen están disponibles para gastronomía" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const v = validateVolumeGroupPayload(body);
  if (!v.value) return NextResponse.json({ error: v.error }, { status: 400 });

  const owned = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
    [vendor.id, v.value.productIds]
  );
  const ownedIds = new Set((owned || []).map((r) => r.id));
  if (ownedIds.size !== v.value.productIds.length) {
    return NextResponse.json({ error: "Hay productos que no son de tu comercio" }, { status: 400 });
  }

  // Un producto en un solo grupo activo (excluyendo el que se edita).
  const clash = await queryMany<{ id: string; name: string; product_ids: string[] }>(
    `SELECT id, name, product_ids FROM volume_groups WHERE vendor_id = $1 AND active = true AND id <> $2`,
    [vendor.id, id]
  );
  for (const g of clash || []) {
    const ids = new Set((g.product_ids || []).map(String));
    if (v.value.productIds.some((pid) => ids.has(pid))) {
      return NextResponse.json(
        { error: `Uno de esos productos ya está en el grupo "${g.name}"` },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await withTransaction(async (tx) => {
      const g = await tx.queryOne<Record<string, unknown>>(
        `UPDATE volume_groups
         SET name = $1, product_ids = $2, combine_promo = $3, combine_cash = $4, extras_mode = $5
         WHERE id = $6 AND vendor_id = $7 RETURNING *`,
        [v.value!.name, v.value!.productIds, v.value!.combinePromo, v.value!.combineCash, v.value!.extrasMode, id, vendor.id]
      );
      if (!g) return null;
      await tx.queryVoid(`DELETE FROM volume_tiers WHERE group_id = $1`, [id]);
      const tiers: Record<string, unknown>[] = [];
      for (const t of v.value!.tiers) {
        const row = await tx.queryOne<Record<string, unknown>>(
          `INSERT INTO volume_tiers (group_id, min_qty, kind, value) VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, t.minQty, t.kind, t.value]
        );
        if (row) tiers.push(row);
      }
      return { ...g, tiers };
    });
    if (!updated) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
    return NextResponse.json({ group: updated });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de precios por volumen" }, { status: 503 });
  }
}

/** Borra un grupo con sus tramos. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  try {
    const rows = await queryMany<{ id: string }>(
      `DELETE FROM volume_groups WHERE id = $1 AND vendor_id = $2 RETURNING id`,
      [id, vendor.id]
    );
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de precios por volumen" }, { status: 503 });
  }
}
