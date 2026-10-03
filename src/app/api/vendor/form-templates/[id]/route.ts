import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { validateFields } from "@/lib/ficha-templates";
import { NextResponse } from "next/server";

/** Editar / activar / duplicar / borrar un modelo de ficha. */
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

  const sets: string[] = [];
  const vals: unknown[] = [gate.vendor.id, id];
  let idx = 3;
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (body.fields !== undefined) {
    const check = validateFields(body.fields);
    if (!check.ok) return NextResponse.json({ error: check.error || "Campos inválidos" }, { status: 400 });
    sets.push(`fields = $${idx++}`);
    vals.push(JSON.stringify(body.fields));
  }
  if (body.service_ids !== undefined) {
    const arr = Array.isArray(body.service_ids)
      ? body.service_ids.map((s: unknown) => String(s)).filter(Boolean).slice(0, 50)
      : [];
    sets.push(`service_ids = $${idx++}`);
    vals.push(JSON.stringify(arr));
  }
  if (body.require_before !== undefined) {
    sets.push(`require_before = $${idx++}`);
    vals.push(body.require_before === true);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE customer_form_templates SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ template: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}

export async function DELETE(
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
    // Las sesiones cargadas se borran en cascada.
    await queryOne(`DELETE FROM customer_form_templates WHERE vendor_id = $1 AND id = $2`, [gate.vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}
