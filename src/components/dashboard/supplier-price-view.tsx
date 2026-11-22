"use client";

/**
 * 💲 Precios por proveedor (Inventario).
 *
 * Muestra, por producto/variante/insumo, el mejor precio cargado en las compras
 * y el costo actual, y permite **aplicar el mejor precio como costo**
 * (`cost_last` / `cost_per_unit`) con un toque — individual o "todos".
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

type Group = {
  key: string;
  kind: "product" | "variant" | "ingredient";
  id: string;
  name: string;
  label: string | null;
  bestPrice: number | null;
  bestSupplier: string | null;
  costCurrent: number | null;
  rows: PriceRow[];
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

function groupKeyOf(r: PriceRow): string {
  if (r.variant_id) return `v:${r.variant_id}`;
  if (r.ingredient_id) return `i:${r.ingredient_id}`;
  return `p:${r.product_id ?? r.id}`;
}

export function SupplierPriceView() {
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inheritVariants, setInheritVariants] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Ediciones locales: precios existentes y alta nueva.
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});
  const [newPrice, setNewPrice] = useState<Record<string, { supplierId: string; price: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/pricelists", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setError(d.error || "No se pudieron cargar los precios");
        return;
      }
      setRows((d.pricelists as PriceRow[]) ?? []);
      setError(null);
    } catch {
      setError("No se pudieron cargar los precios");
    }
  }, []);

  useEffect(() => {
    load();
    getJson<{ suppliers?: Supplier[] }>("/api/vendor/suppliers")
      .then((d) => setSuppliers(d?.suppliers ?? []))
      .catch(() => {});
  }, [load]);

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();
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
          label,
          bestPrice: null,
          bestSupplier: null,
          costCurrent: r.cost_current != null ? Number(r.cost_current) : null,
          rows: [],
        };
        byKey.set(key, g);
      }
      g.rows.push(r);
    }
    const out = [...byKey.values()];
    for (const g of out) {
      const sorted = [...g.rows].sort((a, b) => Number(a.price) - Number(b.price));
      g.rows = sorted;
      if (sorted.length > 0) {
        g.bestPrice = Number(sorted[0].price);
        g.bestSupplier = sorted[0].supplier_name;
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [rows]);

  const supplierNames = useMemo(
    () =>
      [
        ...new Set(
          groups.flatMap((g) => g.rows.map((r) => r.supplier_name).filter((s): s is string => Boolean(s)))
        ),
      ].sort(),
    [groups]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (q && !`${g.name} ${g.label ?? ""}`.toLowerCase().includes(q)) return false;
      if (supplierFilter && !g.rows.some((r) => r.supplier_name === supplierFilter)) return false;
      return true;
    });
  }, [groups, search, supplierFilter]);

  async function applyTarget(g: Group) {
    setBusyKey(g.key);
    setMsg(null);
    try {
      const res = await fetch("/api/vendor/pricelists/apply-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: [{ kind: g.kind, id: g.id, inherit_variants: inheritVariants && g.kind === "product" }],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setMsg(d.error || "No se pudo aplicar el costo");
        return;
      }
      setMsg(
        d.applied > 0
          ? `✅ Costo aplicado a ${g.name}${d.applied > 1 ? ` (+${d.applied - 1} más)` : ""}.` +
            (d.affectedLists?.length ? " Tenés listas de margen para revisar en Catálogo → Listas." : "")
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
          ? `✅ Costo aplicado a ${d.applied} ${
              d.applied === 1 ? "target" : "targets"
            }.${d.skippedNoPrice > 0 ? ` ${d.skippedNoPrice} sin cambios.` : ""}` +
            (d.affectedLists?.length
              ? ` Hay ${d.affectedLists.length} lista(s) de margen con costos nuevos: recalculalas en Catálogo → Listas si querés que los precios se actualicen.`
              : "")
          : "Ningún target tiene precio cargado todavía."
      );
      await load();
    } finally {
      setAllBusy(false);
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
          <input
            type="checkbox"
            checked={inheritVariants}
            onChange={(e) => setInheritVariants(e.target.checked)}
            className="h-4 w-4 accent-lime-500"
          />
          Al aplicar un producto, copiar el costo a sus variantes sin precio propio
        </label>
        <Button type="button" onClick={applyAll} disabled={allBusy || !rows?.length}>
          {allBusy ? "Aplicando…" : "⚡ Aplicar todos los mejores precios"}
        </Button>
      </div>

      {msg && (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{msg}</p>
      )}

      {rows == null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Todavía no hay precios por proveedor cargados. Se guardan solos al cargar una compra (en Compras) y también podés agregarlos acá."
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
                  {g.label && <span className="text-muted-foreground"> · {g.label}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  Mejor: <strong className="text-foreground tabular-nums">{money(g.bestPrice)}</strong>
                  {g.bestSupplier ? ` · ${g.bestSupplier}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  Costo actual:{" "}
                  <strong className={g.costCurrent != null ? "text-foreground tabular-nums" : "text-amber-700"}>
                    {g.costCurrent != null ? money(g.costCurrent) : "sin dato"}
                  </strong>
                </span>
                <span className="flex-1" />
                <Button size="sm" type="button" onClick={() => applyTarget(g)} disabled={busyKey === g.key || g.bestPrice == null}>
                  {busyKey === g.key ? "Aplicando…" : "Aplicar como costo"}
                </Button>
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {open[g.key] ? "▾ Ocultar precios" : `▸ ${g.rows.length} precio(s)`}
                </button>
              </div>

              {open[g.key] && (
                <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-2">
                  {g.rows.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-40 truncate font-medium">{r.supplier_name ?? "Proveedor"}</span>
                      <span className="text-muted-foreground tabular-nums">${Number(r.price).toLocaleString("es-AR", { maximumFractionDigits: 2 })}{r.unit ? ` / ${r.unit}` : ""}</span>
                      <span className="flex-1" />
                      <Input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        defaultValue={String(r.price)}
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
