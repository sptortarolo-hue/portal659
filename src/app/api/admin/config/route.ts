import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, query } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [neighborhoods, categories] = await Promise.all([
    queryMany(`SELECT * FROM neighborhoods ORDER BY name`),
    queryMany(`SELECT * FROM categories ORDER BY name`),
  ]);

  return NextResponse.json({ neighborhoods, categories });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { type, id, data: updateData } = body;

  if (!type || !id || !updateData) {
    return NextResponse.json({ error: "type, id y data son requeridos" }, { status: 400 });
  }

  const table = type === "neighborhood" ? "neighborhoods" : "categories";

  const cols = Object.keys(updateData);
  if (cols.length === 0) return NextResponse.json({ ok: true });
  const setClauses = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await query(
    `UPDATE ${table} SET ${setClauses} WHERE slug = $1`,
    [id, ...Object.values(updateData)]
  );

  return NextResponse.json({ ok: true });
}