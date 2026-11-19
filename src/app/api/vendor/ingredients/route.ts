import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

const VALID_UNITS = ["g", "ml", "u"] as const;

async function hasStockColumn(): Promise<boolean> {
  try {
    const chk = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingredients' AND column_name = 'stock') AS exists`
    );
    return chk?.exists === true;
  } catch {
    return false;
  }
}

function normIngredient(body: any) {
  const name = String(body?.name || "").trim();
  const base_unit = String(body?.base_unit || "g").trim();
  const cost_per_unit = Number(body?.cost_per_unit);
  const waste_pct = Number(body?.waste_pct ?? 0);
  const is_elaborated = body?.is_elaborated === true;
  const notes = body?.notes != null && String(body.notes).trim() !== "" ? String(body.notes).trim() : null;
  const active = body?.active !== false;
  // Control de stock (migrate-elaboration.sql): NULL = sin control.
  const track_stock = body?.track_stock === true;
  const stock =
    body?.stock != null && body.stock !== "" ? Number(body.stock) : track_stock ? 0 : null;
  return { name, base_unit, cost_per_unit, waste_pct, is_elaborated, notes, active, track_stock, stock };
}

/** Lista de insumos del comercio. */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const onlyActive = searchParams.get("active") === "1";

  const ingredients = await queryMany<Record<string, unknown>>(
    `SELECT * FROM ingredients WHERE vendor_id = $1 ${onlyActive ? "AND (active IS NULL OR active = true)" : ""}
     ORDER BY name ASC`,
    [gate.vendor.id]
  );
  return NextResponse.json({ ingredients: ingredients || [] });
}

/** Crea un insumo. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json();
  const ing = normIngredient(body);

  if (!ing.name) return NextResponse.json({ error: "Indicá el nombre del insumo" }, { status: 400 });
  if (!VALID_UNITS.includes(ing.base_unit as (typeof VALID_UNITS)[number])) {
    return NextResponse.json({ error: "Unidad inválida (usá g, ml o u)" }, { status: 400 });
  }
  if (!isFinite(ing.cost_per_unit) || ing.cost_per_unit < 0) {
    return NextResponse.json({ error: "El costo debe ser un número mayor o igual a 0" }, { status: 400 });
  }
  if (!isFinite(ing.waste_pct) || ing.waste_pct < 0 || ing.waste_pct >= 100) {
    return NextResponse.json({ error: "La merma debe estar entre 0 y 99,99%" }, { status: 400 });
  }
  if (ing.track_stock && (ing.stock === null || !isFinite(ing.stock) || ing.stock < 0)) {
    return NextResponse.json({ error: "El stock debe ser un número mayor o igual a 0" }, { status: 400 });
  }

  const wantStock = ing.track_stock || (body?.stock != null && body.stock !== "");
  const stockOk = await hasStockColumn();
  if (wantStock && !stockOk) {
    return NextResponse.json(
      { error: "Falta aplicar migrate-elaboration.sql (columna ingredients.stock)." },
      { status: 503 }
    );
  }

  const row = stockOk
    ? await queryOne<Record<string, unknown>>(
        `INSERT INTO ingredients (vendor_id, name, base_unit, cost_per_unit, waste_pct, is_elaborated, notes, active, stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [gate.vendor.id, ing.name, ing.base_unit, ing.cost_per_unit, ing.waste_pct, ing.is_elaborated, ing.notes, ing.active, ing.track_stock ? ing.stock : null]
      )
    : await queryOne<Record<string, unknown>>(
        `INSERT INTO ingredients (vendor_id, name, base_unit, cost_per_unit, waste_pct, is_elaborated, notes, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [gate.vendor.id, ing.name, ing.base_unit, ing.cost_per_unit, ing.waste_pct, ing.is_elaborated, ing.notes, ing.active]
      );
  return NextResponse.json({ ingredient: row });
}
