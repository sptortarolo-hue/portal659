import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { sanitizeAnswers, type FormField } from "@/lib/ficha-templates";
import { NextResponse } from "next/server";

/**
 * Una sesión de ficha (panel): ver + guardar respuestas/firma + completar.
 * - GET: entry con nombre del modelo y campos (para A4).
 * - PATCH { answers?, status? }: mergea respuestas sanitizadas según schema.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT e.*, t.name AS template_name, t.fields AS template_fields
       FROM customer_form_entries e
       JOIN customer_form_templates t ON t.id = e.template_id
       WHERE e.id = $1 AND e.vendor_id = $2 LIMIT 1`,
      [id, gate.vendor.id]
    );
    if (!row) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    return NextResponse.json({ entry: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const current = await queryOne<{ answers: Record<string, unknown>; template_id: string }>(
      `SELECT answers, template_id::text AS template_id FROM customer_form_entries WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, gate.vendor.id]
    );
    if (!current) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    const tpl = await queryOne<{ fields: FormField[] }>(
      `SELECT fields FROM customer_form_templates WHERE id = $1 LIMIT 1`,
      [current.template_id]
    ).catch(() => null);
    const fields = tpl && Array.isArray(tpl.fields) ? tpl.fields : [];
    const base = (current.answers && typeof current.answers === "object" ? current.answers : {}) as Record<string, unknown>;
    const merged = { ...base, ...sanitizeAnswers(fields, body.answers) };
    const status = body.status === "complete" ? "complete" : body.status === "draft" ? "draft" : null;
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE customer_form_entries SET answers = $1${status ? ", status = $3" : ""} WHERE id = $2 RETURNING *`,
      status ? [JSON.stringify(merged), id, status] : [JSON.stringify(merged), id]
    );
    return NextResponse.json({ entry: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}
