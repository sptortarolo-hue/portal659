import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Edita un insumo (el costo recalcula solo todos los platos que lo usan). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const current = await queryOne<Record<string, unknown>>(
    `SELECT * FROM ingredients WHERE id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!current) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  const name = body?.name !== undefined ? String(body.name).trim() : (current.name as string);
  const base_unit = body?.base_unit !== undefined ? String(body.base_unit).trim() : (current.base_unit as string);
  const cost_per_unit = body?.cost_per_unit !== undefined ? Number(body.cost_per_unit) : Number(current.cost_per_unit);
  const waste_pct = body?.waste_pct !== undefined ? Number(body.waste_pct ?? 0) : Number(current.waste_pct);
  const is_elaborated = body?.is_elaborated !== undefined ? body.is_elaborated === true : current.is_elaborated;
  const notes =
    body?.notes !== undefined
      ? body.notes != null && String(body.notes).trim() !== ""
        ? String(body.notes).trim()
        : null
      : current.notes;
  const active = body?.active !== undefined ? body.active !== false : current.active;

  if (!name) return NextResponse.json({ error: "Indicá el nombre del insumo" }, { status: 400 });
  if (!["g", "ml", "u"].includes(base_unit)) {
    return NextResponse.json({ error: "Unidad inválida (usá g, ml o u)" }, { status: 400 });
  }
  if (!isFinite(cost_per_unit) || cost_per_unit < 0) {
    return NextResponse.json({ error: "El costo debe ser un número mayor o igual a 0" }, { status: 400 });
  }
  if (!isFinite(waste_pct) || waste_pct < 0 || waste_pct >= 100) {
    return NextResponse.json({ error: "La merma debe estar entre 0 y 99,99%" }, { status: 400 });
  }
  // Si cambia la unidad base, las líneas existentes podrían quedar
  // incompatibles: se bloquea y se pide revisar recetas primero.
  if (base_unit !== current.base_unit) {
    const used = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM recipe_items i JOIN recipes r ON r.id = i.recipe_id
       WHERE i.ingredient_id = $1 AND r.vendor_id = $2`,
      [id, gate.vendor.id]
    );
    if (used && Number(used.count) > 0) {
      return NextResponse.json(
        { error: "Ese insumo ya está usado en recetas: sacalo de las recetas antes de cambiar su unidad" },
        { status: 409 }
      );
    }
  }

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE ingredients
     SET name = $1, base_unit = $2, cost_per_unit = $3, waste_pct = $4,
         is_elaborated = $5, notes = $6, active = $7, updated_at = now()
     WHERE id = $8 AND vendor_id = $9 RETURNING *`,
    [name, base_unit, cost_per_unit, waste_pct, is_elaborated, notes, active, id, gate.vendor.id]
  );
  return NextResponse.json({ ingredient: row });
}

/** Borra un insumo (bloqueado si está usado en recetas). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  try {
    await query(`DELETE FROM ingredients WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
  } catch (e: any) {
    // Violación del ON DELETE RESTRICT de recipe_items.ingredient_id.
    if (e?.code === "23001" || /restrict/i.test(String(e?.message || ""))) {
      return NextResponse.json(
        { error: "Ese insumo está usado en recetas: sacalo de las recetas antes de borrarlo" },
        { status: 409 }
      );
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
