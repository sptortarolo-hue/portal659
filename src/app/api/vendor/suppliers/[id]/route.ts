import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Edita un proveedor. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  const current = await queryOne<Record<string, unknown>>(
    `SELECT * FROM suppliers WHERE id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!current) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });

  const body = await request.json();
  const name = body?.name !== undefined ? String(body.name).trim() : (current.name as string);
  const phone =
    body?.phone !== undefined
      ? body.phone != null && String(body.phone).trim() !== ""
        ? String(body.phone).trim()
        : null
      : current.phone;
  const email =
    body?.email !== undefined
      ? body.email != null && String(body.email).trim() !== ""
        ? String(body.email).trim()
        : null
      : current.email;
  const notes =
    body?.notes !== undefined
      ? body.notes != null && String(body.notes).trim() !== ""
        ? String(body.notes).trim()
        : null
      : current.notes;
  const active = body?.active !== undefined ? body.active !== false : current.active;

  if (!name) return NextResponse.json({ error: "Indicá el nombre del proveedor" }, { status: 400 });

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE suppliers SET name = $1, phone = $2, email = $3, notes = $4, active = $5, updated_at = now()
     WHERE id = $6 AND vendor_id = $7 RETURNING *`,
    [name, phone, email, notes, active, id, gate.vendor.id]
  );
  return NextResponse.json({ supplier: row });
}

/** Borra un proveedor. Si tiene compras, se archiva (baja lógica) para no
 *  perder el historial; si no, se borra de verdad. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  const current = await queryOne<Record<string, unknown>>(
    `SELECT * FROM suppliers WHERE id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!current) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });

  const used = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM purchases WHERE supplier_id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (used && Number(used.count) > 0) {
    await query(`UPDATE suppliers SET active = false, updated_at = now() WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, archived: true });
  }
  await query(`DELETE FROM suppliers WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
  return NextResponse.json({ ok: true, archived: false });
}
