import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { FICHA_PRESETS, validateFields } from "@/lib/ficha-templates";
import { NextResponse } from "next/server";

/**
 * ABM de modelos de ficha del centro de estética + presets.
 * - GET: lista modelos (?active=1 solo activos). Solo `estetica`.
 * - GET ?presets=1: devuelve los presets en código (Masajes, Lifting, Nota).
 * - POST { name, fields, service_ids?, require_before? } o { preset: key }:
 *   crea modelo (desde preset o en blanco/con fields propios).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ templates: [] });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("presets") === "1") {
    return NextResponse.json({ presets: FICHA_PRESETS });
  }
  try {
    const onlyActive = searchParams.get("active") === "1";
    const templates = await queryMany<Record<string, unknown>>(
      `SELECT * FROM customer_form_templates WHERE vendor_id = $1${onlyActive ? " AND active = true" : ""}
       ORDER BY position ASC, name ASC`,
      [gate.vendor.id]
    );
    return NextResponse.json({ templates: templates || [] });
  } catch {
    return NextResponse.json({ templates: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const presetKey = typeof body.preset === "string" ? body.preset : null;
  const preset = presetKey ? FICHA_PRESETS.find((p) => p.key === presetKey) : null;

  const name = String(body.name || preset?.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "El nombre del modelo es obligatorio" }, { status: 400 });

  let fields: unknown = body.fields;
  if (preset && fields === undefined) fields = preset.fields;
  const check = validateFields(fields);
  if (!check.ok) return NextResponse.json({ error: check.error || "Campos inválidos" }, { status: 400 });

  const serviceIds = Array.isArray(body.service_ids)
    ? body.service_ids.map((s: unknown) => String(s)).filter(Boolean).slice(0, 50)
    : [];

  try {
    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO customer_form_templates (vendor_id, name, service_ids, require_before, fields, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        gate.vendor.id,
        name,
        JSON.stringify(serviceIds),
        body.require_before === true,
        JSON.stringify(fields),
        body.active === false ? false : true,
      ]
    );
    return NextResponse.json({ template: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}
