import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Lista los links de receta compartida del comercio (con nombres). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const links = await queryMany<Record<string, unknown>>(
    `SELECT l.*, p.name AS product_name, rp.name AS recipe_product_name
     FROM product_recipe_links l
     JOIN products p ON p.id = l.product_id
     JOIN recipes r ON r.id = l.recipe_id
     LEFT JOIN products rp ON rp.id = r.product_id
     WHERE p.vendor_id = $1 AND r.vendor_id = $1
     ORDER BY rp.name ASC, p.name ASC`,
    [gate.vendor.id]
  );
  return NextResponse.json({ links: links || [] });
}

/**
 * Vincula un producto a la receta de otro (otra presentación del mismo batch).
 * Body: { recipe_id, product_id, servings }
 * El producto vinculado no puede tener receta propia.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json();
  const recipe_id: string | null = body?.recipe_id || null;
  const product_id: string | null = body?.product_id || null;
  const servings = Number(body?.servings ?? 1);

  if (!recipe_id || !product_id) {
    return NextResponse.json({ error: "Faltan receta o producto" }, { status: 400 });
  }
  if (!isFinite(servings) || servings <= 0) {
    return NextResponse.json({ error: "Las porciones deben ser mayores a 0" }, { status: 400 });
  }

  const recipe = await queryOne<{ id: string; product_id: string | null }>(
    `SELECT id, product_id FROM recipes WHERE id = $1 AND vendor_id = $2`,
    [recipe_id, gate.vendor.id]
  );
  if (!recipe) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });
  // v1: solo recetas de producto (no sub-recetas de elaborados).
  if (!recipe.product_id) {
    return NextResponse.json(
      { error: "Solo se pueden vincular recetas de platos (no de elaborados)" },
      { status: 400 }
    );
  }

  const product = await queryOne<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND vendor_id = $2`,
    [product_id, gate.vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  if (recipe.product_id === product_id) {
    return NextResponse.json({ error: "Un plato no se vincula a su propia receta" }, { status: 400 });
  }

  const ownRecipe = await queryOne<{ id: string }>(
    `SELECT id FROM recipes WHERE vendor_id = $1 AND product_id = $2`,
    [gate.vendor.id, product_id]
  );
  if (ownRecipe) {
    return NextResponse.json(
      { error: "Ese producto ya tiene receta propia: borrala antes de vincularlo" },
      { status: 409 }
    );
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT l.id FROM product_recipe_links l
     JOIN products p ON p.id = l.product_id
     WHERE l.product_id = $1 AND p.vendor_id = $2`,
    [product_id, gate.vendor.id]
  );
  if (existing) {
    return NextResponse.json({ error: "Ese producto ya está vinculado a una receta" }, { status: 409 });
  }

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO product_recipe_links (recipe_id, product_id, servings)
     VALUES ($1, $2, $3) RETURNING *`,
    [recipe_id, product_id, servings]
  );
  return NextResponse.json({ link: row });
}

/** Borra un vínculo (?productId=). El producto queda sin receta; el batch no se toca. */
export async function DELETE(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Falta productId" }, { status: 400 });

  await query(
    `DELETE FROM product_recipe_links l USING products p
     WHERE l.product_id = p.id AND l.product_id = $1 AND p.vendor_id = $2`,
    [productId, gate.vendor.id]
  );
  return NextResponse.json({ ok: true });
}
