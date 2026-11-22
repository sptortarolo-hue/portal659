import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET: lista las plantillas de presentaciones del comercio.
 * POST: crea una nueva plantilla. Body: { name, rows: [{ label, qty, unit, packaging_pct? }] }
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }
  const row = await queryOne<{ presentation_templates: any }>(
    `SELECT presentation_templates FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  ).catch(() => null);
  const templates = Array.isArray(row?.presentation_templates) ? row.presentation_templates : [];
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "El nombre de la plantilla es obligatorio" }, { status: 400 });
  }
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "La plantilla necesita al menos una fila" }, { status: 400 });
  }

  // Tolerante a migración sin aplicar.
  const hasCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'presentation_templates') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasCol?.exists !== true) {
    return NextResponse.json({ error: "Falta aplicar migrate-product-presentations.sql" }, { status: 503 });
  }

  const newTemplate = {
    id: crypto.randomUUID(),
    name,
    rows: rows.map((r: any) => ({
      label: String(r.label || "").trim(),
      qty: Number(r.qty) || 1,
      unit: String(r.unit || "kg"),
      packaging_pct: Number(r.packaging_pct) || 0,
    })),
    created_at: new Date().toISOString(),
  };

  // Append to existing templates.
  const current = await queryOne<{ presentation_templates: any }>(
    `SELECT presentation_templates FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const templates = Array.isArray(current?.presentation_templates) ? current.presentation_templates : [];
  templates.push(newTemplate);

  await queryOne(
    `UPDATE vendors SET presentation_templates = $2::jsonb WHERE id = $1`,
    [vendor.id, JSON.stringify(templates)]
  );

  return NextResponse.json({ template: newTemplate }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const templateId = String(body?.id || "").trim();
  if (!templateId) {
    return NextResponse.json({ error: "Falta el id de la plantilla" }, { status: 400 });
  }

  const hasCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'presentation_templates') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasCol?.exists !== true) {
    return NextResponse.json({ error: "Falta aplicar migrate-product-presentations.sql" }, { status: 503 });
  }

  const current = await queryOne<{ presentation_templates: any }>(
    `SELECT presentation_templates FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const templates = Array.isArray(current?.presentation_templates) ? current.presentation_templates : [];
  const filtered = templates.filter((t: any) => String(t.id) !== templateId);

  await queryOne(
    `UPDATE vendors SET presentation_templates = $2::jsonb WHERE id = $1`,
    [vendor.id, JSON.stringify(filtered)]
  );

  return NextResponse.json({ ok: true });
}