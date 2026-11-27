"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CategoryOption = { id: string; name: string };

const NEW_CATEGORY = "__nueva__";

/**
 * Selector de categoría con alta inline. Compartido por el alta rápida desde
 * una compra (QuickCreateSheet) y por el asistente de precios.
 *
 * `value` es el NOMBRE de la categoría: products.category es texto y el
 * servidor lo canoniza con resolveCategoryName() contra vendor_categories.
 * Vacío ⇒ "otras" (comportamiento histórico).
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  onCategoryCreated,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (name: string) => void;
  onCategoryCreated?: (category: CategoryOption) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const known = categories.some((c) => c.name === value);

  async function createCategory() {
    const name = newName.trim();
    if (!name) {
      setError("Indicá el nombre de la categoría");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/vendor/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El índice único es case-insensitive: si ya existe, la elegimos.
        const existing = categories.find(
          (c) => c.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (existing) {
          onChange(existing.name);
          setCreating(false);
          setNewName("");
          setError("");
          return;
        }
        setError(data?.error || "No se pudo crear la categoría");
        return;
      }
      const cat = data?.category;
      if (cat?.name) {
        onChange(String(cat.name));
        onCategoryCreated?.({ id: String(cat.id), name: String(cat.name) });
      }
      setCreating(false);
      setNewName("");
    } catch {
      setError("No se pudo conectar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Categoría</Label>
      {!creating ? (
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_CATEGORY) {
              setCreating(true);
              setError("");
              return;
            }
            onChange(v);
          }}
          className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
        >
          <option value="">Sin categoría (se guarda en «otras»)</option>
          {!known && value && <option value={value}>{value}</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
          <option value={NEW_CATEGORY}>+ Nueva categoría…</option>
        </select>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createCategory();
              }
            }}
            placeholder="Nombre de la categoría"
            className="h-8 text-xs flex-1 min-w-[9rem]"
          />
          <Button type="button" size="sm" onClick={() => void createCategory()} disabled={saving}>
            {saving ? "Creando…" : "Crear"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => { setCreating(false); setNewName(""); setError(""); }}
          >
            Cancelar
          </Button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
