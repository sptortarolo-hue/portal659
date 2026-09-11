import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import {
  buildCostingMaps,
  computeRecipeCost,
  foodCostPct,
  foodCostStatus,
  linkedCost,
  resolveThresholds,
} from "@/lib/costing";
import { NextResponse } from "next/server";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Resumen de costos por plato: costo, food-cost % y semáforo (para la carta).
 *  Incluye productos vinculados a recetas compartidas (porción/entera) y los
 *  umbrales del semáforo del comercio. */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const [ingredients, recipes, items, products, links, vendorRow] = await Promise.all([
    queryMany<Ingredient>(`SELECT * FROM ingredients WHERE vendor_id = $1`, [gate.vendor.id]),
    queryMany<Recipe>(`SELECT * FROM recipes WHERE vendor_id = $1`, [gate.vendor.id]),
    queryMany<RecipeItem>(
      `SELECT i.* FROM recipe_items i JOIN recipes r ON r.id = i.recipe_id WHERE r.vendor_id = $1`,
      [gate.vendor.id]
    ),
    queryMany<{ id: string; name: string; price: number }>(
      `SELECT id, name, price FROM products WHERE vendor_id = $1 ORDER BY name ASC`,
      [gate.vendor.id]
    ),
    queryMany<{
      id: string;
      recipe_id: string;
      product_id: string;
      servings: number;
      product_name: string;
      recipe_product_name: string | null;
      recipe_product_id: string | null;
    }>(
      `SELECT l.*, p.name AS product_name, rp.name AS recipe_product_name, r.product_id AS recipe_product_id
       FROM product_recipe_links l
       JOIN products p ON p.id = l.product_id
       JOIN recipes r ON r.id = l.recipe_id
       LEFT JOIN products rp ON rp.id = r.product_id
       WHERE p.vendor_id = $1 AND r.vendor_id = $1`,
      [gate.vendor.id]
    ),
    queryOne<{ food_cost_warn: number | null; food_cost_bad: number | null }>(
      `SELECT food_cost_warn, food_cost_bad FROM vendors WHERE id = $1`,
      [gate.vendor.id]
    ),
  ]);

  const thresholds = resolveThresholds(vendorRow?.food_cost_warn, vendorRow?.food_cost_bad);

  const grouped = (recipes || []).map((r) => ({
    recipe: r,
    items: (items || []).filter((i) => i.recipe_id === r.id),
  }));
  const maps = buildCostingMaps(ingredients || [], grouped);
  const linkByProduct = new Map((links || []).map((l) => [l.product_id, l]));

  const costs = (products || []).map((p) => {
    const base = {
      product_id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      has_recipe: false,
      cost: null as number | null,
      food_cost_pct: null as number | null,
      status: "none" as const,
      linked_from: null as {
        recipe_id: string;
        product_name: string | null;
        servings: number;
      } | null,
    };

    // Caso 1: receta propia.
    if (maps.byProduct.has(p.id)) {
      const c = computeRecipeCost({ productId: p.id }, maps);
      const pct = foodCostPct(c.perPortion, p.price);
      return { ...base, has_recipe: true, cost: c.perPortion, food_cost_pct: pct, status: foodCostStatus(pct, thresholds) };
    }

    // Caso 2: vinculado a la receta de otro (porción/entera).
    const link = linkByProduct.get(p.id);
    if (link && link.recipe_product_id && maps.byProduct.has(link.recipe_product_id)) {
      const c = computeRecipeCost({ productId: link.recipe_product_id }, maps);
      const cost = linkedCost(c.total, c.portions, Number(link.servings));
      const pct = foodCostPct(cost, p.price);
      return {
        ...base,
        has_recipe: true,
        cost,
        food_cost_pct: pct,
        status: foodCostStatus(pct, thresholds),
        linked_from: {
          recipe_id: link.recipe_id,
          product_name: link.recipe_product_name,
          servings: Number(link.servings),
        },
      };
    }

    return base;
  });

  return NextResponse.json({ costs, links: links || [], thresholds });
}
