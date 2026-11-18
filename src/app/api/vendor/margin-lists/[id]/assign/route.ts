import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las listas de margen forman parte del inventario (plan Gestión integral)";
const MIGRATION_MSG = "Falta la migración supabase/self-host/migrate-margin-lists.sql";

/**
 * Asigna o desasigna productos a la lista.
 * Body: { productIds: string[], mode?: "assign" | "unassign" }
 * - assign: productos pasan a esta lista (desde cualquier otra).
 * - unassign: solo los que estaban EN ESTA lista vuelven a "sin lista".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const { id } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }
  const productIds = Array.isArray(body?.productIds)
    ? body.productIds.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const mode = body?.mode === "unassign" ? "unassign" : "assign";
  if (productIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Sin productos seleccionados" }, { status: 400 });
  }
  if (productIds.length > 500) {
    return NextResponse.json({ ok: false, error: "Máximo 500 productos por vez" }, { status: 400 });
  }

  try {
    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, gate.vendor.id]
    );
    if (!exists) {
      // Puede faltar la tabla entera: mensaje accionable.
      return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }

  let updated: { count: number };
  if (mode === "assign") {
    const rows = await queryMany<{ id: string }>(
      `UPDATE products SET margin_list_id = $2 WHERE vendor_id = $1 AND id = ANY($3::uuid[]) RETURNING id`,
      [gate.vendor.id, id, productIds]
    );
    updated = { count: rows.length };
  } else {
    const rows = await queryMany<{ id: string }>(
      `UPDATE products SET margin_list_id = NULL WHERE vendor_id = $1 AND id = ANY($3::uuid[]) AND margin_list_id = $2 RETURNING id`,
      [gate.vendor.id, id, productIds]
    );
    updated = { count: rows.length };
  }
  return NextResponse.json({ ok: true, updated: updated.count });
}
