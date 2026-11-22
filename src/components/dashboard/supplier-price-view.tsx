"use client";

/**
 * 💲 Costos y precios por proveedor (Inventario).
 *
 * Gestor del catálogo completo: productos + variantes + insumos. Muestra, por
 * target, el mejor precio cargado por proveedor y el costo actual, y permite
 * aplicar ese precio como costo (`cost_last`/`cost_per_unit`) con un toque.
 *
 * El circuito estaba muerto: las compras ya guardaban `supplier_pricelists`,
 * pero ninguna pantalla lo leía. Con esto el margen real de Analytics se
 * activa sin tipear costos a mano.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiJson, getJson } from "@/components/dashboard/shared";

type PriceRow = {
  id: string;
  supplier_id: string;
  supplier_name: string | null;
  product_id: string | null;
  variant_id: string | null;
  ingredient_id: string | null;
  price: number;
  unit: string | null;
  updated_at: string;
  product_name?: string | null;
  variant_color?: string | null;
  variant_talle?: string | null;
  ingredient_name?: string | null;
  cost_current?: number | null;
};

type Supplier = { id: string; name: string };

type Product = { id: string; name: string; cost_last?: number | null; supplier_id?: string | null };
type Variant = { id: string; product_id: string; color: string; talle: string; price: number; stock: number; cost_last?: number | null };
type Ingredient = { id: string; name: string; cost_per_unit?: number | null; base_unit?: string | null; active?: boolean | null };

type Group = {
  key: string;
  kind: "product" | "variant" | "ingredient";
  id: string;
  name: string;
  bestPrice: number | null;
  bestSupplier: string | null;
  bestSupplierId: string | null;
  costCurrent: number | null;
  supplierId: string | null;
  supplierName: string | null;
  rows: PriceRow[];
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

function groupKeyOf(r: PriceRow): string {
  if (r.variant_id) return `v:${r.variant_id}`;
  if (r.ingredient_id) return `i:${r.ingredient_id}`;
  return `p:${r.product_id ?? r.id}`;
}

export function SupplierPriceView({ products, variants }: { products: Product[]; variants: Variant[] }) {
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [onlyNoCost, setOnlyNoCost] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inheritVariants, setInheritVariants] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editCost, setEditCost] = useState<Record<string, string>>({});
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});
  const [newPrice, setNewPrice] = useState<Record<string, { supplierId: string; price: string }>>({});

  const load = useCallback(async () => {
    try {
      const [pr, ing, sup] = await Promise.all([
        fetch("/api/vendor/pricelists", { cache: "no-store" }).then((r) => r.json().catch(() => ({}))),
        getJson<{ ingredients?: Ingredient[] }>("/api/vendor/ingredients").catch(() => null),
        getJson<{ suppliers?: Supplier[] }>("/api/vendor/suppliers").catch(() => null),
      ]);
      if (!pr?.ok) {
        setError(pr?.error || "No se pudieron cargar los precios");
        return;
      }
      setRows((pr.pricelists as PriceRow[]) ?? []);
      setIngredients(ing?.ingredients ?? []);
      setSuppliers(sup?.suppliers ?? []);
      setError(null);
    } catch {
      setError("No se pudieron cargar los precios");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.name);
    return m;
  }, [products]);

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();

    // 1) pricelist rows (targets que ya tienen precio de proveedor)
    for (const r of rows ?? []) {
      const key = groupKeyOf(r);
      let g = byKey.get(key);
      if (!g) {
        const name =
          r.variant_id
            ? `${r.product_name ?? "Variante"}${[r.variant_color, r.variant_talle].filter(Boolean).length ? ` (${[r.variant_color, r.variant_talle].filter(Boolean).join(" · ")})` : ""}`
            : r.ingredient_id
              ? String(r.ingredient_name ?? "Insumo")
              : String(r.product_name ?? "Producto");
        const label = r.variant_id ? [r.variant_color, r.variant_talle].filter(Boolean).join(" · ") || null : null;
        g = {
          key,
          kind: r.variant_id ? "variant" : r.ingredient_id ? "ingredient" : "product",
          id: r.variant_id ?? r.ingredient_id ?? r.product_id ?? "",
          name,
          bestPrice: null,
          bestSupplier: null,
          bestSupplierId: null,
          costCurrent: r.cost_current != null ? Number(r.cost_current) : null,
          supplierId: null,
          supplierName: null,
          rows: [],
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
      if (g.costCurrent == null && r.cost_current != null) g.costCurrent = Number(r.cost_current);
    }

    // 2) catálogo completo: productos sin fila de pricelist igual aparecen
    for (const p of products) {
      const key = `p:${p.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          kind: "product",
          id: p.id,
          name: String(p.name || "Producto"),
          bestPrice: null,
          bestSupplier: null,
          bestSupplierId: null,
          costCurrent: p.cost_last != null ? Number(p.cost_last) : null,
          supplierId: p.supplier_id != null ? String(p.supplier_id) : null,
          supplierName: p.supplier_id != null ? (supplierById.get(String(p.supplier_id)) ?? null) : null,
          rows: [],
        });
      } else {
        const g = byKey.get(key)!;
        if (g.costCurrent == null && p.cost_last != null) g.costCurrent = Number(p.cost_last);
        if (!g.supplierId && p.supplier_id != null) {
          g.supplierId = String(p.supplier_id);
          g.supplierName = supplierById.get(String(p.supplier_id)) ?? null;
        }
      }
    }
    for (const v of variants) {
      const key = `v:${v.id}`;
      if (!byKey.has(key)) {
        const pname = productNameById.get(v.product_id) ?? "Variante";
        byKey.set(key, {
          key,
          kind: "variant",
          id: v.id,
          name: `${pname} (${[v.color, v.talle].filter(Boolean).join(" · ") || "variante"})`,
          bestPrice: null,
          bestSupplier: null,
          bestSupplierId: null,
          costCurrent: v.cost_last != null ? Number(v.cost_last) : null,
          supplierId: null,
          supplierName: null,
          rows: [],
        });
      } else {
        const g = byKey.get(key)!;
        if (g.costCurrent == null && v.cost_last != null) g.costCurrent = Number(v.cost_last);
      }
    }
    for (const ing of ingredients) {
      const key = `i:${ing.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          kind: "ingredient",
          id: ing.id,
          name: String(ing.name || "Insumo"),
          bestPrice: null,
          bestSupplier: null,
          bestSupplierId: null,
          costCurrent: ing.cost_per_unit != null ? Number(ing.cost_per_unit) : null,
          supplierId: null,
          supplierName: null,
          rows: [],
        });
      }
    }

    const out = [...byKey.values()];
    for (const g of out) {
      const sorted = [...g.rows].sort((a, b) => Number(a.price) - Number(b.price));
      g.rows = sorted;
      if (sorted.length > 0) {
        g.bestPrice = Number(sorted[0].price);
        g.bestSupplier = sorted[0].supplier_name;
        g.bestSupplierId = sorted[0].supplier_id;
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [rows, products, variants, ingredients, supplierById, productNameById]);

  const supplierNames = useMemo(
    () => [...new Set(groups.flatMap((g) => g.rows.map((r) => r.supplier_name).filter((s): s is string => Boolean(s))))].sort(),
    [groups]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (supplierFilter && !g.rows.some((r) => r.supplier_name === supplierFilter)) return false;
      if (onlyNoCost && g.costCurrent != null) return false;
      return true;
    });
  }, [groups, search, supplierFilter, onlyNoCost]);

  async function applyTarget(g: Group) {
    setBusyKey(g.key);
    setMsg(null);
    try {
      const res = await fetch("/api/vendor/pricelists/apply-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: [{ kind: g.kind, id: g.id, inherit_variants: false }],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setMsg(d.error || "No se pudo aplicar el costo");
        return;
      }
      setMsg(
        d.applied > 0
          ? `✅ Costo aplicado a ${g.name}.` +
            (d.affectedLists?.length ? " Hay listas de margen para revisar en Catálogo → Listas." : "")
          : "Ese objetivo no tiene precio cargado."
      );
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function applyAll() {
    setAllBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/vendor/pricelists/apply-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, inherit_variants: inheritVariants }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setMsg(d.error || "No se pudieron aplicar los costos");
        return;
      }
      setMsg(
        d.applied > 0
          ? `✅ Costo aplicado a ${d.applied} ${d.applied === 1 ? "target" : "targets"}.` +
            `${d.skippedNoPrice > 0 ? ` ${d.skippedNoPrice} sin precio cargado.` : ""}` +
            (d.affectedLists?.length ? ` Hay ${d.affectedLists.length} lista(s) de margen con costos nuevos: recalculalas en Catálogo → Listas.` : "")
          : "Ningún target tiene precio cargado todavía."
      );
      await load();
    } finally {
      setAllBusy(false);
    }
  }

  async function saveCost(g: Group) {
    const value = editCost[g.key];
    const cost = value === "" ? null : Number(String(value).replace(",", "."));
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return;
    setBusyKey(`cost:${g.key}`);
    setMsg(null);
    try {
      const res = await apiJson("/api/vendor/costs", {
        method: "POST",
        body: JSON.stringify({ targets: [{ kind: g.kind, id: g.id, cost }] }),
      });
      if (!res.ok) {
        setMsg(res.error || "No se pudo guardar el costo");
        return;
      }
      setMsg(`✅ Costo de ${g.name} actualizado.`);
      setEditCost((s) => {
        const n = { ...s };
        delete n[g.key];
        return n;
      });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function useCostAsSupplierPrice(g: Group) {
    if (g.costCurrent == null || !g.supplierId) return;
    setBusyKey(`sp:${g.key}`);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { supplier_id: g.supplierId, price: g.costCurrent };
      if (g.kind === "product") body.product_id = g.id;
      else if (g.kind === "variant") body.variant_id = g.id;
      else body.ingredient_id = g.id;
      const res = await apiJson("/api/vendor/pricelists", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMsg(res.error || "No se pudo guardar");
        return;
      }
      setMsg(`✅ Precio de proveedor creado desde el costo de ${g.name}.`);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function savePrice(r: PriceRow) {
    const value = editPrice[r.id];
    const price = Number(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return;
    setBusyKey(r.id);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { supplier_id: r.supplier_id, price };
      if (r.unit) body.unit = r.unit;
      if (r.product_id) body.product_id = r.product_id;
      if (r.variant_id) body.variant_id = r.variant_id;
      if (r.ingredient_id) body.ingredient_id = r.ingredient_id;
      const res = await apiJson("/api/vendor/pricelists", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMsg(res.error || "No se pudo guardar");
        return;
      }
      setMsg(`✅ Precio de ${r.supplier_name ?? "proveedor"} actualizado.`);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function addPrice(g: Group) {
    const np = newPrice[g.key];
    const supplierId = np?.supplierId || "";
    const price = Number(String(np?.price ?? "").replace(",", "."));
    if (!supplierId || !Number.isFinite(price) || price < 0) return;
    setBusyKey(`new:${g.key}`);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { supplier_id: supplierId, price };
      if (g.kind === "product") body.product_id = g.id;
      else if (g.kind === "variant") body.variant_id = g.id;
      else body.ingredient_id = g.id;
      const res = await apiJson("/api/vendor/pricelists", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMsg(res.error || "No se pudo guardar");
        return;
      }
      setMsg(`✅ Precio agregado a ${g.name}.`);
      setNewPrice((s) => ({ ...s, [g.key]: { supplierId: "", price: "" } }));
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto, variante o insumo…"
          className="flex-1 min-w-[200px]"
        />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filtrar por proveedor"
        >
          <option value="">Todos los proveedores</option>
          {supplierNames.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={onlyNoCost} onChange={(e) => setOnlyNoCost(e.target.checked)} className="h-4 w-4 accent-lime-500" />
          Solo sin costo cargado
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={inheritVariants} onChange={(e) => setInheritVariants(e.target.checked)} className="h-4 w-4 accent-lime-500" />
          Al aplicar un producto, copiar el costo a sus variantes sin precio propio
        </label>
        <Button type="button" onClick={applyAll} disabled={allBusy || groups.length === 0}>
          {allBusy ? "Aplicando…" : "⚡ Aplicar todos los mejores precios"}
        </Button>
      </div>

      {msg && <p className="text-sm text-muted-foreground whitespace-pre-line">{msg}</p>}

      {rows == null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {groups.length === 0
              ? "Todavía no hay catálogo cargado. Agregá productos o insumos primero."
              : "Nada coincide con el filtro."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => (
            <div key={g.key} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm min-w-0">
                  {g.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  Mejor precio:{" "}
                  <strong className="text-foreground tabular-nums">{money(g.bestPrice)}</strong>
                  {g.bestSupplier ? ` · ${g.bestSupplier}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  Costo actual:{" "}
                  <strong className={g.costCurrent != null ? "text-foreground tabular-nums" : "text-amber-700"}>
                    {money(g.costCurrent)}
                  </strong>
                </span>
                <span className="flex-1" />
                <Button size="sm" type="button" onClick={() => applyTarget(g)} disabled={busyKey === g.key || g.bestPrice == null}>
                  {busyKey === g.key ? "Aplicando…" : "Aplicar como costo"}
                </Button>
                {g.supplierId && g.costCurrent != null && (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => useCostAsSupplierPrice(g)}
                    disabled={busyKey === `sp:${g.key}`}
                    title="Crea un precio de proveedor a partir del costo cargado"
                  >
                    {busyKey === `sp:${g.key}` ? "…" : "↩︎ Usar costo como precio de proveedor"}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen((s) => ({ ...s, [g.key]: !s[g.key] }));
                    if (editCost[g.key] === undefined) setEditCost((s) => ({ ...s, [g.key]: g.costCurrent != null ? String(g.costCurrent) : "" }));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {open[g.key] ? "▾ Ocultar" : "▸ Precios y costo"}
                </button>
              </div>

              {open[g.key] && (
                <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-2">
                  {/* Costo inline */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">Costo de referencia:</span>
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={editCost[g.key] ?? (g.costCurrent != null ? String(g.costCurrent) : "")}
                      onChange={(e) => setEditCost((s) => ({ ...s, [g.key]: e.target.value }))}
                      className="w-28 h-8"
                      aria-label={`Costo de ${g.name}`}
                    />
                    <Button size="sm" type="button" variant="outline" onClick={() => saveCost(g)} disabled={busyKey === `cost:${g.key}`}>
                      {busyKey === `cost:${g.key}` ? "…" : "Guardar"}
                    </Button>
                    {g.costCurrent != null && (
                      <span className="text-muted-foreground tabular-nums">actual: {money(g.costCurrent)}</span>
                    )}
                  </div>
                  {/* Precios por proveedor */}
                  {g.rows.length > 0 && (
                    <div className="space-y-1">
                      {g.rows.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="w-40 truncate font-medium">{r.supplier_name ?? "Proveedor"}</span>
                          <span className="text-muted-foreground tabular-nums">
                            {money(r.price)}{r.unit ? ` / ${r.unit}` : ""}
                          </span>
                          <span className="flex-1" />
                          <Input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            value={editPrice[r.id] ?? String(r.price)}
                            onChange={(e) => setEditPrice((s) => ({ ...s, [r.id]: e.target.value }))}
                            className="w-28 h-8"
                            aria-label={`Precio de ${r.supplier_name ?? "proveedor"}`}
                          />
                          <Button size="sm" type="button" variant="outline" onClick={() => savePrice(r)} disabled={busyKey === r.id}>
                            Guardar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Alta de precio por proveedor */}
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1 border-t border-border">
                    <span className="text-muted-foreground">＋ Agregar:</span>
                    <select
                      value={newPrice[g.key]?.supplierId ?? ""}
                      onChange={(e) =>
                        setNewPrice((s) => ({ ...s, [g.key]: { supplierId: e.target.value, price: s[g.key]?.price ?? "" } }))
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      aria-label="Proveedor"
                    >
                      <option value="">Proveedor…</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={newPrice[g.key]?.price ?? ""}
                      onChange={(e) =>
                        setNewPrice((s) => ({ ...s, [g.key]: { supplierId: s[g.key]?.supplierId ?? "", price: e.target.value } }))
                      }
                      className="w-28 h-8"
                      placeholder="$ precio"
                    />
                    <Button size="sm" type="button" variant="outline" onClick={() => addPrice(g)} disabled={busyKey === `new:${g.key}`}>
                      Agregar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
