"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { GroupForm } from "@/components/dashboard/modifier-editor";
import type { ModifierGroup } from "@/types/database";

type Product = { id: string; name: string };

type GroupRow = ModifierGroup & {
  product_ids?: string[];
  products_count?: number;
  position?: number;
  product_id?: string;
  /** Override de cantidad de ESTE producto (NULL = default del grupo). */
  link_max?: number | null;
  link_min?: number | null;
};

type GroupData = {
  group_name: string;
  options: ModifierGroup["options"];
  required: boolean;
  max_selections: number;
  min_selections: number | null;
  is_variant: boolean;
  price_mode: "diferencia" | "total";
  product_ids: string[];
  link_max?: number | null;
  link_min?: number | null;
};

/** Solapa ⚙️ Opciones, del lado del producto: muestra los grupos de opciones
 *  cargados en UN producto y permite editar TODOS sus campos ahí mismo
 *  (nombre, obligatorio, variante, cantidad, modo de precio y cada opción:
 *  nombre, familia, precio, promo y pausar). El selector sigue al producto
 *  que se está editando en la otra solapa. */
export function ProductOptionsEditor({
  products,
  initialProductId = null,
  isModa = false,
  isComercio = false,
  onChanged,
  header,
}: {
  products: Product[];
  /** Producto preseleccionado (el que está abierto en el editor). */
  initialProductId?: string | null;
  isModa?: boolean;
  isComercio?: boolean;
  onChanged?: () => void;
  /** Bloque extra arriba (Kit heladería, solo gastro). */
  header?: ReactNode;
}) {
  const isRetail = isModa || isComercio;
  const itemLabel = isRetail ? "producto" : "plato";
  const itemLabelPlural = isRetail ? "productos" : "platos";

  const [productId, setProductId] = useState<string>(initialProductId || products[0]?.id || "");
  const [allGroups, setAllGroups] = useState<GroupRow[]>([]);
  const [flat, setFlat] = useState<GroupRow[]>([]);
  const [mine, setMine] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  /** Contador de requests: descarta respuestas viejas al cambiar de producto. */
  const reqId = useRef(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [otherEditingId, setOtherEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  // Los productos del comercio llegan async: si no hay ninguno elegido,
  // arrancamos con el primero para no mostrar la vista vacía.
  useEffect(() => {
    if (!productId && products.length > 0) setProductId(products[0].id);
  }, [productId, products]);

  // Al cambiar de producto se limpia la lista vieja (evita mostrar grupos
  // del producto anterior bajo el nombre nuevo).
  useEffect(() => { setMine([]); }, [productId]);

  // El selector sigue al producto abierto en el editor (si cambia).
  useEffect(() => {
    if (initialProductId && initialProductId !== productId) {
      setProductId(initialProductId);
      setEditingId(null);
      setCreating(false);
      setOtherEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId]);

  const load = useCallback(async () => {
    // Esqueletos solo en la primera carga: los refrescos posteriores (tras
    // guardar) no deben hacer parpadear la lista.
    if (!loadedOnce.current) setLoading(true);
    // Si el usuario cambia de producto a mitad del fetch, la respuesta
    // vieja se descarta (no pisa la del producto nuevo).
    const req = ++reqId.current;
    try {
      const res = await fetch("/api/vendor/modifiers");
      const data = await res.json();
      if (!data.error) {
        setAllGroups((data.groups || []) as GroupRow[]);
        setFlat((data.modifiers || []) as GroupRow[]);
      }
      if (productId) {
        const r2 = await fetch(`/api/vendor/modifiers?product_id=${encodeURIComponent(productId)}`);
        const d2 = await r2.json();
        if (req === reqId.current) setMine(!d2.error ? ((d2.groups || []) as GroupRow[]) : []);
      } else if (req === reqId.current) {
        setMine([]);
      }
    } finally {
      if (req === reqId.current) {
        loadedOnce.current = true;
        setLoading(false);
      }
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  /** Grupos del producto con el override de cantidad y el conteo de productos
   *  (para el aviso de "grupo compartido"). */
  const mineRich = useMemo<GroupRow[]>(
    () =>
      mine.map((g) => {
        const link = flat.find((m) => m.id === g.id && m.product_id === productId);
        const base = allGroups.find((a) => a.id === g.id);
        return {
          ...g,
          product_ids: base?.product_ids || [],
          products_count: base?.products_count ?? 0,
          link_max: link?.link_max ?? null,
          link_min: link?.link_min ?? null,
        };
      }),
    [mine, flat, allGroups, productId]
  );

  const others = useMemo(
    () => allGroups.filter((g) => !mine.some((m) => m.id === g.id)),
    [allGroups, mine]
  );

  const currentProduct = products.find((p) => p.id === productId) || null;

  async function saveScope(id: string, data: GroupData) {
    setBusy(id);
    setMsg("");
    // 1) Campos del grupo. min/max NO van acá: son del link de este producto.
    const res = await fetch(`/api/vendor/modifiers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        group_name: data.group_name,
        options: data.options,
        required: data.required,
        is_variant: data.is_variant,
        price_mode: data.price_mode,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      setBusy(null);
      setMsg(json.error || "No se pudo guardar el grupo");
      return;
    }
    // 2) Override de cantidad de este producto (NULL = default del grupo).
    if (data.link_max !== undefined || data.link_min !== undefined) {
      const r2 = await fetch("/api/vendor/modifier-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: id,
          product_id: productId,
          max_selections: data.link_max ?? null,
          min_selections: data.link_min ?? null,
        }),
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || j2.error) {
        setBusy(null);
        setMsg(j2.error || "No se pudo guardar la cantidad de este producto");
        return;
      }
    }
    setBusy(null);
    setEditingId(null);
    setMsg("Opciones actualizadas");
    load();
    onChanged?.();
  }

  async function createScope(data: GroupData) {
    if (!productId) return;
    setBusy("new");
    setMsg("");
    const res = await fetch("/api/vendor/modifiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, product_ids: [productId] }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || json.error) {
      setMsg(json.error || "No se pudo crear el grupo");
      return;
    }
    setCreating(false);
    setMsg(`Grupo creado y asignado a ${currentProduct?.name || `este ${itemLabel}`}`);
    load();
    onChanged?.();
  }

  async function updateLibrary(id: string, data: GroupData) {
    setBusy(id);
    setMsg("");
    const res = await fetch(`/api/vendor/modifiers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || json.error) {
      setMsg(json.error || "No se pudo guardar");
      return;
    }
    setOtherEditingId(null);
    setMsg("Grupo actualizado");
    load();
    onChanged?.();
  }

  /** Asigna/quita un grupo de ESTE producto. El PATCH reconcilia los links
   *  (preservando overrides) y el reorder fija el orden final para que el
   *  grupo nuevo caiga al final y no en medio de la lista. */
  async function setAssigned(g: GroupRow, nextIds: string[], finalOrder?: string[]) {
    if (!productId) return;
    setBusy(g.id);
    setMsg("");
    const res = await fetch(`/api/vendor/modifiers/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_ids: nextIds }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      setBusy(null);
      setMsg(json.error || "No se pudo actualizar la asignación");
      return;
    }
    if (finalOrder && finalOrder.length > 0) {
      const r2 = await fetch("/api/vendor/modifiers/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, group_ids: finalOrder }),
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || j2.error) {
        setBusy(null);
        setMsg(j2.error || "No se pudo ordenar los grupos");
        load();
        return;
      }
    }
    setBusy(null);
    load();
    onChanged?.();
  }

  function assign(g: GroupRow) {
    setAssigned(g, [...(g.product_ids || []), productId], [...mineRich.map((m) => m.id), g.id]);
    setMsg(`"${g.group_name}" agregado a ${currentProduct?.name || `este ${itemLabel}`}`);
  }

  function unassign(g: GroupRow) {
    setAssigned(
      g,
      (g.product_ids || []).filter((id) => id !== productId),
      mineRich.map((m) => m.id).filter((id) => id !== g.id)
    );
    setMsg(`"${g.group_name}" quitado de ${currentProduct?.name || `este ${itemLabel}`}`);
  }

  async function move(gid: string, dir: -1 | 1) {
    const ids = mineRich.map((g) => g.id);
    const idx = ids.indexOf(gid);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[idx], next[target]] = [next[target], next[idx]];
    setMine((prev) => {
      const copy = [...prev];
      const [m] = copy.splice(idx, 1);
      copy.splice(target, 0, m);
      return copy;
    });
    setBusy(gid);
    const res = await fetch("/api/vendor/modifiers/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, group_ids: next }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || json.error) {
      setMsg(json.error || "No se pudo reordenar");
      load();
      return;
    }
    onChanged?.();
  }

  async function removeGroup(g: GroupRow) {
    if (!confirm(`¿Eliminar el grupo "${g.group_name}"? Se borra de todos los ${itemLabelPlural}.`)) return;
    setBusy(g.id);
    await fetch(`/api/vendor/modifiers/${g.id}`, { method: "DELETE" });
    setBusy(null);
    if (editingId === g.id) setEditingId(null);
    if (otherEditingId === g.id) setOtherEditingId(null);
    setMsg("Grupo eliminado");
    load();
    onChanged?.();
  }

  /** Chips de resumen de las opciones de un grupo (con precio/promo/pausa). */
  function optionChips(g: GroupRow) {
    const groupTotal = g.price_mode === "total";
    return (g.options || []).map((o, i) => {
      const normal = groupTotal && o.price_total != null ? Number(o.price_total) : Number(o.price_mod) || 0;
      const fmt = (n: number) =>
        groupTotal ? `$${n.toLocaleString("es-AR")}` : n > 0 ? `+$${n.toLocaleString("es-AR")}` : `$${n.toLocaleString("es-AR")}`;
      const hasPromo = o.promo != null && Number(o.promo) >= 0 && Number(o.promo) < normal;
      const showNormal = groupTotal ? o.price_total != null : o.price_mod !== 0;
      return (
        <span
          key={`${g.id}-${i}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            o.available === false
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {o.available === false && <span title="Pausado (oculto en la venta)">🚫</span>}
          {o.label}
          {o.category ? <span className="opacity-70">· {o.category}</span> : null}
          {hasPromo ? (
            <span className="text-primary font-semibold">
              <span className="line-through opacity-70 font-normal">{fmt(normal)}</span> {fmt(Number(o.promo))} 🔥
            </span>
          ) : showNormal ? (
            <span className="text-primary">{fmt(normal)}</span>
          ) : null}
        </span>
      );
    });
  }

  function badges(g: GroupRow) {
    const effMax = g.link_max ?? g.max_selections;
    const effMin = (g.required || g.is_variant) ? (g.link_min ?? g.min_selections ?? 1) : 0;
    const hasOverride = g.link_max != null || g.link_min != null;
    return (
      <>
        {g.is_variant && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Variante</span>}
        {g.price_mode === "total" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Precio final</span>}
        {g.required && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Obligatorio</span>}
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          hasta {effMax}{effMin > 0 ? ` · mín ${effMin}` : ""}
        </span>
        {hasOverride && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium" title={`Cantidad propia de este ${itemLabel}`}>
            propia
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {g.products_count || 0} {(g.products_count || 0) === 1 ? itemLabel : itemLabelPlural}
        </span>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Opciones de</Label>
          <select
            className="flex h-9 min-w-0 max-w-[200px] sm:max-w-[320px] rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setEditingId(null);
              setCreating(false);
              setOtherEditingId(null);
            }}
            aria-label={`Elegir el ${itemLabel}`}
          >
            {products.length === 0 && <option value="">Sin {itemLabelPlural}</option>}
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!productId || busy !== null}
          onClick={() => { setCreating(!creating); setEditingId(null); setOtherEditingId(null); }}
        >
          {creating ? "Cancelar" : `+ Grupo para este ${itemLabel}`}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Acá ves y editás todas las opciones cargadas en{" "}
        <strong className="text-foreground">{currentProduct?.name || `este ${itemLabel}`}</strong>: nombre del grupo,
        si es obligatorio, cuántas se pueden elegir, cómo se muestran los precios y cada opción (nombre, familia,
        precio, promo y pausar).
      </p>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {creating && productId && (
        <GroupForm
          products={[{ id: productId, name: currentProduct?.name || `este ${itemLabel}` }]}
          submitLabel={`Crear y asignar a ${currentProduct?.name || `este ${itemLabel}`}`}
          onCancel={() => setCreating(false)}
          onSubmit={createScope}
          productScope={{ id: productId, name: currentProduct?.name || `este ${itemLabel}` }}
        />
      )}

      {!productId ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Elegí un {itemLabel} arriba para ver y editar sus opciones.
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : mineRich.length === 0 && !creating ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {currentProduct?.name || `Este ${itemLabel}`} no tiene opciones cargadas. Creá un grupo
            (ej: &quot;Tamaño&quot;, &quot;Extras&quot;, &quot;Variante&quot;) o asigná uno existente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mineRich.map((g, i) => (
            <Card key={g.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className={`text-sm font-medium ${g.is_variant ? "text-primary" : ""}`}>
                    {g.is_variant ? "⭐ " : ""}{g.group_name}
                  </span>
                  {badges(g)}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    title="Editar todas las opciones de este grupo"
                    onClick={() => { setEditingId(editingId === g.id ? null : g.id); setCreating(false); }}
                    className={`p-1.5 rounded-md hover:bg-muted ${editingId === g.id ? "text-primary" : "text-muted-foreground"}`}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    title="Subir"
                    disabled={i === 0 || busy === g.id}
                    onClick={() => move(g.id, -1)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Bajar"
                    disabled={i === mineRich.length - 1 || busy === g.id}
                    onClick={() => move(g.id, 1)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title={`Quitar de este ${itemLabel} (el grupo sigue existiendo)`}
                    disabled={busy === g.id}
                    onClick={() => unassign(g)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    title="Eliminar el grupo de todos los productos"
                    disabled={busy === g.id}
                    onClick={() => removeGroup(g)}
                    className="p-1.5 rounded-md hover:bg-red-50 text-red-600"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              {(g.products_count || 0) > 1 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  ⚑ Grupo compartido por {g.products_count} {itemLabelPlural}: los cambios en las opciones se aplican a todos.
                </p>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {optionChips(g)}
              </div>
              {editingId === g.id && (
                <div className="mt-3 pt-3 border-t border-border">
                  <GroupForm
                    initial={g}
                    products={[{ id: productId, name: currentProduct?.name || `este ${itemLabel}` }]}
                    submitLabel="Guardar cambios"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(d) => saveScope(g.id, d)}
                    productScope={{ id: productId, name: currentProduct?.name || `este ${itemLabel}` }}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Grupos que no están en este producto: se pueden editar (modo
          biblioteca) o asignar. Debajo, para no tapar lo del producto. */}
      {others.length > 0 && (
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setShowOthers(!showOthers)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 rounded-xl"
          >
            <span>Otros grupos ({others.length}) — sin asignar a {currentProduct?.name || `este ${itemLabel}`}</span>
            <span>{showOthers ? "▲" : "▼"}</span>
          </button>
          {showOthers && (
            <div className="space-y-2 p-3 pt-0">
              {others.map((g) => (
                <Card key={g.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className={`text-sm font-medium ${g.is_variant ? "text-primary" : ""}`}>
                        {g.is_variant ? "⭐ " : ""}{g.group_name}
                      </span>
                      {badges(g)}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        title={`Asignar a ${currentProduct?.name || `este ${itemLabel}`}`}
                        disabled={!productId || busy === g.id}
                        onClick={() => assign(g)}
                        className="text-[11px] px-2 py-1 rounded-full border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                      >
                        + Asignar
                      </button>
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => { setOtherEditingId(otherEditingId === g.id ? null : g.id); setEditingId(null); setCreating(false); }}
                        className={`p-1.5 rounded-md hover:bg-muted ${otherEditingId === g.id ? "text-primary" : "text-muted-foreground"}`}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        title="Eliminar el grupo"
                        disabled={busy === g.id}
                        onClick={() => removeGroup(g)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-red-600"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {optionChips(g)}
                  </div>
                  {otherEditingId === g.id && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <GroupForm
                        initial={g}
                        products={products}
                        submitLabel="Guardar cambios"
                        onCancel={() => setOtherEditingId(null)}
                        onSubmit={(d) => updateLibrary(g.id, d)}
                      />
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
