"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiJson, getJson } from "@/components/dashboard/shared";
import { RecipeEditor, type RecipeLinkInfo } from "@/components/dashboard/recipe-editor";
import { PurchasesManager } from "@/components/dashboard/purchases-manager";
import { IngredientForm } from "@/components/dashboard/ingredient-form";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";
import {
  FOOD_COST_STATUS_META,
  formatMoney,
  type FoodCostStatus,
} from "@/lib/costing";

type Product = { id: string; name: string; price: number };

type CostSummary = {
  product_id: string;
  name: string;
  price: number;
  has_recipe: boolean;
  cost: number | null;
  food_cost_pct: number | null;
  status: FoodCostStatus;
  linked_from: {
    recipe_id: string;
    product_name: string | null;
    servings: number;
  } | null;
};

// ---------------------------------------------------------------------------
// Semáforo food-cost editable (global por comercio, defaults 30/35).
// ---------------------------------------------------------------------------
function ThresholdSettings({
  thresholds,
  onSaved,
}: {
  thresholds: { warn: number; bad: number };
  onSaved: () => void;
}) {
  const [warn, setWarn] = useState(String(thresholds.warn));
  const [bad, setBad] = useState(String(thresholds.bad));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setWarn(String(thresholds.warn));
    setBad(String(thresholds.bad));
  }, [thresholds.warn, thresholds.bad]);

  async function handleSave() {
    setError("");
    const w = Number(warn);
    const b = Number(bad);
    if (!isFinite(w) || w <= 0 || w >= 100 || !isFinite(b) || b <= 0 || b >= 100) {
      return setError("Usá valores entre 1 y 99");
    }
    if (w >= b) return setError("El amarillo debe ser menor que el rojo");
    setSaving(true);
    const r = await apiJson("/api/vendor/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ food_cost_warn: w, food_cost_bad: b }),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onSaved();
  }

  return (
    <details className="rounded-xl border border-border bg-card px-3 py-2">
      <summary className="text-xs cursor-pointer list-none flex items-center gap-2">
        <span className="tabular-nums">
          🚦 Semáforo: 🟢 &lt;{thresholds.warn}% · 🟡 {thresholds.warn}–{thresholds.bad}% · 🔴 &gt;{thresholds.bad}%
        </span>
        <span className="text-primary font-semibold ml-auto flex-shrink-0">Editar</span>
      </summary>
      <div className="flex items-end gap-2 pt-2">
        <div>
          <Label className="text-xs">🟡 desde %</Label>
          <Input type="number" min={1} max={99} step="any" value={warn} onChange={(e) => setWarn(e.target.value)} className="w-24" />
        </div>
        <div>
          <Label className="text-xs">🔴 desde %</Label>
          <Input type="number" min={1} max={99} step="any" value={bad} onChange={(e) => setBad(e.target.value)} className="w-24" />
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "…" : "Guardar"}</Button>
      </div>
      {error && <p className="text-xs text-red-600 pt-1">{error}</p>}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Tab Recetas: carta con semáforo + editor | biblioteca de insumos | compras.
// ---------------------------------------------------------------------------
export function RecipeManager() {
  const [view, setView] = useState<"platos" | "insumos" | "compras">("platos");
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [allItems, setAllItems] = useState<RecipeItem[]>([]);
  const [costs, setCosts] = useState<CostSummary[]>([]);
  const [links, setLinks] = useState<RecipeLinkInfo[]>([]);
  const [thresholds, setThresholds] = useState({ warn: 30, bad: 35 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null | "new">(null);
  const [selectedElaborated, setSelectedElaborated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, ing, c, r] = await Promise.all([
      getJson<{ offers: Product[] }>("/api/vendor/offers"),
      getJson<{ ingredients: Ingredient[] }>("/api/vendor/ingredients"),
      getJson<{ costs: CostSummary[]; links: RecipeLinkInfo[]; thresholds: { warn: number; bad: number } }>("/api/vendor/recipes/costs"),
      getJson<{ recipes: Recipe[]; items: RecipeItem[] }>("/api/vendor/recipes"),
    ]);
    if (o?.offers) setProducts(o.offers.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) || 0 })));
    if (ing?.ingredients) setIngredients(ing.ingredients);
    if (c?.costs) setCosts(c.costs);
    if (c?.links) setLinks(c.links);
    if (c?.thresholds) setThresholds(c.thresholds);
    if (r) {
      setRecipes(r.recipes || []);
      setAllItems(r.items || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const costByProduct = useMemo(() => new Map(costs.map((c) => [c.product_id, c])), [costs]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...ingredients].sort((a, b) =>
      Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)
    );
    if (!q) return list;
    return list.filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredients, search]);

  const elaborated = useMemo(() => ingredients.filter((i) => i.is_elaborated), [ingredients]);

  async function refreshAfterSave() {
    await load();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-xl font-semibold">Recetas y costos</h2>
        <div className="flex rounded-xl border border-border overflow-hidden text-sm font-medium">
          <button
            onClick={() => setView("platos")}
            className={`px-4 py-2 ${view === "platos" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            🍽️ Platos
          </button>
          <button
            onClick={() => setView("insumos")}
            className={`px-4 py-2 ${view === "insumos" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            🧂 Insumos ({ingredients.filter((i) => i.active).length})
          </button>
          <button
            onClick={() => setView("compras")}
            className={`px-4 py-2 ${view === "compras" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            🧾 Compras
          </button>
        </div>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={view === "platos" ? "Buscar plato…" : view === "insumos" ? "Buscar insumo…" : "Buscar por proveedor o comprobante…"}
        className="max-w-sm"
      />

      <ThresholdSettings thresholds={thresholds} onSaved={refreshAfterSave} />

      {view === "compras" ? (
        <PurchasesManager
          ingredients={ingredients.filter((i) => i.active)}
          search={search}
          onChanged={refreshAfterSave}
        />
      ) : view === "platos" ? (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {/* Carta con semáforo */}
          <Card className="p-3">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
              Carta · costo y food cost
            </p>
            <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
              {filteredProducts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Todavía no hay platos. Cargalos en la pestaña Menú.
                </p>
              )}
              {filteredProducts.map((p) => {
                const c = costByProduct.get(p.id);
                const meta = c ? FOOD_COST_STATUS_META[c.status] : null;
                const active = selectedProduct === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProduct(active ? null : p.id)}
                    className={`w-full text-left rounded-xl border p-2.5 flex items-center gap-2 transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{p.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        Venta ${p.price.toLocaleString("es-AR")}
                        {c?.has_recipe && c.cost !== null
                          ? ` · Costo ${formatMoney(c.cost)}`
                          : " · Sin receta"}
                        {c?.linked_from && ` · 🔗 ${c.linked_from.product_name}`}
                      </span>
                    </span>
                    {c?.has_recipe && meta ? (
                      <Badge className={`${meta.className} tabular-nums flex-shrink-0`}>
                        {c.food_cost_pct !== null ? `${c.food_cost_pct.toLocaleString("es-AR")}%` : "—"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="flex-shrink-0">Sin receta</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
          {/* Editor */}
          <div className="lg:sticky lg:top-20">
            {selectedProduct ? (
              (() => {
                const p = products.find((x) => x.id === selectedProduct);
                if (!p) return null;
                return (
                  <RecipeEditor
                    key={selectedProduct}
                    target={{ productId: p.id }}
                    title={p.name}
                    subtitle="Receta del plato (cantidades netas por porción)"
                    salePrice={p.price}
                    ingredients={ingredients.filter((i) => i.active)}
                    recipes={recipes}
                    allItems={allItems}
                    products={products}
                    links={links}
                    thresholds={thresholds}
                    onSaved={refreshAfterSave}
                    onDeleted={() => {
                      setSelectedProduct(null);
                      refreshAfterSave();
                    }}
                    onLinksChanged={refreshAfterSave}
                  />
                );
              })()
            ) : (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Elegí un plato de la carta para ver o cargar su receta. El costo se calcula solo a partir de los insumos.
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {/* Biblioteca de insumos */}
          <Card className="p-3">
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                Biblioteca · costo sin IVA
              </p>
              <Button size="sm" onClick={() => { setEditingIngredient("new"); setSelectedElaborated(null); }}>
                + Insumo
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
              {filteredIngredients.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Todavía no hay insumos. Creá el primero con el botón + Insumo.
                </p>
              )}
              {filteredIngredients.map((i) => {
                const hasSub = recipes.some((r) => r.ingredient_id === i.id);
                const isEditing = editingIngredient !== "new" && editingIngredient?.id === i.id;
                return (
                  <button
                    key={i.id}
                    onClick={() => {
                      setEditingIngredient(i);
                      setSelectedElaborated(i.is_elaborated ? i.id : null);
                    }}
                    className={`w-full text-left rounded-xl border p-2.5 flex items-center gap-2 transition-colors ${
                      isEditing
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    } ${!i.active ? "opacity-50" : ""}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {i.name} {i.is_elaborated ? "🧪" : ""}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        ${Number(i.cost_per_unit).toLocaleString("es-AR")}/{i.base_unit}
                        {i.waste_pct > 0 ? ` · merma ${i.waste_pct}%` : ""}
                        {i.is_elaborated ? (hasSub ? " · con sub-receta" : " · sin sub-receta") : ""}
                      </span>
                    </span>
                    {!i.active && <Badge variant="secondary">Inactivo</Badge>}
                  </button>
                );
              })}
            </div>
            {elaborated.length > 0 && (
              <p className="text-xs text-muted-foreground px-1 pt-2">
                🧪 = elaborado: cargale su sub-receta con el rinde (ej. 1000 ml de salsa).
              </p>
            )}
          </Card>
          {/* Form + sub-receta */}
          <div className="space-y-4 lg:sticky lg:top-20">
            {editingIngredient === "new" ? (
              <IngredientForm
                key="new"
                onDone={() => { setEditingIngredient(null); refreshAfterSave(); }}
                onDeleted={() => { setEditingIngredient(null); refreshAfterSave(); }}
              />
            ) : editingIngredient ? (
              <>
                <IngredientForm
                  key={editingIngredient.id}
                  initial={editingIngredient}
                  onDone={() => { refreshAfterSave(); }}
                  onDeleted={() => { setEditingIngredient(null); setSelectedElaborated(null); refreshAfterSave(); }}
                />
                {selectedElaborated && (
                  <RecipeEditor
                    key={`sub-${selectedElaborated}`}
                    target={{ ingredientId: selectedElaborated }}
                    title={`Sub-receta: ${editingIngredient.name}`}
                    subtitle="Costo del elaborado (se prorratea en los platos que lo usan)"
                    yieldUnit={(ingredients.find((i) => i.id === selectedElaborated)?.base_unit as string) || "g"}
                    ingredients={ingredients.filter((i) => i.active && i.id !== selectedElaborated)}
                    recipes={recipes}
                    allItems={allItems}
                    thresholds={thresholds}
                    onSaved={refreshAfterSave}
                    onDeleted={() => refreshAfterSave()}
                  />
                )}
              </>
            ) : (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Elegí un insumo para editarlo, o creá uno nuevo. Si es elaborado 🧪, acá mismo le cargás la sub-receta.
              </Card>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground tabular-nums">
        Los costos se calculan sin IVA, con la merma de cada insumo aplicada. Semáforo food cost: 🟢 menos de {thresholds.warn}% · 🟡 {thresholds.warn}–{thresholds.bad}% · 🔴 más de {thresholds.bad}%.
      </p>
    </div>
  );
}
