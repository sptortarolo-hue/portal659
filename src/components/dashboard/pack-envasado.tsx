"use client";

/**
 * Envasado (granel → paquetes) — solapa "🫙 Envasado" de Preparación y Costo.
 *
 * Flujo: elegís el producto envasado (unit kg, "cuento paquetes"), pesás
 * cada bolsa con la balanza (o a mano), cada bolsa se imprime con la etiqueta
 * "Envasado" y al Guardar lote el servidor descuenta insumos (granel por el
 * pesaje real + merma del escandallo, packaging por bolsa), suma el stock de
 * paquetes y recalcula el costo promedio del terminado.
 *
 * El servidor recalcula costos y valida stock; el cliente solo lista pesos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { getJson } from "@/components/dashboard/shared";
import { arISODate, fmtKg, fmtMoney, readLabelPrinterConfig } from "@/lib/label-spec";
import { unitFactor } from "@/lib/costing";
import {
  getCachedScalePort,
  isWebSerialSupported,
  requestScalePort,
  watchScale,
  type WatchHandle,
} from "@/lib/scale-reader";

export type EnvasadoProduct = {
  id: string;
  name: string;
  price?: number | string | null;
  promo_price?: number | string | null;
  cost_avg?: number | string | null;
  stock?: number | string | null;
  unit?: string | null;
  sku?: string | null;
  scale_plu?: string | null;
  expires_at?: string | null;
  /** undefined = la migración no está aplicada en el servidor */
  count_pack?: boolean;
};

type RecipeRow = { id: string; product_id: string | null; ingredient_id: string | null; portions: number };
type RecipeItemRow = { recipe_id: string; ingredient_id: string; qty_net: number; unit: string; position: number };
type IngredientRow = { id: string; base_unit: string; name: string };

type BatchRow = {
  id: string;
  units: number;
  total_kg: number | string;
  cost_total: number | string;
  cost_per_unit: number | string;
  created_at: string;
  product_name: string;
};
type BatchSummary = { units: number; total_kg: number; cost_total: number };

const SHELF_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "Sin vencimiento" },
  { days: 7, label: "+7 días" },
  { days: 15, label: "+15 días" },
  { days: 30, label: "+30 días" },
];

function parseKgInput(raw: string): number | null {
  if (!raw.trim()) return null;
  const v = Number(raw.replace(/[^0-9.,]/g, "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null;
}

function unitPriceOf(p: EnvasadoProduct): number {
  return Number(p.promo_price ?? p.price) || 0;
}

export function PackEnvasado() {
  const [vendor, setVendor] = useState<Record<string, any> | null>(null);
  const [products, setProducts] = useState<EnvasadoProduct[] | null>(null);
  const [recipes, setRecipes] = useState<{ recipes: RecipeRow[]; items: RecipeItemRow[] } | null>(null);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [links, setLinks] = useState<{ product_id: string; recipe_id: string }[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [bags, setBags] = useState<number[]>([]);
  const [kgLive, setKgLive] = useState<number | null>(null);
  const [kgManual, setKgManual] = useState("");
  const [autoPrint, setAutoPrint] = useState(true);
  const [autoSeal, setAutoSeal] = useState(false);
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(null);
  const [packedAt] = useState(() => arISODate());

  // Modo lote: "N bolsas de X g" sin balanza.
  const [batchCount, setBatchCount] = useState("10");
  const [batchWeight, setBatchWeight] = useState("");

  const [scaleState, setScaleState] = useState<"idle" | "connecting" | "watching" | "error">("idle");
  const [scaleMsg, setScaleMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ units: number; total_kg: number; cost_total: number; cost_per_unit: number; expires_at: string | null } | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [today, setToday] = useState<BatchSummary>({ units: 0, total_kg: 0, cost_total: 0 });
  const [batchesBusy, setBatchesBusy] = useState(false);

  const watchRef = useRef<WatchHandle | null>(null);
  const stableRef = useRef<number | null>(null);
  const stableSinceRef = useRef(0);
  const lastAutoRef = useRef<number | null>(null);

  const loadVendor = useCallback(async () => {
    const r = await getJson<{ vendor?: Record<string, any> }>("/api/vendor/me");
    if (r?.vendor) setVendor(r.vendor);
  }, []);
  const loadProducts = useCallback(async () => {
    const r = await getJson<{ offers?: EnvasadoProduct[] }>("/api/vendor/offers");
    const offers = Array.isArray(r?.offers) ? r!.offers : [];
    setProducts(offers);
    const rec = await getJson<{ recipes: RecipeRow[]; items: RecipeItemRow[] }>("/api/vendor/recipes");
    if (rec) setRecipes({ recipes: rec.recipes || [], items: rec.items || [] });
    const costs = await getJson<{ links?: { product_id: string; recipe_id: string }[] }>("/api/vendor/recipes/costs");
    if (costs?.links) setLinks(costs.links.map((l) => ({ product_id: l.product_id, recipe_id: l.recipe_id })));
    const ing = await getJson<{ ingredients: IngredientRow[] }>("/api/vendor/ingredients");
    if (ing) setIngredients(Array.isArray(ing.ingredients) ? ing.ingredients : []);
  }, []);
  const loadBatches = useCallback(async () => {
    setBatchesBusy(true);
    const r = await getJson<{ batches?: BatchRow[]; today?: BatchSummary }>("/api/vendor/elaborations");
    setBatchesBusy(false);
    if (!r) return; // 503 = falta migración; se muestra por otras vías
    setBatches(Array.isArray(r.batches) ? r.batches : []);
    if (r.today) setToday({
      units: Number(r.today.units) || 0,
      total_kg: Number(r.today.total_kg) || 0,
      cost_total: Number(r.today.cost_total) || 0,
    });
  }, []);

  useEffect(() => {
    loadVendor();
    loadProducts();
    loadBatches();
  }, [loadVendor, loadProducts, loadBatches]);

  // Productos con receta (cualquier unidad): son los envasables.
  const recipeByProduct = useMemo(() => {
    const map = new Map<string, RecipeRow>();
    for (const r of recipes?.recipes || []) {
      if (r.product_id) map.set(r.product_id, r);
    }
    // Productos asociados (heredan la receta de otro): product_recipe_links.
    for (const l of links) {
      const rec = (recipes?.recipes || []).find((r) => r.id === l.recipe_id);
      if (rec && !map.has(l.product_id)) map.set(l.product_id, rec);
    }
    return map;
  }, [recipes, links]);

  const isLinked = useCallback((productId: string) => links.some((l) => l.product_id === productId), [links]);

  const suggestedWeightKg = useCallback((productId: string): number | null => {
    const rec = recipeByProduct.get(productId);
    if (!rec) return null;
    const lines = (recipes?.items || []).filter((i) => i.recipe_id === rec.id);
    let totalKg = 0;
    let hasWeight = false;
    for (const l of lines) {
      const ing = ingredients.find((g) => g.id === l.ingredient_id);
      const base = ing?.base_unit || "g";
      const f = unitFactor(l.unit, base);
      if (f === null) continue;
      // Solo líneas de peso (g/kg/ml) aportan al peso nominal del paquete.
      const unit = String(l.unit || "").trim().toLowerCase();
      if (!["mg", "g", "kg", "ml", "l", "lt", "lts"].includes(unit)) continue;
      const baseQty = Number(l.qty_net) * f;
      const kg = base === "g" ? baseQty / 1000 : base === "ml" ? baseQty / 1000 : baseQty;
      totalKg += kg;
      hasWeight = true;
    }
    return hasWeight && totalKg > 0 ? Math.round(totalKg * 1000) / 1000 : null;
  }, [recipeByProduct, recipes, ingredients]);

  const envasables = useMemo(() => {
    if (!products) return null;
    return products.filter((p) => recipeByProduct.has(p.id));
  }, [products, recipeByProduct]);

  const migrationPending = products !== null && products.length > 0 && products.some((p) => p.count_pack === undefined);

  const filtered = useMemo(() => {
    const list = envasables ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.name} ${p.sku ?? ""} ${p.scale_plu ?? ""}`.toLowerCase().includes(q)
    );
  }, [envasables, query]);

  const selected = useMemo(
    () => (products ?? []).find((p) => p.id === selectedId) ?? null,
    [products, selectedId]
  );

  useEffect(() => {
    if (selected) {
      const w = suggestedWeightKg(selected.id);
      if (w != null) setBatchWeight(String(w));
    }
  }, [selected, suggestedWeightKg]);

  const totalKg = useMemo(() => bags.reduce((s, k) => s + k, 0), [bags]);
  const price = selected ? unitPriceOf(selected) : 0;
  const estTotal = bags.reduce((s, k) => s + k * price, 0);

  const effectiveKg = kgLive ?? parseKgInput(kgManual);
  const stopWatching = useCallback(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    setScaleState("idle");
  }, []);
  useEffect(() => () => stopWatching(), [stopWatching]);

  const maybeAutoSeal = useCallback(
    (kg: number | null) => {
      if (!autoSeal) return;
      const now = Date.now();
      if (kg == null || kg <= 0.02) {
        stableRef.current = null;
        lastAutoRef.current = null;
        return;
      }
      const rounded = Math.round(kg * 1000) / 1000;
      if (stableRef.current == null || Math.abs(rounded - stableRef.current) > 0.006) {
        stableRef.current = rounded;
        stableSinceRef.current = now;
        return;
      }
      if (now - stableSinceRef.current >= 1500 && lastAutoRef.current !== rounded) {
        lastAutoRef.current = rounded;
        setBags((prev) => [...prev, rounded]);
        if (autoPrint && selected) void printBag(rounded);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoSeal, autoPrint, selected]
  );

  const startWatching = useCallback(async () => {
    if (!isWebSerialSupported()) {
      setScaleState("error");
      setScaleMsg("Este navegador no soporta balanza directa (usá Chrome o Edge). Cargá los kilos a mano.");
      return;
    }
    setScaleState("connecting");
    setScaleMsg(null);
    try {
      let port = getCachedScalePort();
      if (!port) port = await requestScalePort();
      const handle = await watchScale(port, {
        vendorId: vendor?.id ?? null,
        onKg: (kg) => {
          setKgLive(kg);
          maybeAutoSeal(kg);
        },
        onError: (msg) => {
          setScaleState("error");
          setScaleMsg(msg);
        },
      });
      watchRef.current = handle;
      setScaleState("watching");
    } catch (e: any) {
      if (e?.name === "NotFoundError") {
        setScaleState("idle");
        return;
      }
      setScaleState("error");
      setScaleMsg(e?.message || "No se pudo abrir la balanza.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, maybeAutoSeal]);

  const printBag = useCallback(
    async (kg: number) => {
      if (!selected) return;
      try {
        const res = await fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "sticker",
            productId: selected.id,
            kg,
            copies: 1,
            template: "envasado",
            packedAt,
            shelfLifeDays,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!data?.ok) setError(data?.error || "No se pudo imprimir la etiqueta.");
      } catch {
        setError("No se pudo hablar con el servidor para imprimir.");
      }
    },
    [selected, packedAt, shelfLifeDays]
  );

  const sealCurrent = useCallback(() => {
    const kg = effectiveKg;
    if (!kg || kg <= 0) {
      setError("Poné el producto en la balanza o cargá los kilos a mano.");
      return;
    }
    if (!selected) {
      setError("Elegí el producto envasado.");
      return;
    }
    setBags((prev) => [...prev, Math.round(kg * 1000) / 1000]);
    setKgManual("");
    setError(null);
    if (autoPrint) void printBag(kg);
    stableRef.current = null;
    lastAutoRef.current = Math.round(kg * 1000) / 1000;
  }, [effectiveKg, selected, autoPrint, printBag]);

  async function saveBatch() {
    if (!selected) return;
    if (bags.length === 0) {
      setError("Pesá al menos una bolsa.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    let ok = false;
    let payload: { batch?: { units: number; total_kg: number; cost_total: number; cost_per_unit: number; expires_at?: string | null }; error?: string; missing?: { name: string; need: number; have: number | null; base_unit: string }[] } | null = null;
    try {
      const res = await fetch("/api/vendor/elaborations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: selected.id, bags, packedAt, shelfLifeDays }),
      });
      payload = await res.json().catch(() => null);
      ok = res.ok;
    } catch {
      payload = null;
    }
    setSaving(false);
    if (!ok || !payload) {
      const missing = payload?.missing;
      setError(
        missing?.length
          ? `Stock insuficiente: ${missing.map((m) => `${m.name} (faltan ${m.need} ${m.base_unit})`).join(", ")}`
          : payload?.error || "No se pudo guardar el lote."
      );
      return;
    }
    const b = payload.batch!;
    setResult({
      units: Number(b.units),
      total_kg: Number(b.total_kg),
      cost_total: Number(b.cost_total),
      cost_per_unit: Number(b.cost_per_unit),
      expires_at: b.expires_at ? String(b.expires_at) : null,
    });
    setBags([]);
    setNotice("Lote guardado: stock y costos actualizados.");
    await loadBatches();
    await loadProducts();
  }

  const cfg = useMemo(
    () => (vendor ? readLabelPrinterConfig((vendor as any)?.label_printer_config) : null),
    [vendor]
  );

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden w-full max-w-full">
      <Card className="p-3 border-primary/30 min-w-0 overflow-hidden">
        <p className="text-sm font-medium">🫙 Envasado: granel → paquetes</p>
        <p className="text-xs text-muted-foreground pt-1">
          Pesá cada bolsa con la balanza (peso real) o usá "Modo lote" para paquetes de peso fijo sin balanza. Al guardar el lote se descuenta
          el granel y el packaging, y se suma el stock de paquetes con el costo real.
        </p>
        {today.units > 0 && (
          <p className="text-xs text-muted-foreground pt-2 tabular-nums">
            Hoy: <strong>{today.units}</strong> paquetes · {fmtKg(today.total_kg)} · costo {fmtMoney(today.cost_total, 2)}
          </p>
        )}
      </Card>

      {migrationPending && (
        <Card className="p-3 border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Falta aplicar la migración</p>
          <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
            Corré <code>migrate-elaboration.sql</code> en el contenedor para habilitar el stock de insumos y los lotes de envasado.
          </p>
        </Card>
      )}

      {products !== null && !migrationPending && envasables && envasables.length === 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-sm font-medium">Todavía no hay productos con preparación.</p>
          <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
            <li>Creá el producto en el catálogo (por unidad para paquetes fijos, o por kilo para venta por peso).</li>
            <li>Cargale la receta en <strong>Preparación y Costo → Productos</strong>: granel + bolsa + etiqueta (el packaging va adentro del costo).</li>
            <li>Volvé acá y envasá el lote.</li>
          </ol>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Picker + balanza */}
        <Card className="p-3 space-y-3 min-w-0 overflow-hidden">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1">Producto a envasar</p>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, SKU o PLU…" />
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {(filtered ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedId(p.id); setResult(null); }}
                className={`w-full text-left rounded-xl border p-2 flex items-center gap-2 ${selectedId === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums truncate">
                    {fmtMoney(unitPriceOf(p), 0)}{String(p.unit) === "kg" ? "/kg" : " c/u"}
                    {p.scale_plu ? ` · PLU ${p.scale_plu}` : ""}
                    {p.stock != null ? ` · stock ${Number(p.stock)} ${String(p.unit) === "kg" ? "paq." : "u."}` : ""}
                    {suggestedWeightKg(p.id) != null ? ` · sug. ${fmtKg(suggestedWeightKg(p.id)!)} por bolsa` : ""}
                    {(p as any).expires_at ? ` · vence ${new Date(String((p as any).expires_at) + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}
                  </span>
                </span>
                {p.count_pack === true && <Badge variant="secondary">⚖️ kg</Badge>}
                {isLinked(p.id) && <Badge variant="secondary">🔗</Badge>}
              </button>
            ))}
            {filtered && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Ningún producto envasado coincide.</p>
            )}
          </div>

          {/* Presentaciones de la misma familia: acceso rápido para envasar otro tamaño */}
          {selectedId && (() => {
            const sel = (products || []).find((p) => p.id === selectedId);
            const rootId = (sel as any)?.parent_id || sel?.id;
            const siblings = (products || []).filter((p) =>
              (p as any).parent_id === rootId || p.id === rootId
            );
            if (siblings.length <= 1) return null;
            return (
              <div className="rounded-xl border border-border p-2 space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">Presentaciones de esta familia:</p>
                <div className="flex flex-wrap gap-1.5">
                  {siblings.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setSelectedId(s.id); setResult(null); }}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        s.id === selectedId
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {s.name}
                      {s.stock != null ? ` (${Number(s.stock)})` : ""}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="rounded-xl bg-muted/60 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">Balanza</p>
              <div className="flex items-center gap-2">
                {scaleState !== "watching" ? (
                  <Button type="button" variant="outline" size="sm" onClick={startWatching} disabled={scaleState === "connecting"}>
                    {scaleState === "connecting" ? "Conectando…" : "🔌 Conectar balanza"}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={stopWatching}>⏸ Dejar de pesar</Button>
                )}
              </div>
            </div>
            <p className="text-3xl font-display font-semibold tabular-nums text-center py-1">
              {kgLive != null ? fmtKg(kgLive) : "—"}
            </p>
            {scaleMsg && <p className="text-xs text-red-600">{scaleMsg}</p>}
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                value={kgManual}
                onChange={(e) => setKgManual(e.target.value)}
                placeholder="Kilos a mano (ej. 0,532)"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sealCurrent(); } }}
                className="flex-1 min-w-0"
              />
              <Button type="button" onClick={sealCurrent} className="flex-shrink-0">+ Sellar bolsa</Button>
            </div>
            <div className="flex items-center gap-4 flex-wrap pt-1">
              <div className="flex items-center gap-2">
                <Switch checked={autoSeal} onCheckedChange={setAutoSeal} id="autoseal" />
                <Label htmlFor="autoseal" className="text-xs">Sellar sola al pesar estable</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoPrint} onCheckedChange={setAutoPrint} id="autoprint" />
                <Label htmlFor="autoprint" className="text-xs">Imprimir etiqueta al sellar</Label>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs text-muted-foreground">Vence:</Label>
              {SHELF_OPTIONS.map((o) => (
                <button
                  key={String(o.days)}
                  onClick={() => setShelfLifeDays(o.days)}
                  className={`text-xs rounded-full px-2.5 py-1 border ${shelfLifeDays === o.days ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {cfg && !cfg.enabled && (
              <p className="text-[11px] text-amber-600">La impresora de etiquetas no está configurada (Config → Balanza → 🏷️). Las etiquetas se imprimen solo con “Imprimir”.</p>
            )}
          </div>
        </Card>

        {/* Bolsas + guardar */}
        <div className="space-y-3">
          <Card className="p-3 min-w-0 overflow-hidden">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">Modo lote (sin balanza)</p>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <Label className="text-xs">Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="flex-1 min-w-0">
                <Label className="text-xs">Peso por bolsa (kg)</Label>
                <Input
                  type="number"
                  min={0.001}
                  max={99}
                  step="any"
                  inputMode="decimal"
                  value={batchWeight}
                  onChange={(e) => setBatchWeight(e.target.value)}
                  placeholder={selected ? (suggestedWeightKg(selected.id) != null ? String(suggestedWeightKg(selected.id)) : "0,250") : "0,250"}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selected}
                onClick={() => {
                  const n = Math.max(1, Math.min(100, Math.floor(Number(batchCount) || 0)));
                  const w = parseKgInput(batchWeight || String(suggestedWeightKg(selected!.id) ?? ""));
                  if (!w || w <= 0) {
                    setError("Indicá el peso por bolsa (ej. 0,250).");
                    return;
                  }
                  setBags((prev) => [...prev, ...Array.from({ length: n }, () => w)]);
                  setError(null);
                  if (autoPrint) {
                    for (let i = 0; i < n; i++) void printBag(w);
                  }
                }}
                className="flex-shrink-0"
              >
                Generar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1.5">
              Pre-llena el peso de la receta; editá cada bolsa si alguna salió distinta. Cada bolsa = 1 paquete y se imprime si "Imprimir al sellar" está activo.
            </p>
          </Card>

          <Card className="p-3 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Bolsas del lote ({bags.length})</p>
              {bags.length > 0 && (
                <button className="text-xs text-red-600" onClick={() => setBags([])}>Vaciar</button>
              )}
            </div>
            {bags.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                Las bolsas selladas aparecen acá. Cada bolsa = 1 paquete.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {bags.map((kg, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <span className="text-xs text-muted-foreground w-6 flex-shrink-0">#{i + 1}</span>
                    <span className="flex-1 min-w-0 tabular-nums">{fmtKg(kg)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">{fmtMoney(kg * price, 2)}</span>
                    <button className="text-muted-foreground hover:text-red-600 px-1" aria-label="Quitar bolsa" onClick={() => setBags((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border mt-2 pt-2 px-1 text-sm">
              <span>Total: <strong className="tabular-nums">{fmtKg(totalKg)}</strong> · <strong className="tabular-nums">{bags.length} paquetes</strong></span>
              <span className="tabular-nums text-muted-foreground">≈ {fmtMoney(estTotal, 0)}</span>
            </div>
            {result && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 mt-2 text-xs space-y-0.5">
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">✅ Lote guardado</p>
                <p>{result.units} paquetes · {fmtKg(result.total_kg)} · costo del lote {fmtMoney(result.cost_total, 2)} ({fmtMoney(result.cost_per_unit, 2)} c/u)</p>
                {result.expires_at && <p>Vence: {new Date(result.expires_at + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>}
              </div>
            )}
            {error && <p className="text-xs text-red-600 pt-2">{error}</p>}
            {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400 pt-2">{notice}</p>}
            <Button className="w-full mt-2" onClick={saveBatch} disabled={saving || bags.length === 0 || !selected}>
              {saving ? "Guardando lote…" : "💾 Guardar lote y descontar stock"}
            </Button>
          </Card>

          {/* Últimos lotes */}
          {batches.length > 0 && (
            <Card className="p-3">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
                Últimos lotes {batchesBusy ? "…" : ""}
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {batches.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center gap-2 text-xs px-1 py-1">
                    <span className="flex-1 min-w-0 truncate">{b.product_name}</span>
                    <span className="tabular-nums text-muted-foreground">{b.units} paq · {fmtKg(Number(b.total_kg))}</span>
                    <span className="tabular-nums text-muted-foreground">{new Date(b.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
