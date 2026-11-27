"use client";

/**
 * Empaque por defecto de una categoría: se carga UNA vez y lo heredan todos
 * los productos de esa categoría (patrón Dots / InnoBooks).
 * Los productos pueden salirse con el override del editor de producto.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getJson } from "@/components/dashboard/shared";
import {
  categoryKey,
  sumPackagingLines,
  type PackagingLineInput,
} from "@/lib/product-packaging";
import type { PackagingCatalogItem, PackagingDraftLine } from "@/components/dashboard/product-packaging-section";

type DefaultRow = {
  id: string;
  category_key: string;
  category: string | null;
  lines: PackagingDraftLine[];
};

type Props = {
  categories: { id: string; name: string }[];
  onChange?: () => void;
  /** Cambia para forzar la recarga al abrir el modal. */
  refreshKey?: string | number;
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

export function CategoryPackagingManager({ categories, onChange, refreshKey }: Props) {
  const [catalog, setCatalog] = useState<PackagingCatalogItem[]>([]);
  const [defaults, setDefaults] = useState<DefaultRow[]>([]);
  const [active, setActive] = useState("");
  const [lines, setLines] = useState<PackagingDraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const d = await getJson<{
      ingredients?: PackagingCatalogItem[];
      defaults?: DefaultRow[];
    }>("/api/vendor/product-packaging").catch(() => null);
    setCatalog(d?.ingredients || []);
    setDefaults(d?.defaults || []);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // La DB puede tener categorías repetidas (o con distinto id): se muestran
  // una sola vez por nombre normalizado, igual que la clave del default.
  const uniqueCategories = useMemo(() => {
    const seen = new Set<string>();
    return categories.filter((c) => {
      const k = categoryKey(c.name);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [categories]);

  const currentCategory = uniqueCategories.find((c) => c.id === active) || null;
  const hasDefault = (name: string) => defaults.some((d) => d.category_key === categoryKey(name));

  function selectCategory(id: string) {
    setActive(id);
    setMsg("");
    const cat = uniqueCategories.find((c) => c.id === id);
    const def = cat ? defaults.find((d) => d.category_key === categoryKey(cat.name)) : null;
    setLines((def?.lines || []).map((l) => ({ ...l })));
  }

  function changeLine(index: number, patch: Partial<PackagingDraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    const first = catalog.find((c) => !lines.some((l) => l.ingredient_id === c.id));
    if (!first) return;
    setLines([...lines, {
      ingredient_id: first.id, qty: 1, name: first.name,
      unit_cost: first.unit_cost, base_unit: first.base_unit,
    }]);
  }

  async function save(remove: boolean) {
    if (!currentCategory) return;
    setBusy(true); setMsg("");
    try {
      const payloadLines: PackagingLineInput[] = remove ? [] : lines.map((l) => ({
        ingredient_id: l.ingredient_id, qty: l.qty,
      }));
      const res = await fetch("/api/vendor/product-packaging/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: currentCategory.name, lines: payloadLines, remove }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d?.error || "No se pudo guardar");
      setMsg(remove ? "Default quitado." : "Empaque por defecto guardado. Ya aplica a todos los productos de la categoría.");
      if (remove) setLines([]);
      await load();
      onChange?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">📦 Empaque por defecto por categoría</p>
        <p className="text-xs text-muted-foreground">
          Cargalo una vez y lo heredan todos los productos de esa categoría. Los productos que lo cambian
          en su editor tienen prioridad.
        </p>
      </div>

      {uniqueCategories.length === 0 ? (
        <p className="text-xs text-muted-foreground">Creá una categoría primero.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {uniqueCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCategory(c.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active === c.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {hasDefault(c.name) ? "📦 " : ""}{c.name}
              </button>
            ))}
          </div>

          {currentCategory && (
            <div className="rounded-lg bg-muted/40 p-3 space-y-2">
              <p className="text-xs font-medium">
                {currentCategory.name}
                {hasDefault(currentCategory.name) && (
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">con default cargado</span>
                )}
              </p>
              {catalog.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Cargá primero bolsas/etiquetas como insumos (unidad <code>u</code>) en Preparación y Costo → Insumos.
                </p>
              ) : (
                <>
                  {lines.map((l, i) => (
                    <div key={`${l.ingredient_id}-${i}`} className="flex items-center gap-2">
                      <select
                        value={l.ingredient_id}
                        onChange={(e) => {
                          const item = catalog.find((c) => c.id === e.target.value);
                          if (item) changeLine(i, {
                            ingredient_id: item.id, name: item.name,
                            unit_cost: item.unit_cost, base_unit: item.base_unit,
                          });
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                      >
                        {catalog.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.is_packaging ? "📦 " : ""}{c.name} — {money(c.unit_cost)}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min={0.001}
                        step="any"
                        value={String(l.qty)}
                        onChange={(e) => changeLine(i, { qty: Number(e.target.value) })}
                        className="w-16 px-2 text-xs"
                        aria-label="Cantidad"
                      />
                      <button
                        type="button"
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}
                        className="px-1 text-xs text-muted-foreground hover:text-destructive"
                        aria-label="Quitar"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={lines.length >= catalog.length}
                    className="text-xs text-primary underline underline-offset-2 disabled:opacity-40"
                  >
                    + Agregar empaque
                  </button>
                  <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                    <span className="text-muted-foreground">Costo del empaque</span>
                    <strong className="tabular-nums">{money(sumPackagingLines(lines))}</strong>
                  </div>
                </>
              )}
              {lines.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Agregá al menos un empaque con “+ Agregar empaque” para poder guardar.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => save(false)}
                  disabled={busy || catalog.length === 0 || lines.length === 0}
                >
                  {busy ? "Guardando…" : "Guardar default"}
                </Button>
                {hasDefault(currentCategory.name) && (
                  <Button type="button" size="sm" variant="outline" onClick={() => save(true)} disabled={busy}>
                    Quitar default
                  </Button>
                )}
              </div>
              {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
            </div>
          )}
          {!currentCategory && msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </>
      )}
    </div>
  );
}
