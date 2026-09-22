import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, queryMany, query, withTransaction } from "@/lib/db";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM modifier_groups WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  );
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await request.json();
  const { group_name, options, required, max_selections, min_selections, is_variant, product_ids } = body;

  const update: Record<string, unknown> = {};
  if (typeof group_name === "string" && group_name.trim()) update.group_name = group_name.trim();
  if (Array.isArray(options)) {
    const norm = normalizeOptions(options);
    if (norm.length > 0) update.options = JSON.stringify(norm);
  }
  if (typeof required === "boolean") update.required = required;
  if (max_selections !== undefined) update.max_selections = Math.max(1, Number(max_selections) || 1);
  if (typeof is_variant === "boolean") update.is_variant = is_variant;
  if (min_selections !== undefined) {
    // NULL/0 = legacy. Solo rige si el grupo es (o queda) obligatorio.
    const req = typeof required === "boolean" ? required : undefined;
    const m = Math.floor(Number(min_selections));
    update.min_selections = Number.isFinite(m) && m >= 1 ? m : null;
    if (req === false) update.min_selections = null;
  }

  await withTransaction(async (tx) => {
    if (Object.keys(update).length > 0) {
      const runUpdate = async (cols: string[]) => {
        const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ");
        await tx.queryVoid(`UPDATE modifier_groups SET ${set} WHERE id = $${cols.length + 1}`, [
          ...cols.map((k) => update[k]),
          id,
        ]);
      };
      try {
        await runUpdate(Object.keys(update));
      } catch (e) {
        // Columna min_selections aún no migrada: reintentar sin ella.
        if (!("min_selections" in update) || !/min_selections/i.test(String((e as Error)?.message || ""))) throw e;
        const { min_selections: _drop, ...rest } = update;
        if (Object.keys(rest).length > 0) await runUpdate(Object.keys(rest));
      }
    }

    // Reconciliación de asignaciones: si llega product_ids, reemplaza la lista.
    if (Array.isArray(product_ids)) {
      let cleanIds: string[] = [];
      if (product_ids.length > 0) {
        const rows = await tx.query<{ id: string }>(
          `SELECT id FROM products WHERE id = ANY($1) AND vendor_id = $2`,
          [product_ids, vendor.id]
        );
        cleanIds = rows.map((r) => r.id);
      }
      await tx.queryVoid(`DELETE FROM product_modifier_links WHERE group_id = $1`, [id]);
      for (let i = 0; i < cleanIds.length; i++) {
        await tx.queryVoid(
          `INSERT INTO product_modifier_links (group_id, product_id, position) VALUES ($1, $2, $3)`,
          [id, cleanIds[i], i]
        );
      }
    }
  });

  const updated = await queryOne<Record<string, unknown>>(`SELECT * FROM modifier_groups WHERE id = $1 LIMIT 1`, [id]);
  return NextResponse.json({ modifier: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM modifier_groups WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  );
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  await query(`DELETE FROM modifier_groups WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}