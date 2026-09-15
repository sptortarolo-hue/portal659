"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";

type Product = { id: string; name: string; category?: string | null };
type Category = { id?: string; name: string };

type TierRow = { id: string; min_qty: number; kind: "fixed_total" | "percent_off"; value: number };

type GroupRow = {
  id: string;
  name: string;
  product_ids: string[];
  combine_promo: boolean;
  combine_cash: boolean;
  extras_mode: "on_top" | "included";
  tiers: { min_qty: number; kind: "fixed_total" | "percent_off"; value: number }[];
};

const fmt$ = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;

function tierLabel(t: { min_qty: number; kind: string; value: number }): string {
  return t.kind === "fixed_total"
    ? `${t.min_qty}x ${fmt$(Number(t.value))}`
    : `${t.min_qty}+ con ${Number(t.value).toLocaleString("es-AR")}% off`;
}

function GroupForm({
  products,
  categories,
  initial = null,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  products: Product[];
  categories: Category[];
  initial?: GroupRow | null;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: (data: {
    name: string;
    product_ids: string[];
    tiers: { min_qty: number; kind: "fixed_total" | "percent_off"; value: number }[];
    combine_promo: boolean;
    combine_cash: boolean;
    extras_mode: "on_top" | "included";
  }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.product_ids || []));
  const [tiers, setTiers] = useState<TierRow[]>(
    initial?.tiers?.length
      ? initial.tiers.map((t, i) => ({ id: `t${i}`, min_qty: Number(t.min_qty), kind: t.kind, value: Number(t.value) }))
      : [{ id: "t0", min_qty: 12, kind: "fixed_total", value: 0 }]
  );
  const [combinePromo, setCombinePromo] = useState(!!initial?.combine_promo);
  const [combineCash, setCombineCash] = useState(!!initial?.combine_cash);
  const [extrasIncluded, setExtrasIncluded] = useState(initial?.extras_mode === "included");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleProduct(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleCategory(catName: string) {
    const ids = products.filter((p) => (p.category || "otras") === catName).map((p) => p.id);
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function setTier(i: number, patch: Partial<TierRow>) {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Ponéle un nombre al grupo (ej: Empanadas)");
    if (selected.size === 0) return setError("Tildá al menos un producto del grupo");
    const clean = tiers
      .map((t) => ({
        min_qty: Math.floor(Number(t.min_qty)),
        kind: t.kind,
        value: Number(t.value),
      }))
      .filter((t) => Number.isFinite(t.min_qty) && Number.isFinite(t.value));
    if (clean.length === 0) return setError("Agregá al menos un tramo válido");
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        product_ids: Array.from(selected),
        tiers: clean,
        combine_promo: combinePromo,
        combine_cash: combineCash,
        extras_mode: extrasIncluded ? "included" : "on_top",
      });
    } catch (err) {
      setError((err as Error).message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  const cats = categories.length > 0
    ? categories.map((c) => c.name)
    : [...new Set(products.map((p) => p.category || "otras"))];

  return (
    <Card className="p-4 border-primary/30">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">{initial ? "Editar grupo" : "Nuevo grupo"}</h4>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Nombre del grupo</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Empanadas, Pizzas, Docena surtida"
            className="mt-1"
            maxLength={60}
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Productos que suman al volumen ({selected.size})
          </Label>
          <div className="space-y-2 mt-1 max-h-52 overflow-y-auto">
            {cats.map((cat) => {
              const items = products.filter((p) => (p.category || "otras") === cat);
              if (items.length === 0) return null;
              const ids = items.map((p) => p.id);
              const allIn = ids.every((id) => selected.has(id));
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {allIn ? "✓" : "○"} {cat} ({items.filter((p) => selected.has(p.id)).length}/{items.length})
                  </button>
                  <div className="grid grid-cols-2 gap-1 mt-0.5">
                    {items.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={(e) => toggleProduct(p.id, e.target.checked)}
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Tramos (cantidad + precio)</Label>
          <div className="space-y-2 mt-1">
            {tiers.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={2}
                  max={99}
                  className="w-20"
                  value={t.min_qty}
                  onChange={(e) => setTier(i, { min_qty: Number(e.target.value) })}
                  title="Cantidad mínima"
                />
                <select
                  value={t.kind}
                  onChange={(e) => setTier(i, { kind: e.target.value as TierRow["kind"] })}
                  className="h-9 rounded-xl border border-border bg-background px-2 text-sm"
                >
                  <option value="fixed_total">Precio fijo ($)</option>
                  <option value="percent_off">% off</option>
                </select>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  className="flex-1 min-w-0"
                  value={t.value || ""}
                  onChange={(e) => setTier(i, { value: Number(e.target.value) })}
                  placeholder={t.kind === "fixed_total" ? "Ej: 18000" : "Ej: 10"}
                />
                {tiers.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setTiers((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {tiers.length < 5 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setTiers((prev) => [
                    ...prev,
                    { id: `t${Date.now()}`, min_qty: 6, kind: "fixed_total", value: 0 },
                  ])
                }
              >
                + Tramo
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-xl bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Si un producto tiene promo, el volumen calcula sobre la promo</Label>
            <Switch checked={combinePromo} onCheckedChange={setCombinePromo} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">El descuento en efectivo se suma al precio por volumen</Label>
            <Switch checked={combineCash} onCheckedChange={setCombineCash} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Los extras con costo están incluidos en el pack</Label>
            <Switch checked={extrasIncluded} onCheckedChange={setExtrasIncluded} />
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button type="submit" size="sm" disabled={saving} className="w-full">
          {saving ? "Guardando..." : submitLabel}
        </Button>
      </form>
    </Card>
  );
}

/** Precios por volumen: grupos mixtos + tramos (solo gastronomía). */
export function VolumeEditor({ products, categories }: { products: Product[]; categories: Category[] }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/vendor/volume-groups");
      const d = await r.json();
      setGroups(d.groups || []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(data: Parameters<Parameters<typeof GroupForm>[0]["onSubmit"]>[0]) {
    const url = editing ? `/api/vendor/volume-groups/${editing.id}` : "/api/vendor/volume-groups";
    const r = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "No se pudo guardar");
    setMsg(editing ? "Grupo actualizado" : "Grupo creado");
    setCreating(false);
    setEditing(null);
    load();
  }

  async function remove(g: GroupRow) {
    if (!confirm(`¿Eliminar el grupo "${g.name}"? Los precios vuelven a la normalidad.`)) return;
    setBusy(g.id);
    try {
      await fetch(`/api/vendor/volume-groups/${g.id}`, { method: "DELETE" });
      setMsg("Grupo eliminado");
      load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando grupos...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Ej: 12 empanadas surtidas a precio de docena. El volumen suma entre gustos.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
          }}
        >
          {creating ? "Cancelar" : "+ Grupo"}
        </Button>
      </div>

      {msg && <p className="text-xs text-green-700">{msg}</p>}

      {creating && !editing && (
        <GroupForm products={products} categories={categories} submitLabel="Crear grupo" onSubmit={save} />
      )}

      {groups.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Todavía no hay grupos. Creá el primero (ej: Empanadas).
        </p>
      )}

      {groups.map((g) => (
        <Card key={g.id} className="p-3">
          {editing?.id === g.id ? (
            <GroupForm
              products={products}
              categories={categories}
              initial={g}
              submitLabel="Guardar cambios"
              onCancel={() => setEditing(null)}
              onSubmit={save}
            />
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm">📦 {g.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(g.tiers || []).map(tierLabel).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(g.product_ids || []).length} producto{(g.product_ids || []).length !== 1 ? "s" : ""}
                  {g.combine_cash ? " · acumula efectivo" : ""}
                  {g.combine_promo ? " · acumula promo" : ""}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(g); setCreating(false); }}>
                  Editar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy === g.id}
                  onClick={() => remove(g)}
                >
                  🗑
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
