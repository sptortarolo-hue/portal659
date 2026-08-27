import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";
import { ZONES } from "@/lib/config";

const CATEGORIES = ["transporte", "utilidades", "horarios", "noticias"];
const ZONE_SLUGS = ZONES.map((z) => z.slug);

type ValidResult = { error: string } | { item: Record<string, unknown> };

function validItem(body: Record<string, unknown>): ValidResult {
  const { zone, category, title, body: text, tags, active, sort } = body;
  const normalizedZone = (zone as string) || ZONE_SLUGS[0];
  const normalizedCategory = (category as string) || "";
  if (!ZONE_SLUGS.includes(normalizedZone)) {
    return { error: "Zona inválida" };
  }
  if (!CATEGORIES.includes(normalizedCategory)) {
    return { error: "Categoría inválida" };
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return { error: "title es requerido" };
  }
  return {
    item: {
      zone: normalizedZone,
      category: normalizedCategory,
      title: (title as string).trim(),
      body: typeof text === "string" ? text : null,
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
      active: typeof active === "boolean" ? active : true,
      sort: typeof sort === "number" ? sort : 0,
    },
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const items = await queryMany(
    `SELECT * FROM info_items ORDER BY category ASC, sort ASC`
  );
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const result = validItem(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const item = result.item;

  try {
    const created = await queryOne<Record<string, unknown>>(
      `INSERT INTO info_items (zone, category, title, body, tags, active, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [item.zone, item.category, item.title, item.body, item.tags, item.active, item.sort]
    );
    return NextResponse.json({ item: created });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: "Ya existe un ítem con ese título en esa categoría" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  const result = validItem(patch);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const item = result.item;

  try {
    const updated = await queryOne<Record<string, unknown>>(
      `UPDATE info_items
       SET zone = $1, category = $2, title = $3, body = $4, tags = $5, active = $6, sort = $7,
           updated_at = now()
       WHERE id = $8
       RETURNING *`,
      [item.zone, item.category, item.title, item.body, item.tags, item.active, item.sort, id]
    );
    return NextResponse.json({ item: updated });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: "Ya existe un ítem con ese título en esa categoría" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  await query(`DELETE FROM info_items WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}