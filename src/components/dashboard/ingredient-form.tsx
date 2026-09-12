"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiJson } from "@/components/dashboard/shared";
import { PriceHistory } from "@/components/dashboard/purchases-manager";
import type { Ingredient } from "@/types/database";
import { WASTE_PRESETS } from "@/lib/costing";

// ---------------------------------------------------------------------------
// Formulario de insumo (crear / editar).
// ---------------------------------------------------------------------------
export function IngredientForm({
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
