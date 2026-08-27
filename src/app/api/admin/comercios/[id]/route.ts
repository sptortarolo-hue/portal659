import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany, query } from "@/lib/db";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vendors WHERE id = $1`,
    [id]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const products = await queryMany(
    `SELECT * FROM products WHERE vendor_id = $1`,
    [id]
  );

  return NextResponse.json({ vendor: { ...vendor, products } });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const body = await request.json();
  await query(`UPDATE vendors SET ${buildSetClauses(body)} WHERE id = $1`, buildValues(id, body));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  await query(`DELETE FROM vendors WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

function buildSetClauses(body: Record<string, unknown>): string {
  const cols = Object.keys(body);
  return cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
}

function buildValues(id: string, body: Record<string, unknown>): unknown[] {
  return [id, ...Object.values(body)];
}