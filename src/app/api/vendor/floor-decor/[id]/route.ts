import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

function migrationPending(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation "?floor_decor"? does not exist|42P01|does not exist/i.test(msg);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "El plano forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const payload: Record<string, unknown> = {};
  for (const k of ["x", "y", "w", "h"] as const) {
    if (body?.[k] !== undefined) {
      const n = Math.round(Number(body[k]));
      if (Number.isFinite(n)) payload[k] = k === "w" || k === "h" ? Math.min(800, Math.max(4, n)) : n;
    }
  }
  if (body?.rotation !== undefined && Number.isFinite(Number(body.rotation))) {
    payload.rotation = Math.round(Number(body.rotation)) % 360;
  }
  if (body?.text !== undefined) {
    payload.text =
      typeof body.text === "string" && body.text.trim() ? body.text.trim().slice(0, 40) : null;
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  try {
    const setClauses: string[] = [];
    const values: unknown[] = [id, gate.vendor.id];
    let idx = 3;
    for (const [key, val] of Object.entries(payload)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
    const item = await queryOne<Record<string, unknown>>(
      `UPDATE floor_decor SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
      values
    );
    if (!item) return NextResponse.json({ error: "Elemento no encontrado" }, { status: 404 });
    return NextResponse.json({ decor: item });
  } catch (e) {
    if (migrationPending(e)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-floor-decor.sql", code: "migration_pending" },
        { status: 503 }
      );
    }
    throw e;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "El plano forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const { id } = await params;
  try {
    const item = await queryOne<{ id: string }>(
      `DELETE FROM floor_decor WHERE id = $1 AND vendor_id = $2 RETURNING id`,
      [id, gate.vendor.id]
    );
    if (!item) return NextResponse.json({ error: "Elemento no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (migrationPending(e)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-floor-decor.sql", code: "migration_pending" },
        { status: 503 }
      );
    }
    throw e;
  }
}
