"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "@/components/dashboard/shared";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";
import {
  FOOD_COST_STATUS_META,
  LINE_UNITS,
  buildCostingMaps,
  computeRecipeCost,
  foodCostPct,
  foodCostStatus,
  formatMoney,
  linkedCost,
  suggestedPrice,
  toBaseUnit,
  type IngredientUnit,
  type RecipeCost,
} from "@/lib/costing";

export type ProductBrief = { id: string; name: string; price: number };

export type RecipeLinkInfo = {
  id: string;
  recipe_id: string;
  product_id: string;
  servings: number;
  product_name: string;
  recipe_product_name: string | null;
};

export type DraftLine = { key: number; ingredient_id: string; qty_net: string; unit: string };

export type DraftTarget = { productId: string } | { ingredientId: string };

export function targetKey(t: DraftTarget): string {
  return "productId" in t ? `p:${t.productId}` : `i:${t.ingredientId}`;
}

// ---------------------------------------------------------------------------
// Editor de receta (plato o insumo elaborado), con costo en vivo.
// ---------------------------------------------------------------------------
export function RecipeEditor({
  target,
  title,
  subtitle,
  salePrice,
  yieldUnit,
  ingredients,
  recipes,
  allItems,
  products,
  links,
  thresholds,
  onSaved,
  onDeleted,
  onLinksChanged,
}: {
  target: DraftTarget;
  title: string;
  subtitle?: string;
  /** Precio de venta (solo platos): para food-cost % y precio sugerido. */
  salePrice?: number | null;
  /** Unidad del rinde (solo elaborados): ej. "ml". */
  yieldUnit?: string;
  ingredients: Ingredient[];
  recipes: Recipe[];
  allItems: RecipeItem[];
  /** Catálogo para vincular otras presentaciones (solo platos). */
  products?: ProductBrief[];
  /** Links existentes (se filtran por receta acá adentro). */
  links?: RecipeLinkInfo[];
  /** Umbrales del semáforo del comercio. */
  thresholds?: { warn: number; bad: number };
  onSaved: () => void;
  onDeleted: () => void;
  onLinksChanged?: () => void;
}) {
  const existing = useMemo(() => {
    const r =
      "productId" in target
        ? recipes.find((x) => x.product_id === target.productId)
        : recipes.find((x) => x.ingredient_id === target.ingredientId);
    if (!r) return null;
    return {
      recipe: r,
      items: allItems
        .filter((i) => i.recipe_id === r.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    };
  }, [target, recipes, allItems]);

  const [portions, setPortions] = useState("1");
  const [instructions, setInstructions] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [targetPct, setTargetPct] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keySeq, setKeySeq] = useState(1);

  // Cargar receta existente al abrir/cambiar de objetivo o cuando cambian los
  // datos del servidor (ej. después de guardar). La firma es por contenido:
  // estable entre renders con los mismos datos (sin loops) y cambia solo si
  // el servidor trae algo distinto.
  const existingSig = existing
    ? `r:${existing.recipe.id}|${existing.recipe.portions}|${existing.recipe.instructions ?? ""}|${existing.items.map((i) => `${i.ingredient_id}:${i.qty_net}:${i.unit}`).join(",")}`
    : `new:${targetKey(target)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional: depende de la firma, no del objeto
  useEffect(() => {
    if (existing) {
      setPortions(String(existing.recipe.portions ?? 1));
      setInstructions(existing.recipe.instructions || "");
      setLines(
        existing.items.map((i, idx) => ({
          key: idx + 1,
          ingredient_id: i.ingredient_id,
          qty_net: String(i.qty_net),
          unit: i.unit,
        }))
      );
      setKeySeq(existing.items.length + 1);
    } else {
      setPortions("1");
      setInstructions("");
      setLines([{ key: 0, ingredient_id: "", qty_net: "", unit: "g" }]);
      setKeySeq(1);
    }
    setError("");
  }, [existingSig]);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // Costo en vivo: mapas del servidor + borrador aplicado al objetivo.
  const preview: RecipeCost | null = useMemo(() => {
    const grouped = recipes.map((r) => ({
      recipe: r,
      items: allItems.filter((i) => i.recipe_id === r.id),
    }));
    const maps = buildCostingMaps(ingredients, grouped);
    const draftItems: RecipeItem[] = lines
      .filter((l) => l.ingredient_id && Number(l.qty_net) > 0)
      .map((l, idx) => ({
        id: `draft-${idx}`,
        recipe_id: "draft",
        ingredient_id: l.ingredient_id,
        qty_net: Number(l.qty_net),
        unit: l.unit || "g",
        position: idx,
        created_at: "",
      }));
    const draftRecipe: Recipe = {
      id: "draft",
      vendor_id: "",
      product_id: "productId" in target ? target.productId : null,
      ingredient_id: "ingredientId" in target ? target.ingredientId : null,
      portions: Number(portions) > 0 ? Number(portions) : 1,
      instructions: instructions || null,
      created_at: "",
      updated_at: "",
    };
    if ("productId" in target) maps.byProduct.set(target.productId, { recipe: draftRecipe, items: draftItems });
    else maps.byIngredient.set(target.ingredientId, { recipe: draftRecipe, items: draftItems });
    return "productId" in target
      ? computeRecipeCost({ productId: target.productId }, maps)
      : computeRecipeCost({ ingredientId: target.ingredientId }, maps);
  }, [lines, portions, instructions, ingredients, recipes, allItems, targetKey(target)]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickIngredient(key: number, ingredientId: string) {
    const ing = ingMap.get(ingredientId);
    patchLine(key, { ingredient_id: ingredientId, unit: ing ? ing.base_unit : "g" });
  }

  async function handleSave() {
    setError("");
    const clean = lines.filter((l) => l.ingredient_id && Number(l.qty_net) > 0);
    if (clean.length === 0) return setError("Agregá al menos un ingrediente con cantidad");
    setSaving(true);
    const body =
      "productId" in target
        ? { product_id: target.productId }
        : { ingredient_id: target.ingredientId };
    const r = await apiJson("/api/vendor/recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        portions: Number(portions) > 0 ? Number(portions) : 1,
        instructions: instructions.trim() || null,
        items: clean.map((l) => ({ ingredient_id: l.ingredient_id, qty_net: Number(l.qty_net), unit: l.unit })),
      }),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onSaved();
  }

  async function handleDelete() {
    if (!existing) return;
    if (!window.confirm("¿Borrar esta receta? Los insumos no se tocan.")) return;
    setSaving(true);
    const qs =
      "productId" in target ? `?productId=${target.productId}` : `?ingredientId=${target.ingredientId}`;
    const r = await apiJson(`/api/vendor/recipes${qs}`, { method: "DELETE" });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo borrar");
    onDeleted();
  }

  const pct = preview && salePrice ? foodCostPct(preview.perPortion, salePrice) : null;
  const status = foodCostStatus(pct, thresholds);
  const meta = FOOD_COST_STATUS_META[status];
  const tgt = Math.min(Math.max(Number(targetPct) || 30, 1), 90);
  const belowCost = salePrice != null && preview !== null && preview.perPortion > salePrice;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{yieldUnit ? `Rinde (en ${yieldUnit})` : "Porciones que rinde"}</Label>
          <Input
            type="number"
            min={0.001}
            step="any"
            value={portions}
            onChange={(e) => setPortions(e.target.value)}
          />
        </div>
        {salePrice != null && (
          <div>
            <Label className="text-xs">Precio de venta</Label>
            <Input value={`$${Number(salePrice).toLocaleString("es-AR")}`} disabled />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Ingredientes (cantidades netas, lo que queda en el plato)</Label>
        {lines.map((l) => {
          const ing = ingMap.get(l.ingredient_id);
          const units = ing ? LINE_UNITS[ing.base_unit as IngredientUnit] ?? [ing.base_unit] : ["mg", "g", "kg", "ml", "cl", "l", "u", "doc"];
          const badUnit =
            ing && l.qty_net && toBaseUnit(Number(l.qty_net), l.unit, ing.base_unit) === null;
          return (
            <div key={l.key} className="flex flex-col gap-1.5 rounded-xl border border-border p-2">
              <div className="flex gap-1.5">
                <select
                  value={l.ingredient_id}
                  onChange={(e) => pickIngredient(l.key, e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="">Elegí insumo…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (${Number(i.cost_per_unit).toLocaleString("es-AR")}/{i.base_unit}
                      {i.waste_pct > 0 ? `, merma ${i.waste_pct}%` : ""}
                      {i.is_elaborated ? " 🧪" : ""})
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 px-2"
                  onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  title="Quitar línea"
                >
                  ✕
                </Button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Cantidad neta"
                  value={l.qty_net}
                  onChange={(e) => patchLine(l.key, { qty_net: e.target.value })}
                  className="flex-1"
                />
                <select
                  value={l.unit}
                  onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                  className="w-24 rounded-lg border border-input bg-background px-2 py-2 text-sm"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              {badUnit && (
                <p className="text-xs text-red-600">La unidad “{l.unit}” no es compatible con “{ing!.base_unit}”.</p>
              )}
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLines((prev) => [...prev, { key: keySeq, ingredient_id: "", qty_net: "", unit: "g" }]);
            setKeySeq((k) => k + 1);
          }}
        >
          + Ingrediente
        </Button>
      </div>

      <div>
        <Label className="text-xs">Preparación (opcional, ficha técnica)</Label>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Pasos de elaboración…"
          rows={2}
        />
      </div>

      {/* Resumen en vivo */}
      {preview && (
        <div className="rounded-xl bg-muted/60 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Costo total</span>
            <span className="text-xl font-bold tabular-nums">{formatMoney(preview.total)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Costo por {yieldUnit ? yieldUnit : "porción"}
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(preview.perPortion)}</span>
          </div>
          {preview.lines.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-border">
              {preview.lines.map((ln) => (
                <li key={ln.ingredient_id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {ln.name} · {ln.qty_net} {ln.unit} → {ln.qty_gross_base} {ln.base_unit} brutos
                    {ln.is_elaborated ? " 🧪" : ""}
                  </span>
                  <span className="tabular-nums flex-shrink-0">{formatMoney(ln.line_cost)}</span>
                </li>
              ))}
            </ul>
          )}
          {salePrice != null && pct !== null && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
              <span className="text-sm">Food cost</span>
              <Badge className={`${meta.className} tabular-nums`}>
                {pct.toLocaleString("es-AR")}% · {meta.label}
              </Badge>
            </div>
          )}
          {belowCost && (
            <p className="text-sm text-red-600 font-medium">
              ⚠️ Vendés bajo costo: cuesta {formatMoney(preview.perPortion)} y sale a {formatMoney(Number(salePrice))}
            </p>
          )}
          {salePrice != null && preview.perPortion > 0 && (
            <div className="flex items-center justify-between gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground flex items-center gap-1 min-w-0 flex-wrap">
                Precio sugerido (food cost
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={targetPct}
                  onChange={(e) => setTargetPct(e.target.value)}
                  className="w-14 h-7 px-1 text-xs inline-block"
                />
                %)
              </span>
              <span className="font-semibold tabular-nums shrink-0">{formatMoney(suggestedPrice(preview.perPortion, tgt))}</span>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 space-y-0.5 pt-1">
              {preview.warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {"productId" in target && (
        <RecipePresentations
          recipeId={existing?.recipe.id ?? null}
          batchTotal={preview?.total ?? 0}
          batchPortions={preview?.portions ?? 1}
          ownProductId={target.productId}
          products={products ?? []}
          recipes={recipes}
          links={links ?? []}
          onChanged={() => onLinksChanged?.()}
        />
      )}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? "Guardando…" : existing ? "Guardar cambios" : "Crear receta"}
        </Button>
        {existing && (
          <Button variant="outline" onClick={handleDelete} disabled={saving} className="text-red-600">
            Borrar
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Otras presentaciones del mismo batch (porción + entera): productos
// vinculados a esta receta, cada uno con sus porciones y su precio propio.
// ---------------------------------------------------------------------------
function RecipePresentations({
  recipeId,
  batchTotal,
  batchPortions,
  ownProductId,
  products,
  recipes,
  links,
  onChanged,
}: {
  recipeId: string | null;
  batchTotal: number;
  batchPortions: number;
  ownProductId: string;
  products: ProductBrief[];
  recipes: Recipe[];
  links: RecipeLinkInfo[];
  onChanged: () => void;
}) {
  const [selProduct, setSelProduct] = useState("");
  const [servings, setServings] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const myLinks = useMemo(() => links.filter((l) => l.recipe_id === recipeId), [links, recipeId]);

  const eligible = useMemo(() => {
    const withRecipe = new Set(recipes.map((r) => r.product_id).filter(Boolean));
    const withLink = new Set(links.map((l) => l.product_id));
    return products.filter((p) => p.id !== ownProductId && !withRecipe.has(p.id) && !withLink.has(p.id));
  }, [products, recipes, links, ownProductId]);

  async function handleAdd() {
    setError("");
    if (!recipeId) return setError("Guardá la receta primero");
    if (!selProduct) return setError("Elegí el producto");
    const sv = Number(servings);
    if (!isFinite(sv) || sv <= 0) return setError("Las porciones deben ser mayores a 0");
    setSaving(true);
    const r = await apiJson("/api/vendor/recipes/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe_id: recipeId, product_id: selProduct, servings: sv }),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo vincular");
    setSelProduct("");
    setServings("1");
    onChanged();
  }

  async function handleRemove(productId: string, name: string) {
    if (!window.confirm(`¿Desvincular “${name}”? Queda sin receta.`)) return;
    const r = await apiJson(`/api/vendor/recipes/links?productId=${productId}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error || "No se pudo desvincular");
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        🧩 Otras presentaciones de este batch
      </p>
      {myLinks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Ej.: esta elaboración (rinde {batchPortions}) también se vende entera o por porción, cada una a su precio.
        </p>
      )}
      {myLinks.map((l) => (
        <div key={l.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 min-w-0 truncate tabular-nums">
            {l.product_name} · {Number(l.servings).toLocaleString("es-AR")} porc. →{" "}
            <span className="font-semibold">{formatMoney(linkedCost(batchTotal, batchPortions, Number(l.servings)))}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 px-2"
            onClick={() => handleRemove(l.product_id, l.product_name)}
          >
            ✕
          </Button>
        </div>
      ))}
      {eligible.length > 0 ? (
        <div className="flex gap-1.5">
          <select
            value={selProduct}
            onChange={(e) => setSelProduct(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="">Vincular producto…</option>
            {eligible.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Input
            type="number"
            min={0.001}
            step="any"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className="w-20"
            title="Porciones del batch que representa"
            placeholder="Porc."
          />
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving || !recipeId}>+</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No hay productos libres para vincular (todos tienen receta o link).</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
