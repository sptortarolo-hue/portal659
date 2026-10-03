import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { computeRecipeCost, buildCostingMaps } from "@/lib/costing";
import { buildRecipePdf } from "@/lib/recipe-pdf";
import { NextResponse } from "next/server";
import type { Ingredient, Recipe, RecipeItem, ProductRecipeLink } from "@/types/database";

export const dynamic = "force-dynamic";

/** PDF A4 de la ficha de receta (ingredientes, preparación, costos vs venta). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: "Las recetas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;

  const recipe = await queryOne<Recipe>(
    `SELECT * FROM recipes WHERE id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!recipe) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });

  const [items, ingredients, product, links] = await Promise.all([
    queryMany<RecipeItem>(`SELECT * FROM recipe_items WHERE recipe_id = $1 ORDER BY position ASC`, [id]),
    queryMany<Ingredient>(`SELECT * FROM ingredients WHERE vendor_id = $1`, [gate.vendor.id]),
    recipe.product_id
      ? queryOne<{ id: string; name: string; price: number }>(
          `SELECT id, name, price FROM products WHERE id = $1 AND vendor_id = $2`,
          [recipe.product_id, gate.vendor.id]
        )
      : Promise.resolve(null),
    queryMany<ProductRecipeLink>(
      `SELECT * FROM product_recipe_links WHERE recipe_id = $1`,
      [id]
    ),
  ]);

  const maps = buildCostingMaps(ingredients, [{ recipe, items }]);
  const cost = "productId" in { productId: recipe.product_id }
    ? computeRecipeCost({ productId: recipe.product_id! }, maps)
    : computeRecipeCost({ ingredientId: recipe.ingredient_id! }, maps);

  const linked = await Promise.all(
    links.map(async (l) => {
      const p = await queryOne<{ name: string; price: number }>(
        `SELECT name, price FROM products WHERE id = $1 AND vendor_id = $2`,
        [l.product_id, gate.vendor.id]
      );
      return p ? { name: p.name, servings: Number(l.servings), price: Number(p.price) } : null;
    })
  );

  const pdf = await buildRecipePdf({
    vendor: gate.vendor,
    productName: product?.name ?? "(elaborado)",
    price: product ? Number(product.price) : 0,
    portions: cost.portions,
    instructions: recipe.instructions,
    cost,
    linked: linked.filter((x): x is NonNullable<typeof x> => x !== null),
  });

  const safeName = (product?.name || "receta").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receta-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
