import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { validateVolumeGroupPayload } from "@/lib/volume-pricing";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function tablesReady(): Promise<boolean> {
  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'volume_groups'
       ) AS exists`
    );
    return row?.exists === true;
  } catch {
    return false;
  }
}

/** Lista los grupos de volumen del comercio con sus tramos. */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ groups: [] });
  if (!(await tablesReady())) return NextResponse.json({ groups: [] });

  const groups = await queryMany<Record<string, unknown>>(
    `SELECT * FROM volume_groups WHERE vendor_id = $1 ORDER BY position ASC, created_at ASC`,
    [vendor.id]
  );
  const tiers = await queryMany<Record<string, unknown>>(
    `SELECT t.* FROM volume_tiers t
     JOIN volume_groups g ON g.id = t.group_id
     WHERE g.vendor_id = $1 ORDER BY t.min_qty ASC`,
    [vendor.id]
  );
  const tiersByGroup: Record<string, unknown[]> = {};
  for (const t of tiers || []) {
    const gid = t.group_id as string;
    (tiersByGroup[gid] ||= []).push(t);
  }
  return NextResponse.json({
    groups: (groups || []).map((g) => ({ ...g, tiers: tiersByGroup[g.id as string] || [] })),
  });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
  const vrow = await queryOne<{ vertical: string | null }>(
    `SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  if (vrow?.vertical && vrow.vertical !== "gastronomia") {
    return NextResponse.json({ error: "Los precios por volumen están disponibles para gastronomía" }, { status: 403 });
  }
  if (!(await tablesReady())) {
    return NextResponse.json({ error: "Falta aplicar la migración de precios por volumen" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const v = validateVolumeGroupPayload(body);
  if (!v.value) return NextResponse.json({ error: v.error }, { status: 400 });

  // Los productos tienen que ser del comercio.
  const owned = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
    [vendor.id, v.value.productIds]
  );
  const ownedIds = new Set((owned || []).map((r) => r.id));
  if (ownedIds.size !== v.value.productIds.length) {
    return NextResponse.json({ error: "Hay productos que no son de tu comercio" }, { status: 400 });
  }

  // Un producto en un solo grupo activo.
  const clash = await queryMany<{ name: string; product_ids: string[] }>(
    `SELECT name, product_ids FROM volume_groups WHERE vendor_id = $1 AND active = true`,
    [vendor.id]
  );
  for (const g of clash || []) {
    const ids = new Set((g.product_ids || []).map(String));
    if (v.value.productIds.some((id) => ids.has(id))) {
      return NextResponse.json(
        { error: `Uno de esos productos ya está en el grupo "${g.name}"` },
        { status: 400 }
      );
    }
  }

  const created = await withTransaction(async (tx) => {
    const g = await tx.queryOne<Record<string, unknown>>(
      `INSERT INTO volume_groups (vendor_id, name, product_ids, combine_promo, combine_cash, extras_mode)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [vendor.id, v.value!.name, v.value!.productIds, v.value!.combinePromo, v.value!.combineCash, v.value!.extrasMode]
    );
    if (!g) throw new Error("No se pudo crear el grupo");
    const tiers: Record<string, unknown>[] = [];
    for (const t of v.value!.tiers) {
      const row = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO volume_tiers (group_id, min_qty, kind, value) VALUES ($1, $2, $3, $4) RETURNING *`,
        [g.id, t.minQty, t.kind, t.value]
      );
      if (row) tiers.push(row);
    }
    return { ...g, tiers };
  });

  return NextResponse.json({ group: created });
}
