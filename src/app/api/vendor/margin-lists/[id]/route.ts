import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las listas de margen forman parte del inventario (plan Gestión integral)";
const MIGRATION_MSG = "Falta la migración supabase/self-host/migrate-margin-lists.sql";

async function ready(): Promise<boolean> {
  try {
    const rows = await queryMany<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'margin_lists')
            OR (table_name = 'products' AND column_name = 'margin_list_id'))`
    );
    return (
      rows.some((r) => r.table_name === "margin_lists") &&
      rows.some((r) => r.table_name === "products" && r.column_name === "margin_list_id")
    );
  } catch {
    return false;
  }
}

/** PATCH — renombrar / cambiar regla / % de una lista propia. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await ready())) {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
  const { id } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const current = await queryOne<{ id: string; name: string; rule: string; pct: number }>(
    `SELECT id, name, rule, pct::float8 AS pct FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!current) {
    return NextResponse.json({ ok: false, error: "Lista no encontrada" }, { status: 404 });
  }

  // Aplicar parciales con la misma validación que el alta.
  const name = body?.name !== undefined ? String(body.name).trim() : current.name;
  const rule = body?.rule !== undefined ? String(body.rule) : current.rule;
  const pct = body?.pct !== undefined ? Number(body.pct) : Number(current.pct);

  if (!name || name.length > 60) {
    return NextResponse.json({ ok: false, error: "El nombre es obligatorio (máx. 60 caracteres)" }, { status: 400 });
  }
  if (rule !== "markup" && rule !== "margin") {
    return NextResponse.json({ ok: false, error: "La regla debe ser 'markup' o 'margin'" }, { status: 400 });
  }
  if (!Number.isFinite(pct) || pct < 0) {
    return NextResponse.json({ ok: false, error: "El porcentaje debe ser un número mayor o igual a 0" }, { status: 400 });
  }
  if (rule === "markup" && pct > 1000) {
    return NextResponse.json({ ok: false, error: "El recargo no puede superar el 1000%" }, { status: 400 });
  }
  if (rule === "margin" && pct >= 100) {
    return NextResponse.json({ ok: false, error: "El margen debe ser menor al 100%" }, { status: 400 });
  }

  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM margin_lists WHERE vendor_id = $1 AND lower(name) = lower($2) AND id <> $3 LIMIT 1`,
    [gate.vendor.id, name, id]
  );
  if (dup) {
    return NextResponse.json({ ok: false, error: "Ya tenés una lista con ese nombre" }, { status: 409 });
  }

  const updated = await queryOne<{ id: string; name: string; rule: string; pct: number }>(
    `UPDATE margin_lists
        SET name = $2, rule = $3, pct = $4::numeric
      WHERE id = $1 AND vendor_id = $5
      RETURNING id, name, rule, pct::float8 AS pct`,
    [id, name, rule, Math.round(pct * 100) / 100, gate.vendor.id]
  );
  return NextResponse.json({ ok: true, list: updated });
}

/** DELETE — borra la lista; los productos quedan "sin lista" (FK ON DELETE SET NULL). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await ready())) {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
  const { id } = await params;
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM margin_lists WHERE id = $1 AND vendor_id = $2 RETURNING id`,
    [id, gate.vendor.id]
  );
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Lista no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
