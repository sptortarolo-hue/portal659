"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import type { ModifierGroup, ModifierOption } from "@/types/database";

type GroupRow = ModifierGroup & { product_ids?: string[]; products_count?: number };

type Product = { id: string; name: string };

type GroupData = {
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  /** NULL = legacy (obligatorio exige ≥1). Solo rige si required. */
  min_selections: number | null;
  is_variant: boolean;
  product_ids: string[];
};

function emptyOption(): ModifierOption {
  return { label: "", price_mod: 0 };
}

function GroupForm({
  initial = null,
  products,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: GroupRow | null;
  products: Product[];
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: (data: GroupData) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.group_name || "");
  const [options, setOptions] = useState<ModifierOption[]>(
    (initial?.options && initial.options.length ? initial.options : [emptyOption()]).map((o) => ({ ...o }))
  );
  const [required, setRequired] = useState(initial ? !!initial.required : false);
  const [maxSel, setMaxSel] = useState(String(initial?.max_selections || 1));
  const [minSel, setMinSel] = useState(
    initial?.min_selections != null ? String(initial.min_selections) : ""
  );
  const [isVariant, setIsVariant] = useState(initial ? !!initial.is_variant : false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial?.product_ids || [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setOpt(i: number, patch: Partial<ModifierOption>) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function addOpt() {
    setOptions((prev) => [...prev, emptyOption()]);
  }
  function removeOpt(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setError("");
    const clean = options
      .map((o) => ({
        label: o.label.trim(),
        price_mod: Number(o.price_mod) || 0,
        ...(String(o.category ?? "").trim() ? { category: String(o.category).trim().slice(0, 40) } : {}),
      }))
      .filter((o) => o.label !== "");
    if (!name.trim()) return setError("Indicá el nombre del grupo");
    if (clean.length === 0) return setError("Agregá al menos una opción");
    const maxN = Math.max(1, Number(maxSel) || 1);
    const req = required || isVariant;
    // Mínimo: vacío = legacy (≥1 si obligatorio). Clampeado a 1..max.
    let minN: number | null = null;
    if (req) {
      const m = Math.floor(Number(minSel));
      minN = Number.isFinite(m) && m >= 1 ? Math.min(m, maxN) : 1;
    }
    setSaving(true);
    try {
      await onSubmit({
        group_name: name.trim(),
        options: clean,
        required: req,
        max_selections: maxN,
        min_selections: minN,
        is_variant: isVariant,
        product_ids: Array.from(selected),
      });
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 border-primary/30">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">{initial ? "Editar grupo" : "Nuevo grupo"}</h4>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Es variante</Label>
            <Switch
              checked={isVariant}
              onCheckedChange={(v) => {
                setIsVariant(v);
                if (v) setRequired(true);
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grupo (ej: Tamaño, Extras, Variante)"
            className="flex-1"
          />
          <Input
            type="number"
            min={0}
            className="w-20"
            value={minSel}
            onChange={(e) => setMinSel(e.target.value)}
            title="Mínimo de selecciones (vacío = 1 si es obligatorio)"
            placeholder="Mín"
            disabled={!required && !isVariant}
          />
          <Input
            type="number"
            min={1}
            className="w-20"
            value={maxSel}
            onChange={(e) => setMaxSel(e.target.value)}
            title="Máximo de selecciones"
            placeholder="Máx"
          />
        </div>
        {(required || isVariant) && (
          <p className="text-xs text-muted-foreground">
            Mínimo {minSel && Number(minSel) >= 1 ? Math.min(Math.max(1, Math.floor(Number(minSel))), Math.max(1, Number(maxSel) || 1)) : 1}
            {" "}· Máximo {Math.max(1, Number(maxSel) || 1)}
            {minSel && Number(minSel) >= Math.max(1, Number(maxSel) || 1)
              ? " — hay que elegir exactamente esa cantidad (ej: 2 gustos en el 1/4 kg)."
              : " — el cliente puede elegir dentro de ese rango."}
          </p>
        )}
        {isVariant && (
          <p className="text-xs text-primary">
            ⭐ Variante: aparece primero en la ficha y es obligatorio elegir una opción.
          </p>
        )}

        <div className="space-y-1.5">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o.label}
                onChange={(e) => setOpt(i, { label: e.target.value })}
                placeholder="Opción"
                className="flex-1"
              />
              <Input
                value={o.category || ""}
                onChange={(e) => setOpt(i, { category: e.target.value })}
                placeholder="Familia"
                title="Familia para filtrar (ej: Cremas, Chocolates). Opcional."
                className="w-24"
              />
              <Input
                type="number"
                step="0.01"
                value={o.price_mod === 0 ? "" : String(o.price_mod)}
                onChange={(e) => setOpt(i, { price_mod: Number(e.target.value) || 0 })}
                placeholder="$"
                className="w-20"
              />
              <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeOpt(i)} disabled={options.length <= 1}>
                ✕
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addOpt}>
            + Opción
          </Button>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Obligatorio</Label>
          <div className="flex items-center gap-2 mt-1">
            <Switch checked={required} onCheckedChange={setRequired} disabled={isVariant} />
            <span className="text-xs text-muted-foreground">{required ? "Sí" : "No"}</span>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Aplicar a platos ({selected.size})
          </Label>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto mt-1">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    });
                  }}
                  className="h-4 w-4"
                />
                <span className="truncate text-xs">{p.name}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button type="button" className="flex-1" disabled={saving} onClick={handleSubmit}>
            {saving ? "Guardando..." : submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Biblioteca de grupos de modificadores (definidos una vez, asignados a N platos). */
export function ModifierLibrary({ products }: { products: Product[] }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vendor/modifiers");
    const data = await res.json();
    if (!data.error) setGroups(data.groups || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(data: GroupData) {
    const res = await fetch("/api/vendor/modifiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "No se pudo crear");
    setCreating(false);
    setMsg("Grupo creado");
    load();
  }

  async function update(id: string, data: GroupData) {
    const res = await fetch(`/api/vendor/modifiers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "No se pudo guardar");
    setEditing(null);
    setMsg("Grupo actualizado");
    load();
  }

  async function submitGroup(data: GroupData) {
    if (editing) return update(editing.id, data);
    return create(data);
  }

  async function remove(g: GroupRow) {
    if (!confirm(`¿Eliminar el grupo "${g.group_name}"? Se desasigna de todos los platos.`)) return;
    setBusy(g.id);
    await fetch(`/api/vendor/modifiers/${g.id}`, { method: "DELETE" });
    setBusy(null);
    setMsg("Grupo eliminado");
    load();
  }

  const ordered = [...groups].sort((a, b) => Number(b.is_variant) - Number(a.is_variant));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Definí cada grupo una vez y asignalo a 1 o N platos.
        </p>
        <Button type="button" size="sm" onClick={() => { setCreating(!creating); setEditing(null); }}>
          {creating ? "Cancelar" : "+ Grupo"}
        </Button>
      </div>

      {creating && (
        <GroupForm products={products} submitLabel="Crear grupo" onCancel={() => setCreating(false)} onSubmit={create} />
      )}
      {editing && (
        <GroupForm
          initial={editing}
          products={products}
          submitLabel="Guardar cambios"
          onCancel={() => setEditing(null)}
          onSubmit={(d) => update(editing.id, d)}
        />
      )}

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {loading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No tenés grupos de modificadores. Creá uno, por ejemplo "Tamaño", "Extras" o "Variante".
        </p>
      ) : (
        <div className="space-y-2">
          {ordered.map((g) => (
            <Card key={g.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className={`text-sm font-medium ${g.is_variant ? "text-primary" : ""}`}>
                    {g.is_variant ? "⭐ " : ""}{g.group_name}
                  </span>
                  {g.is_variant && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Variante</span>
                  )}
                  {g.required && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Obligatorio</span>
                  )}
                  {g.max_selections > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Hasta {g.max_selections}</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {g.products_count || 0} plato{(g.products_count || 0) !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => { setEditing(g); setCreating(false); }} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" title="Editar">✏️</button>
                  <button onClick={() => remove(g)} disabled={busy === g.id} className="p-1.5 rounded-md hover:bg-red-50 text-red-600" title="Eliminar">🗑️</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(g.options || []).map((o, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {o.label}
                    {o.price_mod !== 0 && <span className="text-primary">{o.price_mod > 0 ? `+$${o.price_mod}` : `$${o.price_mod}`}</span>}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Editor de modificadores dentro de la ficha de un plato. */
export function ProductModifiersBlock({
  productId,
  productName,
}: {
  productId: string | null;
  productName?: string;
}) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setLoading(false);
      return;
    }
    const res = await fetch("/api/vendor/modifiers");
    const data = await res.json();
    if (!data.error) {
      setGroups(data.groups || []);
      setAssigned((data.assignments && data.assignments[productId]) || []);
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  if (!productId) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Guardá el plato para poder asignarle modificadores.
        </p>
      </div>
    );
  }

  const assignedGroups = assigned
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is GroupRow => !!g)
    .sort((a, b) => Number(b.is_variant) - Number(a.is_variant));
  const available = groups.filter((g) => !assigned.includes(g.id));

  async function assignGroup(gid: string) {
    setBusy(gid);
    const group = groups.find((g) => g.id === gid);
    const nextIds = [...(group?.product_ids || []), productId!];
    const res = await fetch(`/api/vendor/modifiers/${gid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_ids: nextIds }),
    });
    setBusy(null);
    const json = await res.json();
    if (json.error) return setMsg(json.error);
    setMsg("Agregado");
    load();
  }

  async function unassignGroup(gid: string) {
    setBusy(gid);
    const group = groups.find((g) => g.id === gid);
    const nextIds = (group?.product_ids || []).filter((id) => id !== productId);
    const res = await fetch(`/api/vendor/modifiers/${gid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_ids: nextIds }),
    });
    setBusy(null);
    const json = await res.json();
    if (json.error) return setMsg(json.error);
    setMsg("Quitado");
    load();
  }

  async function createAndAssign(data: GroupData) {
    const res = await fetch("/api/vendor/modifiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, product_ids: [productId!] }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "No se pudo crear");
    setCreating(false);
    setMsg("Grupo creado y asignado");
    load();
  }

  async function move(gid: string, dir: -1 | 1) {
    const idx = assigned.indexOf(gid);
    const target = idx + dir;
    if (target < 0 || target >= assigned.length) return;
    const next = [...assigned];
    const [m] = next.splice(idx, 1);
    next.splice(target, 0, m);
    setAssigned(next);
    setBusy(gid);
    const res = await fetch("/api/vendor/modifiers/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, group_ids: next }),
    });
    setBusy(null);
    const json = await res.json();
    if (json.error) setMsg(json.error);
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          Modificadores {productName ? `de ${productName}` : ""}
        </Label>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(!creating)}>
            {creating ? "Cancelar" : "+ Agregar"}
          </Button>
        </div>
      </div>

      {creating && (
        <GroupForm
          products={[{ id: productId, name: productName || "este plato" }]}
          submitLabel="Crear y asignar"
          onCancel={() => setCreating(false)}
          onSubmit={createAndAssign}
        />
      )}

      {available.length > 0 && !creating && (
        <div className="flex flex-wrap gap-1">
          {available.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={busy === g.id}
              onClick={() => assignGroup(g.id)}
              className="text-[11px] px-2 py-1 rounded-full border border-border hover:border-primary hover:text-primary transition-colors"
            >
              + {g.is_variant ? "⭐ " : ""}{g.group_name}
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-xs text-green-600">{msg}</p>}

      {loading ? (
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
      ) : assignedGroups.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground">
          Este plato no tiene modificadores todavía.
        </p>
      ) : (
        <div className="space-y-1.5">
          {assignedGroups.map((g, i) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm font-medium ${g.is_variant ? "text-primary" : ""}`}>
                  {g.is_variant ? "⭐ " : ""}{g.group_name}
                </span>
                {g.is_variant && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">obligatorio</span>
                )}
                {g.required && !g.is_variant && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">obligatorio</span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" onClick={() => move(g.id, -1)} disabled={i === 0 || busy === g.id} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(g.id, 1)} disabled={i === assignedGroups.length - 1 || busy === g.id} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30">↓</button>
                <button type="button" onClick={() => unassignGroup(g.id)} disabled={busy === g.id} className="p-1 rounded hover:bg-red-50 text-red-600">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}