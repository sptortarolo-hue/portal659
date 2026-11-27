"use client";

/**
 * Sección "📦 Empaque" del editor de productos.
 * Se pasa al OfferForm como `packagingSection` (ver menu-studio.tsx) para no
 * acoplar el formulario compartido con la API de empaque.
 *
 * Con default de categoría: switch "Usar empaque por defecto de X". Si se
 * apaga, aparecen las líneas para el override del producto (patrón Dots).
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sumPackagingLines } from "@/lib/product-packaging";

export type PackagingCatalogItem = {
  id: string;
  name: string;
  base_unit: string | null;
  unit_cost: number;
  stock: number | null;
  is_packaging: boolean;
};

export type PackagingDraftLine = {
  ingredient_id: string;
  qty: number;
  name: string;
  unit_cost: number;
  base_unit?: string | null;
};

type Props = {
  mode: string;
  enabled: boolean;
  lines: PackagingDraftLine[];
  catalog: PackagingCatalogItem[];
  onEnabled: (v: boolean) => void;
  onLines: (lines: PackagingDraftLine[]) => void;
  onMode: (mode: string) => void;
  disabled?: boolean;
  productCost?: number | null;
  /** Default configurado en Catálogo → Categorías para la categoría del producto. */
  categoryName?: string | null;
  hasCategoryDefault?: boolean;
  categoryLines?: PackagingDraftLine[];
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

export function ProductPackagingSection({
  mode,
  enabled,
  lines,
  catalog,
  onEnabled,
  onLines,
  onMode,
  disabled,
  productCost,
  categoryName,
  hasCategoryDefault,
  categoryLines = [],
}: Props) {
  if (mode === "in_recipe") {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/30 dark:border-amber-800">
        <p className="text-sm font-medium">📦 Empaque incluido en el lote de envasado</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          El costo de la bolsa y la etiqueta ya está dentro del lote, así que no se suma dos veces.
        </p>
        {!disabled && (
          <button
            type="button"
            onClick={() => { onMode("simple"); onEnabled(true); }}
            className="mt-2 text-xs underline underline-offset-2 text-primary"
          >
            Cambiar a empaque cargado a mano
          </button>
        )}
      </div>
    );
  }

  const total = sumPackagingLines(mode === "category" ? categoryLines : lines);

  function changeLine(index: number, patch: Partial<PackagingDraftLine>) {
    onLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    const first = catalog.find((c) => !lines.some((l) => l.ingredient_id === c.id));
    if (!first) return;
    onLines([...lines, {
      ingredient_id: first.id, qty: 1, name: first.name,
      unit_cost: first.unit_cost, base_unit: first.base_unit,
    }]);
  }

  function useDefault(v: boolean) {
    if (v) {
      onMode("category");
      onEnabled(true);
    } else {
      onMode("simple");
      onEnabled(true);
      if (lines.length === 0 && categoryLines.length > 0) onLines(categoryLines.map((l) => ({ ...l })));
    }
  }

  function linesEditor() {
    if (catalog.length === 0) {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2.5">
          <p className="text-xs text-muted-foreground flex-1 min-w-[160px]">
            Primero cargá bolsas o etiquetas como <strong>insumos</strong> (unidad <code>u</code>).
          </p>
          <Link href="/vendor/dashboard?tab=recetas&insumos=1" target="_blank" rel="noopener noreferrer">
            <Button type="button" size="sm" variant="outline">Ir a Insumos ↗</Button>
          </Link>
        </div>
      );
    }
    return (
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
              disabled={disabled}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
            >
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.is_packaging ? "📦 " : ""}{c.name} — {money(c.unit_cost)}/{c.base_unit === "u" ? "u" : c.base_unit || "u"}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={0.001}
              step="any"
              value={String(l.qty)}
              onChange={(e) => changeLine(i, { qty: Number(e.target.value) })}
              disabled={disabled}
              className="w-16 px-2 text-xs"
              aria-label="Cantidad de empaque"
            />
            <button
              type="button"
              onClick={() => onLines(lines.filter((_, j) => j !== i))}
              disabled={disabled}
              className="text-xs text-muted-foreground hover:text-destructive px-1"
              aria-label="Quitar empaque"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          disabled={disabled || lines.length >= catalog.length}
          className="text-xs text-primary underline underline-offset-2 disabled:opacity-40"
        >
          + Agregar otro empaque
        </button>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-2.5">
      {hasCategoryDefault ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Usar empaque de {categoryName || "la categoría"}</Label>
            <p className="text-xs text-muted-foreground">
              Se carga una sola vez en Catálogo → Categorías. Podés cambiarlo solo en este producto.
            </p>
          </div>
          <Switch checked={mode === "category"} onCheckedChange={useDefault} disabled={disabled} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">📦 Este producto usa empaque</Label>
            <p className="text-xs text-muted-foreground">
              Bolsa, etiqueta o contenedor. Se suma al costo del producto.
            </p>
          </div>
          <Switch
            checked={mode === "simple"}
            onCheckedChange={(v) => {
              onMode(v ? "simple" : "none");
              onEnabled(v);
              if (v && lines.length === 0 && catalog.length > 0) {
                const first = catalog[0];
                onLines([{ ingredient_id: first.id, qty: 1, name: first.name, unit_cost: first.unit_cost, base_unit: first.base_unit }]);
              }
            }}
            disabled={disabled}
          />
        </div>
      )}

      {mode === "category" && (
        <div className="rounded-lg bg-muted/50 p-2.5 text-xs space-y-1">
          {categoryLines.length > 0 ? (
            categoryLines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{l.name}</span>
                <span className="tabular-nums shrink-0">
                  {l.qty !== 1 ? `${l.qty}× ` : ""}{money(l.unit_cost)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">La categoría no tiene empaque cargado.</p>
          )}
          <p className="text-muted-foreground pt-1 border-t border-border">
            Para cambiarlo para todos, andá a Catálogo → Categorías.
          </p>
        </div>
      )}

      {mode === "simple" && linesEditor()}

      {mode === "none" && hasCategoryDefault && !disabled && (
        <button
          type="button"
          onClick={() => useDefault(true)}
          className="text-xs text-primary underline underline-offset-2"
        >
          Usar el empaque de {categoryName || "la categoría"}
        </button>
      )}

      {(mode === "simple" || mode === "category") && (
        <>
          <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">Costo del empaque</span>
            <strong className="tabular-nums">{money(total)}</strong>
          </div>
          {productCost != null && productCost > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Costo total (producto + empaque)</span>
              <strong className="tabular-nums">{money(Number(productCost) + total)}</strong>
            </div>
          )}
        </>
      )}
    </div>
  );
}
