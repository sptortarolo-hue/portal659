import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const categories = await queryMany(`SELECT * FROM categories ORDER BY name`);
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { name, slug } = body;

  if (!name) return NextResponse.json({ error: "name es requerido" }, { status: 400 });

  const category = await queryOne<Record<string, unknown>>(
    `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *`,
    [name, slug || name.toLowerCase().replace(/\s+/g, "-")]
  );

  return NextResponse.json({ category });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  await query(`DELETE FROM categories WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}