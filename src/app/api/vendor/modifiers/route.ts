import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { isMissingColumnError, queryEffectiveModifiers } from "@/lib/modifier-rules";
import { NextResponse } from "next/server";
import type { ModifierOption } from "@/types/database";

export const dynamic = "force-dynamic";

function normalizeOptions(options: unknown): ModifierOption[] {
  return (Array.isArray(options) ? options : [])
    .map((o: any) => ({
      label: String(o?.label ?? o?.name ?? "").trim(),
      price_mod: Number(o?.price_mod ?? o?.price ?? 0) || 0,
      // Familia opcional (filtro en la hoja de gustos). Se guarda en el JSONB.
      ...(String(o?.category ?? "").trim() ? { category: String(o.category).trim().slice(0, 40) } : {}),
      // Gusto pausado (ej: se acabó el pistacho): se oculta sin borrarlo.
      ...(o?.available === false ? { available: false } : {}),
    }))
    .filter((o) => o.label !== "");
}

/** Clampea el mínimo al rango válido. NULL = legacy (solo si no es obligatorio). */
function normalizeMin(min: unknown, max: number, required: boolean): number | null {
  if (!required) return null;
  const m = Math.floor(Number(min));
  if (!Number.isFinite(m) || m < 1) return 1;
  return Math.min(m, Math.max(1, max));
}

/** Devuelve grupos del vendor + asignaciones por plato + listado plano (compat). */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ groups: [], assignments: {}, modifiers: [] });

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  let groups;
  let links;
  if (productId) {
    // Valores efectivos por producto (override por link si existe).
    const eff = await queryEffectiveModifiers(queryMany, [productId]);
    groups = eff;
    return NextResponse.json({ groups: eff || [], assignments: { [productId]: (eff || []).map((g) => g.id) }, modifiers: (eff || []).map((g) => ({ ...g, product_id: productId })) });
  }

  groups = await queryMany<Record<string, unknown>>(
    `SELECT * FROM modifier_groups WHERE vendor_id = $1 ORDER BY is_variant DESC, created_at ASC`,
    [vendor.id]
  );
  // Links con overrides por producto (NULL = default del grupo). Fallback si
  // la migración migrate-link-overrides.sql aún no se aplicó.
  try {
    links = await queryMany<Record<string, unknown>>(
      `SELECT l.product_id, l.group_id, l.position, l.max_selections AS link_max, l.min_selections AS link_min
       FROM product_modifier_links l
       JOIN modifier_groups g ON g.id = l.group_id
       WHERE g.vendor_id = $1
       ORDER BY g.is_variant DESC, l.position ASC`,
      [vendor.id]
    );
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    links = await queryMany<Record<string, unknown>>(
      `SELECT l.product_id, l.group_id, l.position
       FROM product_modifier_links l
       JOIN modifier_groups g ON g.id = l.group_id
       WHERE g.vendor_id = $1
       ORDER BY g.is_variant DESC, l.position ASC`,
      [vendor.id]
    );
  }

  const productIdsByGroup: Record<string, string[]> = {};
  const assignments: Record<string, string[]> = {};
  const flat: Record<string, unknown>[] = [];

  for (const l of links || []) {
    const gid = l.group_id as string;
    const pid = l.product_id as string;
    (productIdsByGroup[gid] ||= []).push(pid);
    (assignments[pid] ||= []).push(gid);
    const group = (groups || []).find((g) => g.id === gid);
    // Overrides por link (NULL = default del grupo). Ausentes si la migración
    // migrate-link-overrides.sql aún no se aplicó.
    if (group) flat.push({ ...group, product_id: pid, position: l.position, link_max: l.link_max ?? null, link_min: l.link_min ?? null });
  }

  const groupsWithMeta = (groups || []).map((g) => ({
    ...g,
    product_ids: productIdsByGroup[g.id as string] || [],
    products_count: (productIdsByGroup[g.id as string] || []).length,
  }));

  return NextResponse.json({ groups: groupsWithMeta, assignments, modifiers: flat });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const body = await request.json();
  const { group_name, options, required, max_selections, min_selections, is_variant, product_ids } = body;

  const name = String(group_name || "").trim();
  const norm = normalizeOptions(options);
  if (!name) return NextResponse.json({ error: "Indicá el nombre del grupo" }, { status: 400 });
  if (norm.length === 0) return NextResponse.json({ error: "El grupo necesita al menos una opción válida" }, { status: 400 });

  const req = required === true || is_variant === true;
  const maxN = Math.max(1, Number(max_selections) || 1);
  const minN = normalizeMin(min_selections, maxN, req);

  let cleanIds: string[] = [];
  if (Array.isArray(product_ids) && product_ids.length > 0) {
    const rows = await queryMany<{ id: string }>(
      `SELECT id FROM products WHERE id = ANY($1) AND vendor_id = $2`,
      [product_ids, vendor.id]
    );
    cleanIds = rows.map((r) => r.id);
  }

  const group = await withTransaction(async (tx) => {
    // min_selections vive en la migración migrate-min-selections.sql. Si el
    // comercio aún no la aplicó, reintentamos sin la columna (sin romper).
    const insertWithMin = async () =>
      tx.queryOne<Record<string, unknown>>(
        `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, min_selections, is_variant)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [vendor.id, name, JSON.stringify(norm), req, maxN, minN, is_variant === true]
      );
    let g: Record<string, unknown> | undefined;
    try {
      g = await insertWithMin();
    } catch (e) {
      if (!/min_selections/i.test(String((e as Error)?.message || ""))) throw e;
      g = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [vendor.id, name, JSON.stringify(norm), req, maxN, is_variant === true]
      );
    }
    if (!g) throw new Error("No se pudo crear el grupo");
    for (let i = 0; i < cleanIds.length; i++) {
      await tx.queryVoid(
        `INSERT INTO product_modifier_links (group_id, product_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [g.id, cleanIds[i], i]
      );
    }
    return g;
  });

  return NextResponse.json({ modifier: { ...group, product_ids: cleanIds } });
}