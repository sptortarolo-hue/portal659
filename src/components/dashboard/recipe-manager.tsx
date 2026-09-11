"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { apiJson } from "@/components/dashboard/shared";
import type { Ingredient, Recipe, RecipeItem, Supplier } from "@/types/database";
import {
  FOOD_COST_STATUS_META,
  LINE_UNITS,
  RECEIPT_TYPE_LABEL,
  RECEIPT_TYPE_OPTIONS,
  WASTE_PRESETS,
  buildCostingMaps,
  computeRecipeCost,
  foodCostPct,
  foodCostStatus,
  formatMoney,
  suggestedPrice,
  toBaseUnit,
  unitFactor,
  type FoodCostStatus,
  type IngredientUnit,
  type RecipeCost,
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
};

type DraftLine = { key: number; ingredient_id: string; qty_net: string; unit: string };

type DraftTarget = { productId: string } | { ingredientId: string };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function targetKey(t: DraftTarget): string {
  return "productId" in t ? `p:${t.productId}` : `i:${t.ingredientId}`;
}

// ---------------------------------------------------------------------------
// Editor de receta (plato o insumo elaborado), con costo en vivo.
// ---------------------------------------------------------------------------
function RecipeEditor({
  target,
  title,
  subtitle,
  salePrice,
  yieldUnit,
  ingredients,
  recipes,
  allItems,
  onSaved,
  onDeleted,
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
  onSaved: () => void;
  onDeleted: () => void;
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

  // Cargar receta existente al abrir/cambiar de objetivo.
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
  }, [targetKey(target)]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const status = foodCostStatus(pct);
  const meta = FOOD_COST_STATUS_META[status];
  const tgt = Math.min(Math.max(Number(targetPct) || 30, 1), 90);

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
// Formulario de insumo (crear / editar).
// ---------------------------------------------------------------------------
function IngredientForm({
  initial,
  onDone,
  onDeleted,
}: {
  initial?: Ingredient | null;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [baseUnit, setBaseUnit] = useState<string>(initial?.base_unit || "g");
  const [cost, setCost] = useState(initial ? String(initial.cost_per_unit) : "");
  const [buyPrice, setBuyPrice] = useState("");
  const [buyQty, setBuyQty] = useState("");
  const [waste, setWaste] = useState(initial ? String(initial.waste_pct) : "0");
  const [wasteType, setWasteType] = useState("");
  const [isElaborated, setIsElaborated] = useState(!!initial?.is_elaborated);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [active, setActive] = useState(initial ? !!initial.active : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Ayuda de carga estilo Fudo: precio de compra ÷ cantidad → costo unitario.
  function applyPurchaseHelper() {
    const p = Number(buyPrice);
    const q = Number(buyQty);
    if (p > 0 && q > 0) setCost(String(Math.round((p / q) * 10000) / 10000));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Indicá el nombre del insumo");
    if (!(Number(cost) >= 0)) return setError("Indicá el costo por unidad base");
    setSaving(true);
    const payload = {
      name: name.trim(),
      base_unit: baseUnit,
      cost_per_unit: Number(cost),
      waste_pct: Number(waste) || 0,
      is_elaborated: isElaborated,
      notes: notes.trim() || null,
      active,
    };
    const r = initial
      ? await apiJson(`/api/vendor/ingredients/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await apiJson("/api/vendor/ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onDone();
  }

  async function handleDelete() {
    if (!initial) return;
    if (!window.confirm(`¿Borrar “${initial.name}”?`)) return;
    setSaving(true);
    const r = await apiJson(`/api/vendor/ingredients/${initial.id}`, { method: "DELETE" });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo borrar");
    onDeleted();
  }

  return (
    <Card className="p-4 border-primary/30">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h4 className="font-medium text-sm">{initial ? "Editar insumo" : "Nuevo insumo"}</h4>
        <div>
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Queso mozzarella" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Unidad base</Label>
            <select
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="g">Peso (g)</option>
              <option value="ml">Volumen (ml)</option>
              <option value="u">Unidad</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Costo por {baseUnit} (sin IVA)</Label>
            <Input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="rounded-xl bg-muted/60 p-2.5 space-y-2">
          <p className="text-xs text-muted-foreground">Ayuda: precio de compra ÷ cantidad del envase</p>
          <div className="flex gap-1.5">
            <Input type="number" min={0} step="any" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="$ compra" />
            <Input type="number" min={0} step="any" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} placeholder={`Cant. (${baseUnit})`} />
            <Button type="button" variant="outline" size="sm" onClick={applyPurchaseHelper}>=</Button>
          </div>
        </div>
        <div>
          <Label className="text-xs">Tipo de insumo (autocompleta la merma)</Label>
          <select
            value={wasteType}
            onChange={(e) => {
              setWasteType(e.target.value);
              const p = WASTE_PRESETS.find((x) => x.value === e.target.value);
              if (p) setWaste(String(p.waste));
            }}
            className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="">Elegí para sugerir merma…</option>
            {WASTE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} ({p.waste}%)
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Merma %</Label>
            <Input type="number" min={0} max={99.99} step="any" value={waste} onChange={(e) => setWaste(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch checked={isElaborated} onCheckedChange={setIsElaborated} />
            <Label className="text-xs">Es elaborado 🧪<br /><span className="text-muted-foreground">(lleva sub-receta)</span></Label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          La merma real depende de tu proveedor y tu cocina: pesá bruto vs. neto alguna vez y ajustala.
        </p>
        <div>
          <Label className="text-xs">Notas (opcional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Proveedor, marca…" />
        </div>
        {initial && <PriceHistory ingredientId={initial.id} baseUnit={initial.base_unit} />}
        {initial && (
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} />
            <Label className="text-xs">Activo</Label>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear insumo"}
          </Button>
          {initial && (
            <Button type="button" variant="outline" onClick={handleDelete} disabled={saving} className="text-red-600">
              Borrar
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Compras: formulario de carga rápida (proveedor + líneas con costo neto).
// Al guardar, cada insumo actualiza su costo al ÚLTIMO precio (la API).
// ---------------------------------------------------------------------------
type BuyLine = { key: number; ingredient_id: string; qty: string; unit: string; unit_cost: string; total_paid: string };

function PurchaseForm({
  suppliers,
  ingredients,
  onSupplierCreated,
  onDone,
  onCancel,
}: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  onSupplierCreated: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptType, setReceiptType] = useState("ninguno");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BuyLine[]>([
    { key: 0, ingredient_id: "", qty: "", unit: "g", unit_cost: "", total_paid: "" },
  ]);
  const [keySeq, setKeySeq] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  function patchLine(key: number, patch: Partial<BuyLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickIngredient(key: number, ingredientId: string) {
    const ing = ingMap.get(ingredientId);
    patchLine(key, { ingredient_id: ingredientId, unit: ing ? ing.base_unit : "g" });
  }

  // Ayuda estilo Fudo: total pagado ÷ cantidad → costo por unidad de línea.
  function applyTotalHelper(key: number) {
    const l = lines.find((x) => x.key === key);
    if (!l) return;
    const t = Number(l.total_paid);
    const q = Number(l.qty);
    if (t > 0 && q > 0) patchLine(key, { unit_cost: String(Math.round((t / q) * 10000) / 10000) });
  }

  const preview = lines.map((l) => {
    const ing = ingMap.get(l.ingredient_id);
    const f = ing ? unitFactor(l.unit, ing.base_unit) : null;
    const qty = Number(l.qty) || 0;
    const unitCost = Number(l.unit_cost) || 0;
    return {
      ing,
      factor: f,
      badUnit: !!ing && f === null,
      // Costo neto resultante por unidad BASE (es lo que pisa el costo actual).
      unitNet: f ? unitCost / f : 0,
      lineTotal: qty * unitCost,
    };
  });
  const grand = preview.reduce((s, p) => s + (isFinite(p.lineTotal) ? p.lineTotal : 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    let sid: string | null = supplierId || null;
    if (!sid && newSupplier.trim()) {
      const res = await fetch("/api/vendor/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSupplier.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error || "No se pudo crear el proveedor");
      sid = data.supplier.id;
      onSupplierCreated();
    }
    const clean = lines.filter(
      (l) => l.ingredient_id && Number(l.qty) > 0 && l.unit_cost !== "" && Number(l.unit_cost) >= 0
    );
    if (clean.length === 0) return setError("Agregá al menos una línea con cantidad y costo");
    if (preview.some((p) => p.badUnit)) return setError("Hay líneas con unidad incompatible");
    setSaving(true);
    const r = await apiJson("/api/vendor/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_id: sid,
        purchased_at: date || undefined,
        receipt_type: receiptType,
        receipt_number: receiptNumber.trim() || null,
        notes: notes.trim() || null,
        items: clean.map((l) => ({
          ingredient_id: l.ingredient_id,
          qty: Number(l.qty),
          unit: l.unit,
          unit_cost: Number(l.unit_cost),
        })),
      }),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onDone();
  }

  return (
    <Card className="p-4 border-primary/30">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h4 className="font-medium text-sm">Nueva compra</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Proveedor</Label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">Sin proveedor</option>
              {suppliers
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">O crear proveedor</Label>
            <Input
              value={newSupplier}
              onChange={(e) => setNewSupplier(e.target.value)}
              placeholder="Nombre del nuevo…"
              disabled={!!supplierId}
            />
          </div>
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Comprobante</Label>
            <select
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              {RECEIPT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">N° comprobante (opcional)</Label>
            <Input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="0001-…" />
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="…" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Mercadería (costos netos, sin IVA)</Label>
          {lines.map((l, idx) => {
            const ing = ingMap.get(l.ingredient_id);
            const units = ing
              ? LINE_UNITS[ing.base_unit as IngredientUnit] ?? [ing.base_unit]
              : ["mg", "g", "kg", "ml", "cl", "l", "u", "doc"];
            const pv = preview[idx];
            return (
              <div key={l.key} className="rounded-xl border border-border p-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <select
                    value={l.ingredient_id}
                    onChange={(e) => pickIngredient(l.key, e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm"
                  >
                    <option value="">Elegí insumo…</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} (actual ${Number(i.cost_per_unit).toLocaleString("es-AR")}/{i.base_unit})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
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
                    type="number" min={0} step="any" placeholder="Cantidad"
                    value={l.qty} onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                    className="flex-1"
                  />
                  <select
                    value={l.unit}
                    onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                    className="w-20 rounded-lg border border-input bg-background px-1 py-2 text-sm"
                  >
                    {units.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  <Input
                    type="number" min={0} step="any" placeholder={`Costo x ${l.unit}`}
                    value={l.unit_cost} onChange={(e) => patchLine(l.key, { unit_cost: e.target.value })}
                    className="flex-1"
                    title={`Costo neto por ${l.unit}`}
                  />
                </div>
                <div className="flex gap-1.5 items-center">
                  <Input
                    type="number" min={0} step="any" placeholder="Total pagado (ayuda)"
                    value={l.total_paid} onChange={(e) => patchLine(l.key, { total_paid: e.target.value })}
                    className="flex-1 h-8 text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => applyTotalHelper(l.key)} title="Total ÷ cantidad → costo">=</Button>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                    = {formatMoney(isFinite(pv.lineTotal) ? pv.lineTotal : 0)}
                  </span>
                </div>
                {pv.badUnit && (
                  <p className="text-xs text-red-600">Unidad incompatible con “{ing!.base_unit}”.</p>
                )}
                {ing && pv.factor !== null && l.unit_cost !== "" && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    → {formatMoney(pv.unitNet)}/{ing.base_unit} (pisa el actual {formatMoney(Number(ing.cost_per_unit))}/{ing.base_unit})
                  </p>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((prev) => [...prev, { key: keySeq, ingredient_id: "", qty: "", unit: "g", unit_cost: "", total_paid: "" }]);
              setKeySeq((k) => k + 1);
            }}
          >
            + Línea
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
          <span className="text-sm text-muted-foreground">Total compra</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(grand)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Al guardar, el costo de cada insumo se actualiza al último precio y los platos se recalculan solos.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "Guardando…" : "Guardar compra"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Compras: lista + detalle + borrado (con reversión) + proveedores.
// ---------------------------------------------------------------------------
type PurchaseRow = {
  id: string;
  purchased_at: string;
  receipt_type: string;
  receipt_number: string | null;
  notes: string | null;
  total: number;
  supplier_id: string | null;
  supplier_name: string | null;
  items_count: number;
};

type PurchaseDetail = {
  purchase: PurchaseRow;
  items: {
    id: string;
    ingredient_id: string;
    qty: number;
    unit: string;
    unit_cost_net: number;
    line_total: number;
    ingredient_name: string;
    ingredient_unit: string;
  }[];
};

function SupplierForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Supplier | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Indicá el nombre");
    setSaving(true);
    const payload = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null };
    const r = initial
      ? await apiJson(`/api/vendor/suppliers/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await apiJson("/api/vendor/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onDone();
  }

  return (
    <Card className="p-3 border-primary/30">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <div className="flex-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Distribuidora Sur" />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Teléfono</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="221…" />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Email (opcional)</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="…" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "…" : "Guardar"}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>✕</Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Card>
  );
}

function PurchasesManager({
  ingredients,
  search,
  onChanged,
}: {
  ingredients: Ingredient[];
  search: string;
  onChanged: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [msg, setMsg] = useState("");

  const loadAll = useCallback(async () => {
    const [s, p] = await Promise.all([
      getJson<{ suppliers: Supplier[] }>("/api/vendor/suppliers"),
      getJson<{ purchases: PurchaseRow[] }>("/api/vendor/purchases"),
    ]);
    if (s?.suppliers) setSuppliers(s.suppliers);
    if (p?.purchases) setPurchases(p.purchases);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(
      (p) =>
        (p.supplier_name || "").toLowerCase().includes(q) ||
        (p.receipt_number || "").toLowerCase().includes(q)
    );
  }, [purchases, search]);

  function fmtDate(iso: string) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  async function openDetail(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    const d = await getJson<PurchaseDetail>(`/api/vendor/purchases/${id}`);
    if (d) {
      setDetail(d);
      setExpanded(id);
    }
  }

  async function deletePurchase(id: string) {
    if (!window.confirm("¿Borrar esta compra? Los costos vuelven al precio de la compra anterior.")) return;
    const r = await apiJson(`/api/vendor/purchases/${id}`, { method: "DELETE" });
    if (!r.ok) return setMsg(r.error || "No se pudo borrar");
    setMsg("Compra borrada y costos revertidos ✅");
    setExpanded(null);
    await loadAll();
    onChanged();
  }

  async function deleteSupplier(s: Supplier) {
    if (!window.confirm(`¿Borrar “${s.name}”?`)) return;
    const res = await fetch(`/api/vendor/suppliers/${s.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data?.error || "No se pudo borrar");
    setMsg(data?.archived ? `“${s.name}” archivado (tiene compras en el historial)` : "Proveedor borrado");
    await loadAll();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cerrar" : "+ Nueva compra"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowSuppliers((v) => !v)}>
          🏭 Proveedores ({suppliers.filter((s) => s.active).length})
        </Button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {showForm && (
        <PurchaseForm
          suppliers={suppliers}
          ingredients={ingredients}
          onSupplierCreated={loadAll}
          onDone={() => {
            setShowForm(false);
            setMsg("Compra guardada y costos actualizados ✅");
            loadAll();
            onChanged();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {showSuppliers && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Proveedores</p>
            <Button size="sm" variant="outline" onClick={() => setEditingSupplier("new")}>+ Proveedor</Button>
          </div>
          {editingSupplier && (
            <SupplierForm
              initial={editingSupplier === "new" ? null : editingSupplier}
              onDone={() => {
                setEditingSupplier(null);
                loadAll();
              }}
              onCancel={() => setEditingSupplier(null)}
            />
          )}
          {suppliers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-3">
              Todavía no hay proveedores. Creá el primero — o se crea solo al cargar una compra.
            </p>
          )}
          {suppliers.map((s) => (
            <div key={s.id} className={`flex items-center gap-2 rounded-xl border border-border p-2.5 ${!s.active ? "opacity-50" : ""}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{s.name}</span>
                {s.phone && <span className="block text-xs text-muted-foreground">{s.phone}</span>}
              </span>
              {!s.active && <Badge variant="secondary">Archivado</Badge>}
              <Button size="sm" variant="outline" onClick={() => setEditingSupplier(s)}>Editar</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteSupplier(s)}>Borrar</Button>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-3">
        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
          Historial de compras
        </p>
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Todavía no hay compras. Con la primera, los costos se actualizan solos.
            </p>
          )}
          {filtered.map((p) => (
            <div key={p.id} className="rounded-xl border border-border">
              <button
                onClick={() => openDetail(p.id)}
                className="w-full text-left p-2.5 flex items-center gap-2"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">
                    {p.supplier_name || "Sin proveedor"}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {fmtDate(p.purchased_at)} · {RECEIPT_TYPE_LABEL[p.receipt_type] || p.receipt_type}
                    {p.receipt_number ? ` ${p.receipt_number}` : ""} · {p.items_count} ítems
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums flex-shrink-0">
                  {formatMoney(Number(p.total))}
                </span>
                <span className="text-muted-foreground text-xs flex-shrink-0">{expanded === p.id ? "▲" : "▼"}</span>
              </button>
              {expanded === p.id && detail?.purchase.id === p.id && (
                <div className="border-t border-border px-2.5 py-2 space-y-1">
                  {detail.items.map((it) => (
                    <div key={it.id} className="flex justify-between gap-2 text-xs tabular-nums">
                      <span className="text-muted-foreground truncate">
                        {it.ingredient_name} · {Number(it.qty).toLocaleString("es-AR")} {it.unit} × {formatMoney(Number(it.unit_cost_net))}/{it.ingredient_unit}
                      </span>
                      <span className="font-medium flex-shrink-0">{formatMoney(Number(it.line_total))}</span>
                    </div>
                  ))}
                  {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                  <div className="pt-1">
                    <Button size="sm" variant="ghost" className="text-red-600 h-7 text-xs" onClick={() => deletePurchase(p.id)}>
                      Borrar compra (revierte costos)
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Cada compra actualiza el costo al último precio neto y deja historial. Borrar una compra revierte los costos a la compra anterior.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historial de precios de un insumo (variación en el tiempo).
// ---------------------------------------------------------------------------
type PricePoint = {
  purchased_at: string;
  receipt_type: string;
  supplier_name: string | null;
  qty: number;
  unit: string;
  unit_cost_net: number;
  line_total: number;
};

function PriceHistory({ ingredientId, baseUnit }: { ingredientId: string; baseUnit: string }) {
  const [history, setHistory] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    getJson<{ history: PricePoint[] }>(`/api/vendor/purchases/prices?ingredientId=${ingredientId}`).then(
      (d) => setHistory(d?.history ?? [])
    );
  }, [ingredientId]);

  if (!history || history.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin compras registradas todavía. Al cargar una compra, el costo se actualiza solo.
      </p>
    );
  }

  function fmtDate(iso: string) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}`;
  }

  return (
    <div className="rounded-xl bg-muted/60 p-2.5 space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Últimas compras</p>
      {history.slice(0, 5).map((h, i) => {
        const older = history[i + 1];
        const prev = older ? Number(older.unit_cost_net) : null;
        const cur = Number(h.unit_cost_net);
        const pct = prev ? ((cur - prev) / prev) * 100 : null;
        return (
          <div key={`${h.purchased_at}-${i}`} className="flex items-center justify-between gap-2 text-xs tabular-nums">
            <span className="text-muted-foreground truncate">
              {fmtDate(h.purchased_at)} · {h.supplier_name || "s/prov."} · {Number(h.qty).toLocaleString("es-AR")} {h.unit}
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-medium">{formatMoney(cur)}/{baseUnit}</span>
              {pct !== null && Math.abs(pct) >= 0.05 && (
                <Badge className={pct > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>
                  {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
                </Badge>
              )}
            </span>
          </div>
        );
      })}
    </div>
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null | "new">(null);
  const [selectedElaborated, setSelectedElaborated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, ing, c, r] = await Promise.all([
      getJson<{ offers: Product[] }>("/api/vendor/offers"),
      getJson<{ ingredients: Ingredient[] }>("/api/vendor/ingredients"),
      getJson<{ costs: CostSummary[] }>("/api/vendor/recipes/costs"),
      getJson<{ recipes: Recipe[]; items: RecipeItem[] }>("/api/vendor/recipes"),
    ]);
    if (o?.offers) setProducts(o.offers.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) || 0 })));
    if (ing?.ingredients) setIngredients(ing.ingredients);
    if (c?.costs) setCosts(c.costs);
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
                    onSaved={refreshAfterSave}
                    onDeleted={() => {
                      setSelectedProduct(null);
                      refreshAfterSave();
                    }}
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
                return (
                  <button
                    key={i.id}
                    onClick={() => {
                      setEditingIngredient(i);
                      setSelectedElaborated(i.is_elaborated ? i.id : null);
                    }}
                    className={`w-full text-left rounded-xl border p-2.5 flex items-center gap-2 transition-colors ${
                      editingIngredient !== "new" && (editingIngredient as Ingredient | null)?.id === i.id
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

      <p className="text-xs text-muted-foreground">
        Los costos se calculan sin IVA, con la merma de cada insumo aplicada. Semáforo food cost: 🟢 menos de 30% · 🟡 30–35% · 🔴 más de 35%.
      </p>
    </div>
  );
}
