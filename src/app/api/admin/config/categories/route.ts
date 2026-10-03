import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const categories = await queryMany(`SELECT * FROM categories ORDER BY name`);
    return NextResponse.json({ categories });
  } catch (e) {
    console.error("[api/admin/config/categories] GET error:", e);
    return NextResponse.json({ error: "No se pudieron cargar las categorías" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const { name, slug, vertical } = body ?? {};

    if (!name) return NextResponse.json({ error: "name es requerido" }, { status: 400 });

    const finalSlug = slug || name.toLowerCase().replace(/\s+/g, "-");
    let category: Record<string, unknown> | undefined;
    try {
      category = await queryOne<Record<string, unknown>>(
        `INSERT INTO categories (name, slug, vertical) VALUES ($1, $2, $3) RETURNING *`,
        [name, finalSlug, vertical || null]
      );
    } catch (e: any) {
      // Tolerante a migración pendiente (sin columna vertical): se crea igual.
      if (e?.code !== "42703") throw e;
      category = await queryOne<Record<string, unknown>>(
        `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *`,
        [name, finalSlug]
      );
    }

    return NextResponse.json({ category });
  } catch (e) {
    console.error("[api/admin/config/categories] POST error:", e);
    return NextResponse.json({ error: "No se pudo crear la categoría" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

    await query(`DELETE FROM categories WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/config/categories] DELETE error:", e);
    return NextResponse.json({ error: "No se pudo eliminar la categoría" }, { status: 500 });
  }
}
