import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const neighborhoods = await queryMany(`SELECT * FROM neighborhoods ORDER BY name`);
  return NextResponse.json({ neighborhoods });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { name, slug, lat, lng } = body;

  if (!name || !slug) {
    return NextResponse.json({ error: "name y slug son requeridos" }, { status: 400 });
  }

  const neighborhood = await queryOne<Record<string, unknown>>(
    `INSERT INTO neighborhoods (name, slug, lat, lng) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, slug, lat || null, lng || null]
  );

  return NextResponse.json({ neighborhood });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  await query(`DELETE FROM neighborhoods WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}