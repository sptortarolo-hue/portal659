import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Lista de proveedores del comercio. */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const onlyActive = searchParams.get("active") === "1";

  const suppliers = await queryMany<Record<string, unknown>>(
    `SELECT * FROM suppliers WHERE vendor_id = $1 ${onlyActive ? "AND active = true" : ""}
     ORDER BY name ASC`,
    [gate.vendor.id]
  );
  return NextResponse.json({ suppliers: suppliers || [] });
}

/** Crea un proveedor. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json();
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Indicá el nombre del proveedor" }, { status: 400 });

  const phone =
    body?.phone != null && String(body.phone).trim() !== "" ? String(body.phone).trim() : null;
  const email =
    body?.email != null && String(body.email).trim() !== "" ? String(body.email).trim() : null;
  const notes =
    body?.notes != null && String(body.notes).trim() !== "" ? String(body.notes).trim() : null;

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO suppliers (vendor_id, name, phone, email, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [gate.vendor.id, name, phone, email, notes]
  );
  return NextResponse.json({ supplier: row });
}
