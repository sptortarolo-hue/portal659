import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { resolveRounding } from "@/lib/price-rounding";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las listas de margen forman parte del inventario (plan Gestión integral)";
const MIGRATION_MSG = "Falta la migración supabase/self-host/migrate-margin-lists.sql";

/** Las listas por costo requieren la migración; se detecta por information_schema. */
async function marginListsReady(): Promise<boolean> {
  try {
    const rows = await queryMany<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'margin_lists')
            OR (table_name = 'products' AND column_name = 'margin_list_id'))`
    );
    const hasListTable = rows.some((r) => r.table_name === "margin_lists");
    const hasCol = rows.some((r) => r.table_name === "products" && r.column_name === "margin_list_id");
    // margin_lists solo expone el PK hasta crear filas: basta table + products col.
    return hasListTable && hasCol;
  } catch {
    return false;
  }
}

/** Columnas de redondeo (migrate-price-rounding.sql). Sin migrar: null. */
async function priceRoundColsReady(): Promise<boolean> {
  try {
    const rows = await queryMany<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'margin_lists'
          AND column_name = 'price_round_step'`
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

type MarginListRow = { id: string; name: string; rule: string; pct: number };

/** Redondeo del body (opcional). NULL = no viene → default neutro al insertar. */
function parseRounding(body: any) {
  if (body?.price_round_step === undefined && body?.price_round_mode === undefined && body?.price_round_tail === undefined) {
    return null;
  }
  return resolveRounding({
    step: body?.price_round_step,
    mode: body?.price_round_mode,
    tail: body?.price_round_tail,
  });
}

function validateListInput(body: any):
  | { ok: true; name: string; rule: "markup" | "margin"; pct: number }
  | { ok: false; error: string } {
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 60) {
    return { ok: false, error: "El nombre es obligatorio (máx. 60 caracteres)" };
  }
  const rule = String(body?.rule ?? "");
  if (rule !== "markup" && rule !== "margin") {
    return { ok: false, error: "La regla debe ser 'markup' o 'margin'" };
  }
  const pct = Number(body?.pct);
  if (!Number.isFinite(pct) || pct < 0) {
    return { ok: false, error: "El porcentaje debe ser un número mayor o igual a 0" };
  }
  if (rule === "markup" && pct > 1000) {
    return { ok: false, error: "El recargo no puede superar el 1000%" };
  }
  if (rule === "margin" && pct >= 100) {
    return { ok: false, error: "El margen debe ser menor al 100%" };
  }
  return { ok: true, name, rule, pct: Math.round(pct * 100) / 100 };
}

/** GET — listas con productCount (0 si la migración no está aplicada: 503 claro). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await marginListsReady())) {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
  try {
    const hasRound = await priceRoundColsReady();
    const lists = await queryMany<MarginListRow & { product_count: number; price_round_step?: number; price_round_mode?: string; price_round_tail?: number }>(
      hasRound
        ? `SELECT ml.id, ml.name, ml.rule, ml.pct::float8 AS pct,
                  ml.price_round_step::float8 AS price_round_step, ml.price_round_mode, ml.price_round_tail::float8 AS price_round_tail,
                  COUNT(p.id)::int AS product_count
             FROM margin_lists ml
             LEFT JOIN products p ON p.margin_list_id = ml.id
            WHERE ml.vendor_id = $1
            GROUP BY ml.id
            ORDER BY ml.created_at ASC`
        : `SELECT ml.id, ml.name, ml.rule, ml.pct::float8 AS pct,
                  COUNT(p.id)::int AS product_count
             FROM margin_lists ml
             LEFT JOIN products p ON p.margin_list_id = ml.id
            WHERE ml.vendor_id = $1
            GROUP BY ml.id
            ORDER BY ml.created_at ASC`,
      [gate.vendor.id]
    );
    return NextResponse.json({
      ok: true,
      lists: lists.map((l) => ({
        id: l.id,
        name: l.name,
        rule: l.rule,
        pct: l.pct,
        productCount: l.product_count,
        price_round_step: l.price_round_step != null ? Number(l.price_round_step) : undefined,
        price_round_mode: l.price_round_mode ?? undefined,
        price_round_tail: l.price_round_tail != null ? Number(l.price_round_tail) : undefined,
      })),
    });
  } catch (e) {
    console.error("[margin-lists] GET error:", e);
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
}

/** POST — crear lista. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await marginListsReady())) {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }
  const parsed = validateListInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM margin_lists WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [gate.vendor.id, parsed.name]
  );
  if (dup) {
    return NextResponse.json({ ok: false, error: "Ya tenés una lista con ese nombre" }, { status: 409 });
  }
  const rounding = parseRounding(body);
  // Tolerante a migrate-price-rounding.sql sin aplicar: sin columnas, inserta sin redondeo.
  const hasRound = await priceRoundColsReady();
  let list: MarginListRow | null | undefined;
  if (hasRound && rounding) {
    list = await queryOne<MarginListRow>(
      `INSERT INTO margin_lists (vendor_id, name, rule, pct, price_round_step, price_round_mode, price_round_tail)
       VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7::numeric)
       RETURNING id, name, rule, pct::float8 AS pct`,
      [gate.vendor.id, parsed.name, parsed.rule, parsed.pct, rounding.step, rounding.mode, rounding.tail]
    );
  } else {
    list = await queryOne<MarginListRow>(
      `INSERT INTO margin_lists (vendor_id, name, rule, pct)
       VALUES ($1, $2, $3, $4::numeric)
       RETURNING id, name, rule, pct::float8 AS pct`,
      [gate.vendor.id, parsed.name, parsed.rule, parsed.pct]
    );
  }
  return NextResponse.json({ ok: true, list: { ...list, productCount: 0 } }, { status: 201 });
}
