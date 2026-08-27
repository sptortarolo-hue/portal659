import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const tables = await queryMany<Record<string, unknown>>(
    `SELECT * FROM tables WHERE vendor_id = $1 ORDER BY position ASC, created_at ASC`,
    [gate.vendor.id]
  );

  return NextResponse.json({ tables: tables || [] });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { name, capacity, position } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: "El nombre de la mesa es requerido" }, { status: 400 });
  }

  const table = await queryOne<Record<string, unknown>>(
    `INSERT INTO tables (vendor_id, name, capacity, position, status)
     VALUES ($1, $2, $3, $4, 'libre') RETURNING *`,
    [
      gate.vendor.id,
      String(name).trim(),
      capacity && Number(capacity) > 0 ? Number(capacity) : 4,
      position != null ? Number(position) : 0,
    ]
  );

  return NextResponse.json({ table });
}