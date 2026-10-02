import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

const KINDS = ["wall", "label", "rect", "circle"] as const;

function migrationPending(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation "?floor_decor"? does not exist|42P01|does not exist/i.test(msg);
}

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "El plano forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  try {
    const items = await queryMany<Record<string, unknown>>(
      `SELECT * FROM floor_decor WHERE vendor_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [gate.vendor.id]
    );
    return NextResponse.json({ decor: items || [] });
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

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "El plano forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const kind = String(body?.kind || "");
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "Tipo inválido (wall | label | rect | circle)" }, { status: 400 });
  }
  const num = (v: unknown, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : d;
  };

  try {
    const item = await queryOne<Record<string, unknown>>(
      `INSERT INTO floor_decor (vendor_id, kind, x, y, w, h, rotation, text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        gate.vendor.id,
        kind,
        num(body?.x, 0),
        num(body?.y, 0),
        num(body?.w, kind === "wall" ? 80 : 60),
        num(body?.h, kind === "wall" ? 8 : 60),
        num(body?.rotation, 0) % 360,
        typeof body?.text === "string" && body.text.trim() ? body.text.trim().slice(0, 40) : null,
      ]
    );
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
