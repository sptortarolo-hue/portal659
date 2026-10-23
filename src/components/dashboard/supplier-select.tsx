"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SupplierOption = {
  id: string;
  name: string;
  phone?: string | null;
  active?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function SupplierSelect({ value, onChange, disabled = false }: Props) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/vendor/suppliers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          if (alive) setHidden(true);
          return;
        }
        const data = await res.json();
        if (alive) setSuppliers(Array.isArray(data?.suppliers) ? data.suppliers : []);
      })
      .catch(() => {
        if (alive) setHidden(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (hidden) return null;

  const selected = suppliers.find((s) => s.id === value);
  const missingCurrent = value && !selected;

  async function createSupplier() {
    const name = newName.trim();
    if (!name) {
      setError("Indicá el nombre del proveedor");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/vendor/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: newPhone.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.supplier?.id) {
        setError(data?.error || "No se pudo crear el proveedor");
        return;
      }
      const created: SupplierOption = data.supplier;
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(created.id);
      setCreating(false);
      setNewName("");
      setNewPhone("");
    } catch {
      setError("No se pudo crear el proveedor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Proveedor habitual</Label>
        {!creating && (
          <button
            type="button"
            className="text-xs font-medium text-primary"
            onClick={() => {
              setCreating(true);
              setError("");
            }}
            disabled={disabled || loading}
          >
            ＋ Nuevo
          </button>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
      >
        <option value="">Sin proveedor</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.active === false ? " (inactivo)" : ""}
          </option>
        ))}
        {missingCurrent && <option value={value}>Proveedor actual</option>}
      </select>
      {selected?.phone && (
        <p className="text-xs text-muted-foreground">📞 {selected.phone}</p>
      )}
      {!loading && suppliers.length === 0 && !creating && (
        <p className="text-xs text-muted-foreground">
          Cargá uno acá o desde Compras → Proveedores.
        </p>
      )}
      {creating && (
        <div className="rounded-xl border border-border bg-muted/30 p-2 space-y-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del proveedor"
            className="h-9"
            disabled={saving}
          />
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="WhatsApp (ej. 221 555 0000)"
            className="h-9"
            disabled={saving}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-1.5">
            <Button type="button" size="sm" onClick={createSupplier} disabled={saving}>
              {saving ? "Creando…" : "Crear y elegir"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
