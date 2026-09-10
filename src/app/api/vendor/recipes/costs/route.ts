import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import {
  buildCostingMaps,
  computeRecipeCost,
  foodCostPct,
  foodCostStatus,
} from "@/lib/costing";
import { NextResponse } from "next/server";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Resumen de costos por plato: costo, food-cost % y semáforo (para la carta). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const [ingredients, recipes, items, products] = await Promise.all([
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
  ]);

  const grouped = (recipes || []).map((r) => ({
    recipe: r,
    items: (items || []).filter((i) => i.recipe_id === r.id),
  }));
  const maps = buildCostingMaps(ingredients || [], grouped);

  const costs = (products || []).map((p) => {
    const hasRecipe = maps.byProduct.has(p.id);
    if (!hasRecipe) {
      return {
        product_id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        has_recipe: false,
        cost: null as number | null,
        food_cost_pct: null as number | null,
        status: "none" as const,
      };
    }
    const c = computeRecipeCost({ productId: p.id }, maps);
    const pct = foodCostPct(c.perPortion, p.price);
    return {
      product_id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      has_recipe: true,
      cost: c.perPortion,
      food_cost_pct: pct,
      status: foodCostStatus(pct),
    };
  });

  return NextResponse.json({ costs });
}
