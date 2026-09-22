import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";
import { isMissingColumnError } from "@/lib/modifier-rules";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Override de min/max de un grupo PARA UN producto (link). NULL = default del
 * grupo. Caso heladería: grupo "Gustos" con 2/3/5 según tamaño.
 * Requiere que el link ya exista (primero asignar el grupo al plato).
 */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { group_id, product_id } = body;
  if (!group_id || !product_id) {
    return NextResponse.json({ error: "Faltan grupo y producto" }, { status: 400 });
  }

  const link = await queryOne<{ group_id: string; product_id: string }>(
    `SELECT l.group_id, l.product_id
     FROM product_modifier_links l
     JOIN modifier_groups g ON g.id = l.group_id
     JOIN products p ON p.id = l.product_id
     WHERE l.group_id = $1 AND l.product_id = $2 AND g.vendor_id = $3 AND p.vendor_id = $3
     LIMIT 1`,
    [group_id, product_id, vendor.id]
  );
  if (!link) {
    return NextResponse.json({ error: "Primero asigná el grupo a ese plato" }, { status: 404 });
  }

  const normN = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  let maxN = normN(body.max_selections);
  let minN = normN(body.min_selections);
  if (maxN != null) maxN = Math.min(99, Math.max(1, maxN));
  if (minN != null && maxN != null) minN = Math.min(minN, maxN);

  try {
    await query(
      `UPDATE product_modifier_links SET max_selections = $1, min_selections = $2
       WHERE group_id = $3 AND product_id = $4`,
      [maxN, minN, group_id, product_id]
    );
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-link-overrides.sql en la base" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, max_selections: maxN, min_selections: minN });
}
