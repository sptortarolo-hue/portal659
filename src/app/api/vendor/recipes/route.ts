import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { toBaseUnit } from "@/lib/costing";
import { NextResponse } from "next/server";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

type RecipeWithItems = { recipe: Recipe; items: RecipeItem[] };

async function fetchRecipe(
  vendorId: string,
  target: { productId: string } | { ingredientId: string }
): Promise<RecipeWithItems | null> {
  const recipe =
    "productId" in target
      ? await queryOne<Recipe>(
          `SELECT * FROM recipes WHERE vendor_id = $1 AND product_id = $2`,
          [vendorId, target.productId]
        )
      : await queryOne<Recipe>(
          `SELECT * FROM recipes WHERE vendor_id = $1 AND ingredient_id = $2`,
          [vendorId, target.ingredientId]
        );
  if (!recipe) return null;
  const items = await queryMany<RecipeItem>(
    `SELECT * FROM recipe_items WHERE recipe_id = $1 ORDER BY position ASC, created_at ASC`,
    [recipe.id]
  );
  return { recipe, items: items || [] };
}

/** Lee recetas: ?productId= | ?ingredientId= | ?all=1 (todas con ítems). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const ingredientId = searchParams.get("ingredientId");

  if (productId) {
    return NextResponse.json({ data: await fetchRecipe(gate.vendor.id, { productId }) });
  }
  if (ingredientId) {
    return NextResponse.json({ data: await fetchRecipe(gate.vendor.id, { ingredientId }) });
  }

  const recipes = await queryMany<Recipe>(
    `SELECT * FROM recipes WHERE vendor_id = $1 ORDER BY created_at ASC`,
    [gate.vendor.id]
  );
  const items = await queryMany<RecipeItem>(
    `SELECT i.* FROM recipe_items i JOIN recipes r ON r.id = i.recipe_id
     WHERE r.vendor_id = $1 ORDER BY i.position ASC, i.created_at ASC`,
    [gate.vendor.id]
  );
  return NextResponse.json({ recipes: recipes || [], items: items || [] });
}

type InItem = { ingredient_id: string; qty_net: number; unit: string };

/** Detecta ciclos entre sub-recetas: expande el grafo de elaborados del
 *  vendor (con las líneas nuevas aplicadas al objetivo) y falla si el
 *  objetivo se alcanza a sí mismo o hay un ciclo alcanzable. */
async function assertNoCycle(
  vendorId: string,
  targetIngredientId: string | null,
  items: InItem[]
): Promise<string | null> {
  const rows = await queryMany<{ owner: string; used: string }>(
    `SELECT r.ingredient_id AS owner, i.ingredient_id AS used
     FROM recipes r JOIN recipe_items i ON i.recipe_id = r.id
     WHERE r.vendor_id = $1 AND r.ingredient_id IS NOT NULL`,
    [vendorId]
  );
  const adj = new Map<string, Set<string>>();
  for (const r of rows || []) {
    if (!adj.has(r.owner)) adj.set(r.owner, new Set());
    adj.get(r.owner)!.add(r.used);
  }
  // Pseudo-nodo del objetivo con las líneas nuevas.
  const TARGET = targetIngredientId ?? "__product__";
  adj.set(
    TARGET,
    new Set(items.map((i) => i.ingredient_id))
  );

  // DFS desde cada línea nueva buscando volver al objetivo o un ciclo.
  const visit = (node: string, stack: string[]): string | null => {
    if (node === TARGET && stack.length > 0) return "referencia circular";
    if (stack.includes(node)) return "referencia circular";
    const next = adj.get(node);
    if (!next) return null;
    for (const n of next) {
      const hit = visit(n, [...stack, node]);
      if (hit) return hit;
    }
    return null;
  };
  for (const it of items) {
    const hit = visit(it.ingredient_id, [TARGET]);
    if (hit) return `La receta tiene una ${hit} con “${it.ingredient_id}”`;
  }
  return null;
}

/**
 * Crea o reemplaza la receta completa de un plato o insumo elaborado.
 * Body: { product_id?, ingredient_id?, portions?, instructions?, items: [{ingredient_id, qty_net, unit}] }
 */
export async function PUT(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json();
  const product_id: string | null = body?.product_id || null;
  const ingredient_id: string | null = body?.ingredient_id || null;
  const portions = Number(body?.portions ?? 1);
  const instructions =
    body?.instructions != null && String(body.instructions).trim() !== ""
      ? String(body.instructions).trim()
      : null;
  const rawItems: unknown = body?.items;

  if ((product_id ? 1 : 0) + (ingredient_id ? 1 : 0) !== 1) {
    return NextResponse.json({ error: "Indicá un plato o un insumo elaborado" }, { status: 400 });
  }
  if (!isFinite(portions) || portions <= 0) {
    return NextResponse.json({ error: "El rinde debe ser mayor a 0" }, { status: 400 });
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "La receta necesita al menos un ingrediente" }, { status: 400 });
  }

  // El objetivo debe pertenecer al vendor.
  if (product_id) {
    const p = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 AND vendor_id = $2`,
      [product_id, gate.vendor.id]
    );
    if (!p) return NextResponse.json({ error: "Plato no encontrado" }, { status: 404 });
  } else {
    const target = await queryOne<Ingredient>(
      `SELECT * FROM ingredients WHERE id = $1 AND vendor_id = $2`,
      [ingredient_id, gate.vendor.id]
    );
    if (!target) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });
    if (!target.is_elaborated) {
      return NextResponse.json(
        { error: "Marcá el insumo como “elaborado” para cargarle una receta" },
        { status: 400 }
      );
    }
  }

  // Normalizar + validar líneas.
  const ingIds = Array.from(
    new Set((rawItems as any[]).map((i) => String(i?.ingredient_id || "")).filter(Boolean))
  );
  if (ingIds.length === 0) {
    return NextResponse.json({ error: "La receta necesita al menos un ingrediente válido" }, { status: 400 });
  }
  const ings = await queryMany<Ingredient>(
    `SELECT * FROM ingredients WHERE id = ANY($1) AND vendor_id = $2`,
    [ingIds, gate.vendor.id]
  );
  const ingMap = new Map((ings || []).map((i) => [i.id, i]));

  const items: InItem[] = [];
  for (let idx = 0; idx < (rawItems as any[]).length; idx++) {
    const raw = (rawItems as any[])[idx];
    const iid = String(raw?.ingredient_id || "");
    const ing = ingMap.get(iid);
    if (!ing) return NextResponse.json({ error: `Línea ${idx + 1}: insumo inválido` }, { status: 400 });
    if (ing.is_elaborated && ingredient_id && iid === ingredient_id) {
      return NextResponse.json({ error: "Un elaborado no puede usarse a sí mismo" }, { status: 400 });
    }
    const qty = Number(raw?.qty_net);
    if (!isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: `Línea ${idx + 1} (“${ing.name}”): cantidad inválida` }, { status: 400 });
    }
    const unit = String(raw?.unit || ing.base_unit).trim();
    if (toBaseUnit(qty, unit, ing.base_unit) === null) {
      return NextResponse.json(
        { error: `Línea ${idx + 1} (“${ing.name}”): la unidad “${unit}” no es compatible con “${ing.base_unit}”` },
        { status: 400 }
      );
    }
    items.push({ ingredient_id: iid, qty_net: qty, unit });
  }

  const cycle = await assertNoCycle(gate.vendor.id, ingredient_id, items);
  if (cycle) return NextResponse.json({ error: cycle }, { status: 400 });

  const saved = await withTransaction(async (tx) => {
    const prev = product_id
      ? await tx.queryOne<Recipe>(`SELECT * FROM recipes WHERE vendor_id = $1 AND product_id = $2`, [
          gate.vendor.id,
          product_id,
        ])
      : await tx.queryOne<Recipe>(`SELECT * FROM recipes WHERE vendor_id = $1 AND ingredient_id = $2`, [
          gate.vendor.id,
          ingredient_id,
        ]);
    let recipeId: string;
    if (prev) {
      await tx.queryVoid(`DELETE FROM recipe_items WHERE recipe_id = $1`, [prev.id]);
      const upd = await tx.queryOne<Recipe>(
        `UPDATE recipes SET portions = $1, instructions = $2, updated_at = now()
         WHERE id = $3 RETURNING *`,
        [portions, instructions, prev.id]
      );
      if (!upd) throw new Error("No se pudo actualizar la receta");
      recipeId = upd.id;
    } else {
      const ins = await tx.queryOne<Recipe>(
        `INSERT INTO recipes (vendor_id, product_id, ingredient_id, portions, instructions)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [gate.vendor.id, product_id, ingredient_id, portions, instructions]
      );
      if (!ins) throw new Error("No se pudo crear la receta");
      recipeId = ins.id;
    }
    for (let i = 0; i < items.length; i++) {
      await tx.queryVoid(
        `INSERT INTO recipe_items (recipe_id, ingredient_id, qty_net, unit, position)
         VALUES ($1, $2, $3, $4, $5)`,
        [recipeId, items[i].ingredient_id, items[i].qty_net, items[i].unit, i]
      );
    }
    return recipeId;
  });

  const data = product_id
    ? await fetchRecipe(gate.vendor.id, { productId: product_id })
    : await fetchRecipe(gate.vendor.id, { ingredientId: ingredient_id! });
  void saved;
  return NextResponse.json({ data });
}

/** Borra la receta de un plato o insumo (los insumos no se tocan). */
export async function DELETE(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const ingredientId = searchParams.get("ingredientId");
  if ((productId ? 1 : 0) + (ingredientId ? 1 : 0) !== 1) {
    return NextResponse.json({ error: "Indicá un plato o un insumo" }, { status: 400 });
  }
  await withTransaction(async (tx) => {
    if (productId) {
      await tx.queryVoid(`DELETE FROM recipes WHERE vendor_id = $1 AND product_id = $2`, [
        gate.vendor.id,
        productId,
      ]);
    } else {
      await tx.queryVoid(`DELETE FROM recipes WHERE vendor_id = $1 AND ingredient_id = $2`, [
        gate.vendor.id,
        ingredientId,
      ]);
    }
  });
  return NextResponse.json({ ok: true });
}
